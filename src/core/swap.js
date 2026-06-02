/**
 * BioWallet — Swap Module (Paraswap v5)
 * Phase 1: native → ERC-20 (no approval)
 * Phase 2: ERC-20 → any (with approval flow)
 */

const PARASWAP   = 'https://apiv5.paraswap.io';
const PARTNER_ID = 'biowallet';
export const ETH_ADDR = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

export const TREASURY = '0x4368F0bF9201118bD19b62fB68bFcbaC4B61B7Eb';
const FEE_BPS         = 15;   // 0.15%
const MAX_SLIPPAGE    = 1;    // 1% hard cap

const SUPPORTED  = new Set([1, 56, 137, 42161, 8453, 10, 43114]);
const L2_CHAINS  = new Set([42161, 8453, 10]);  // Arbitrum, Base, Optimism — higher gas fallback
export function isSwapSupported(chainId) { return SUPPORTED.has(chainId); }

// Cache: Paraswap TokenTransferProxy per chain
const _spenderCache = {};

/** Returns the address the user must approve for ERC-20 swaps. */
export async function getParaswapSpender(chainId) {
  if (_spenderCache[chainId]) return _spenderCache[chainId];
  const res = await fetch(`${PARASWAP}/adapters/contracts?network=${chainId}`);
  if (!res.ok) throw new Error('Paraswap spender fetch failed');
  const d = await res.json();
  _spenderCache[chainId] = d.TokenTransferProxy;
  return d.TokenTransferProxy;
}

/** Encode ERC-20 approve(spender, amount) calldata — exact amount only. */
export function buildApproveTx(tokenAddress, spenderAddress, amountWei) {
  const paddedSpender = spenderAddress.slice(2).toLowerCase().padStart(64, '0');
  const paddedAmount  = BigInt(amountWei).toString(16).padStart(64, '0');
  return {
    to:       tokenAddress,
    value:    '0',
    data:     `0x095ea7b3${paddedSpender}${paddedAmount}`,
    gasLimit: '80000',
  };
}

/**
 * Build swap TX via Paraswap.
 * fromToken: ETH_ADDR for native, or ERC-20 address.
 * Returns: { tx, outputAmount, outputSymbol, outputDecimals, spender }
 *   spender: address to approve (null if fromToken is native)
 */
export async function buildSwapTx(chainId, fromToken, toToken, amountWei, fromAddress, slippage = 1) {
  const clampedSlippage = Math.min(slippage, MAX_SLIPPAGE);
  const isNative = fromToken.toLowerCase() === ETH_ADDR.toLowerCase();

  // 1. priceRoute
  const priceUrl = new URL(`${PARASWAP}/prices`);
  priceUrl.searchParams.set('srcToken',  fromToken);
  priceUrl.searchParams.set('destToken', toToken);
  priceUrl.searchParams.set('amount',    amountWei);
  priceUrl.searchParams.set('network',   chainId);
  priceUrl.searchParams.set('side',      'SELL');
  if (TREASURY) priceUrl.searchParams.set('partner', PARTNER_ID);

  const priceRes = await fetch(priceUrl);
  if (!priceRes.ok) {
    const e = await priceRes.json().catch(() => ({}));
    throw new Error(e.error ?? `Paraswap quote: ${priceRes.status}`);
  }
  const { priceRoute } = await priceRes.json();

  // 2. TX
  const body = {
    srcToken:    fromToken,
    destToken:   toToken,
    srcAmount:   amountWei,
    priceRoute,
    userAddress: fromAddress,
    slippage:    Math.round(clampedSlippage * 100),
  };
  if (TREASURY) {
    body.partner        = PARTNER_ID;
    body.partnerAddress = TREASURY;
    body.partnerFeeBps  = FEE_BPS;
  }

  // Try with partner fee; if the partner is not registered, retry without it.
  let d;
  try {
    d = await _paraswapTx(chainId, body);
  } catch (e) {
    if (TREASURY && body.partner) {
      const bodyNoFee = { ...body };
      delete bodyNoFee.partner;
      delete bodyNoFee.partnerAddress;
      delete bodyNoFee.partnerFeeBps;
      d = await _paraswapTx(chainId, bodyNoFee);
    } else {
      throw e;
    }
  }

  const gasLimit = d.gas
    ? Math.ceil(Number(d.gas) * 1.25).toString()
    : (L2_CHAINS.has(chainId) ? '600000' : '400000');

  return {
    tx: {
      to:       d.to,
      value:    d.value ?? '0',
      data:     d.data,
      gasLimit,
    },
    outputAmount:   priceRoute.destAmount,
    outputSymbol:   priceRoute.destToken?.symbol   ?? '?',
    outputDecimals: priceRoute.destDecimals         ?? 18,
    spender:        isNative ? null : priceRoute.contractAddress ?? null,
  };
}

async function _paraswapTx(chainId, body) {
  const txUrl = new URL(`${PARASWAP}/transactions/${chainId}`);
  txUrl.searchParams.set('ignoreGasEstimate', 'true');
  txUrl.searchParams.set('ignoreChecks',      'true');
  const res = await fetch(txUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error ?? `Paraswap TX: ${res.status}`);
  }
  return res.json();
}

export function formatOutput(amountWei, decimals) {
  const val = Number(BigInt(amountWei)) / 10 ** decimals;
  return val < 0.000001 ? '<0.000001' : val.toLocaleString('en', { maximumFractionDigits: 6 });
}
