/**
 * BioWallet — 1inch Swap Module (Phase 1: native → ERC-20)
 *
 * Csak native token (ETH/BNB/POL…) → ERC-20 swapot kezel.
 * ERC-20 → bármi (approval flow) = Phase 2.
 *
 * Fee: 0.15% a TREASURY címre (ha be van állítva).
 * Slippage: max 1% (MEV-sandwich védelem).
 */

const INCH_BASE   = 'https://api.1inch.io/v5.2';
const INCH_ROUTER = '0x1111111254EEB25477B68fb85Ed929f73A960582';
export const ETH_ADDR = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// ── Treasury cím (Arbitrum One ajánlott — set before production) ──────────
export const TREASURY = '';   // pl. '0xYourTreasuryAddress'
const FEE_PCT         = 0.15; // 0.15%
const MAX_SLIPPAGE    = 1;    // 1% hard cap

// Támogatott chainId-k (1inch v5.2)
const SUPPORTED = new Set([1, 56, 137, 42161, 8453, 10, 43114]);

export function isSwapSupported(chainId) {
  return SUPPORTED.has(chainId);
}

/**
 * Quote lekérés — nem indít tranzakciót.
 * Visszaad: { outputAmount: string (wei), outputSymbol, outputDecimals }
 */
export async function getSwapQuote(chainId, fromToken, toToken, amountWei) {
  const url = new URL(`${INCH_BASE}/${chainId}/quote`);
  url.searchParams.set('fromTokenAddress', fromToken);
  url.searchParams.set('toTokenAddress',   toToken);
  url.searchParams.set('amount',           amountWei);
  const res = await fetch(url);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.description ?? `1inch quote error ${res.status}`);
  }
  const d = await res.json();
  return {
    outputAmount:   d.toTokenAmount,
    outputSymbol:   d.toToken?.symbol   ?? '?',
    outputDecimals: d.toToken?.decimals ?? 18,
  };
}

/**
 * Swap TX felépítése — ezt kell aláírni és broadcastolni.
 * Visszaad: { tx, outputAmount, outputSymbol, outputDecimals }
 * tx.to === INCH_ROUTER (ellenőrzött)
 */
export async function buildSwapTx(chainId, toToken, amountWei, fromAddress, slippage = 1) {
  const clampedSlippage = Math.min(slippage, MAX_SLIPPAGE);
  const url = new URL(`${INCH_BASE}/${chainId}/swap`);
  url.searchParams.set('fromTokenAddress', ETH_ADDR);
  url.searchParams.set('toTokenAddress',   toToken);
  url.searchParams.set('amount',           amountWei);
  url.searchParams.set('fromAddress',      fromAddress);
  url.searchParams.set('slippage',         clampedSlippage);
  url.searchParams.set('disableEstimate',  'true');
  if (TREASURY) {
    url.searchParams.set('referrerAddress', TREASURY);
    url.searchParams.set('fee',             FEE_PCT);
  }

  const res = await fetch(url);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.description ?? `1inch swap error ${res.status}`);
  }
  const d = await res.json();

  if (d.tx?.to?.toLowerCase() !== INCH_ROUTER.toLowerCase()) {
    throw new Error('1inch: unexpected router address');
  }

  return {
    tx: {
      to:       d.tx.to,
      value:    d.tx.value,
      data:     d.tx.data,
      gasLimit: d.tx.gas ? Math.ceil(d.tx.gas * 1.25).toString() : undefined,
    },
    outputAmount:   d.toTokenAmount,
    outputSymbol:   d.toToken?.symbol   ?? '?',
    outputDecimals: d.toToken?.decimals ?? 18,
  };
}

/** Wei-ből ember-olvasható (max 6 tizedesjegy) */
export function formatOutput(amountWei, decimals) {
  const val = Number(BigInt(amountWei)) / 10 ** decimals;
  return val < 0.000001 ? '<0.000001' : val.toLocaleString('en', { maximumFractionDigits: 6 });
}
