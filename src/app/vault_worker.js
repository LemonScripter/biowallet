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
 *   INIT_VAULT        { vaultId }
 *   ENROLL            { embedding: Float32Array }                          → { vaultId, P, encryptedVault }
 *   IMPORT            { mnemonic: string, embedding: Float32Array }        → { vaultId, P, encryptedVault }
 *   CREATE_V4         { embedding, devicePrf?, credentialId?, prfSalt? }   → { vaultId, P, encryptedVault, paperShareY }
 *   CREATE_V5         { embedding, devicePrf?, credentialId?, prfSalt? }   → { vaultId, P, encryptedVault, paperShareY }
 *   IMPORT_V5         { mnemonic, embedding, devicePrf?, credentialId?, prfSalt? } → { vaultId, P, encryptedVault, paperShareY }
 *   COMMIT_TX         { tx: object }                                       → { fingerprint: string }
 *   CANCEL_TX         {}
 *   BIO_CAPTURE       { embedding: Float32Array, P, userInput?: string }
 *   OPEN              { encryptedVault, P, devicePrf?, pin?, paperShareY? } → { address, hasDevice, usedDevice, isV4, isV5, genesis? }
 *   ENROLL_DEVICE     { devicePrf, credentialId, prfSalt }                → { encryptedVault }
 *   SIGN              { tx: object }
 *   PERSONAL_SIGN     { message: string }
 *   RECOVERY_FORMULA  {}
 *   UPGRADE_V5        { devicePrf?, credentialId?, prfSalt? }              → { encryptedVault, paperShareY }
 *   RE_ENROLL_FACE    { embedding, devicePrf?, credentialId?, prfSalt? }   → { P, encryptedVault, paperShareY }
 *   ADD_CHAIN_ENTRY   { method: string }                                   → { encryptedVault }
 *   GENESIS_RECOVER   { encryptedVault, embedding, P }                    → { mnemonic }
 *   LOCK              {}
 *   STATUS            {}
 */

import * as _ethersLib from '../vendor/ethers.bundle.js';
self.ethers = _ethersLib;

import { BioVault } from '../core/vault.js?v=16';

let vault = null;

// Worker-szintű brute-force védelem (UI-rétegtől független hard gate)
let _bioFailCount  = 0;
let _cooldownUntil = 0;
function _workerCooldownMs() {
  const counts = [0, 0, 0, 30_000, 60_000, 120_000, 240_000];
  return counts[Math.min(_bioFailCount, counts.length - 1)];
}

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
      if (p.bfState) {
        _bioFailCount  = p.bfState.n     ?? 0;
        _cooldownUntil = p.bfState.until ?? 0;
      }
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

    case 'CREATE_V4': {
      const dPrf  = p.devicePrf    ? new Uint8Array(p.devicePrf)    : null;
      const cId   = p.credentialId ? new Uint8Array(p.credentialId) : null;
      const pSalt = p.prfSalt      ? new Uint8Array(p.prfSalt)      : null;
      const res = await BioVault.createV4(p.embedding, dPrf, cId, pSalt);
      vault = new BioVault(res.vaultId);
      return {
        vaultId:        res.vaultId,
        P:              res.P,
        encryptedVault: res.encryptedVault,
        paperShareY:    Array.from(res.paperShareY),
      };
    }

    case 'CREATE_V5': {
      const dPrf  = p.devicePrf    ? new Uint8Array(p.devicePrf)    : null;
      const cId   = p.credentialId ? new Uint8Array(p.credentialId) : null;
      const pSalt = p.prfSalt      ? new Uint8Array(p.prfSalt)      : null;
      const res = await BioVault.createV5(p.embedding, dPrf, cId, pSalt);
      vault = new BioVault(res.vaultId);
      return {
        vaultId:        res.vaultId,
        P:              res.P,
        encryptedVault: res.encryptedVault,
        paperShareY:    Array.from(res.paperShareY),
      };
    }

    case 'IMPORT_V5': {
      const dPrf  = p.devicePrf    ? new Uint8Array(p.devicePrf)    : null;
      const cId   = p.credentialId ? new Uint8Array(p.credentialId) : null;
      const pSalt = p.prfSalt      ? new Uint8Array(p.prfSalt)      : null;
      const res = await BioVault.importFromMnemonicV5(p.mnemonic, p.embedding, dPrf, cId, pSalt);
      vault = new BioVault(res.vaultId);
      return {
        vaultId:        res.vaultId,
        P:              res.P,
        encryptedVault: res.encryptedVault,
        paperShareY:    Array.from(res.paperShareY),
      };
    }

    case 'OPEN': {
      if (!vault) throw new Error('No vault initialised');
      const now = Date.now();
      if (now < _cooldownUntil) {
        const remaining = Math.ceil((_cooldownUntil - now) / 1000);
        throw new Error(`WORKER_COOLDOWN:${remaining}`);
      }
      const devicePrf  = p.devicePrf   ? new Uint8Array(p.devicePrf)  : null;
      const paperShare = p.paperShareY
        ? { x: 3, y: new Uint8Array(p.paperShareY) }
        : null;
      let result;
      try {
        result = await vault.open(p.encryptedVault, p.P, devicePrf, p.pin ?? null, paperShare);
      } catch (e) {
        if (e.message?.includes('BIO_MISMATCH')) {
          _bioFailCount++;
          _cooldownUntil = Date.now() + _workerCooldownMs();
        }
        throw e;
      }
      _bioFailCount  = 0;
      _cooldownUntil = 0;
      return {
        address:    result.address,
        hasDevice:  result.hasDevice,
        usedDevice: result.usedDevice,
        usedFace:   result.usedFace ?? true,
        isV4:       result.isV4 ?? false,
        isV5:       result.isV5 ?? false,
        genesis:    result.genesis ?? null,
      };
    }

    case 'ENROLL_DEVICE': {
      if (!vault) throw new Error('No vault initialised');
      const res = await vault.enrollDevice(
        new Uint8Array(p.devicePrf),
        new Uint8Array(p.credentialId),
        new Uint8Array(p.prfSalt)
      );
      return {
        encryptedVault: res.encryptedVault,
        paperShareY:    res.paperShareY ? Array.from(res.paperShareY) : null,
      };
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

    case 'SIGN_TYPED_DATA': {
      if (!vault) throw new Error('No vault initialised');
      const sig = await vault.signTypedData(p.typedDataJson);
      return { signature: sig };
    }

    case 'RECOVERY_FORMULA': {
      if (!vault) throw new Error('No vault initialised');
      const { rawA, r } = await vault.makeRecoveryFormula();
      return { rawA, r };
    }

    case 'UPGRADE_V4': {
      if (!vault) throw new Error('No vault initialised');
      const dPrf  = p.devicePrf    ? new Uint8Array(p.devicePrf)    : null;
      const cId   = p.credentialId ? new Uint8Array(p.credentialId) : null;
      const pSalt = p.prfSalt      ? new Uint8Array(p.prfSalt)      : null;
      const { encryptedVault, paperShareY } = await vault.upgradeToV4(dPrf, cId, pSalt);
      return { encryptedVault, paperShareY: Array.from(paperShareY) };
    }

    case 'UPGRADE_V5': {
      if (!vault) throw new Error('No vault initialised');
      const dPrf  = p.devicePrf    ? new Uint8Array(p.devicePrf)    : null;
      const cId   = p.credentialId ? new Uint8Array(p.credentialId) : null;
      const pSalt = p.prfSalt      ? new Uint8Array(p.prfSalt)      : null;
      const { encryptedVault, paperShareY } = await vault.upgradeToV5(dPrf, cId, pSalt);
      return { encryptedVault, paperShareY: Array.from(paperShareY) };
    }

    case 'RE_ENROLL_FACE': {
      if (!vault) throw new Error('No vault initialised');
      const dPrf  = p.devicePrf    ? new Uint8Array(p.devicePrf)    : null;
      const cId   = p.credentialId ? new Uint8Array(p.credentialId) : null;
      const pSalt = p.prfSalt      ? new Uint8Array(p.prfSalt)      : null;
      const { P, encryptedVault, paperShareY } = await vault.reEnrollFace(p.embedding, dPrf, cId, pSalt);
      return { P, encryptedVault, paperShareY: Array.from(paperShareY) };
    }

    case 'ADD_CHAIN_ENTRY': {
      if (!vault) throw new Error('No vault initialised');
      const encryptedVault = await vault.addChainEntry(p.method ?? 're-enrollment');
      return { encryptedVault };
    }

    case 'GENESIS_RECOVER': {
      const { mnemonic } = await BioVault.genesisRecover(p.encryptedVault, p.embedding, p.P);
      return { mnemonic };
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
