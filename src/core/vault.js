/**
 * BioWallet — AES-256-GCM Vault
 *
 * v1: vault_key = PBKDF2(face_R, salt)           — single factor (legacy)
 * v2: vault_key = random 32 bytes, wrapped twice:
 *     faceWrap:   AES-GCM( PBKDF2(face_R, salt),                    vault_key )
 *     deviceWrap: AES-GCM( HKDF(face_R ‖ device_prf, salt), vault_key ) — optional
 * v3: same as v2 but PIN mandatory: PBKDF2(face_R ‖ PIN, salt)
 * v4: SSS 2-of-3  (arc x=1 · device x=2 · paper x=3)
 * v5: SSS 2-of-3 + genesis DNA chain + genesis_backup
 *     genesis.dna = SHA-256(face_R_0 ‖ ts_u64be)   ← arc-only, device-független
 *     dna_chain[0].hash = SHA-256("" + genesis.dna + ts)
 *     dna_chain[n].hash = SHA-256(prev_hash + genesis.dna + ts)
 *     genesis.dna never changes; chain grows on re-enrollment.
 *     genesis_backup = AES-GCM(PBKDF2(R_genesis, gbSalt), seed)
 *       R_genesis = SHA-256(project(embedding, FIXED_W))  ← determinisztikus
 *       genesisS + genesisExtraBit tárolt a P fájlban → arc + P → 24 szó
 */

import { CausalChain, DCCError } from './causal_chain.js?v=11';
import { fuzzyExtract, fuzzyCommit, fuzzyCommitDeterministic, fuzzyExtractDeterministic } from './fuzzy_extractor.js?v=12';
import { seedToAddress, signEthTx, signPersonal, signTypedData, mnemonicToSeed, seedToMnemonic } from './wallet.js?v=15';
import {
  entropyToIndices, fetchRandomOffsets, computeRawPaper,
} from './recovery_formula.js?v=12';
import { split as sssSplit, combine as sssCombine } from './sss.js?v=1';

const AES_MODE            = 'AES-GCM';
const DEVICE_PRF_INFO     = new TextEncoder().encode('biowallet-device-v2');
const GENESIS_HMAC_INFO   = new TextEncoder().encode('biowallet-genesis-hmac-v1');

class BioVault {
  #chain;
  #vaultId;
  #cryptoKey    = null;   // AES-GCM CryptoKey for vault data
  #vaultData    = null;   // { seed, accounts, ... }
  #vaultFormat  = null;   // parsed v2 JSON | null (v1)
  #vaultKeyRaw  = null;   // Uint8Array — vault_key (v2 only), zeroed on lock
  #faceR        = null;   // Uint8Array — face_R from last OPEN, for device enrollment
  #pendingTxHash= null;
  #genesis      = null;   // { dna: hex, ts: number } — v5 only, null otherwise
  #openedViaFace= false;  // true if face share was used in last OPEN (for genesis check)

  constructor(vaultId) {
    this.#vaultId = vaultId;
    this.#chain   = new CausalChain();
  }

  get id()      { return this.#vaultId; }
  get genesis() { return this.#genesis ? { ...this.#genesis } : null; }

  // ── TX commitment (P6) ────────────────────────────────────────────────────

  async commitTx(tx) {
    const canonical = JSON.stringify(tx, Object.keys(tx).sort());
    const hashBuf   = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
    this.#pendingTxHash = hex;
    return hex.slice(0, 8);
  }

  cancelCommit() { this.#pendingTxHash = null; }

  // ── Biometric capture ─────────────────────────────────────────────────────

  async onBioCapture(embedding, P, userInput = null) {
    if (this.#pendingTxHash !== null && userInput !== null) {
      if (userInput !== this.#pendingTxHash.slice(0, 4)) {
        this.#pendingTxHash = null;
        throw new DCCError('TX_MISMATCH', 'BIO_CAPTURE');
      }
    }
    const R = await fuzzyExtract(embedding, P);
    this.#chain.issue(R, this.#vaultId, this.#pendingTxHash);
  }

  // ── Vault creation ────────────────────────────────────────────────────────

  // v37 v5-only: a legacy create() (v2/v3), createV4() és _encryptSeedV4() eltávolítva.

  // ── genesis DNA helpers (v5) ──────────────────────────────────────────────

  // SHA-256(face_R_0 ‖ ts_u64be) — arc-only, device-independent
  static async _computeGenesisDna(R, ts) {
    const tsBytes = new Uint8Array(8);
    new DataView(tsBytes.buffer).setBigUint64(0, BigInt(ts));
    const buf = new Uint8Array(R.length + 8);
    buf.set(R, 0);
    buf.set(tsBytes, R.length);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return toHex(new Uint8Array(hash));
  }

  static async _deriveGenesisBackupKey(R_genesis, gbSalt) {
    const km = await crypto.subtle.importKey('raw', R_genesis, 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: gbSalt, iterations: 300_000, hash: 'SHA-256' },
      km, { name: AES_MODE, length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  // HMAC-SHA256(HKDF(vaultKeyRaw, "biowallet-genesis-hmac-v1"), JSON({genesis, dna_chain}))
  static async _computeGenesisHmac(vaultKeyRaw, genesis, dna_chain) {
    const ikm = await crypto.subtle.importKey('raw', vaultKeyRaw, 'HKDF', false, ['deriveKey']);
    const hmacKey = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: GENESIS_HMAC_INFO },
      ikm, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const data = new TextEncoder().encode(JSON.stringify({ genesis, dna_chain }));
    const sig  = await crypto.subtle.sign('HMAC', hmacKey, data);
    return toHex(new Uint8Array(sig));
  }

  // SHA-256(prevHash + genesisDna + ts.toString())
  static async _buildChainEntry(prevHash, genesisDna, ts, gen, method) {
    const input = new TextEncoder().encode(prevHash + genesisDna + ts.toString());
    const hash  = await crypto.subtle.digest('SHA-256', input);
    return { gen, hash: toHex(new Uint8Array(hash)), ts, method };
  }

  static async _encryptSeedV5(seedBytes, embedding, devicePrf, credentialId, prfSalt, keyType = 'raw') {
    const vaultId = crypto.randomUUID();
    const ts      = Date.now();
    const { R, P } = await fuzzyCommit(embedding);
    const salt     = crypto.getRandomValues(new Uint8Array(32));

    const genesisDna  = await BioVault._computeGenesisDna(R, ts);
    const chainEntry  = await BioVault._buildChainEntry('', genesisDna, ts, 0, 'initial_enrollment');

    // genesis_backup: determinisztikus projekció → seed titkosítva, P fájlban tárolt szindróma
    const { R: R_genesis, genesisS, genesisExtraBit } = await fuzzyCommitDeterministic(embedding);
    const gbSalt  = crypto.getRandomValues(new Uint8Array(32));
    const gbKey   = await BioVault._deriveGenesisBackupKey(R_genesis, gbSalt);
    const { iv: gbIv, ciphertext: gbCtBuf } = await aesEncrypt(gbKey, seedBytes);
    P.genesisS        = genesisS;
    P.genesisExtraBit = genesisExtraBit;

    const vaultKeyRaw = crypto.getRandomValues(new Uint8Array(32));
    try {
      const vaultKey  = await importRawKey(vaultKeyRaw);
      const plain = { seed: toHex(seedBytes), accounts: [], vaultId, created: ts };
      if (keyType !== 'raw') plain.keyType = keyType;
      const plaintext = encode(plain);
      const { iv, ciphertext } = await aesEncrypt(vaultKey, plaintext);

      // SSS: face(x=1) + paper(x=3) only — device is a SEPARATE direct K-wrap.
      // Share at x=2 is generated but immediately discarded (keeps polynomial degree correct).
      // This ensures enrollDevice never changes the paper code.
      const shares = sssSplit(vaultKeyRaw, 3, 2);
      try {
        const faceKey   = await deriveKey(R, salt, null);
        const faceShare = { x: shares[0].x, ...await wrapBytes(faceKey, shares[0].y) };
        // shares[1] (x=2) intentionally discarded — device uses deviceWrap instead
        const paperShareY = shares[2].y.slice();

        // Device: direct vault key wrap (not an SSS share) — enrollDevice can update this freely
        let deviceWrap = null;
        if (devicePrf && credentialId && prfSalt) {
          const devKey = await deriveKeyDevice(R, new Uint8Array(devicePrf), salt);
          deviceWrap = {
            ...await wrapBytes(devKey, vaultKeyRaw),
            credentialId: toHex(new Uint8Array(credentialId)),
            prfSalt:      toHex(new Uint8Array(prfSalt)),
          };
        }

        const genesisHmac = await BioVault._computeGenesisHmac(
          vaultKeyRaw, { dna: genesisDna, ts }, [chainEntry]
        );

        const vault = {
          v: 5, vaultId,
          ...(keyType !== 'raw' && { keyType }),
          genesis_hmac: genesisHmac,
          salt:      toHex(salt),
          iv:        toHex(iv),
          ct:        toHex(new Uint8Array(ciphertext)),
          genesis:   { dna: genesisDna, ts },
          dna_chain: [chainEntry],
          sss:       { faceShare, paperX: 3 },
          deviceWrap,
          genesis_backup: {
            gbSalt: toHex(gbSalt),
            gbIv:   toHex(gbIv),
            gbCt:   toHex(new Uint8Array(gbCtBuf)),
          },
        };

        return {
          vaultId,
          P,
          encryptedVault: new TextEncoder().encode(JSON.stringify(vault)).buffer,
          paperShareY,
        };
      } finally {
        shares[0].y.fill(0);
        shares[1].y.fill(0);
        shares[2].y.fill(0);
      }
    } finally { vaultKeyRaw.fill(0); }
  }

  // ── Vault v5 creation (SSS 2-of-3 + genesis DNA chain) ───────────────────
  static async createV5(embedding, devicePrf = null, credentialId = null, prfSalt = null) {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    try {
      return await BioVault._encryptSeedV5(seed, embedding, devicePrf, credentialId, prfSalt);
    } finally { seed.fill(0); }
  }

  static async importFromMnemonicV5(mnemonic, embedding, devicePrf = null, credentialId = null, prfSalt = null) {
    const seedBytes = mnemonicToSeed(mnemonic);
    try {
      return await BioVault._encryptSeedV5(seedBytes, embedding, devicePrf, credentialId, prfSalt, 'bip39');
    } finally { seedBytes.fill(0); }
  }

  static async importFromPrivKeyV5(privKeyHex, embedding, devicePrf = null, credentialId = null, prfSalt = null) {
    const stripped = privKeyHex.startsWith('0x') || privKeyHex.startsWith('0X')
      ? privKeyHex.slice(2) : privKeyHex;
    if (!/^[0-9a-fA-F]{64}$/.test(stripped))
      throw new Error('INVALID_PRIVATE_KEY');
    const seedBytes = new Uint8Array(stripped.match(/../g).map(x => parseInt(x, 16)));
    try {
      return await BioVault._encryptSeedV5(seedBytes, embedding, devicePrf, credentialId, prfSalt, 'privkey');
    } finally { seedBytes.fill(0); }
  }

  // v37 v5-only: a legacy _encryptSeed() (v2/v3 faceWrap) eltávolítva.

  // ── OPEN ──────────────────────────────────────────────────────────────────

  // paperShare: { x: 3, y: Uint8Array } — only needed for v4 vaults when device not available
  async open(encryptedVault, P, devicePrf = null, pin = null, paperShare = null) {
    const R = this.#chain.gate('OPEN', this.#vaultId);
    this.#faceR = R.slice();

    // v5-only: kizárólag az aktuális v5 formátum nyitható (deviceWrap mező + SSS).
    // Minden más (v1–v4, idegen JSON) → UNSUPPORTED_FORMAT (nincs PIN, nincs néma hiba).
    let v2;
    try { v2 = JSON.parse(new TextDecoder().decode(encryptedVault)); }
    catch { this.lock(); throw new DCCError('UNSUPPORTED_FORMAT', 'OPEN'); }
    if (!(v2 && v2.v === 5 && 'deviceWrap' in v2 && v2.sss)) {
      this.lock();
      throw new DCCError('UNSUPPORTED_FORMAT', 'OPEN');
    }
    const salt = fromHex(v2.salt);

    let vaultKeyRaw = null;
    let usedDevice  = false;

    // Path 1: device direct K-wrap (fastest — no SSS needed)
    if (devicePrf && v2.deviceWrap) {
      try {
        const devKey = await deriveKeyDevice(R, new Uint8Array(devicePrf), salt);
        vaultKeyRaw  = await unwrapBytes(devKey, v2.deviceWrap);
        usedDevice   = true;
      } catch { /* device PRF mismatch or wrong browser */ }
    }

    // Path 2: SSS face(x=1) + paper(x=3)
    let shareA = null;
    if (!vaultKeyRaw) {
      try {
        const faceKey = await deriveKey(R, salt, null);
        const y1      = await unwrapBytes(faceKey, v2.sss.faceShare);
        shareA = { x: v2.sss.faceShare.x, y: y1 };
      } catch {}

      let finalA = shareA;
      let finalB = paperShare ?? null;
      if (!finalA && finalB) { finalA = finalB; finalB = null; }

      if (finalA && finalB) {
        vaultKeyRaw = sssCombine([finalA, finalB]);
        if (shareA?.y) shareA.y.fill(0);
      }
    }

    if (!vaultKeyRaw) { this.lock(); throw new DCCError('BIO_MISMATCH', 'OPEN'); }

    this.#vaultKeyRaw = vaultKeyRaw;
    this.#cryptoKey   = await importRawKey(vaultKeyRaw);
    this.#vaultFormat = v2;

    try {
      const plaintext = await crypto.subtle.decrypt(
        { name: AES_MODE, iv: fromHex(v2.iv) }, this.#cryptoKey, fromHex(v2.ct)
      );
      this.#vaultData = decode(plaintext);
    } catch { this.lock(); throw new DCCError('BIO_MISMATCH', 'OPEN'); }

    if (v2.genesis_hmac) {
      const expected = await BioVault._computeGenesisHmac(vaultKeyRaw, v2.genesis, v2.dna_chain);
      if (expected !== v2.genesis_hmac) {
        this.lock();
        throw new DCCError('GENESIS_HMAC_MISMATCH', 'OPEN');
      }
    }

    const seedBytes = fromHex(this.#vaultData.seed);
    const address   = await seedToAddress(seedBytes, this.#vaultData.keyType ?? 'raw');
    seedBytes.fill(0);

    // When opened via device, also check if face share still decodes (drift detection).
    // If face share fails → usedFace=false → _mandatoryReenroll triggered in app.js.
    let usedFace = shareA !== null;
    if (usedDevice && !usedFace) {
      try {
        const faceKey = await deriveKey(R, salt, null);
        await unwrapBytes(faceKey, v2.sss.faceShare);
        usedFace = true;
      } catch { /* face has drifted — mandatory re-enroll will be triggered */ }
    }

    if (v2.genesis) this.#genesis = v2.genesis;
    this.#openedViaFace = usedFace;

    return {
      address,
      hasDevice:  !!(v2.deviceWrap),
      usedDevice,
      usedFace,
      isV4:  false,
      isV5:  true,
      genesis: v2.genesis ?? null,
    };
  }

  // ── Device enrollment / re-enrollment ────────────────────────────────────

  // v5-only: csak a deviceWrap (direkt K-wrap) frissül; az SSS és a paper kód érintetlen.
  async enrollDevice(devicePrf, credentialId, prfSalt) {
    if (!this.#vaultData || !this.#faceR) throw new DCCError('VAULT_LOCKED', 'ENROLL_DEVICE');
    if (!(this.#vaultFormat?.v === 5 && 'deviceWrap' in this.#vaultFormat))
      throw new DCCError('UNSUPPORTED_FORMAT', 'ENROLL_DEVICE');

    const R    = this.#faceR;
    const salt = fromHex(this.#vaultFormat.salt);

    const devKey = await deriveKeyDevice(R, new Uint8Array(devicePrf), salt);
    const newDeviceWrap = {
      ...await wrapBytes(devKey, this.#vaultKeyRaw),
      credentialId: toHex(new Uint8Array(credentialId)),
      prfSalt:      toHex(new Uint8Array(prfSalt)),
    };
    const vault = { ...this.#vaultFormat, deviceWrap: newDeviceWrap };
    this.#vaultFormat = vault;
    return {
      encryptedVault: new TextEncoder().encode(JSON.stringify(vault)).buffer,
      paperShareY: null,  // paper code unchanged — no new paper to show
    };
  }

  // ── SIGN ──────────────────────────────────────────────────────────────────

  async sign(tx) {
    if (!this.#cryptoKey || !this.#vaultData) throw new DCCError('VAULT_LOCKED', 'SIGN');
    await this._checkGenesis('SIGN');
    const canonical = JSON.stringify(tx, Object.keys(tx).sort());
    const hashBuf   = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    const txHash    = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
    this.#chain.gate('SIGN', this.#vaultId, txHash);
    this.#pendingTxHash = null;
    const seed   = fromHex(this.#vaultData.seed);
    const signed = await signEthTx(tx, seed, this.#vaultData.keyType ?? 'raw');
    seed.fill(0);
    this.lock();
    return signed;
  }

  async personalSign(message) {
    if (!this.#cryptoKey || !this.#vaultData) throw new DCCError('VAULT_LOCKED', 'SIGN');
    await this._checkGenesis('PERSONAL_SIGN');
    this.#chain.gate('SIGN', this.#vaultId);
    const seed = fromHex(this.#vaultData.seed);
    const sig  = await signPersonal(message, seed, this.#vaultData.keyType ?? 'raw');
    seed.fill(0);
    this.lock();
    return sig;
  }

  async signTypedData(typedDataJson) {
    if (!this.#cryptoKey || !this.#vaultData) throw new DCCError('VAULT_LOCKED', 'SIGN');
    await this._checkGenesis('SIGN_TYPED_DATA');
    this.#chain.gate('SIGN', this.#vaultId);
    const seed = fromHex(this.#vaultData.seed);
    const sig  = await signTypedData(typedDataJson, seed, this.#vaultData.keyType ?? 'raw');
    seed.fill(0);
    this.lock();
    return sig;
  }

  // v37 v5-only: upgradeToV4() és upgradeToV5() eltávolítva — minden vault eleve v5.

  // ── Face re-enrollment (v5 only) ──────────────────────────────────────────
  // Re-commits face BCH, refreshes SSS share wrappings, appends chain entry.
  // genesis.dna is preserved; vault key (and ct) unchanged.
  // Device share is cleared if no new devicePrf provided — re-enroll device separately.
  async reEnrollFace(newEmbedding, devicePrf = null, credentialId = null, prfSalt = null) {
    if (!this.#vaultData || !this.#vaultKeyRaw) throw new DCCError('VAULT_LOCKED', 'RE_ENROLL');
    if (!this.#vaultFormat || this.#vaultFormat.v !== 5)
      throw new DCCError('NOT_V5', 'RE_ENROLL');

    const { R: newR, P: newP } = await fuzzyCommit(newEmbedding);
    const newSalt = crypto.getRandomValues(new Uint8Array(32));
    const ts      = Date.now();

    // genesis_backup frissítése az új arc-szindróma alapján
    const { R: R_genesis, genesisS, genesisExtraBit } = await fuzzyCommitDeterministic(newEmbedding);
    const gbSalt = crypto.getRandomValues(new Uint8Array(32));
    const gbKey  = await BioVault._deriveGenesisBackupKey(R_genesis, gbSalt);
    const seedBytes = fromHex(this.#vaultData.seed);
    let gbIv, gbCtBuf;
    try {
      const gbEnc = await aesEncrypt(gbKey, seedBytes);
      gbIv    = gbEnc.iv;
      gbCtBuf = gbEnc.ciphertext;
    } finally { seedBytes.fill(0); }
    newP.genesisS        = genesisS;
    newP.genesisExtraBit = genesisExtraBit;

    const shares = sssSplit(this.#vaultKeyRaw, 3, 2);
    try {
      const faceKey   = await deriveKey(newR, newSalt, null);
      const faceShare = { x: shares[0].x, ...await wrapBytes(faceKey, shares[0].y) };
      // shares[1] (x=2) discarded — device uses deviceWrap (direct K-wrap) instead
      const paperShareY = shares[2].y.slice();

      // Device: direct vault key wrap — enrollDevice can update without changing paper
      let deviceWrap = null;
      if (devicePrf && credentialId && prfSalt) {
        const devKey = await deriveKeyDevice(newR, new Uint8Array(devicePrf), newSalt);
        deviceWrap = {
          ...await wrapBytes(devKey, this.#vaultKeyRaw),
          credentialId: toHex(new Uint8Array(credentialId)),
          prfSalt:      toHex(new Uint8Array(prfSalt)),
        };
      }

      const vault    = this.#vaultFormat;
      const chain    = vault.dna_chain;
      const prevHash = chain[chain.length - 1].hash;
      const method   = this.#openedViaFace ? 're_enrollment' : 're_enrollment_via_sss';
      const entry    = await BioVault._buildChainEntry(
        prevHash, vault.genesis.dna, ts, chain.length, method
      );
      chain.push(entry);
      vault.salt           = toHex(newSalt);
      vault.sss            = { faceShare, paperX: 3 };
      vault.deviceWrap     = deviceWrap;
      vault.genesis_backup = { gbSalt: toHex(gbSalt), gbIv: toHex(gbIv), gbCt: toHex(new Uint8Array(gbCtBuf)) };
      if (vault.genesis_hmac !== undefined) {
        vault.genesis_hmac = await BioVault._computeGenesisHmac(this.#vaultKeyRaw, vault.genesis, vault.dna_chain);
      }

      this.#faceR = newR.slice();

      return {
        P:              newP,
        encryptedVault: new TextEncoder().encode(JSON.stringify(vault)).buffer,
        paperShareY,
      };
    } finally {
      shares[0].y.fill(0);
      shares[1].y.fill(0);
      shares[2].y.fill(0);
    }
  }

  // ── Genesis check (Use Case C — DCC SIGN guard) ──────────────────────────
  // Only runs on v5 vaults opened via face. Skipped for device+paper fallback path.
  // Also skipped for re-enrolled vaults (dna_chain.length > 1) since new face R ≠ genesis R.
  async _checkGenesis(op) {
    if (!this.#genesis || !this.#openedViaFace || !this.#faceR) return;
    if (this.#vaultFormat?.dna_chain?.length > 1) return;
    const check = await BioVault._computeGenesisDna(this.#faceR, this.#genesis.ts);
    if (check !== this.#genesis.dna) {
      this.lock();
      throw new DCCError('GENESIS_MISMATCH', op);
    }
  }

  // ── Genesis backup recovery (v5 + genesis_backup) ────────────────────────
  // arc + P fájl (genesisS) → R_genesis → seed visszafejtés; nincs open session szükséges.
  static async genesisRecover(encryptedVault, embedding, P) {
    if (!P?.genesisS) throw new Error('GENESIS_BACKUP_UNAVAILABLE');
    const vault = JSON.parse(new TextDecoder().decode(encryptedVault));
    if (!vault.genesis_backup) throw new Error('GENESIS_BACKUP_UNAVAILABLE');

    const R_genesis = await fuzzyExtractDeterministic(embedding, P.genesisS, P.genesisExtraBit ?? 0);
    const gbSalt    = fromHex(vault.genesis_backup.gbSalt);
    const gbKey     = await BioVault._deriveGenesisBackupKey(R_genesis, gbSalt);

    let seedBytes;
    try {
      const plain = await crypto.subtle.decrypt(
        { name: AES_MODE, iv: fromHex(vault.genesis_backup.gbIv) },
        gbKey,
        fromHex(vault.genesis_backup.gbCt)
      );
      seedBytes = new Uint8Array(plain);
    } catch {
      throw new Error('GENESIS_DECODE_FAIL');
    }

    const keyType  = vault.keyType ?? 'raw';
    if (keyType === 'privkey') {
      const privkey = '0x' + Array.from(seedBytes).map(b => b.toString(16).padStart(2,'0')).join('');
      seedBytes.fill(0);
      return { privkey };
    }
    const mnemonic = seedToMnemonic(seedBytes);
    seedBytes.fill(0);
    return { mnemonic };
  }

  // ── DNA chain extension (v5 re-enrollment) ───────────────────────────────
  // Appends a new chain entry to the vault JSON (no re-encryption needed).
  // Call after updating the face BCH codeword (Fázis 4).
  async addChainEntry(method) {
    if (!this.#vaultFormat || this.#vaultFormat.v !== 5)
      throw new DCCError('NOT_V5', 'ADD_CHAIN');
    if (!this.#vaultData)
      throw new DCCError('VAULT_LOCKED', 'ADD_CHAIN');

    const vault    = this.#vaultFormat;
    const chain    = vault.dna_chain;
    const prevHash = chain[chain.length - 1].hash;
    const ts       = Date.now();
    const entry    = await BioVault._buildChainEntry(
      prevHash, vault.genesis.dna, ts, chain.length, method
    );
    chain.push(entry);
    if (vault.genesis_hmac !== undefined && this.#vaultKeyRaw) {
      vault.genesis_hmac = await BioVault._computeGenesisHmac(this.#vaultKeyRaw, vault.genesis, vault.dna_chain);
    }
    return new TextEncoder().encode(JSON.stringify(vault)).buffer;
  }

  // ── Paper recovery ────────────────────────────────────────────────────────

  async makeRecoveryFormula() {
    if (!this.#vaultData) throw new DCCError('VAULT_LOCKED', 'EXPORT');
    // privkey vault-nál nincs BIP39 entropy → papírképlet nem alkalmazható.
    // A check a DCC gate ELŐTT fut, így a token megmarad és a vault nyitva marad.
    if ((this.#vaultData.keyType ?? 'raw') === 'privkey') {
      throw new Error('PRIVKEY_NO_FORMULA');
    }
    this.#chain.gate('EXPORT', this.#vaultId);
    const entropy = fromHex(this.#vaultData.seed);
    try {
      const indices = await entropyToIndices(entropy);       // 12 vagy 24 elem
      const r       = await fetchRandomOffsets(indices.length, false);
      const rawA    = computeRawPaper(indices, r);
      return { rawA, r };
    } finally {
      entropy.fill(0);
      this.lock();
    }
  }

  // ── LOCK (P7) ─────────────────────────────────────────────────────────────

  lock() {
    this.#chain.revoke();
    this.#cryptoKey     = null;
    this.#vaultData     = null;
    this.#pendingTxHash = null;
    this.#vaultFormat   = null;
    this.#genesis       = null;
    this.#openedViaFace = false;
    if (this.#vaultKeyRaw) { this.#vaultKeyRaw.fill(0); this.#vaultKeyRaw = null; }
    if (this.#faceR)       { this.#faceR.fill(0);       this.#faceR = null; }
  }

  isOpen() { return this.#cryptoKey !== null && this.#vaultData !== null; }

  chainStatus() { return this.#chain.status(); }
}

// ── Crypto helpers ────────────────────────────────────────────────────────

async function deriveKey(R, salt, pin = null) {
  let material = R;
  let combined = null;
  if (pin) {
    const pinBytes = new TextEncoder().encode(pin);
    combined = new Uint8Array(R.length + pinBytes.length);
    combined.set(R);
    combined.set(pinBytes, R.length);
    material = combined;
  }
  const km = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey']);
  if (combined) combined.fill(0);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 300_000, hash: 'SHA-256' },
    km, { name: AES_MODE, length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function deriveKeyDevice(R, devicePrf, salt) {
  const ikm = new Uint8Array(R.length + devicePrf.length);
  ikm.set(R); ikm.set(devicePrf, R.length);
  const km = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  ikm.fill(0);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: DEVICE_PRF_INFO },
    km, { name: AES_MODE, length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function importRawKey(raw) {
  return crypto.subtle.importKey('raw', raw, AES_MODE, false, ['encrypt', 'decrypt']);
}

async function wrapBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: AES_MODE, iv }, key, bytes);
  return { wIv: toHex(iv), wCt: toHex(new Uint8Array(ct)) };
}

async function unwrapBytes(key, wrap) {
  const raw = await crypto.subtle.decrypt(
    { name: AES_MODE, iv: fromHex(wrap.wIv) }, key, fromHex(wrap.wCt)
  );
  return new Uint8Array(raw);
}

async function aesEncrypt(key, plaintext) {
  const iv         = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: AES_MODE, iv }, key, plaintext);
  return { iv, ciphertext };
}

// v37 v5-only: aesDecrypt/isV2/pack/unpack (v1 legacy helperek) eltávolítva.

const encode = (v) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v));
const decode = (b) => JSON.parse(new TextDecoder().decode(b));
const toHex  = (b) => Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('');
const fromHex= (h) => new Uint8Array(h.match(/../g).map(x => parseInt(x,16)));

export { BioVault };
