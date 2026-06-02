/**
 * BioWallet — USD Price Feed (DeFi Llama Coins API)
 * Free, no API key, multi-chain, 60s client-side cache.
 * Graceful degradation: returns {} on network error.
 */

const LLAMA_API = 'https://coins.llama.fi/prices/current';
const TTL       = 60_000; // 60 seconds

// DeFi Llama chain prefix per chainId
const CHAIN_PREFIX = {
  1:     'ethereum',
  56:    'bsc',
  137:   'polygon',
  42161: 'arbitrum',
  8453:  'base',
  10:    'optimism',
  43114: 'avax',
};

// Sentinel address for native coin (ETH/BNB/MATIC/etc)
export const PRICE_NATIVE_ADDR = '0x0000000000000000000000000000000000000000';

const _cache = {}; // "chain:0xaddr" → { price, ts }

/**
 * Fetch USD prices for native coin + given ERC-20 addresses.
 * @param {number}   chainId
 * @param {string[]} tokenAddresses  lowercase or mixed-case ERC-20 addresses
 * @returns {Promise<Record<string, number>>}  { lowercaseAddr → usdPrice }
 */
export async function fetchPricesUsd(chainId, tokenAddresses = []) {
  const chain = CHAIN_PREFIX[chainId];
  if (!chain) return {};

  const addrs = [PRICE_NATIVE_ADDR, ...tokenAddresses.map(a => a.toLowerCase())];
  const keys  = addrs.map(a => `${chain}:${a}`);
  const now   = Date.now();
  const stale = keys.filter(k => !_cache[k] || now - _cache[k].ts > TTL);

  if (stale.length) {
    try {
      const res = await fetch(`${LLAMA_API}/${stale.join(',')}`);
      if (res.ok) {
        const { coins = {} } = await res.json();
        for (const [k, v] of Object.entries(coins)) {
          if (typeof v.price === 'number') {
            _cache[k.toLowerCase()] = { price: v.price, ts: now };
          }
        }
      }
    } catch { /* offline — fall through to cached values */ }
  }

  const out = {};
  for (const k of keys) {
    const entry = _cache[k.toLowerCase()];
    if (entry) out[k.split(':')[1]] = entry.price;
  }
  return out; // e.g. { '0x0000...': 2450.5, '0xa0b8...': 0.9998 }
}

/**
 * Format a USD amount as a compact string, or null if not meaningful.
 * @param {string|number} amount  human-readable token amount (not wei)
 * @param {number|undefined} price  USD price per token
 * @returns {string|null}  e.g. "$2.45", "$1,234", null
 */
export function fmtUsd(amount, price) {
  const n = parseFloat(amount);
  if (!price || !n || isNaN(n) || n < 0) return null;
  const usd = n * price;
  if (usd < 0.005)   return null;          // skip negligible amounts
  if (usd < 1)       return `$${usd.toFixed(3)}`;
  if (usd < 10000)   return `$${usd.toFixed(2)}`;
  return '$' + Math.round(usd).toLocaleString('en');
}
