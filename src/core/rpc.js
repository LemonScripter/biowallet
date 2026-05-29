/**
 * BioWallet — RPC réteg (Phase 5 / EIP-1559)
 *
 * Raw JSON-RPC 2.0 — nincs CDN függőség.
 * Támogatott: Ethereum Mainnet + Sepolia testnet.
 * EIP-1559: eth_feeHistory alapú maxFeePerGas / maxPriorityFeePerGas.
 */

export const NETWORKS = {
  sepolia: {
    name:     'Sepolia',
    chainId:  11155111,
    rpc:      'https://ethereum-sepolia-rpc.publicnode.com',
    explorer: 'https://sepolia.etherscan.io/tx/',
  },
  mainnet: {
    name:     'Mainnet',
    chainId:  1,
    rpc:      'https://eth.llamarpc.com',
    explorer: 'https://etherscan.io/tx/',
  },
};

// ── JSON-RPC alap ─────────────────────────────────────────────────────────

async function rpcCall(rpcUrl, method, params = []) {
  const res = await fetch(rpcUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const { result, error } = await res.json();
  if (error) throw new Error(error.message ?? 'RPC hiba');
  return result;
}

// ── Lekérdezések ──────────────────────────────────────────────────────────

/** Cím egyenlege ETH-ben (6 tizedesjegy). */
export async function getBalance(address, rpcUrl) {
  const hex = await rpcCall(rpcUrl, 'eth_getBalance', [address, 'latest']);
  const wei = BigInt(hex);
  const eth = Number(wei * 10000n / BigInt(1e18)) / 10000;
  return eth.toFixed(6);
}

/** Következő nonce. */
export async function getNonce(address, rpcUrl) {
  const hex = await rpcCall(rpcUrl, 'eth_getTransactionCount', [address, 'latest']);
  return parseInt(hex, 16);
}

/**
 * EIP-1559 gasbecslés — eth_feeHistory + eth_maxPriorityFeePerGas.
 * Visszaad: { maxFeePerGas: BigInt, maxPriorityFeePerGas: BigInt }
 */
export async function getFeeData(rpcUrl) {
  const [feeHistory, priorityHex] = await Promise.all([
    rpcCall(rpcUrl, 'eth_feeHistory', [5, 'latest', [50]]),
    rpcCall(rpcUrl, 'eth_maxPriorityFeePerGas', []).catch(() => null),
  ]);

  const baseFees = feeHistory.baseFeePerGas ?? [];
  const lastBase = baseFees.length > 0 ? BigInt(baseFees[baseFees.length - 1]) : 1000000000n;
  const baseNext = lastBase * 5n / 4n;   // +25% puffer következő blokkhoz

  const maxPrio = priorityHex ? BigInt(priorityHex) : 1500000000n;  // 1.5 Gwei fallback

  return { maxFeePerGas: baseNext + maxPrio, maxPriorityFeePerGas: maxPrio };
}

/** Gáz limit becslése — eth_estimateGas + 20% puffer. Fallback: 21000 (ETH) / 65000 (token). */
export async function estimateGas(tx, rpcUrl, fallback = 21000n) {
  try {
    const hex = await rpcCall(rpcUrl, 'eth_estimateGas', [{
      from:  tx.from,
      to:    tx.to,
      value: '0x' + (tx.value ?? 0n).toString(16),
      data:  tx.data ?? '0x',
    }]);
    return BigInt(hex) * 12n / 10n;
  } catch {
    return fallback;
  }
}

/** Aláírt tranzakció broadcast — visszaad egy tx hash-t. */
export async function broadcastTx(signedHex, rpcUrl) {
  return await rpcCall(rpcUrl, 'eth_sendRawTransaction', [signedHex]);
}

// ── Konverzió ─────────────────────────────────────────────────────────────

/** "0.001" ETH string → wei BigInt. Lebegőpontos hiba nélkül. */
export function ethToWei(ethStr) {
  const clean = ethStr.trim().replace(',', '.');
  const [whole = '0', frac = ''] = clean.split('.');
  const fracPadded = frac.padEnd(18, '0').slice(0, 18);
  return BigInt(whole) * BigInt('1000000000000000000') + BigInt(fracPadded);
}

/** wei BigInt → ETH string (6 tizedesjegy). */
export function weiToEth(wei) {
  const eth = Number(BigInt(wei) * 10000n / BigInt(1e18)) / 10000;
  return eth.toFixed(6);
}

/** Cím validáció. */
export function isValidAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

/** ENS név → ETH cím (Mainnet-only). null ha nem található. */
export async function resolveENS(name) {
  if (!name || !name.includes('.')) return null;
  try {
    const provider = new window.ethers.JsonRpcProvider(NETWORKS.mainnet.rpc);
    return await provider.resolveName(name);
  } catch {
    return null;
  }
}

/** ERC-20 balanceOf(address) — raw eth_call. Visszaad: BigInt (wei-egyenérték). */
export async function getTokenBalance(tokenAddress, walletAddress, rpcUrl) {
  const data = '0x70a08231' + walletAddress.slice(2).padStart(64, '0');
  const result = await rpcCall(rpcUrl, 'eth_call', [{ to: tokenAddress, data }, 'latest']);
  return BigInt(result);
}

/** ERC-20 tokenek decimálisa. */
export async function getTokenDecimals(tokenAddress, rpcUrl) {
  const result = await rpcCall(rpcUrl, 'eth_call', [{ to: tokenAddress, data: '0x313ce567' }, 'latest']);
  return parseInt(result, 16);
}

/** BigInt token mennyiség → emberi olvasható string (pl. "1234.56"). */
export function formatToken(amount, decimals) {
  const d = BigInt(10) ** BigInt(decimals);
  const whole = amount / d;
  const frac  = (amount % d).toString().padStart(decimals, '0').slice(0, 2);
  return `${whole}.${frac}`;
}

/** "1.5" token string → raw BigInt (decimals alapján). Lebegőpontos hiba nélkül. */
export function tokenToRaw(amountStr, decimals) {
  const clean = amountStr.trim().replace(',', '.');
  const [whole = '0', frac = ''] = clean.split('.');
  const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * (BigInt(10) ** BigInt(decimals)) + BigInt(fracPadded || '0');
}

/** ERC-20 transfer(address,uint256) calldata — 0xa9059cbb + 64+64 byte ABI encoding. */
export function encodeTransfer(to, amount) {
  return '0xa9059cbb'
    + to.slice(2).padStart(64, '0')
    + amount.toString(16).padStart(64, '0');
}

/**
 * Blockscout API v2 — utolsó N tranzakció (nincs API key szükséges).
 * networkKey: 'mainnet' | 'sepolia'
 * Visszaad: items tömb (max limit db), vagy dob hibát.
 */
export async function fetchTxHistory(address, networkKey, limit = 5) {
  const base = networkKey === 'mainnet'
    ? 'https://eth.blockscout.com'
    : 'https://eth-sepolia.blockscout.com';
  const res = await fetch(
    `${base}/api/v2/addresses/${address}/transactions?filter=to%20%7C%20from`
  );
  if (!res.ok) throw new Error(`Blockscout ${res.status}`);
  const { items } = await res.json();
  return (items ?? []).slice(0, limit);
}
