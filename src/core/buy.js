/**
 * BioWallet Protected Buy/Sell — v36 (MoonPay)
 *
 * Flow:
 *   1. [Buy/Sell Crypto] gomb → döntési modal (Vétel / Eladás)
 *   2. Választás → modal bezárul → kamera felugrik a főképernyőn
 *   3. Liveness fut a fő UI-ban (DCC gate)
 *   4. Sikeres scan → MoonPay widget popup ablakban nyílik
 *
 * Protection chain:
 *   Ring 0 (code integrity) + DCC (biometric gate) + Worker (key isolation)
 *
 * MoonPay integration:
 *   - No domain/IP whitelist required for widget URL
 *   - Test key (pk_test_...) from moonpay.com/dashboard
 *   - Production key (pk_live_...) for live use
 */

// ── Supported networks (MoonPay currency codes) ───────────────────────────────
export const BUY_NETWORKS = new Map([
  [1,        { name: 'Ethereum',  buyCurrency: 'eth',           sellCurrency: 'eth',           fiatCurrencies: ['EUR','USD','GBP'] }],
  [56,       { name: 'BNB Chain', buyCurrency: 'bnb_bsc',       sellCurrency: 'bnb_bsc',       fiatCurrencies: ['EUR','USD']       }],
  [137,      { name: 'Polygon',   buyCurrency: 'matic_polygon',  sellCurrency: 'matic_polygon', fiatCurrencies: ['EUR','USD']       }],
  [42161,    { name: 'Arbitrum',  buyCurrency: 'eth_arbitrum',   sellCurrency: 'eth_arbitrum',  fiatCurrencies: ['EUR','USD']       }],
  [8453,     { name: 'Base',      buyCurrency: 'eth_base',       sellCurrency: 'eth_base',      fiatCurrencies: ['EUR','USD']       }],
  [10,       { name: 'Optimism',  buyCurrency: 'eth_optimism',   sellCurrency: 'eth_optimism',  fiatCurrencies: ['EUR','USD']       }],
]);

// ── MoonPay config ────────────────────────────────────────────────────────────
// Test mode is activated by the pk_test_ key — same URL for both test and production
const MOONPAY_BUY_URL  = 'https://buy.moonpay.com/';
const MOONPAY_SELL_URL = 'https://sell.moonpay.com/';

// ── Module state ──────────────────────────────────────────────────────────────
let _deps         = null;
let _container    = null;
let _modal        = null;
let _moonpayWin   = null;
let _pollInterval = null;

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
  _moonpayWin?.close();
  if (_pollInterval) clearInterval(_pollInterval);
  _deps = null; _container = null; _modal = null; _moonpayWin = null;
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

    const apiKey = await _loadApiKey();
    if (!apiKey) throw new Error('MoonPay API key not configured');

    _deps.setScanning(false);
    _deps.setMsg(_deps.t('buy.popup.opened'));
    _openMoonpayWindow(mode, network, address, apiKey);

  } catch (e) {
    _deps.setScanning(false);
    const isLiveness = e.message === 'LIVENESS_TIMEOUT' || (e.message ?? '').includes('LIVENESS');
    _deps.setMsg(
      isLiveness
        ? _deps.t('buy.err.liveness')
        : _deps.t('buy.err.provider') + ': ' + (e.message ?? '').slice(0, 80),
      'error'
    );
  }
}

// ── API key loading ───────────────────────────────────────────────────────────

async function _loadApiKey() {
  // 1. Server endpoint (Ring 0 protected)
  try {
    const r = await fetch('/api/buy/config', { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      if (d.apiKey) return d.apiKey;
    }
  } catch { /* try local */ }

  // 2. Local dev file (gitignored)
  try {
    const r = await fetch('/config/buy_local.json', { cache: 'no-store' });
    if (r.ok) {
      const d = await r.json();
      if (d.apiKey) return d.apiKey;
    }
  } catch { /* no local key */ }

  return null;
}

// ── MoonPay window ────────────────────────────────────────────────────────────

function _openMoonpayWindow(mode, network, address, apiKey) {
  const netInfo = BUY_NETWORKS.get(network.chainId);
  const baseUrl = mode === 'buy' ? MOONPAY_BUY_URL : MOONPAY_SELL_URL;

  const params = new URLSearchParams({
    apiKey,
    theme:           'dark',
    colorCode:       '%236c63ff',
    language:        document.documentElement.lang === 'hu' ? 'hu' : 'en',
  });

  if (mode === 'buy') {
    params.set('currencyCode',    netInfo.buyCurrency);
    params.set('walletAddress',   address);
    params.set('baseCurrencyCode','eur');
  } else {
    params.set('baseCurrencyCode', netInfo.sellCurrency);
    params.set('refundWalletAddress', address);
  }

  const url = baseUrl + '?' + params;

  _moonpayWin = window.open(
    url,
    'moonpay_buy',
    'width=480,height=700,left=100,top=50,resizable=yes,scrollbars=yes'
  );

  if (!_moonpayWin) {
    _moonpayWin = window.open(url, '_blank', 'noopener');
  }

  // Poll for window close to refresh balance
  if (_pollInterval) clearInterval(_pollInterval);
  _pollInterval = setInterval(() => {
    if (_moonpayWin?.closed) {
      clearInterval(_pollInterval);
      _pollInterval = null;
      _moonpayWin = null;
      window.dispatchEvent(new CustomEvent('biowallet:balance-refresh'));
    }
  }, 1000);
}
