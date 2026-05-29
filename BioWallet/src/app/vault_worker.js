/**
 * BioWallet — Crypto Worker (Phase 5)
 *
 * Minden kripto-érzékeny művelet ebben a Worker szálban fut.
 * A main thread soha nem látja a privát kulcsot nyíltan.
 * Module Worker — ES modul importok, self.ethers = bundled ethers.
 *
 * Protokoll → main thread: { id, type, payload }
 * Válasz ← Worker:         { id, ok, result } | { id, ok:false, error }
 *
 * Típusok:
 *   INIT_VAULT   { vaultId }
 *   ENROLL       { embedding: Float32Array }
 *   BIO_CAPTURE  { embedding: Float32Array, P: object }
 *   OPEN         { encryptedVault: ArrayBuffer, P: object }
 *   SIGN         { tx: object }
 *   EXPORT       {}
 *   LOCK         {}
 *   STATUS       {}
 */

import * as _ethersLib from '../vendor/ethers.bundle.js';
self.ethers = _ethersLib;   // wallet.js reads this (self.ethers)

import { BioVault } from '../core/vault.js?v=11';

let vault = null;

self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    const result = await handle(type, payload ?? {});
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e.message });
  }
};

async function handle(type, p) {
  switch (type) {

    case 'INIT_VAULT': {
      vault = new BioVault(p.vaultId);
      return {};
    }

    case 'ENROLL': {
      const res = await BioVault.create(p.embedding);
      vault = new BioVault(res.vaultId);
      return { vaultId: res.vaultId, P: res.P, encryptedVault: res.encryptedVault };
    }

    case 'IMPORT': {
      const res = await BioVault.importFromMnemonic(p.mnemonic, p.embedding);
      vault = new BioVault(res.vaultId);
      return { vaultId: res.vaultId, P: res.P, encryptedVault: res.encryptedVault };
    }

    case 'BIO_CAPTURE': {
      if (!vault) throw new Error('No vault initialised');
      await vault.onBioCapture(p.embedding, p.P);
      return {};
    }

    case 'OPEN': {
      if (!vault) throw new Error('No vault initialised');
      const { address } = await vault.open(p.encryptedVault, p.P);
      return { address };
    }

    case 'SIGN': {
      if (!vault) throw new Error('No vault initialised');
      const res = await vault.sign(p.tx);
      return { signed: res.signed, from: res.from };
    }

    case 'PERSONAL_SIGN': {
      if (!vault) throw new Error('No vault initialised');
      const sig = await vault.personalSign(p.message);
      return { signature: sig };
    }

    case 'RECOVERY_FORMULA': {
      if (!vault) throw new Error('No vault initialised');
      const { rawA, r } = await vault.makeRecoveryFormula();
      return { rawA, r };
    }

    case 'LOCK': {
      vault?.lock();
      return {};
    }

    case 'STATUS': {
      return vault ? vault.chainStatus() : { state: 'NO_VAULT' };
    }

    default:
      throw new Error(`Unknown Worker operation: ${type}`);
  }
}
