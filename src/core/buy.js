/**
 * BioWallet Protected Buy/Sell — v36
 *
 * Flow:
 *   1. [Buy/Sell Crypto] gomb → döntési modal (Vétel / Eladás)
 *   2. Választás → modal bezárul → kamera felugrik a főképernyőn (setScanning)
 *   3. Liveness fut a fő UI-ban (nem a modal-ban)
 *   4. Sikeres scan → Transak widget overlay-ként nyílik
 *
 * Protection chain:
 *   Ring 0 (code integrity) + DCC (biometric gate) + Worker (key isolation)
 */

// ── Supported networks ────────────────────────────────────────────────────────
export const BUY_NETWORKS = new Map([
  // transakNet = Transak API network identifier (NOT the display name)
  [1,        { name: 'Ethereum',  transakNet: 'ethereum',  fiatCurrencies: ['EUR','USD','GBP'], cryptoCurrencies: ['ETH','USDC','USDT'] }],
  [56,       { name: 'BNB Chain', transakNet: 'bsc',       fiatCurrencies: ['EUR','USD'],       cryptoCurrencies: ['BNB','USDC']        }],
  [137,      { name: 'Polygon',   transakNet: 'polygon',   fiatCurrencies: ['EUR','USD'],       cryptoCurrencies: ['MATIC','USDC']      }],
  [42161,    { name: 'Arbitrum',  transakNet: 'arbitrum',  fiatCurrencies: ['EUR','USD'],       cryptoCurrencies: ['ETH','USDC']        }],
  [8453,     { name: 'Base',      transakNet: 'base',      fiatCurrencies: ['EUR','USD'],       cryptoCurrencies: ['ETH','USDC']        }],
  [10,       { name: 'Optimism',  transakNet: 'optimism',  fiatCurrencies: ['EUR','USD'],       cryptoCurrencies: ['ETH','USDC']        }],
]);

// ── Transak config ────────────────────────────────────────────────────────────
const TRANSAK_SANDBOX_KEY = 'BIOWALLET_TRANSAK_KEY_PLACEHOLDER';
const TRANSAK_WIDGET_URL  = 'https://global-stg.transak.com';  // sandbox

// ── Module state ──────────────────────────────────────────────────────────────
let _deps      = null;
let _container = null;
let _modal     = null;

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
  _deps = null; _container = null; _modal = null;
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
      width:100%;max-width:480px;padding:1.2rem;
    }
    .buy-modal-header {
      display:flex;justify-content:space-between;align-items:center;
      font-weight:700;font-size:1rem;margin-bottom:1.2rem;
    }
    .buy-close-btn {
      background:none;border:none;color:var(--muted);font-size:1.4rem;
      cursor:pointer;width:auto;padding:0 .4rem;line-height:1;
    }
    .buy-choice-row {
      display:flex;gap:.75rem;
    }
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
    .buy-success {
      text-align:center;padding:2rem 1rem;
    }
    .buy-success-icon { font-size:2.5rem;color:var(--ok);margin-bottom:.75rem; }
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

// Step 1: Döntési modal — csak Vétel / Eladás, nincs scan gomb
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

// Step 2: Választás → modal bezár → kamera felugrik → liveness → Transak
async function _startFlow(mode, network) {
  _closeChoiceModal();

  // Kamera megnyitása + scroll top (mint a Sign TX flow)
  try {
    await _deps.ensureCameraForScan();
  } catch (e) {
    _deps.setMsg(_deps.t('buy.err.provider') + ': camera unavailable', 'error');
    return;
  }
  _deps.setScanning(true);
  _deps.setMsg(_deps.t('buy.scanning'));

  try {
    // DCC Gate: liveness a főképernyőn
    await _deps.performLivenessChallenge(_deps.videoEl, m => _deps.setMsg(m));
    await new Promise(r => setTimeout(r, 1500));

    const address = _deps.getActiveAddress();
    if (!address) throw new Error(_deps.t('buy.err.no_address'));

    _deps.setMsg(_deps.t('buy.loading'));
    _deps.setScanning(false);

    // Try session endpoint first (production, IP whitelisted)
    // Fall back to direct URL (staging/dev)
    let widgetUrl = null;
    try {
      const netInfo = BUY_NETWORKS.get(network.chainId);
      widgetUrl = await _loadTransakSession(mode, netInfo, address);
    } catch {
      // Session not available (IP not whitelisted yet) → direct URL
      const config = await _loadTransakConfig();
      widgetUrl = _buildDirectUrl(mode, network, address, config);
    }
    _openTransakWindow(widgetUrl);

  } catch (e) {
    _deps.setScanning(false);
    const isLiveness = e.message === 'LIVENESS_TIMEOUT' || (e.message ?? '').includes('LIVENESS');
    _deps.setMsg(
      isLiveness ? _deps.t('buy.err.liveness') : _deps.t('buy.err.provider') + ': ' + (e.message ?? '').slice(0, 60),
      'error'
    );
  }
}

// ── Transak config ────────────────────────────────────────────────────────────

async function _loadTransakConfig() {
  // 1. Production: server session endpoint (Ring 0 protected, IP whitelisted)
  //    Returns { widgetUrl } directly — used when IP is whitelisted at Transak
  //    Activated once Transak IP whitelist is configured

  // 2. Server config endpoint (API key only, no session)
  try {
    const r = await fetch('/api/buy/config', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch { /* try local dev */ }

  // 3. Local dev: buy_local.json (gitignored, never committed)
  try {
    const r = await fetch('/config/buy_local.json', { cache: 'no-store' });
    if (r.ok) return await r.json();
  } catch { /* fallback placeholder */ }

  return { apiKey: TRANSAK_SANDBOX_KEY, environment: 'STAGING' };
}

// Called when IP is whitelisted — gets session widgetUrl from server
async function _loadTransakSession(mode, network, address) {
  const r = await fetch('/api/buy/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode, network: network.transakNet,
      address, currency: network.cryptoCurrencies[0],
      staging: true,
    }),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error('Session API error ' + r.status);
  const data = await r.json();
  if (!data.widgetUrl) throw new Error(data.error || 'No widgetUrl');
  return data.widgetUrl;
}

// ── Transak window ────────────────────────────────────────────────────────────

let _transakWindow = null;

function _buildDirectUrl(mode, network, address, config) {
  const netInfo = BUY_NETWORKS.get(network.chainId);
  const params = new URLSearchParams({
    apiKey:                   config.apiKey,
    environment:              config.environment,
    walletAddress:            address,
    network:                  netInfo.transakNet,
    defaultCryptoCurrency:    netInfo.cryptoCurrencies[0],
    productsAvailed:          mode === 'buy' ? 'BUY' : 'SELL',
    themeColor:               '6c63ff',
    hideMenu:                 'true',
    disableWalletAddressForm: 'true',
  });
  return `${TRANSAK_WIDGET_URL}?${params}`;
}

function _openTransakWindow(url) {

  _transakWindow = window.open(
    url,
    'transak_buy',
    'width=450,height=700,left=100,top=50,resizable=yes,scrollbars=yes'
  );

  if (!_transakWindow) {
    // Popup blocked — fallback: new tab
    _transakWindow = window.open(url, '_blank', 'noopener');
    _deps.setMsg(_deps.t('buy.popup.opened'));
  } else {
    _deps.setMsg(_deps.t('buy.popup.opened'));
  }

  // Listen for completion message from Transak popup (window.opener.postMessage)
  window.addEventListener('message', _handleTransakMessage);
}

function _handleTransakMessage(event) {
  if (!event.data?.event_id?.startsWith('TRANSAK_')) return;
  const { event_id, data } = event.data;

  if (event_id === 'TRANSAK_ORDER_SUCCESSFUL') {
    _transakWindow?.close();
    _transakWindow = null;
    window.removeEventListener('message', _handleTransakMessage);
    _deps.setMsg(
      _deps.t('buy.success') +
      (data?.cryptoAmount ? ' ' + data.cryptoAmount + ' ' + (data.cryptoCurrency ?? '') : '')
    );
    setTimeout(() => window.dispatchEvent(new CustomEvent('biowallet:balance-refresh')), 3000);
  } else if (event_id === 'TRANSAK_WIDGET_CLOSE') {
    _transakWindow?.close();
    _transakWindow = null;
    window.removeEventListener('message', _handleTransakMessage);
  }
}
