/**
 * BioWallet — AES-256-GCM Vault
 *
 * Minden vault-művelet causal gate mögött fut.
 * A bio_key soha nem kerül ki a memóriából.
 * Signing után auto-lock (P7).
 *
 * Külső függőség: causal_chain.js, fuzzy_extractor.js
 */

import { CausalChain, DCCError } from './causal_chain.js?v=11';
import { fuzzyExtract, fuzzyCommit } from './fuzzy_extractor.js?v=11';
import { seedToAddress, signEthTx, mnemonicToSeed } from './wallet.js?v=11';
import {
  entropyToIndices, personalHashOffsets, fetchRandomOffsets, computeCodes,
} from './recovery_formula.js?v=11';

// KDF: PBKDF2-SHA256 300k iteráció (WebCrypto natív).
// Argon2 (mem-hard) erősebb lenne — WASM bundler nélkül nem implementálható (Phase 6+).
const AES_MODE = 'AES-GCM';

class BioVault {
  #chain;
  #vaultId;
  #cryptoKey = null;    // WebCrypto CryptoKey — memóriában él, auto-null lock után
  #vaultData = null;    // { seed, accounts, metadata } — decrypted state

  constructor(vaultId) {
    this.#vaultId = vaultId;
    this.#chain   = new CausalChain();
  }

  get id() { return this.#vaultId; }

  // ── Biometriai esemény ────────────────────────────────────────────────────

  /**
   * Face capture sikeres → token kiadása.
   * Ezt az app hívja közvetlenül a bio_capture után.
   * @param {Float32Array} embedding — FaceNet 512-dim output
   * @param {Uint8Array}   P         — fuzzy extractor helper (publikus)
   */
  async onBioCapture(embedding, P) {
    const R = await fuzzyExtract(embedding, P);   // stabil kulcs → tokenbe
    this.#chain.issue(R, this.#vaultId);           // vault-kötés: vaultId egyezés (P4)
  }

  // ── Vault létrehozása (egyszer, első indításkor) ──────────────────────────

  /**
   * @param {Float32Array} embedding — enrollment scan (5x átlagolt)
   * @returns {{ encryptedVault: ArrayBuffer, P: Uint8Array, vaultId: string }}
   */
  static async create(embedding) {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    try {
      return await BioVault._encryptSeed(seed, embedding);
    } finally {
      seed.fill(0);
    }
  }

  // ── Seed importálás (meglévő BIP39 mnemonic → új vault) ─────────────────

  /**
   * Meglévő 24 szavas mnemonic importálása biometriai vault-ba.
   * A seedBytes-t fill(0) törli a finally-ban.
   * @param {string}       mnemonic  — 24 szavas BIP39 phrase (szóközzel)
   * @param {Float32Array} embedding — enrollment scan (5x átlagolt)
   */
  static async importFromMnemonic(mnemonic, embedding) {
    const seedBytes = mnemonicToSeed(mnemonic);
    try {
      return await BioVault._encryptSeed(seedBytes, embedding);
    } finally {
      seedBytes.fill(0);
    }
  }

  /**
   * Belső helper: 32 bájt seed → titkosított vault (embedding alapján új kulcs).
   * @param {Uint8Array}   seedBytes
   * @param {Float32Array} embedding
   */
  static async _encryptSeed(seedBytes, embedding) {
    const vaultId   = crypto.randomUUID();
    const { R, P }  = await fuzzyCommit(embedding);
    const salt      = crypto.getRandomValues(new Uint8Array(32));
    const cryptoKey = await deriveKey(R, salt);

    const plaintext = encode({ seed: toHex(seedBytes), accounts: [], vaultId, created: Date.now() });
    const { iv, ciphertext } = await aesEncrypt(cryptoKey, plaintext);

    return { vaultId, P, encryptedVault: pack({ salt, iv, ciphertext }) };
  }

  // ── OPEN ─────────────────────────────────────────────────────────────────

  /**
   * @param {ArrayBuffer} encryptedVault
   * @param {Uint8Array}  P
   */
  async open(encryptedVault, P) {
    // Kauzális kapu — R közvetlenül a tokenből (P1–P4)
    const R = this.#chain.gate('OPEN', this.#vaultId);

    const { salt, iv, ciphertext } = unpack(encryptedVault);
    this.#cryptoKey  = await deriveKey(R, salt);

    try {
      const plaintext  = await aesDecrypt(this.#cryptoKey, iv, ciphertext);
      this.#vaultData  = decode(plaintext);
    } catch {
      this.lock();
      throw new DCCError('BIO_MISMATCH', 'OPEN');
    }

    // Ethereum cím deriválása (megjelenítéshez — seed memóriában marad)
    const seedBytes = fromHex(this.#vaultData.seed);
    const address   = await seedToAddress(seedBytes);
    seedBytes.fill(0);

    return { address };
  }

  // ── SIGN ─────────────────────────────────────────────────────────────────

  /**
   * Tranzakció aláírása — legszigorúbb TTL (10s), auto-lock után.
   * @param {object} tx
   */
  async sign(tx) {
    if (!this.#cryptoKey || !this.#vaultData) {
      throw new DCCError('VAULT_LOCKED', 'SIGN');
    }
    // Új biometriai scan szükséges minden aláíráshoz (P5)
    // gate() visszadobja R-t — itt nem kell a KDF-hez, csak a kauzális ellenőrzés
    this.#chain.gate('SIGN', this.#vaultId);

    const seed   = fromHex(this.#vaultData.seed);
    const signed = await signEthTx(tx, seed);

    seed.fill(0);
    this.lock();   // P7: auto-lock

    return signed;
  }

  // ── Papírképlet (Phase 9.0 — browser only) ──────────────────────────────

  /**
   * Visszanyerési képlet generálása:
   *   c_j = (i_j - r_j - hash(P)[j]) mod 2048
   *
   * A 24 szó SOHA nem hagyja el ezt a függvényt — csak c_j és r_j tér vissza.
   * EXPORT gate (5s TTL) szükséges, auto-lock után.
   *
   * @param {string} personalNumber — felhasználó által megadott P
   * @returns {Promise<{ c: number[], r: number[] }>}
   */
  async makeRecoveryFormula(personalNumber) {
    if (!this.#vaultData) throw new DCCError('VAULT_LOCKED', 'EXPORT');
    if (!personalNumber || personalNumber.length < 4) {
      throw new Error('A személyes szám legalább 4 karakter legyen.');
    }
    this.#chain.gate('EXPORT', this.#vaultId);

    const entropy = fromHex(this.#vaultData.seed);
    try {
      const indices = await entropyToIndices(entropy);          // i_j
      const r       = await fetchRandomOffsets(24, false);      // r_j (Phase 9.0: helyi)
      const p       = await personalHashOffsets(personalNumber, 24);
      const c       = computeCodes(indices, r, p);

      // indices és p tömbök tartalma még RAM-ban van, de nincs export-csatorna
      return { c, r };
    } finally {
      entropy.fill(0);
      this.lock();   // P7: auto-lock
    }
  }

  // ── LOCK ─────────────────────────────────────────────────────────────────

  lock() {
    this.#chain.revoke();
    this.#cryptoKey = null;
    this.#vaultData = null;
  }

  chainStatus() { return this.#chain.status(); }
}

// ── Crypto helpers ────────────────────────────────────────────────────────

async function deriveKey(R, salt) {
  // argon2-wasm kellene ide (Phase 2), PBKDF2 placeholder ugyanolyan API-val
  const keyMaterial = await crypto.subtle.importKey(
    'raw', R, 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 300_000, hash: 'SHA-256' },
    keyMaterial,
    { name: AES_MODE, length: 256 },
    false, ['encrypt', 'decrypt']
  );
}

async function aesEncrypt(key, plaintext) {
  const iv         = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: AES_MODE, iv }, key, plaintext);
  return { iv, ciphertext };
}

async function aesDecrypt(key, iv, ciphertext) {
  return crypto.subtle.decrypt({ name: AES_MODE, iv }, key, ciphertext);
}


function pack({ salt, iv, ciphertext }) {
  const buf = new Uint8Array(32 + 12 + ciphertext.byteLength);
  buf.set(salt, 0);
  buf.set(iv, 32);
  buf.set(new Uint8Array(ciphertext), 44);
  return buf.buffer;
}

function unpack(buf) {
  const b          = new Uint8Array(buf);
  const salt       = b.slice(0, 32);
  const iv         = b.slice(32, 44);
  const ciphertext = b.slice(44);
  return { salt, iv, ciphertext };
}

const encode = (v) => new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v));
const decode = (b) => JSON.parse(new TextDecoder().decode(b));
const toHex  = (b) => Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('');
const fromHex= (h) => new Uint8Array(h.match(/../g).map(x => parseInt(x,16)));

export { BioVault };
