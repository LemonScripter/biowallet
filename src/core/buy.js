/**
 * BioWallet Protected Buy/Sell — v36 (Ramp Network)
 *
 * Flow:
 *   1. [Buy/Sell Crypto] gomb → döntési modal (Vétel / Eladás)
 *   2. Választás → modal bezárul → kamera felugrik a főképernyőn
 *   3. Liveness fut a fő UI-ban (DCC gate)
 *   4. Sikeres scan → Ramp widget popup ablakban nyílik
 *
 * Protection chain:
 *   Ring 0 (code integrity) + DCC (biometric gate) + Worker (key isolation)
 *
 * Ramp Network integration:
 *   - No IP whitelist required
 *   - No domain whitelist for demo
 *   - URL built client-side (no server session needed)
 *   - postMessage events for order tracking
 */

// ── Supported networks (Ramp Network asset format) ───────────────────────────
// rampAsset: NETWORK_TOKEN format used by Ramp
export const BUY_NETWORKS = new Map([
  [1,        { name: 'Ethereum',  rampAsset: 'ETH_ETH',       fiatCurrencies: ['EUR','USD','GBP'], cryptoCurrencies: ['ETH','USDC','USDT'] }],
  [56,       { name: 'BNB Chain', rampAsset: 'BSC_BNB',       fiatCurrencies: ['EUR','USD'],       cryptoCurrencies: ['BNB','USDC']        }],
  [137,      { name: 'Polygon',   rampAsset: 'MATIC_MATIC',   fiatCurrencies: ['EUR','USD'],       cryptoCurrencies: ['MATIC','USDC']      }],
  [42161,    { name: 'Arbitrum',  rampAsset: 'ARBITRUM_ETH',  fiatCurrencies: ['EUR','USD'],       cryptoCurrencies: ['ETH','USDC']        }],
  [8453,     { name: 'Base',      rampAsset: 'BASE_ETH',      fiatCurrencies: ['EUR','USD'],       cryptoCurrencies: ['ETH','USDC']        }],
  [10,       { name: 'Optimism',  rampAsset: 'OPTIMISM_ETH',  fiatCurrencies: ['EUR','USD'],       cryptoCurrencies: ['ETH','USDC']        }],
]);

// ── Ramp config ───────────────────────────────────────────────────────────────
const RAMP_DEMO_URL  = 'https://app.demo.ramp.network/';   // no API key needed
const RAMP_PROD_URL  = 'https://app.ramp.network/';
const RAMP_APP_NAME  = 'BioWallet';
const RAMP_LOGO_URL  = 'https://biowallet.metaspace.bio/app/icon-192.png';

// ── Module state ──────────────────────────────────────────────────────────────
let _deps       = null;
let _container  = null;
let _modal      = null;
let _rampWindow = null;

// ── Public API ────────────────────────────────────────────────────────────────

export function initBuyModule({ container, deps }) {
  _deps      = deps;
  _container = container;
  _injectStyles();
  _bindButton();
}

export function teardownBuyModule() {
  _modal?.remove();
  const btn = document.getElementById('btn-buy-sell');
  if (btn) btn.replaceWith(btn.cloneNode(true));
  _rampWindow?.close();
  window.removeEventListener('message', _handleRampMessage);
  _deps = null; _container = null; _modal = null; _rampWindow = null;
}

export function isBuySupported(chainId) {
  return BUY_NETWORKS.has(chainId);
}

// ── Styles ────────────────────────────────────────────────────────────────────

function _injectStyles() {
  if (document.getElementById('_buy_styles')) return;
  const s = document.createElement('style');
  s.id = '_buy_styles';
  s.textContent = `
    .buy-modal-overlay {
      position:fixed;inset:0;background:rgba(0,0,0,.65);
      display:flex;align-items:center;justify-content:center;z-index:9000;padding:1rem;
    }
    .buy-modal {
      background:var(--surface);border:1px solid var(--border);border-radius:16px;
      width:100%;max-width:420px;padding:1.2rem;
    }
    .buy-modal-header {
      display:flex;justify-content:space-between;align-items:center;
      font-weight:700;font-size:1rem;margin-bottom:1.2rem;
    }
    .buy-close-btn {
      background:none;border:none;color:var(--muted);font-size:1.4rem;
      cursor:pointer;width:auto;padding:0 .4rem;line-height:1;
    }
    .buy-choice-row { display:flex;gap:.75rem; }
    .buy-choice-btn {
      flex:1;width:auto;padding:1rem .8rem;border-radius:12px;
      border:1px solid var(--border);background:var(--surface2);
      cursor:pointer;text-align:center;transition:all .15s;
      display:flex;flex-direction:column;align-items:center;gap:.35rem;
    }
    .buy-choice-btn:hover { border-color:var(--accent);background:rgba(108,99,255,.08); }
    .buy-choice-btn .buy-choice-icon { font-size:1.6rem;color:var(--accent); }
    .buy-choice-btn strong { font-size:.95rem;color:var(--text); }
    .buy-choice-btn small  { font-size:.72rem;color:var(--muted);line-height:1.3; }
  `;
  document.head.appendChild(s);
}

// ── UI ────────────────────────────────────────────────────────────────────────

function _bindButton() {
  const btn = document.getElementById('btn-buy-sell');
  if (btn) btn.addEventListener('click', _onBuySellClick);
}

function _onBuySellClick() {
  const network = _deps.getCurrentNetwork();
  if (!BUY_NETWORKS.has(network.chainId)) return;
  _showChoiceModal(network);
}

function _showChoiceModal(network) {
  _modal?.remove();
  const netInfo = BUY_NETWORKS.get(network.chainId);
  const t = _deps.t;

  _modal = document.createElement('div');
  _modal.className = 'buy-modal-overlay';
  _modal.innerHTML = `
    <div class="buy-modal">
      <div class="buy-modal-header">
        <span>${t('buy.modal.title')} &mdash; ${netInfo.name}</span>
        <button id="_buy_close" class="buy-close-btn">&times;</button>
      </div>
      <div class="buy-choice-row">
        <button id="_buy_go_buy" class="buy-choice-btn">
          <span class="buy-choice-icon">&#8593;</span>
          <strong>${t('buy.tab.buy')}</strong>
          <small>${t('buy.desc.buy.short')}</small>
        </button>
        <button id="_buy_go_sell" class="buy-choice-btn">
          <span class="buy-choice-icon">&#8595;</span>
          <strong>${t('buy.tab.sell')}</strong>
          <small>${t('buy.desc.sell.short')}</small>
        </button>
      </div>
    </div>`;

  document.body.appendChild(_modal);
  _modal.querySelector('#_buy_close').addEventListener('click', _closeChoiceModal);
  _modal.querySelector('#_buy_go_buy').addEventListener('click',  () => _startFlow('buy',  network));
  _modal.querySelector('#_buy_go_sell').addEventListener('click', () => _startFlow('sell', network));
}

function _closeChoiceModal() {
  _modal?.remove();
  _modal = null;
}

// ── Core flow ─────────────────────────────────────────────────────────────────

async function _startFlow(mode, network) {
  _closeChoiceModal();

  try {
    await _deps.ensureCameraForScan();
  } catch {
    _deps.setMsg(_deps.t('buy.err.provider') + ': camera unavailable', 'error');
    return;
  }

  _deps.setScanning(true);
  _deps.setMsg(_deps.t('buy.scanning'));

  try {
    await _deps.performLivenessChallenge(_deps.videoEl, m => _deps.setMsg(m));
    await new Promise(r => setTimeout(r, 1500));

    const address = _deps.getActiveAddress();
    if (!address) throw new Error(_deps.t('buy.err.no_address'));

    _deps.setScanning(false);
    _deps.setMsg(_deps.t('buy.popup.opened'));

    _openRampWindow(mode, network, address);

  } catch (e) {
    _deps.setScanning(false);
    const isLiveness = e.message === 'LIVENESS_TIMEOUT' || (e.message ?? '').includes('LIVENESS');
    _deps.setMsg(
      isLiveness
        ? _deps.t('buy.err.liveness')
        : _deps.t('buy.err.provider') + ': ' + (e.message ?? '').slice(0, 60),
      'error'
    );
  }
}

// ── Ramp window ───────────────────────────────────────────────────────────────

function _openRampWindow(mode, network, address) {
  const netInfo = BUY_NETWORKS.get(network.chainId);

  const params = new URLSearchParams({
    userAddress:  address,
    hostAppName:  RAMP_APP_NAME,
    hostLogoUrl:  RAMP_LOGO_URL,
    fiatCurrency: 'EUR',
  });

  if (mode === 'buy') {
    params.set('swapAsset', netInfo.rampAsset);
    params.set('defaultAsset', netInfo.rampAsset);
  } else {
    // off-ramp: sell crypto for fiat
    params.set('offrampAsset', netInfo.rampAsset);
    params.set('enabledFlows', 'OFF_RAMP');
  }

  const url = RAMP_DEMO_URL + '?' + params;

  _rampWindow = window.open(
    url,
    'ramp_buy',
    'width=480,height=700,left=100,top=50,resizable=yes,scrollbars=yes'
  );

  if (!_rampWindow) {
    _rampWindow = window.open(url, '_blank', 'noopener');
  }

  window.addEventListener('message', _handleRampMessage);
}

function _handleRampMessage(event) {
  // Ramp sends events from app.demo.ramp.network or app.ramp.network
  if (!event.origin.includes('ramp.network')) return;

  const { type, payload } = event.data ?? {};

  if (type === 'PURCHASE_CREATED' || type === 'PURCHASE_SUCCESSFUL') {
    const amount = payload?.purchase?.cryptoAmount ?? '';
    const asset  = payload?.purchase?.asset?.symbol ?? '';
    _deps.setMsg(_deps.t('buy.success') + (amount ? ` ${amount} ${asset}` : ''));
    setTimeout(() => window.dispatchEvent(new CustomEvent('biowallet:balance-refresh')), 3000);
  }

  if (type === 'WIDGET_CLOSE') {
    _rampWindow?.close();
    _rampWindow = null;
    window.removeEventListener('message', _handleRampMessage);
  }
}
