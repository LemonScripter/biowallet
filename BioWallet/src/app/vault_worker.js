/**
 * BioWallet — Crypto Worker
 *
 * Minden kripto-érzékeny művelet ebben a Worker szálban fut.
 * A main thread soha nem látja a privát kulcsot nyíltan.
 *
 * Protokoll → main thread: { id, type, payload }
 * Válasz ← Worker:         { id, ok, result } | { id, ok:false, error }
 *
 * Típusok:
 *   INIT_VAULT      { vaultId }
 *   ENROLL          { embedding: Float32Array }                        → { vaultId, P, encryptedVault }
 *   IMPORT          { mnemonic: string, embedding: Float32Array }      → { vaultId, P, encryptedVault }
 *   COMMIT_TX       { tx: object }                                     → { fingerprint: string }
 *   CANCEL_TX       {}
 *   BIO_CAPTURE     { embedding: Float32Array, P, userInput?: string }
 *   OPEN            { encryptedVault: ArrayBuffer, P, devicePrf?: number[] } → { address, hasDevice, usedDevice }
 *   ENROLL_DEVICE   { devicePrf: number[], credentialId: number[], prfSalt: number[] } → { encryptedVault }
 *   SIGN            { tx: object }
 *   PERSONAL_SIGN   { message: string }
 *   RECOVERY_FORMULA {}
 *   LOCK            {}
 *   STATUS          {}
 */

import * as _ethersLib from '../vendor/ethers.bundle.js';
self.ethers = _ethersLib;

import { BioVault } from '../core/vault.js?v=13';

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
      const res = await BioVault.create(p.embedding, p.pin ?? null);
      vault = new BioVault(res.vaultId);
      return { vaultId: res.vaultId, P: res.P, encryptedVault: res.encryptedVault };
    }

    case 'IMPORT': {
      const res = await BioVault.importFromMnemonic(p.mnemonic, p.embedding, p.pin ?? null);
      vault = new BioVault(res.vaultId);
      return { vaultId: res.vaultId, P: res.P, encryptedVault: res.encryptedVault };
    }

    case 'COMMIT_TX': {
      if (!vault) throw new Error('No vault initialised');
      const fingerprint = await vault.commitTx(p.tx);
      return { fingerprint };
    }

    case 'CANCEL_TX': {
      vault?.cancelCommit();
      return {};
    }

    case 'BIO_CAPTURE': {
      if (!vault) throw new Error('No vault initialised');
      await vault.onBioCapture(p.embedding, p.P, p.userInput ?? null);
      return {};
    }

    case 'OPEN': {
      if (!vault) throw new Error('No vault initialised');
      const devicePrf = p.devicePrf ? new Uint8Array(p.devicePrf) : null;
      const { address, hasDevice, usedDevice } = await vault.open(p.encryptedVault, p.P, devicePrf, p.pin ?? null);
      return { address, hasDevice, usedDevice };
    }

    case 'ENROLL_DEVICE': {
      if (!vault) throw new Error('No vault initialised');
      const encryptedVault = await vault.enrollDevice(
        new Uint8Array(p.devicePrf),
        new Uint8Array(p.credentialId),
        new Uint8Array(p.prfSalt)
      );
      return { encryptedVault };
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
