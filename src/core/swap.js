/**
 * BioWallet — Swap Module (Paraswap v5, Phase 1: native → ERC-20)
 *
 * Paraswap ingyenes, nincs API kulcs. Partner fee: 0.15% a TREASURY-re.
 * ERC-20 → bármi (approval) = Phase 2.
 */

const PARASWAP   = 'https://apiv5.paraswap.io';
const PARTNER_ID = 'biowallet';
export const ETH_ADDR = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// ── Treasury cím — set before production ─────────────────────────────────
export const TREASURY = '0x4368F0bF9201118bD19b62fB68bFcbaC4B61B7Eb';
const FEE_BPS         = 15; // 0.15% in basis points
const MAX_SLIPPAGE    = 1;  // 1% hard cap

const SUPPORTED = new Set([1, 56, 137, 42161, 8453, 10, 43114]);

export function isSwapSupported(chainId) {
  return SUPPORTED.has(chainId);
}

/**
 * buildSwapTx — quote + TX felépítés egy lépésben.
 * Visszaad: { tx, outputAmount, outputSymbol, outputDecimals }
 */
export async function buildSwapTx(chainId, toToken, amountWei, fromAddress, slippage = 1) {
  const clampedSlippage = Math.min(slippage, MAX_SLIPPAGE);

  // 1. lépés: priceRoute lekérése
  const priceUrl = new URL(`${PARASWAP}/prices`);
  priceUrl.searchParams.set('srcToken',    ETH_ADDR);
  priceUrl.searchParams.set('destToken',   toToken);
  priceUrl.searchParams.set('amount',      amountWei);
  priceUrl.searchParams.set('srcDecimals', '18');
  priceUrl.searchParams.set('network',     chainId);
  priceUrl.searchParams.set('side',        'SELL');
  if (TREASURY) priceUrl.searchParams.set('partner', PARTNER_ID);

  const priceRes = await fetch(priceUrl);
  if (!priceRes.ok) {
    const e = await priceRes.json().catch(() => ({}));
    throw new Error(e.error ?? `Paraswap quote: ${priceRes.status}`);
  }
  const { priceRoute } = await priceRes.json();

  // 2. lépés: TX felépítése
  const slippageBps = Math.round(clampedSlippage * 100);
  const body = {
    srcToken:    ETH_ADDR,
    destToken:   toToken,
    srcAmount:   amountWei,
    priceRoute,
    userAddress: fromAddress,
    slippage:    slippageBps,
  };
  if (TREASURY) {
    body.partner        = PARTNER_ID;
    body.partnerAddress = TREASURY;
    body.partnerFeeBps  = FEE_BPS;
  }

  const txUrl = new URL(`${PARASWAP}/transactions/${chainId}`);
  txUrl.searchParams.set('ignoreGasEstimate', 'true');
  txUrl.searchParams.set('ignoreChecks',      'true');

  const txRes = await fetch(txUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  if (!txRes.ok) {
    const e = await txRes.json().catch(() => ({}));
    throw new Error(e.error ?? `Paraswap build TX: ${txRes.status}`);
  }
  const d = await txRes.json();

  return {
    tx: {
      to:       d.to,
      value:    d.value ?? '0',
      data:     d.data,
      gasLimit: d.gas ? Math.ceil(Number(d.gas) * 1.25).toString() : '400000',
    },
    outputAmount:   priceRoute.destAmount,
    outputSymbol:   priceRoute.destToken?.symbol   ?? '?',
    outputDecimals: priceRoute.destDecimals         ?? 18,
  };
}

export function formatOutput(amountWei, decimals) {
  const val = Number(BigInt(amountWei)) / 10 ** decimals;
  return val < 0.000001 ? '<0.000001' : val.toLocaleString('en', { maximumFractionDigits: 6 });
}
