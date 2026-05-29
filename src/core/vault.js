/**
 * BioWallet — AES-256-GCM Vault
 *
 * Every vault operation runs behind a causal gate.
 * The bio_key never leaves memory.
 * Auto-lock after signing (P7).
 *
 * External dependencies: causal_chain.js, fuzzy_extractor.js
 */

import { CausalChain, DCCError } from './causal_chain.js?v=11';
import { fuzzyExtract, fuzzyCommit } from './fuzzy_extractor.js?v=11';
import { seedToAddress, signEthTx, signPersonal, mnemonicToSeed } from './wallet.js?v=11';
import {
  entropyToIndices, fetchRandomOffsets, computeRawPaper,
} from './recovery_formula.js?v=11';

// KDF: PBKDF2-SHA256 300k iteráció (WebCrypto natív).
// Argon2 (mem-hard) erősebb lenne — WASM bundler nélkül nem implementálható (Phase 6+).
const AES_MODE = 'AES-GCM';

class BioVault {
  #chain;
  #vaultId;
  #cryptoKey     = null;   // WebCrypto CryptoKey — lives in memory, auto-nulled after lock
  #vaultData     = null;   // { seed, accounts, metadata } — decrypted state
  #pendingTxHash = null;   // SHA-256 hex of committed tx; set by commitTx(), cleared by lock/cancelCommit

  constructor(vaultId) {
    this.#vaultId = vaultId;
    this.#chain   = new CausalChain();
  }

  get id() { return this.#vaultId; }

  // ── TX commitment (pre-sign causal anchor) ───────────────────────────────

  /**
   * Commit a transaction before the second biometric scan.
   * Returns an 8-hex-char fingerprint shown to the user; the user must manually
   * type the first 4 characters into the confirm modal before the second scan.
   * This binds the physical user attention to the exact tx being signed.
   *
   * @param {object} tx  — the transaction object (same fields as sign())
   * @returns {string}   — 8-character hex fingerprint (SHA-256(canonical(tx))[:8])
   */
  async commitTx(tx) {
    const canonical = JSON.stringify(tx, Object.keys(tx).sort());
    const hashBuf   = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    const hex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
    this.#pendingTxHash = hex;
    return hex.slice(0, 8);
  }

  /** Cancel a pending tx commit without locking the vault (user dismissed confirm modal). */
  cancelCommit() {
    this.#pendingTxHash = null;
  }

  // ── Biometric event ───────────────────────────────────────────────────────

  /**
   * Face capture succeeded → token issued.
   * Called by the app directly after bio_capture.
   *
   * In the SIGN flow, `userInput` must contain the first 4 chars the user
   * typed from the fingerprint display. If #pendingTxHash is set and
   * userInput doesn't match its first 4 chars → TX_MISMATCH (blocks substitution).
   *
   * @param {Float32Array} embedding   — FaceNet 512-dim output
   * @param {Uint8Array}   P           — fuzzy extractor helper (public)
   * @param {string|null}  userInput   — manually typed fingerprint prefix (SIGN only)
   */
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

  // ── Vault creation (once, on first launch) ───────────────────────────────

  /**
   * @param {Float32Array} embedding — enrollment scan (5x averaged)
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

  // ── Seed import (existing BIP39 mnemonic → new vault) ───────────────────

  /**
   * Import an existing 24-word mnemonic into a biometric vault.
   * seedBytes is zeroed via fill(0) in the finally block.
   * @param {string}       mnemonic  — 24-word BIP39 phrase (space-separated)
   * @param {Float32Array} embedding — enrollment scan (5x averaged)
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
   * Internal helper: 32-byte seed → encrypted vault (new key derived from embedding).
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
    // Causal gate — R directly from token (P1–P4)
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

    // Derive Ethereum address (for display — seed stays in memory)
    const seedBytes = fromHex(this.#vaultData.seed);
    const address   = await seedToAddress(seedBytes);
    seedBytes.fill(0);

    return { address };
  }

  // ── SIGN ─────────────────────────────────────────────────────────────────

  /**
   * Sign a transaction — strictest TTL (10s), auto-lock after.
   * Verifies that the tx matches the hash committed in commitTx() (P_TX).
   * @param {object} tx
   */
  async sign(tx) {
    if (!this.#cryptoKey || !this.#vaultData) {
      throw new DCCError('VAULT_LOCKED', 'SIGN');
    }

    // Compute hash of the tx to verify against the token-bound hash (P_TX)
    const canonical = JSON.stringify(tx, Object.keys(tx).sort());
    const hashBuf   = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    const txHash    = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,'0')).join('');

    // New biometric scan required for every signing (P5); gate also checks TX_MISMATCH
    this.#chain.gate('SIGN', this.#vaultId, txHash);
    this.#pendingTxHash = null;

    const seed   = fromHex(this.#vaultData.seed);
    const signed = await signEthTx(tx, seed);

    seed.fill(0);
    this.lock();   // P7: auto-lock

    return signed;
  }

  // ── PERSONAL SIGN (WalletConnect personal_sign) ──────────────────────────

  async personalSign(message) {
    if (!this.#cryptoKey || !this.#vaultData) throw new DCCError('VAULT_LOCKED', 'SIGN');
    this.#chain.gate('SIGN', this.#vaultId);
    const seed = fromHex(this.#vaultData.seed);
    const sig  = await signPersonal(message, seed);
    seed.fill(0);
    this.lock();   // P7: auto-lock
    return sig;
  }

  // ── Paper formula (Phase 9.1b — P never enters the app) ─────────────────

  /**
   * Generate raw recovery data:
   *   raw_A_j = (i_j - r_j) mod 2048
   *
   * P (personal number) is NOT included — applied in the offline ENCODE step.
   * The 24 words NEVER leave this function.
   * Requires EXPORT gate (5s TTL), auto-lock after.
   *
   * @returns {Promise<{ rawA: number[], r: number[] }>}
   */
  async makeRecoveryFormula() {
    if (!this.#vaultData) throw new DCCError('VAULT_LOCKED', 'EXPORT');
    this.#chain.gate('EXPORT', this.#vaultId);

    const entropy = fromHex(this.#vaultData.seed);
    try {
      const indices = await entropyToIndices(entropy);
      const r       = await fetchRandomOffsets(24, false);
      const rawA    = computeRawPaper(indices, r);   // P nélkül
      return { rawA, r };
    } finally {
      entropy.fill(0);
      this.lock();
    }
  }

  // ── LOCK ─────────────────────────────────────────────────────────────────

  lock() {
    this.#chain.revoke();
    this.#cryptoKey     = null;
    this.#vaultData     = null;
    this.#pendingTxHash = null;
  }

  chainStatus() { return this.#chain.status(); }
}

// ── Crypto helpers ────────────────────────────────────────────────────────

async function deriveKey(R, salt) {
  // argon2-wasm needed here (Phase 2), PBKDF2 placeholder with the same API
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
