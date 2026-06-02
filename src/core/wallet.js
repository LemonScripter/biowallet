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

// Returns the private key hex for the given seed bytes and keyType.
// 'privkey': seedBytes IS the 32-byte private key (MetaMask imported account)
// 'bip39':   entropy → Mnemonic → PBKDF2 → BIP32 m/44'/60'/0'/0/0 (MetaMask HD account)
// 'raw':     seed bytes → BIP32 seed directly (BioWallet native)
function _privkeyHex(e, seedBytes, keyType) {
  const hex = '0x' + Array.from(seedBytes).map(b => b.toString(16).padStart(2,'0')).join('');
  if (keyType === 'privkey') return hex;
  if (keyType === 'bip39') {
    const mnem = e.Mnemonic.fromEntropy(hex);
    return e.HDNodeWallet.fromSeed(mnem.computeSeed()).derivePath(ETH_PATH).privateKey;
  }
  return e.HDNodeWallet.fromSeed(hex).derivePath(ETH_PATH).privateKey;
}

// ── BIP39 mnemonic ────────────────────────────────────────────────────────

/** 32 bájt entropy → 24 szavas BIP39 mnemonic. */
export function seedToMnemonic(seedBytes) {
  const e   = eth();
  const hex = '0x' + Array.from(seedBytes).map(b => b.toString(16).padStart(2,'0')).join('');
  return e.Mnemonic.fromEntropy(hex).phrase;
}

/** 24 szavas BIP39 mnemonic → 32 bájt entropy (vault seed). */
export function mnemonicToSeed(phrase) {
  const e    = eth();
  const mnem = e.Mnemonic.fromPhrase(phrase.trim());
  const hex  = mnem.entropy.startsWith('0x') ? mnem.entropy.slice(2) : mnem.entropy;
  return new Uint8Array(hex.match(/../g).map(x => parseInt(x, 16)));
}

// ── BIP32 + Ethereum cím ──────────────────────────────────────────────────

/** seed bytes → Ethereum cím (EIP-55 checksum). */
export function seedToAddress(seedBytes, keyType = 'raw') {
  const e = eth();
  return new e.Wallet(_privkeyHex(e, seedBytes, keyType)).address;
}

// ── ECDSA aláírás (EIP-1559 Type 2) ──────────────────────────────────────

/**
 * Tranzakció aláírása secp256k1-gyel — EIP-1559 Type 2 tx.
 * tx.maxFeePerGas + tx.maxPriorityFeePerGas kötelező (Phase 6 rpc.js adja).
 */
export async function signEthTx(tx, seedBytes, keyType = 'raw') {
  const e      = eth();
  const wallet = new e.Wallet(_privkeyHex(e, seedBytes, keyType));

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
  return { tx: fullTx, from: wallet.address, signed };
}

/** personal_sign — sign a hex or UTF-8 message (\x19Ethereum Signed Message prefix). */
export async function signPersonal(hexMessage, seedBytes, keyType = 'raw') {
  const e      = eth();
  const wallet = new e.Wallet(_privkeyHex(e, seedBytes, keyType));
  const bytes  = (typeof hexMessage === 'string' && hexMessage.startsWith('0x'))
    ? e.getBytes(hexMessage)
    : hexMessage;
  return wallet.signMessage(bytes);
}

/** eth_signTypedData_v4 — EIP-712 typed data signing. */
export async function signTypedData(typedDataJson, seedBytes, keyType = 'raw') {
  const e      = eth();
  const wallet = new e.Wallet(_privkeyHex(e, seedBytes, keyType));

  const { domain, types, message, primaryType } = JSON.parse(typedDataJson);

  // ethers v6 signTypedData rejects EIP712Domain in types
  const { EIP712Domain: _removed, ...filteredTypes } = types;

  return wallet.signTypedData(domain, filteredTypes, message);
}
