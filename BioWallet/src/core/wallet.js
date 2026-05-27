/**
 * BioWallet — HD Crypto Wallet Core (Phase 5)
 *
 * ethers.js v6 lokálisan bundlezve (vendor/ethers.umd.min.js).
 * Nincs CDN függőség — supply chain attack kizárva.
 * UMD build: self.ethers (Worker) vagy window.ethers (main thread).
 */

const ETH_PATH = "m/44'/60'/0'/0/0";

function eth() {
  const e = (typeof self !== 'undefined' && self.ethers) ? self.ethers : window.ethers;
  if (!e) throw new Error('ethers.js nincs betöltve (vendor/ethers.umd.min.js hiányzik)');
  return e;
}

// ── BIP39 mnemonic ────────────────────────────────────────────────────────

/** 32 bájt entropy → 24 szavas BIP39 mnemonic. */
export function seedToMnemonic(seedBytes) {
  const e   = eth();
  const hex = '0x' + Array.from(seedBytes).map(b => b.toString(16).padStart(2,'0')).join('');
  return e.Mnemonic.fromEntropy(hex).phrase;
}

// ── BIP32 + Ethereum cím ──────────────────────────────────────────────────

/** 32 bájt seed → Ethereum cím (EIP-55 checksum). Deriváció: m/44'/60'/0'/0/0 */
export function seedToAddress(seedBytes) {
  const e     = eth();
  const hex   = '0x' + Array.from(seedBytes).map(b => b.toString(16).padStart(2,'0')).join('');
  const root  = e.HDNodeWallet.fromSeed(hex);
  const child = root.derivePath(ETH_PATH);
  return child.address;
}

// ── ECDSA aláírás (EIP-1559 Type 2) ──────────────────────────────────────

/**
 * Tranzakció aláírása secp256k1-gyel — EIP-1559 Type 2 tx.
 * tx.maxFeePerGas + tx.maxPriorityFeePerGas kötelező (Phase 6 rpc.js adja).
 */
export async function signEthTx(tx, seedBytes) {
  const e      = eth();
  const hex    = '0x' + Array.from(seedBytes).map(b => b.toString(16).padStart(2,'0')).join('');
  const root   = e.HDNodeWallet.fromSeed(hex);
  const child  = root.derivePath(ETH_PATH);
  const wallet = new e.Wallet(child.privateKey);

  // BigInt mezők stringként jönnek a Worker postMessage-en keresztül
  const toBN = v => (v === undefined || v === null) ? undefined : BigInt(v);

  const fullTx = {
    type:                 2,
    to:                   tx.to,
    value:                toBN(tx.value) ?? 0n,
    nonce:                tx.nonce ?? 0,
    gasLimit:             toBN(tx.gasLimit) ?? 21000n,
    chainId:              toBN(tx.chainId) ?? 1n,
    data:                 tx.data ?? '0x',
    maxFeePerGas:         toBN(tx.maxFeePerGas),
    maxPriorityFeePerGas: toBN(tx.maxPriorityFeePerGas),
  };

  const signed = await wallet.signTransaction(fullTx);
  return { tx: fullTx, from: child.address, signed };
}
