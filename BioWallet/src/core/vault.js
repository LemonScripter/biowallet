/**
 * BioWallet — AES-256-GCM Vault (v2)
 *
 * v1: vault_key = PBKDF2(face_R, salt)           — single factor (legacy)
 * v2: vault_key = random 32 bytes, wrapped twice:
 *     faceWrap:   AES-GCM( PBKDF2(face_R, salt),                    vault_key )
 *     deviceWrap: AES-GCM( HKDF(face_R ‖ device_prf, salt), vault_key ) — optional
 *
 * Open paths (v2):
 *   Same device:  device_prf available → device path (stronger)
 *   New device:   no device_prf → face-only path (always works with P.json)
 *
 * Device enrollment requires vault to be open (#faceR, #vaultKeyRaw in memory).
 * Both are zeroed on lock (P7).
 */

import { CausalChain, DCCError } from './causal_chain.js?v=11';
import { fuzzyExtract, fuzzyCommit } from './fuzzy_extractor.js?v=11';
import { seedToAddress, signEthTx, signPersonal, mnemonicToSeed } from './wallet.js?v=11';
import {
  entropyToIndices, fetchRandomOffsets, computeRawPaper,
} from './recovery_formula.js?v=11';
import { split as sssSplit, combine as sssCombine } from './sss.js?v=1';

const AES_MODE        = 'AES-GCM';
const DEVICE_PRF_INFO = new TextEncoder().encode('biowallet-device-v2');

class BioVault {
  #chain;
  #vaultId;
  #cryptoKey    = null;   // AES-GCM CryptoKey for vault data
  #vaultData    = null;   // { seed, accounts, ... }
  #vaultFormat  = null;   // parsed v2 JSON | null (v1)
  #vaultKeyRaw  = null;   // Uint8Array — vault_key (v2 only), zeroed on lock
  #faceR        = null;   // Uint8Array — face_R from last OPEN, for device enrollment
  #pendingTxHash= null;

  constructor(vaultId) {
    this.#vaultId = vaultId;
    this.#chain   = new CausalChain();
  }

  get id() { return this.#vaultId; }

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

  static async create(embedding, pin = null, devicePrf = null, credentialId = null, prfSalt = null) {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    try {
      return await BioVault._encryptSeed(seed, embedding, pin, devicePrf, credentialId, prfSalt);
    } finally { seed.fill(0); }
  }

  // ── Vault v4 creation (SSS 2-of-3) ───────────────────────────────────────
  //
  // Returns { vaultId, P, encryptedVault, paperShareY: Uint8Array }
  // paperShareY (32 bytes) must be shown to the user — it is NOT stored in the vault.
  // No PIN in v4: the second factor requirement replaces PIN security.
  static async createV4(embedding, devicePrf = null, credentialId = null, prfSalt = null) {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    try {
      return await BioVault._encryptSeedV4(seed, embedding, devicePrf, credentialId, prfSalt);
    } finally { seed.fill(0); }
  }

  static async _encryptSeedV4(seedBytes, embedding, devicePrf, credentialId, prfSalt) {
    const vaultId = crypto.randomUUID();
    const { R, P } = await fuzzyCommit(embedding);
    const salt     = crypto.getRandomValues(new Uint8Array(32));

    const vaultKeyRaw = crypto.getRandomValues(new Uint8Array(32));
    try {
      const vaultKey  = await importRawKey(vaultKeyRaw);
      const plaintext = encode({ seed: toHex(seedBytes), accounts: [], vaultId, created: Date.now() });
      const { iv, ciphertext } = await aesEncrypt(vaultKey, plaintext);

      const shares = sssSplit(vaultKeyRaw, 3, 2); // [{x:1,y}, {x:2,y}, {x:3,y}]
      try {
        const faceKey   = await deriveKey(R, salt, null);
        const faceShare = { x: shares[0].x, ...await wrapBytes(faceKey, shares[0].y) };

        let deviceShare = null;
        if (devicePrf && credentialId && prfSalt) {
          const devKey = await deriveKeyDevice(R, devicePrf, salt);
          deviceShare  = {
            x: shares[1].x,
            ...await wrapBytes(devKey, shares[1].y),
            credentialId: toHex(new Uint8Array(credentialId)),
            prfSalt:      toHex(new Uint8Array(prfSalt)),
          };
        }

        const paperShareY = shares[2].y.slice(); // caller must show this to the user

        const vault = {
          v: 4, vaultId,
          salt: toHex(salt),
          iv:   toHex(iv),
          ct:   toHex(new Uint8Array(ciphertext)),
          sss: { faceShare, deviceShare, paperX: 3 },
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

  static async importFromMnemonic(mnemonic, embedding, pin = null) {
    const seedBytes = mnemonicToSeed(mnemonic);
    try {
      return await BioVault._encryptSeed(seedBytes, embedding, pin);
    } finally { seedBytes.fill(0); }
  }

  static async _encryptSeed(seedBytes, embedding, pin = null, devicePrf = null, credentialId = null, prfSalt = null) {
    const vaultId  = crypto.randomUUID();
    const { R, P } = await fuzzyCommit(embedding);
    const salt     = crypto.getRandomValues(new Uint8Array(32));

    const vaultKeyRaw = crypto.getRandomValues(new Uint8Array(32));
    try {
      const vaultKey  = await importRawKey(vaultKeyRaw);
      const plaintext = encode({ seed: toHex(seedBytes), accounts: [], vaultId, created: Date.now() });
      const { iv, ciphertext } = await aesEncrypt(vaultKey, plaintext);

      const faceAesKey = await deriveKey(R, salt, pin);
      const faceWrap   = await wrapBytes(faceAesKey, vaultKeyRaw);

      let deviceWrap = null;
      if (devicePrf && credentialId && prfSalt) {
        const devKey = await deriveKeyDevice(R, devicePrf, salt);
        deviceWrap = {
          ...await wrapBytes(devKey, vaultKeyRaw),
          credentialId: toHex(new Uint8Array(credentialId)),
          prfSalt:      toHex(new Uint8Array(prfSalt)),
        };
      }

      const vault = {
        v: pin ? 3 : 2, vaultId,
        salt: toHex(salt),
        iv:   toHex(iv),
        ct:   toHex(new Uint8Array(ciphertext)),
        faceWrap,
        deviceWrap,
      };

      return { vaultId, P, encryptedVault: new TextEncoder().encode(JSON.stringify(vault)).buffer };
    } finally { vaultKeyRaw.fill(0); }
  }

  // ── OPEN ──────────────────────────────────────────────────────────────────

  // paperShare: { x: 3, y: Uint8Array } — only needed for v4 vaults when device not available
  async open(encryptedVault, P, devicePrf = null, pin = null, paperShare = null) {
    const R = this.#chain.gate('OPEN', this.#vaultId);
    this.#faceR = R.slice();

    if (isV2(encryptedVault)) {
      const v2   = JSON.parse(new TextDecoder().decode(encryptedVault));
      const salt = fromHex(v2.salt);

      // ── v4: SSS 2-of-3 reconstruction ─────────────────────────────────────
      if (v2.v === 4) {
        let shareA = null; // face share
        let shareB = null; // device or paper share

        try {
          const faceKey = await deriveKey(R, salt, null);
          const y1      = await unwrapBytes(faceKey, v2.sss.faceShare);
          shareA = { x: v2.sss.faceShare.x, y: y1 };
        } catch { /* biometric mismatch — try device+paper fallback */ }

        if (devicePrf && v2.sss.deviceShare) {
          try {
            const devKey = await deriveKeyDevice(R, new Uint8Array(devicePrf), salt);
            const y2     = await unwrapBytes(devKey, v2.sss.deviceShare);
            shareB = { x: v2.sss.deviceShare.x, y: y2 };
          } catch { /* device PRF mismatch */ }
        }

        // Pick the best 2-of-3 combination:
        //   face + device (priority 1), face + paper (priority 2), device + paper (priority 3)
        let finalA = shareA; // face  (x=1) or null
        let finalB = shareB; // device (x=2) or null
        if (!finalA && paperShare) finalA = paperShare; // paper replaces missing face
        else if (!finalB && paperShare) finalB = paperShare; // paper replaces missing device

        if (!finalA || !finalB) {
          this.lock();
          throw new DCCError('BIO_MISMATCH', 'OPEN');
        }

        const vaultKeyRaw = sssCombine([finalA, finalB]);
        if (shareA?.y) shareA.y.fill(0);
        if (shareB?.y) shareB.y.fill(0);

        this.#vaultKeyRaw = vaultKeyRaw;
        this.#cryptoKey   = await importRawKey(vaultKeyRaw);
        this.#vaultFormat = v2;

        try {
          const plaintext = await crypto.subtle.decrypt(
            { name: AES_MODE, iv: fromHex(v2.iv) }, this.#cryptoKey, fromHex(v2.ct)
          );
          this.#vaultData = decode(plaintext);
        } catch {
          this.lock();
          throw new DCCError('BIO_MISMATCH', 'OPEN');
        }

        const seedBytes = fromHex(this.#vaultData.seed);
        const address   = await seedToAddress(seedBytes);
        seedBytes.fill(0);

        return {
          address,
          hasDevice:  !!v2.sss.deviceShare,
          usedDevice: shareB?.x === 2,
          isV4:       true,
        };
      }
      // ── end v4 ─────────────────────────────────────────────────────────────

      let vaultKeyRaw  = null;
      let usedDevice   = false;

      if (devicePrf && v2.deviceWrap) {
        try {
          const devKey = await deriveKeyDevice(R, devicePrf, salt);
          vaultKeyRaw  = await unwrapBytes(devKey, v2.deviceWrap);
          usedDevice   = true;
        } catch { /* fall through to face path */ }
      }

      if (!vaultKeyRaw) {
        // v3 vault: faceWrap key = PBKDF2(face_R ‖ PIN, salt) — PIN required on new devices
        const faceKey = await deriveKey(R, salt, v2.v === 3 ? pin : null);
        try {
          vaultKeyRaw = await unwrapBytes(faceKey, v2.faceWrap);
        } catch {
          this.lock();
          throw new DCCError('BIO_MISMATCH', 'OPEN');
        }
      }

      this.#vaultKeyRaw = vaultKeyRaw;
      this.#cryptoKey   = await importRawKey(vaultKeyRaw);
      this.#vaultFormat = v2;

      try {
        const plaintext = await crypto.subtle.decrypt(
          { name: AES_MODE, iv: fromHex(v2.iv) }, this.#cryptoKey, fromHex(v2.ct)
        );
        this.#vaultData = decode(plaintext);
      } catch {
        this.lock();
        throw new DCCError('BIO_MISMATCH', 'OPEN');
      }

      const seedBytes = fromHex(this.#vaultData.seed);
      const address   = await seedToAddress(seedBytes);
      seedBytes.fill(0);

      return { address, hasDevice: !!v2.deviceWrap, usedDevice };

    } else {
      // v1 legacy
      const { salt, iv, ciphertext } = unpack(encryptedVault);
      this.#cryptoKey = await deriveKey(R, salt);
      try {
        const plaintext = await aesDecrypt(this.#cryptoKey, iv, ciphertext);
        this.#vaultData = decode(plaintext);
      } catch {
        this.lock();
        throw new DCCError('BIO_MISMATCH', 'OPEN');
      }

      const seedBytes = fromHex(this.#vaultData.seed);
      const address   = await seedToAddress(seedBytes);
      seedBytes.fill(0);

      return { address, hasDevice: false, usedDevice: false };
    }
  }

  // ── Device enrollment / re-enrollment ────────────────────────────────────

  async enrollDevice(devicePrf, credentialId, prfSalt) {
    if (!this.#vaultData || !this.#faceR) throw new DCCError('VAULT_LOCKED', 'ENROLL_DEVICE');

    const R   = this.#faceR;
    let salt, faceWrap, iv, ct;

    if (!this.#vaultFormat) {
      // v1 vault: generate new vault_key and re-encrypt data
      salt = crypto.getRandomValues(new Uint8Array(32));
      const vaultKeyRaw = crypto.getRandomValues(new Uint8Array(32));
      try {
        const vaultKey  = await importRawKey(vaultKeyRaw);
        const { iv: _iv, ciphertext } = await aesEncrypt(vaultKey, encode(this.#vaultData));
        iv       = toHex(_iv);
        ct       = toHex(new Uint8Array(ciphertext));
        faceWrap = await wrapBytes(await deriveKey(R, salt), vaultKeyRaw);
        this.#vaultKeyRaw = vaultKeyRaw.slice();
        this.#cryptoKey   = await importRawKey(this.#vaultKeyRaw);
        vaultKeyRaw.fill(0);
      } catch (e) { throw e; }
    } else {
      salt     = fromHex(this.#vaultFormat.salt);
      faceWrap = this.#vaultFormat.faceWrap;
      iv       = this.#vaultFormat.iv;
      ct       = this.#vaultFormat.ct;
    }

    const devKey    = await deriveKeyDevice(R, new Uint8Array(devicePrf), salt);
    const deviceWrap = {
      ...await wrapBytes(devKey, this.#vaultKeyRaw),
      credentialId: toHex(new Uint8Array(credentialId)),
      prfSalt:      toHex(new Uint8Array(prfSalt)),
    };

    const vaultId  = this.#vaultFormat?.vaultId ?? this.#vaultId;
    const vVersion = this.#vaultFormat?.v ?? 2;
    const vaultJSON = { v: vVersion, vaultId, salt: toHex(salt), iv, ct, faceWrap, deviceWrap };
    this.#vaultFormat = vaultJSON;

    return new TextEncoder().encode(JSON.stringify(vaultJSON)).buffer;
  }

  // ── SIGN ──────────────────────────────────────────────────────────────────

  async sign(tx) {
    if (!this.#cryptoKey || !this.#vaultData) throw new DCCError('VAULT_LOCKED', 'SIGN');
    const canonical = JSON.stringify(tx, Object.keys(tx).sort());
    const hashBuf   = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    const txHash    = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
    this.#chain.gate('SIGN', this.#vaultId, txHash);
    this.#pendingTxHash = null;
    const seed   = fromHex(this.#vaultData.seed);
    const signed = await signEthTx(tx, seed);
    seed.fill(0);
    this.lock();
    return signed;
  }

  async personalSign(message) {
    if (!this.#cryptoKey || !this.#vaultData) throw new DCCError('VAULT_LOCKED', 'SIGN');
    this.#chain.gate('SIGN', this.#vaultId);
    const seed = fromHex(this.#vaultData.seed);
    const sig  = await signPersonal(message, seed);
    seed.fill(0);
    this.lock();
    return sig;
  }

  // ── Upgrade v2/v3 → v4 (SSS 2-of-3) ─────────────────────────────────────
  // Vault must be open (#faceR and #vaultData in memory).
  // No fresh scan needed — uses the face_R from the current session.
  async upgradeToV4(devicePrf = null, credentialId = null, prfSalt = null) {
    if (!this.#vaultData || !this.#faceR) throw new DCCError('VAULT_LOCKED', 'UPGRADE_V4');

    const R    = this.#faceR;
    const salt = crypto.getRandomValues(new Uint8Array(32));

    const vaultKeyRaw = crypto.getRandomValues(new Uint8Array(32));
    try {
      const vaultKey  = await importRawKey(vaultKeyRaw);
      const { iv, ciphertext } = await aesEncrypt(vaultKey, encode(this.#vaultData));

      const shares = sssSplit(vaultKeyRaw, 3, 2);
      try {
        const faceKey   = await deriveKey(R, salt, null);
        const faceShare = { x: shares[0].x, ...await wrapBytes(faceKey, shares[0].y) };

        let deviceShare = null;
        if (devicePrf && credentialId && prfSalt) {
          const devKey = await deriveKeyDevice(R, new Uint8Array(devicePrf), salt);
          deviceShare  = {
            x: shares[1].x,
            ...await wrapBytes(devKey, shares[1].y),
            credentialId: toHex(new Uint8Array(credentialId)),
            prfSalt:      toHex(new Uint8Array(prfSalt)),
          };
        }

        const paperShareY = shares[2].y.slice();

        const vault = {
          v: 4, vaultId: this.#vaultId,
          salt: toHex(salt),
          iv:   toHex(iv),
          ct:   toHex(new Uint8Array(ciphertext)),
          sss:  { faceShare, deviceShare, paperX: 3 },
        };

        this.#vaultKeyRaw = vaultKeyRaw.slice();
        this.#cryptoKey   = await importRawKey(this.#vaultKeyRaw);
        this.#vaultFormat = vault;

        return {
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

  // ── Paper recovery ────────────────────────────────────────────────────────

  async makeRecoveryFormula() {
    if (!this.#vaultData) throw new DCCError('VAULT_LOCKED', 'EXPORT');
    this.#chain.gate('EXPORT', this.#vaultId);
    const entropy = fromHex(this.#vaultData.seed);
    try {
      const indices = await entropyToIndices(entropy);
      const r       = await fetchRandomOffsets(24, false);
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
    if (this.#vaultKeyRaw) { this.#vaultKeyRaw.fill(0); this.#vaultKeyRaw = null; }
    if (this.#faceR)       { this.#faceR.fill(0);       this.#faceR = null; }
  }

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

async function aesDecrypt(key, iv, ciphertext) {
  return crypto.subtle.decrypt({ name: AES_MODE, iv }, key, ciphertext);
}

function isV2(buf) {
  try { return new Uint8Array(buf)[0] === 0x7b; } // '{'
  catch { return false; }
}

function pack({ salt, iv, ciphertext }) {
  const buf = new Uint8Array(32 + 12 + ciphertext.byteLength);
  buf.set(salt, 0); buf.set(iv, 32); buf.set(new Uint8Array(ciphertext), 44);
  return buf.buffer;
}

function unpack(buf) {
  const b = new Uint8Array(buf);
  return { salt: b.slice(0, 32), iv: b.slice(32, 44), ciphertext: b.slice(44) };
}

const encode = (v) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v));
const decode = (b) => JSON.parse(new TextDecoder().decode(b));
const toHex  = (b) => Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('');
const fromHex= (h) => new Uint8Array(h.match(/../g).map(x => parseInt(x,16)));

export { BioVault };
