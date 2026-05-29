/**
 * BioWallet — App Controller
 *
 * Crypto: vault_worker.js (Worker thread) — main thread never sees the key.
 * EIP-1559: getFeeData() + estimateGas() — accurate gas estimation.
 * Confirm overlay before every send.
 */

import { t, setLang, getLang, applyI18n, getInfoContent, getGuideHTML, tArr } from '../core/i18n.js?v=12';
import { openCamera, enrollEmbedding, captureEmbedding } from '../core/bio_capture.js?v=11';
import {
  WC_PROJECT_ID, initWC, wcPair, wcApprove, wcRejectProposal, wcEmitChainChanged,
  wcRespondOk, wcRespondError, wcGetSessions, wcDisconnect, wcReady,
} from '../core/wc2.js';
import {
  BUILTIN_NETWORKS, getAllNetworks, saveCustomNetwork, deleteCustomNetwork,
  getBalance, getNonce,
  getFeeData, estimateGas, broadcastTx,
  ethToWei, weiToEth, isValidAddress, resolveENS,
  getTokenBalance, formatToken, fetchTxHistory,
  tokenToRaw, encodeTransfer,
} from '../core/rpc.js?v=21';

// ── Worker init ───────────────────────────────────────────────────────────

const worker  = new Worker('./vault_worker.js?v=22', { type: 'module' });
let _nextId   = 0;
const _pending = new Map();

worker.onmessage = ({ data: { id, ok, result, error } }) => {
  const p = _pending.get(id);
  if (!p) return;
  _pending.delete(id);
  ok ? p.resolve(result) : p.reject(new Error(error));
};

worker.onerror = (e) => console.error('[Worker]', e.message);

function callWorker(type, payload = {}, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = _nextId++;
    _pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload }, transfer);
  });
}

// ── DOM refs ──────────────────────────────────────────────────────────────
const video       = document.getElementById('video');
const faceGuide   = document.getElementById('face-guide');
const scanHint    = document.getElementById('scan-hint');
const enrollDots  = document.getElementById('enroll-dots');
const msg         = document.getElementById('msg');
const tokenBadge  = document.getElementById('token-badge');
const tokenText   = document.getElementById('token-text');
const ttlBars     = document.getElementById('ttl-bars');
const ethAddress  = document.getElementById('eth-address');

const panelSetup  = document.getElementById('panel-setup');
const panelImport = document.getElementById('panel-import');
const panelLock   = document.getElementById('panel-lock');
const panelVault  = document.getElementById('panel-vault');

const btnLang        = document.getElementById('btn-lang');
const btnEnroll      = document.getElementById('btn-enroll');
const btnImport       = document.getElementById('btn-import');
const btnRestore      = document.getElementById('btn-restore');
const btnSwitchWallet = document.getElementById('btn-switch-wallet');
const btnImportEnroll= document.getElementById('btn-import-enroll');
const btnImportCancel= document.getElementById('btn-import-cancel');
const importPhrase   = document.getElementById('import-phrase');
importPhrase.addEventListener('focus', () => { importPhrase.style.filter = 'none'; });
importPhrase.addEventListener('blur',  () => { importPhrase.style.filter = 'blur(4px)'; });
const btnScan        = document.getElementById('btn-scan');
const btnSign        = document.getElementById('btn-sign');
const btnPaper       = document.getElementById('btn-paper');
const btnLock        = document.getElementById('btn-lock');
const btnCopy        = document.getElementById('btn-copy');
const btnNetwork     = document.getElementById('btn-network');
const btnRefresh     = document.getElementById('btn-refresh');

const ethBalance     = document.getElementById('eth-balance');
const tokenBalances  = document.getElementById('token-balances');
const sendToInput    = document.getElementById('send-to');
const sendAmountInput= document.getElementById('send-amount');
const txResult       = document.getElementById('tx-result');
const txLink         = document.getElementById('tx-link');
const wcBar          = document.getElementById('wc-bar');
const wcDappName     = document.getElementById('wc-dapp-name');
const btnWcDisc      = document.getElementById('btn-wc-disc');
const btnWc          = document.getElementById('btn-wc');
const txHistoryCard  = document.getElementById('tx-history-card');
const txHistoryList  = document.getElementById('tx-history-list');
const sendCardLabel  = document.getElementById('send-card-label');
const tokenSelector  = document.getElementById('token-selector');
const amountUnit     = document.getElementById('amount-unit');
const sendBtnLabel   = document.getElementById('send-btn-label');
const btnQR          = document.getElementById('btn-qr');
const qrWrap         = document.getElementById('qr-wrap');
const qrCanvas       = document.getElementById('qr-canvas');
const ensHint        = document.getElementById('ens-hint');
const btnDevice      = document.getElementById('btn-device');
const deviceRow      = document.getElementById('device-row');

const dots = [0,1,2,3,4].map(i => document.getElementById(`dot-${i}`));

// ── State ─────────────────────────────────────────────────────────────────
let stream            = null;
let timerID           = null;
let currentNetwork    = BUILTIN_NETWORKS.find(n => n.key === 'sepolia');
let vaultReady        = false;
let ensResolved       = null;
let inCooldown        = false;
let selectedToken       = null;
const tokenBalanceCache = new Map();
let pendingWCReq        = null;
let _currentMsgKey    = null;  // i18n key of the last status bar message

// ── i18n init ─────────────────────────────────────────────────────────────
applyI18n();
document.getElementById('guide-modal-body').innerHTML = getGuideHTML();

if (btnLang) {
  btnLang.addEventListener('click', () => {
    setLang(getLang() === 'hu' ? 'en' : 'hu');
    applyI18n();
    document.getElementById('guide-modal-body').innerHTML = getGuideHTML();
    _refreshDynamicLabels();
    if (_currentMsgKey) setMsg(t(_currentMsgKey), msg.className.replace('msg-bar', '').trim());
  });
}

function _refreshDynamicLabels() {
  const sym = currentNetwork.nativeSymbol ?? 'ETH';
  if (!selectedToken) {
    const label = t('btn.send.token', { sym });
    sendCardLabel.textContent = label;
    sendBtnLabel.textContent  = label;
    amountUnit.textContent    = sym;
  } else {
    const label = t('btn.send.token', { sym: selectedToken.symbol });
    sendCardLabel.textContent = label;
    sendBtnLabel.textContent  = label;
    amountUnit.textContent    = selectedToken.symbol;
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
(async () => {
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.register('/app/sw.js').catch(() => {});

  try {
    stream = await openCamera(video, m => setMsg(m, ''));
  } catch (e) {
    setMsg(t('msg.camera.error', { err: e.message }), 'error');
  }

  const stored = localStorage.getItem('biowallet_meta');
  if (stored) {
    try {
      const meta = JSON.parse(stored);
      if (meta.P?.version === 'p1') {
        localStorage.clear();
        showPanel('setup');
        setMsgK('msg.vault.outdated', 'error');
      } else {
        await callWorker('INIT_VAULT', { vaultId: meta.vaultId });
        vaultReady = true;
        showPanel('lock');
        setMsgK('msg.vault.loaded');
      }
    } catch {
      localStorage.clear();
      showPanel('setup');
      setMsgK('msg.vault.corrupted', 'error');
    }
  } else {
    showPanel('setup');
    setMsgK('msg.first.launch');
  }

  startTimer();
  showVersionHash(); // non-blocking
})();

// ── Brute-force protection (C5) ───────────────────────────────────────────
const BF_AFTER = 3;
const BF_BASE  = 30;

function _bfGet() {
  try { return JSON.parse(localStorage.getItem('biowallet_bf') ?? 'null') ?? { n: 0, until: 0 }; }
  catch { return { n: 0, until: 0 }; }
}

function bioFail() {
  const s = _bfGet();
  s.n++;
  if (s.n % BF_AFTER === 0) {
    const mult = Math.min(2 ** (s.n / BF_AFTER - 1), 8);
    s.until = Date.now() + BF_BASE * mult * 1000;
  }
  localStorage.setItem('biowallet_bf', JSON.stringify(s));
}

function bioSuccess() {
  localStorage.removeItem('biowallet_bf');
}

function cooldownMs() {
  return Math.max(0, _bfGet().until - Date.now());
}

function bioFailHint() {
  const s = _bfGet();
  const left = BF_AFTER - (s.n % BF_AFTER);
  return s.n > 0 && left < BF_AFTER ? t('bf.remaining', { n: left }) : '';
}

// ── Version hash (verifiable build fingerprint) ───────────────────────────
async function showVersionHash() {
  const FILES = [
    ['/app/index.html',           'index.html'],
    ['/app/app.js',               'app.js'],
    ['/app/vault_worker.js',      'vault_worker.js'],
    ['/core/vault.js',            'vault.js'],
    ['/core/recovery_formula.js', 'recovery_formula.js'],
  ];
  try {
    const results = await Promise.all(FILES.map(async ([url, name]) => {
      const buf  = await fetch(url).then(r => r.arrayBuffer());
      const hash = await crypto.subtle.digest('SHA-256', buf);
      const hex  = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
      return { name, hex };
    }));

    const combined = await crypto.subtle.digest('SHA-256',
      new TextEncoder().encode(results.map(r => r.hex).join('')));
    const fp = Array.from(new Uint8Array(combined), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);

    const footer = document.getElementById('app-footer');
    if (!footer) return;

    const el = document.createElement('div');
    el.style.cssText = [
      'margin-top:0.35rem',
      'font-family:"SF Mono","Fira Code",monospace',
      'font-size:0.6rem',
      'color:#3a3a55',
      'letter-spacing:0.04em',
      'cursor:pointer',
      'user-select:none',
    ].join(';');
    el.innerHTML = `Build <span id="fp-value" style="color:#52527a">${fp}</span>`;
    el.title = 'Click for details · SHA-256 verification';

    el.addEventListener('click', () => {
      const existing = document.getElementById('hash-detail-box');
      if (existing) { existing.remove(); return; }

      const box = document.createElement('div');
      box.id = 'hash-detail-box';
      box.style.cssText = [
        'position:fixed', 'bottom:3.5rem', 'left:50%', 'transform:translateX(-50%)',
        'background:#16161a', 'border:1px solid #2a2a35', 'border-radius:12px',
        'padding:1rem 1.2rem 0.8rem', 'font-family:monospace', 'font-size:0.68rem',
        'color:#e8e8f0', 'z-index:999', 'line-height:1.8',
        'box-shadow:0 8px 32px rgba(0,0,0,0.7)', 'max-width:calc(100vw - 2rem)',
        'overflow-x:auto', 'min-width:min(380px, calc(100vw - 2rem))',
      ].join(';');

      const lines = results.map(r =>
        `${r.name.padEnd(22)} ${r.hex.slice(0, 16)}…`
      ).join('\n');
      const pre = document.createElement('pre');
      pre.style.cssText = 'margin:0;white-space:pre;';
      pre.textContent = `SHA-256 Build Fingerprint\n${'─'.repeat(40)}\n${lines}\n\nCombined: ${fp}`;

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.style.cssText = [
        'display:block', 'margin-top:0.6rem', 'margin-left:auto',
        'background:none', 'border:1px solid #3a3a55', 'border-radius:6px',
        'color:#6b6b80', 'font-size:0.75rem', 'padding:0.2rem 0.6rem',
        'cursor:pointer', 'font-family:inherit',
      ].join(';');
      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); box.remove(); });

      box.appendChild(pre);
      box.appendChild(closeBtn);
      document.body.appendChild(box);
    });

    footer.appendChild(el);
  } catch { /* offline or fetch error — hash not displayed */ }
}

// ── PIN modal ─────────────────────────────────────────────────────────────

function showPinModal(mode) {
  const isSetup = mode === 'setup';
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;';

    const inputStyle = [
      'width:100%', 'background:#1e1e24', 'border:1px solid #2a2a35',
      'border-radius:10px', 'padding:0.65rem 0.75rem', 'color:#e8e8f0',
      'font-size:1.1rem', 'letter-spacing:0.25em', 'outline:none',
      'box-sizing:border-box', 'margin-bottom:0.5rem',
    ].join(';');

    ov.innerHTML = `
      <div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;
                  width:100%;max-width:340px;padding:1.5rem;">
        <div style="font-size:1rem;font-weight:700;color:#6c63ff;margin-bottom:0.5rem;">
          ${t(isSetup ? 'pin.setup.title' : 'pin.open.title')}
        </div>
        <div style="font-size:0.78rem;color:#6b6b80;margin-bottom:1rem;line-height:1.5;">
          ${t(isSetup ? 'pin.setup.desc' : 'pin.open.desc')}
        </div>
        <div style="font-size:0.72rem;color:#a0a0b0;margin-bottom:0.3rem;">${t('pin.label')}</div>
        <input id="_pin1" type="password" autocomplete="off" style="${inputStyle}" placeholder="••••">
        ${isSetup ? `
          <div style="font-size:0.72rem;color:#a0a0b0;margin-bottom:0.3rem;">${t('pin.confirm.label')}</div>
          <input id="_pin2" type="password" autocomplete="off" style="${inputStyle}" placeholder="••••">
        ` : ''}
        <div id="_pin_err" style="font-size:0.72rem;color:#ff4757;min-height:1.2em;margin-bottom:0.6rem;"></div>
        <div style="display:flex;gap:0.75rem;">
          <button id="_pin_cancel" style="flex:1;padding:0.75rem;border-radius:10px;
            border:1px solid #2a2a35;background:#1e1e24;color:#e8e8f0;
            font-size:0.9rem;font-weight:600;cursor:pointer;">${t('pin.btn.cancel')}</button>
          <button id="_pin_ok" style="flex:1;padding:0.75rem;border-radius:10px;
            border:none;background:#6c63ff;color:#fff;
            font-size:0.9rem;font-weight:600;cursor:pointer;">
            ${t(isSetup ? 'pin.btn.set' : 'pin.btn.open')}
          </button>
        </div>
      </div>`;

    document.body.appendChild(ov);

    const pin1   = ov.querySelector('#_pin1');
    const pin2   = ov.querySelector('#_pin2');
    const errEl  = ov.querySelector('#_pin_err');
    const okBtn  = ov.querySelector('#_pin_ok');

    setTimeout(() => pin1.focus(), 80);

    const submit = () => {
      const v1 = pin1.value;
      if (v1.length < 4) { errEl.textContent = t('pin.min.hint'); return; }
      if (isSetup && pin2 && v1 !== pin2.value) {
        errEl.textContent = t('pin.mismatch');
        pin2.focus();
        return;
      }
      ov.remove();
      resolve(v1);
    };

    okBtn.addEventListener('click', submit);
    ov.querySelector('#_pin_cancel').addEventListener('click', () => { ov.remove(); resolve(null); });
    [pin1, pin2].filter(Boolean).forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
  });
}

// ── File save (showSaveFilePicker on desktop, <a download> fallback) ────────

async function saveFile(data, filename) {
  if (window.showSaveFilePicker) {
    try {
      const isJson = filename.endsWith('.json');
      const fh = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{
          description: isJson ? 'JSON' : 'BioWallet vault',
          accept: isJson
            ? { 'application/json': ['.json'] }
            : { 'application/octet-stream': ['.biowallet'] },
        }],
      });
      const w = await fh.createWritable();
      await w.write(data);
      await w.close();
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  downloadBlob(data, filename);
  return true;
}

// ── Save modal ─────────────────────────────────────────────────────────────

function showSaveModal(vaultData, pJsonStr, context, existingName) {
  return new Promise(resolve => {
    const isDevice = context === 'device';
    const dfltName = (existingName || 'biowallet').replace(/[^a-zA-Z0-9_-]/g, '-');

    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:2000;display:flex;align-items:start;justify-content:center;padding:1.5rem;overflow-y:auto;';

    const rowS  = 'display:flex;align-items:center;gap:0.6rem;background:#1e1e24;border:1px solid #2a2a35;border-radius:10px;padding:0.75rem;margin-bottom:0.5rem;';
    const keepS = 'flex-shrink:0;font-size:0.65rem;font-weight:700;color:#ffa502;background:#2a1f00;border-radius:4px;padding:2px 6px;';
    const btnS  = 'flex-shrink:0;padding:0.45rem 0.7rem;border-radius:8px;border:none;background:#6c63ff;color:#fff;font-size:0.8rem;font-weight:600;cursor:pointer;';
    const okS   = 'flex-shrink:0;font-size:0.82rem;color:#4CAF50;font-weight:700;display:none;';
    const descS = 'font-size:0.72rem;color:#6b6b80;margin-top:0.18rem;line-height:1.4;';
    const inpS  = 'width:100%;background:#1e1e24;border:1px solid #2a2a35;border-radius:10px;padding:0.65rem 0.75rem;color:#e8e8f0;font-size:1rem;outline:none;box-sizing:border-box;margin-bottom:0.75rem;';

    ov.innerHTML = `
      <div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;width:100%;max-width:380px;padding:1.5rem;margin-top:1rem;">
        <div style="font-size:1rem;font-weight:700;color:#6c63ff;margin-bottom:1rem;">${t('save.title')}</div>
        <div style="font-size:0.72rem;color:#a0a0b0;margin-bottom:0.3rem;">${t('save.name.label')}</div>
        <input id="_sn" type="text" style="${inpS}" placeholder="${t('save.name.ph')}" value="${dfltName}" autocomplete="off" spellcheck="false">
        <div style="${rowS}">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
              <span id="_fn_v" style="font-size:0.82rem;font-weight:600;color:#e8e8f0;word-break:break-all;">${dfltName}.biowallet</span>
              <span style="${keepS}">${t('save.vault.keep')}</span>
            </div>
            <div style="${descS}">${t('save.vault.desc')}</div>
          </div>
          <button id="_sv" style="${btnS}">${t('save.btn.download')}</button>
          <span id="_sv_ok" style="${okS}">${t('save.saved')}</span>
        </div>
        ${!isDevice ? `
        <div style="${rowS}">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:0.4rem;flex-wrap:wrap;">
              <span id="_fn_p" style="font-size:0.82rem;font-weight:600;color:#e8e8f0;word-break:break-all;">${dfltName}.P.json</span>
              <span style="${keepS}">${t('save.pjson.keep')}</span>
            </div>
            <div style="${descS}">${t('save.pjson.desc')}</div>
          </div>
          <button id="_sp" style="${btnS}">${t('save.btn.download')}</button>
          <span id="_sp_ok" style="${okS}">${t('save.saved')}</span>
        </div>
        ` : `
        <div id="_sw_warn" style="font-size:0.72rem;color:#ffa502;background:#1a1500;border:1px solid #3a2f00;border-radius:8px;padding:0.6rem 0.75rem;margin-bottom:0.75rem;line-height:1.5;">
          ${t('save.device.warn', { name: dfltName })}
        </div>
        `}
        <button id="_sd" style="width:100%;margin-top:0.25rem;padding:0.75rem;border-radius:10px;border:none;background:#2a2a35;color:#e8e8f0;font-size:0.9rem;font-weight:600;cursor:pointer;">${t('save.btn.done')}</button>
      </div>`;

    document.body.appendChild(ov);

    const nameInp = ov.querySelector('#_sn');
    const fnV     = ov.querySelector('#_fn_v');
    const fnP     = ov.querySelector('#_fn_p');
    const svBtn   = ov.querySelector('#_sv');
    const svOk    = ov.querySelector('#_sv_ok');
    const spBtn   = ov.querySelector('#_sp');
    const spOk    = ov.querySelector('#_sp_ok');
    const warnEl  = ov.querySelector('#_sw_warn');
    const doneBtn = ov.querySelector('#_sd');

    const getName = () => (nameInp.value.trim().replace(/[^a-zA-Z0-9_-]/g, '-') || 'biowallet');

    nameInp.addEventListener('input', () => {
      const n = getName();
      fnV.textContent = `${n}.biowallet`;
      if (fnP)    fnP.textContent    = `${n}.P.json`;
      if (warnEl) warnEl.innerHTML   = t('save.device.warn', { name: n });
    });

    svBtn.addEventListener('click', async () => {
      const saved = await saveFile(vaultData, `${getName()}.biowallet`);
      if (saved) { svBtn.style.display = 'none'; svOk.style.display = 'inline'; }
    });

    spBtn?.addEventListener('click', async () => {
      const saved = await saveFile(pJsonStr, `${getName()}.P.json`);
      if (saved) { spBtn.style.display = 'none'; spOk.style.display = 'inline'; }
    });

    doneBtn.addEventListener('click', () => { ov.remove(); resolve(getName()); });
  });
}

function _getVaultVersion(buf) {
  try {
    if (new Uint8Array(buf)[0] !== 0x7b) return 1;
    return JSON.parse(new TextDecoder().decode(buf)).v ?? 2;
  } catch { return 1; }
}

// ── WebAuthn PRF helpers ──────────────────────────────────────────────────

async function enrollWebAuthn() {
  // Check platform authenticator availability upfront
  const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false);
  if (!available) return null;

  const prfSalt = crypto.getRandomValues(new Uint8Array(32));
  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'BioWallet', id: location.hostname },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: 'biowallet',
          displayName: 'BioWallet',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7   },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey:             'required',
          requireResidentKey:      true,
          userVerification:        'required',
        },
        extensions: { prf: { eval: { first: prfSalt } } },
        timeout: 60000,
      },
    });
  } catch { return null; }

  // Try PRF from create() response (Chrome 116+ returns it immediately on most platforms)
  let prfResult = credential.getClientExtensionResults()?.prf?.results?.first;

  // Fallback: some platforms (e.g. older Windows Hello) only expose PRF on get(), not create()
  if (!prfResult) {
    try {
      const getC = await navigator.credentials.get({
        publicKey: {
          challenge:        crypto.getRandomValues(new Uint8Array(32)),
          rpId:             location.hostname,
          allowCredentials: [{ type: 'public-key', id: credential.rawId }],
          userVerification: 'required',
          extensions:       { prf: { eval: { first: prfSalt } } },
          timeout:          60000,
        },
      });
      prfResult = getC?.getClientExtensionResults()?.prf?.results?.first;
    } catch { /* platform doesn't support PRF at all */ }
  }

  if (!prfResult) return null;

  return {
    credentialId: Array.from(new Uint8Array(credential.rawId)),
    prfSalt:      Array.from(prfSalt),
    devicePrf:    Array.from(new Uint8Array(prfResult)),
  };
}

async function getDevicePrf(credentialId, prfSalt) {
  let credential;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge:        crypto.getRandomValues(new Uint8Array(32)),
        rpId:             location.hostname,
        allowCredentials: [{ type: 'public-key', id: new Uint8Array(credentialId) }],
        userVerification: 'required',
        extensions:       { prf: { eval: { first: new Uint8Array(prfSalt) } } },
        timeout:          60000,
      },
    });
  } catch { return null; }

  const prfResult = credential?.getClientExtensionResults()?.prf?.results?.first;
  if (!prfResult) return null;
  return Array.from(new Uint8Array(prfResult));
}

// ── Enrollment ────────────────────────────────────────────────────────────
btnEnroll.addEventListener('click', async () => {
  btnEnroll.disabled = true;
  setScanning(true);
  enrollDots.style.display = 'flex';
  setMsg(t('msg.scanning.face'), '');

  let embedding;
  try {
    embedding = await enrollEmbedding(video, (n) => {
      dots.forEach((d, i) => d.classList.toggle('done', i < n));
      setMsg(t('msg.scan.progress', { n }), '');
    });
  } catch (e) {
    setScanning(false);
    enrollDots.style.display = 'none';
    setMsg(e.message, 'error');
    btnEnroll.disabled = false;
    return;
  }

  setScanning(false);
  enrollDots.style.display = 'none';

  const pin = await showPinModal('setup');
  if (!pin) {
    setMsg('', '');
    btnEnroll.disabled = false;
    return;
  }

  try {
    const { vaultId, P, encryptedVault } = await callWorker(
      'ENROLL', { embedding, pin }, [embedding.buffer]
    );

    const vaultJson = new TextDecoder().decode(encryptedVault);
    const newMeta = { vaultId, P, vaultJson };
    localStorage.setItem('biowallet_meta', JSON.stringify(newMeta));

    const walletName = await showSaveModal(encryptedVault, JSON.stringify(P), 'create');
    newMeta.walletName = walletName;
    localStorage.setItem('biowallet_meta', JSON.stringify(newMeta));

    vaultReady = true;
    setMsg(t('msg.wallet.created'), 'ok');
    showPanel('lock');
  } catch (e) {
    setMsg(e.message, 'error');
    btnEnroll.disabled = false;
  }
});

// ── Paper recovery modal (printable) ─────────────────────────────────────
function showRecoveryPaperModal(rawA, r) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id = 'paper-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:2000;
      display:flex;align-items:flex-start;justify-content:center;
      padding:1rem;overflow-y:auto;
    `;

    const rows = (arr) => arr.map((v, i) =>
      `<div class="paper-row">
        <span class="paper-idx">${String(i+1).padStart(2,' ')}.</span>
        <span class="paper-val">${String(v).padStart(4,'0')}</span>
       </div>`
    ).join('');

    overlay.innerHTML = `
      <style>
        @media print {
          html, body { overflow:visible !important; height:auto !important; }
          body > *:not(#paper-overlay) { display:none !important; }
          #paper-overlay {
            position:static !important;
            inset:auto !important;
            overflow:visible !important;
            background:#fff !important;
            padding:0 !important;
            height:auto !important;
            display:block !important;
          }
          #paper-overlay > div {
            max-width:560px !important;
            margin:0 auto !important;
            background:#fff !important;
            border:none !important;
            border-radius:0 !important;
            padding:1cm !important;
            box-shadow:none !important;
          }
          #paper-overlay * { color:#000 !important; background:#fff !important;
                             border-color:#ccc !important; }
          .no-print { display:none !important; }
          .paper-section { page-break-inside:avoid; padding:0.5cm !important;
                           border:2px solid #000 !important; margin:0.3cm 0 !important;
                           border-radius:0 !important; }
          .paper-cut { display:block !important; }
        }
        .paper-grid { display:grid; grid-template-columns:repeat(4, 1fr); gap:0.3rem; }
        .paper-row { display:flex; gap:0.4rem; align-items:baseline;
                     padding:0.2rem 0.3rem; border-bottom:1px dotted #2a2a35; }
        .paper-idx { color:#6b6b80; font-size:0.7rem; width:1.6rem; flex-shrink:0; }
        .paper-val { color:#e8e8f0; font-family:monospace; font-size:0.88rem;
                     font-weight:600; }
        .paper-cut { display:none; text-align:center; padding:0.5rem;
                     border-top:1px dashed #000; border-bottom:1px dashed #000;
                     font-size:0.8rem; margin:0.5cm 0; }
      </style>
      <div style="background:#16161a;border:1px solid #ff4757;border-radius:16px;
                  width:100%;max-width:560px;margin:auto;padding:1.5rem;">

        <div style="color:#ffa502;font-size:0.72rem;font-weight:700;letter-spacing:0.08em;
                    text-transform:uppercase;margin-bottom:0.3rem;">${t('paper.step.label')}</div>
        <div style="font-size:1.05rem;font-weight:700;color:#e8e8f0;margin-bottom:0.3rem;">
          ${t('paper.title')}
        </div>
        <div style="font-size:0.78rem;color:#6b6b80;margin-bottom:0.8rem;line-height:1.5;">
          ${t('paper.desc')}
        </div>

        <div style="font-size:0.78rem;color:#ff4757;background:rgba(255,71,87,0.08);
                    border:1px solid rgba(255,71,87,0.4);border-radius:8px;
                    padding:0.6rem 0.8rem;margin-bottom:0.8rem;line-height:1.5;">
          ${t('paper.warn')}
        </div>

        <div class="paper-section" style="background:#1e1e24;border:1px solid #3a2a00;
                                          border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
          <div style="font-size:0.8rem;font-weight:700;color:#ffa502;margin-bottom:0.6rem;">
            ${t('paper.a.title')}
          </div>
          <div class="paper-grid">${rows(rawA)}</div>
        </div>

        <div class="paper-cut">✂  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  ✂</div>

        <div class="paper-section" style="background:#1e1e24;border:1px solid #2a2a35;
                                          border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
          <div style="font-size:0.8rem;font-weight:700;color:#4CAF50;margin-bottom:0.6rem;">
            ${t('paper.b.title')}
          </div>
          <div class="paper-grid">${rows(r)}</div>
        </div>

        <div class="paper-cut">✂  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  ✂</div>

        <div class="paper-section" style="background:#0d1a2b;border:1px solid #1a3a5c;
                                          border-radius:10px;padding:1rem;margin-bottom:0.8rem;
                                          font-size:0.78rem;line-height:1.6;color:#e8e8f0;">
          <div style="font-weight:700;color:#6c63ff;margin-bottom:0.5rem;">
            ${t('paper.step2.title')}
          </div>
          <ol style="padding-left:1.3rem;margin-bottom:0.5rem;">
            ${t('paper.step2.steps')}
          </ol>
          <p style="color:#4CAF50;font-size:0.74rem;">
            ${t('paper.step2.note')}
          </p>
        </div>

        <div class="no-print" style="display:flex;gap:0.75rem;margin-top:1rem;">
          <button id="_paper_print" style="flex:1;padding:0.75rem;border-radius:10px;
            border:none;background:#6c63ff;color:#fff;
            font-size:0.9rem;font-weight:600;cursor:pointer;">${t('paper.btn.print')}</button>
          <button id="_paper_close" style="flex:1;padding:0.75rem;border-radius:10px;
            border:1px solid #ff4757;background:#2b0a0a;color:#ff4757;
            font-size:0.9rem;font-weight:600;cursor:pointer;">${t('paper.btn.close')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#_paper_print').onclick = () => window.print();
    overlay.querySelector('#_paper_close').onclick = () => { overlay.remove(); resolve(); };
  });
}

// ── Wallet switch (lock panel → setup) ───────────────────────────────────
btnSwitchWallet.addEventListener('click', () => {
  if (!confirm(t('switch.wallet.confirm'))) return;
  localStorage.clear();
  vaultReady = false;
  callWorker('LOCK').catch(() => {});
  showPanel('setup');
  setMsg(t('msg.new.wallet'), '');
});

// ── Restore existing wallet (.P.json) ────────────────────────────────────
btnRestore.addEventListener('click', async () => {
  try {
    const pFile = await pickFile('.json,application/json');
    const text  = await pFile.text();
    const P     = JSON.parse(text);

    if (!P.version || !['p2', 'p3'].includes(P.version)) {
      setMsg(t('msg.invalid.pjson.ver'), 'error');
      return;
    }
    if (!P.W_seed || !P.syndrome) {
      setMsg(t('msg.invalid.pjson.bch'), 'error');
      return;
    }

    const vaultId = pFile.name.replace(/\.P\.json$/i, '').replace(/^.*[/\\]/, '');

    localStorage.setItem('biowallet_meta', JSON.stringify({ vaultId, P }));
    await callWorker('INIT_VAULT', { vaultId });
    vaultReady = true;
    showPanel('lock');
    setMsgK('msg.restore.ok', 'ok');
  } catch (e) {
    setMsg(t('msg.restore.error', { err: e.message }), 'error');
  }
});

// ── Import ────────────────────────────────────────────────────────────────
btnImport.addEventListener('click', () => {
  importPhrase.value = '';
  showPanel('import');
  setMsg(t('msg.import.enter.phrase'), '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => importPhrase.focus(), 300);
});

btnImportCancel.addEventListener('click', () => {
  importPhrase.value = '';
  showPanel('setup');
  setMsg('', '');
});

btnImportEnroll.addEventListener('click', async () => {
  const words = importPhrase.value.trim().split(/\s+/).filter(Boolean);
  if (words.length !== 24) {
    setMsg(t('msg.import.word.count', { n: words.length }), 'error');
    return;
  }

  importPhrase.value = '';
  importPhrase.blur();

  btnImportEnroll.disabled = true;
  setScanning(true);
  enrollDots.style.display = 'flex';
  setMsg(t('msg.import.scanning'), '');

  let embedding;
  try {
    embedding = await enrollEmbedding(video, (n) => {
      dots.forEach((d, i) => d.classList.toggle('done', i < n));
      setMsg(t('msg.scan.progress', { n }), '');
    });
  } catch (e) {
    setScanning(false);
    enrollDots.style.display = 'none';
    setMsg(friendlyError(e.message), 'error');
    btnImportEnroll.disabled = false;
    return;
  }

  setScanning(false);
  enrollDots.style.display = 'none';

  const pin = await showPinModal('setup');
  if (!pin) {
    setMsg('', '');
    btnImportEnroll.disabled = false;
    return;
  }

  try {
    const { vaultId, P, encryptedVault } = await callWorker(
      'IMPORT', { mnemonic: words.join(' '), embedding, pin }, [embedding.buffer]
    );

    const vaultJson = new TextDecoder().decode(encryptedVault);
    const newMeta = { vaultId, P, vaultJson };
    localStorage.setItem('biowallet_meta', JSON.stringify(newMeta));

    const walletName = await showSaveModal(encryptedVault, JSON.stringify(P), 'import');
    newMeta.walletName = walletName;
    localStorage.setItem('biowallet_meta', JSON.stringify(newMeta));

    vaultReady = true;
    setMsg(t('msg.wallet.imported'), 'ok');
    showPanel('lock');
    await showPostImportChecklist();
  } catch (e) {
    importPhrase.value = '';
    setMsg(friendlyError(e.message), 'error');
    btnImportEnroll.disabled = false;
  }
});

// ── Post-import checklist ─────────────────────────────────────────────────
function showPostImportChecklist() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:2000;
      display:flex;align-items:flex-start;justify-content:center;
      padding:1rem;overflow-y:auto;
    `;

    const steps = tArr('postimport.steps');
    const stepHtml = steps.map((text, i) => `
      <label style="display:flex;gap:0.75rem;align-items:flex-start;
                    padding:0.65rem 0.5rem;border-bottom:1px solid #1e1e24;
                    cursor:pointer;font-size:0.82rem;line-height:1.5;color:#e8e8f0;">
        <input type="checkbox" id="_chk_${i}"
               style="width:16px;height:16px;margin-top:0.15rem;flex-shrink:0;
                      accent-color:#6c63ff;cursor:pointer;">
        <span>${text}</span>
      </label>`).join('');

    overlay.innerHTML = `
      <div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;
                  width:100%;max-width:480px;margin:auto;padding:1.5rem;">
        <div style="font-size:0.72rem;font-weight:700;letter-spacing:0.08em;
                    text-transform:uppercase;color:#4CAF50;margin-bottom:0.3rem;">
          ${t('postimport.badge')}
        </div>
        <div style="font-size:1rem;font-weight:700;color:#e8e8f0;margin-bottom:0.3rem;">
          ${t('postimport.title')}
        </div>
        <div style="font-size:0.76rem;color:#6b6b80;margin-bottom:1rem;line-height:1.5;">
          ${t('postimport.desc')}
        </div>
        <div style="border:1px solid #2a2a35;border-radius:10px;overflow:hidden;
                    margin-bottom:1rem;">
          ${stepHtml}
        </div>
        <div style="font-size:0.72rem;color:#ffa502;background:rgba(255,165,2,0.07);
                    border-left:2px solid #ffa502;padding:0.5rem 0.7rem;
                    border-radius:0 6px 6px 0;margin-bottom:1rem;line-height:1.5;">
          ${t('postimport.warning')}
        </div>
        <button id="_postimport_ok"
                style="width:100%;padding:0.85rem;border-radius:10px;border:none;
                       background:#6c63ff;color:#fff;font-size:0.9rem;
                       font-weight:600;cursor:pointer;">
          ${t('postimport.ok')}
        </button>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('#_postimport_ok').addEventListener('click', () => {
      overlay.remove();
      resolve();
    });
  });
}

// ── Open vault (face scan + optional device) ──────────────────────────────
btnScan.addEventListener('click', async () => {
  if (cooldownMs() > 0) return;
  btnScan.disabled = true;
  setScanning(true);
  setMsg(t('msg.open.scanning'), '');

  try {
    const meta = JSON.parse(localStorage.getItem('biowallet_meta'));

    // Face scan FIRST — before any file picker (file picker backgrounds the tab on mobile,
    // suspending the camera stream and causing detection to fail on return)
    const embedding = await captureEmbedding(video);
    await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);
    bioSuccess();

    // Try device factor if this vault has one registered on this device
    let devicePrf = null;
    if (meta.device?.credentialId) {
      setMsg(t('msg.device.auth'), '');
      try {
        devicePrf = await getDevicePrf(meta.device.credentialId, meta.device.prfSalt);
      } catch { /* fall through — face-only open */ }
      if (!devicePrf) setMsg(t('msg.device.fallback'), '');
    }

    // Get vault: localStorage first (same device), file picker only on new/restored device
    let encBuf;
    if (meta.vaultJson) {
      encBuf = new TextEncoder().encode(meta.vaultJson).buffer;
    } else {
      const vaultFile = await pickFile('.biowallet,application/octet-stream,*/*');
      encBuf = await vaultFile.arrayBuffer();
      // Cache JSON vault (v2/v3) for future opens — skips file picker on this device
      if (new Uint8Array(encBuf)[0] === 0x7b) {
        meta.vaultJson = new TextDecoder().decode(encBuf);
        localStorage.setItem('biowallet_meta', JSON.stringify(meta));
      }
    }

    // v3 vault without device PRF → PIN required
    let pin = null;
    if (!devicePrf && _getVaultVersion(encBuf) === 3) {
      setMsg(t('msg.pin.required'), '');
      pin = await showPinModal('open');
      if (pin === null) {
        setScanning(false);
        btnScan.disabled = false;
        return;
      }
    }

    const { address, hasDevice, usedDevice } = await callWorker(
      'OPEN',
      { encryptedVault: encBuf, P: meta.P, devicePrf, pin },
      [encBuf]
    );

    ethAddress.textContent = address;
    fetchBalance(address);
    updateTokenSelector();
    setScanning(false, true);
    setMsg(t('msg.vault.open'), 'ok');

    _updateDeviceRow(hasDevice, usedDevice);
    deviceRow.style.display = '';

    showPanel('vault');
    ensureWCInit().catch(() => {});
    if (pendingWCReq) {
      const req = pendingWCReq;
      pendingWCReq = null;
      dispatchWCRequest(req.topic, req.id, req.params).catch(() => {});
    }

    // Offer device enrollment if vault has no device yet and WebAuthn is available
    if (!hasDevice && navigator.credentials) {
      setTimeout(() => setMsg(t('msg.device.offer'), ''), 1500);
    }
  } catch (e) {
    setScanning(false);
    if (e.message.includes('BIO_MISMATCH')) bioFail();
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
    btnScan.disabled = false;
  }
});

function _updateDeviceRow(hasDevice, usedDevice) {
  const span  = btnDevice.querySelector('span');
  const small = btnDevice.querySelector('small');
  if (hasDevice && usedDevice) {
    span.setAttribute('data-i18n', 'btn.device.remove');
    small.setAttribute('data-i18n', 'btn.device.remove.sub');
    span.textContent  = t('btn.device.remove');
    small.textContent = t('btn.device.remove.sub');
  } else {
    span.setAttribute('data-i18n', 'btn.device');
    small.setAttribute('data-i18n', 'btn.device.sub');
    span.textContent  = t('btn.device');
    small.textContent = t('btn.device.sub');
  }
  btnDevice._removeMode = hasDevice && usedDevice;
}

// ── Send ETH / ERC-20 ────────────────────────────────────────────────────
btnSign.addEventListener('click', async () => {
  if (cooldownMs() > 0) return;

  const recipient = ensResolved || sendToInput.value.trim();
  const amountStr = sendAmountInput.value.trim().replace(',', '.');
  const address   = ethAddress.textContent;

  if (!isValidAddress(recipient)) {
    sendToInput.classList.add('error');
    setMsg(t('msg.invalid.address'), 'error');
    return;
  }
  sendToInput.classList.remove('error');

  let txTo = recipient, txValue = 0n, txData = '0x', confirmAmount;

  if (!selectedToken) {
    try {
      txValue = ethToWei(amountStr);
      if (txValue <= 0n) throw new Error();
    } catch {
      sendAmountInput.classList.add('error');
      setMsg(t('msg.invalid.amount'), 'error');
      return;
    }
    confirmAmount = amountStr + ' ' + currentNetwork.nativeSymbol;
  } else {
    let tokenAmount;
    try {
      tokenAmount = tokenToRaw(amountStr, selectedToken.decimals);
      if (tokenAmount <= 0n) throw new Error();
    } catch {
      sendAmountInput.classList.add('error');
      setMsg(t('msg.invalid.amount2'), 'error');
      return;
    }
    const cachedBal = tokenBalanceCache.get(selectedToken.symbol) ?? 0n;
    if (tokenAmount > cachedBal) {
      setMsg(t('msg.insuf.token', { sym: selectedToken.symbol }), 'error');
      return;
    }
    txTo          = selectedToken.address;
    txData        = encodeTransfer(recipient, tokenAmount);
    confirmAmount = `${amountStr} ${selectedToken.symbol}`;
  }
  sendAmountInput.classList.remove('error');

  setMsg(t('msg.network.fee'), '');
  let nonce, feeData, gasLimit;
  try {
    [nonce, feeData] = await Promise.all([
      getNonce(address, currentNetwork.rpc),
      getFeeData(currentNetwork.rpc),
    ]);
    const gasFallback = txData !== '0x' ? 65000n : 21000n;
    gasLimit = await estimateGas(
      { from: address, to: txTo, value: txValue, data: txData },
      currentNetwork.rpc, gasFallback,
    );
    const gasCost    = gasLimit * feeData.maxFeePerGas;
    const ethNeeded  = txValue + gasCost;
    const balanceEth = parseFloat(ethBalance.textContent);
    if (Number(ethNeeded) / 1e18 > balanceEth + 0.000001) {
      const hint = selectedToken
        ? t('msg.gas.hint.token', { eth: weiToEth(gasCost) })
        : t('msg.gas.hint.eth',   { eth: (Number(ethNeeded) / 1e18).toFixed(6) });
      setMsg(t('msg.insuf.balance', { hint }), 'error');
      return;
    }
  } catch (e) {
    setMsg(t('msg.network.error', { err: e.message }), 'error');
    return;
  }

  // Build the canonical tx payload before commit (same object used for SIGN)
  const txPayload = {
    to:                   txTo,
    value:                txValue.toString(),
    data:                 txData,
    nonce,
    gasLimit:             gasLimit.toString(),
    chainId:              currentNetwork.chainId,
    maxFeePerGas:         feeData.maxFeePerGas.toString(),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas.toString(),
  };

  // Commit tx to Worker: Worker stores hash(txPayload), returns 8-char fingerprint
  const { fingerprint } = await callWorker('COMMIT_TX', { tx: txPayload });

  const { confirmed, userInput } = await showConfirm({
    to:          recipient,
    amount:      confirmAmount,
    gas:         `~${weiToEth(gasLimit * feeData.maxFeePerGas)} ETH`,
    network:     currentNetwork.name,
    fingerprint,
  });
  if (!confirmed) {
    await callWorker('CANCEL_TX');
    setMsg(t('msg.tx.cancelled'), '');
    return;
  }

  if (cooldownMs() > 0) return;
  btnSign.disabled = true;
  setScanning(true);
  setMsg(t('msg.signing'), '');

  try {
    const meta      = JSON.parse(localStorage.getItem('biowallet_meta'));
    const embedding = await captureEmbedding(video);
    await callWorker('BIO_CAPTURE', { embedding, P: meta.P, userInput }, [embedding.buffer]);
    bioSuccess();

    const { signed } = await callWorker('SIGN', { tx: txPayload });

    setScanning(false);
    setMsg(t('msg.broadcast'), '');

    const txHash = await broadcastTx(signed, currentNetwork.rpc);

    txResult.style.display = 'block';
    txLink.href        = currentNetwork.explorer + txHash;
    txLink.textContent = txHash;
    setMsg(t('msg.tx.sent', { hash: txHash.slice(0,10) + '…' }), 'ok');

    setTimeout(async () => {
      await callWorker('LOCK');
      ethAddress.textContent = '—';
      ethBalance.textContent = '—';
      setScanning(false);
      setMsg(t('msg.vault.locked'), '');
      showPanel('lock');
    }, 5000);

  } catch (e) {
    setScanning(false);
    if (e.message.includes('BIO_MISMATCH')) bioFail();
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
    btnSign.disabled = false;
  }
});

// ── Paper recovery (Phase 9.1b — P never enters the app) ─────────────────
btnPaper.addEventListener('click', async () => {
  if (cooldownMs() > 0) return;
  setScanning(true);
  setMsg(t('msg.paper.scanning'), '');

  try {
    const meta      = JSON.parse(localStorage.getItem('biowallet_meta'));
    const embedding = await captureEmbedding(video);
    await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);
    bioSuccess();

    const { rawA, r } = await callWorker('RECOVERY_FORMULA', {});

    setScanning(false);
    await showRecoveryPaperModal(rawA, r);
    setMsg(t('msg.paper.done'), 'ok');
    showPanel('lock');
  } catch (e) {
    setScanning(false);
    if (e.message.includes('BIO_MISMATCH')) bioFail();
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
  }
});

// ── Lock ──────────────────────────────────────────────────────────────────
btnLock.addEventListener('click', async () => {
  await callWorker('LOCK');
  ethAddress.textContent = '—';
  ethBalance.textContent = '—';
  setScanning(false);
  setMsgK('msg.vault.locked');
  showPanel('lock');
});

// ── Device second factor ──────────────────────────────────────────────────
btnDevice.addEventListener('click', async () => {
  const meta = JSON.parse(localStorage.getItem('biowallet_meta') ?? 'null');
  if (!meta) return;

  if (btnDevice._removeMode) {
    // Remove device: clear from meta. The vault file retains a stale deviceWrap
    // but face-only open always works and the orphaned wrap is harmless without its credential.
    delete meta.device;
    localStorage.setItem('biowallet_meta', JSON.stringify(meta));
    _updateDeviceRow(false, false);
    setMsg(t('msg.device.removed'), 'ok');
    return;
  }

  // Enroll this device
  if (!navigator.credentials) {
    setMsg(t('err.device.prf'), 'error');
    return;
  }

  setMsg(t('msg.device.auth'), '');
  const wa = await enrollWebAuthn();
  if (!wa) {
    setMsg(t('err.device.prf'), 'error');
    return;
  }

  try {
    const { encryptedVault } = await callWorker('ENROLL_DEVICE', {
      devicePrf:    wa.devicePrf,
      credentialId: wa.credentialId,
      prfSalt:      wa.prfSalt,
    });

    meta.device   = { credentialId: wa.credentialId, prfSalt: wa.prfSalt };
    meta.vaultJson = new TextDecoder().decode(encryptedVault);
    localStorage.setItem('biowallet_meta', JSON.stringify(meta));

    const walletName = await showSaveModal(encryptedVault, null, 'device', meta.walletName || 'biowallet');
    meta.walletName = walletName;
    localStorage.setItem('biowallet_meta', JSON.stringify(meta));

    _updateDeviceRow(true, true);
    setMsg(t('msg.device.enrolled'), 'ok');
  } catch (e) {
    setMsg(e.message, 'error');
  }
});

// ── Copy address ──────────────────────────────────────────────────────────
btnCopy.addEventListener('click', async () => {
  const addr = ethAddress.textContent;
  if (!addr || addr === '—') return;
  await navigator.clipboard.writeText(addr);
  btnCopy.textContent = t('msg.address.copied');
  setTimeout(() => { btnCopy.textContent = t('btn.copy'); }, 2000);
});

// ── Network selector ──────────────────────────────────────────────────────
btnNetwork.addEventListener('click', () => showNetworkModal());

// ── Balance refresh ───────────────────────────────────────────────────────
btnRefresh.addEventListener('click', () => {
  const addr = ethAddress.textContent;
  if (addr && addr !== '—') fetchBalance(addr);
});

// ── QR code toggle ────────────────────────────────────────────────────────
btnQR.addEventListener('click', async () => {
  if (qrWrap.style.display !== 'none') {
    qrWrap.style.display = 'none';
    return;
  }
  const addr = ethAddress.textContent;
  if (!addr || addr === '—') return;
  try {
    await window.QRCode.toCanvas(qrCanvas, addr, {
      width: 200,
      color: { dark: '#e8e8f0', light: '#16161a' },
      errorCorrectionLevel: 'M',
    });
    qrWrap.style.display = 'block';
  } catch { /* QR lib not loaded — offline PWA */ }
});

// ── WalletConnect buttons ─────────────────────────────────────────────────
btnWc.addEventListener('click', async () => {
  const uri = await showWCPairModal();
  if (!uri) return;
  try {
    await ensureWCInit();
    if (!wcReady()) return;
    await wcPair(uri);
    setMsg(t('msg.wc.pairing'), '');
  } catch (e) {
    setMsg(t('msg.wc.error', { err: e?.message || e?.toString() || '' }), 'error');
  }
});

btnWcDisc.addEventListener('click', async () => {
  const sessions = wcGetSessions();
  for (const s of sessions) await wcDisconnect(s.topic);
  updateWCBar();
  setMsg(t('msg.wc.disconnected'), '');
});

// ── ENS resolution (C3) — debounce 600ms ─────────────────────────────────
let _ensTimer = null;
sendToInput.addEventListener('input', () => {
  ensResolved = null;
  ensHint.style.display = 'none';
  clearTimeout(_ensTimer);
  const val = sendToInput.value.trim();
  if (!val.includes('.')) return;
  _ensTimer = setTimeout(async () => {
    ensHint.style.cssText = 'display:block;font-size:0.7rem;margin-top:0.3rem;color:#6b6b80;';
    ensHint.textContent = t('msg.ens.resolving');
    const addr = await resolveENS(val);
    if (addr) {
      ensResolved = addr;
      ensHint.style.cssText = 'display:block;font-size:0.7rem;margin-top:0.3rem;color:#4CAF50;font-family:monospace;';
      ensHint.textContent = `→ ${addr}`;
    } else {
      ensResolved = null;
      ensHint.style.cssText = 'display:block;font-size:0.7rem;margin-top:0.3rem;color:#ff4757;';
      ensHint.textContent = t('msg.ens.not.found');
    }
  }, 600);
});

// ERC-20 token list — decimals hardcoded (no extra eth_call needed)
const TOKEN_LIST = {
  mainnet: [
    { symbol: 'USDC',  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6  },
    { symbol: 'USDT',  address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6  },
    { symbol: 'WETH',  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
  ],
  bsc: [
    { symbol: 'USDT',  address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
    { symbol: 'USDC',  address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
    { symbol: 'WBNB',  address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', decimals: 18 },
  ],
  polygon: [
    { symbol: 'USDC',  address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', decimals: 6  },
    { symbol: 'USDT',  address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', decimals: 6  },
    { symbol: 'WETH',  address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', decimals: 18 },
  ],
  arbitrum: [
    { symbol: 'USDC',  address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6  },
    { symbol: 'USDT',  address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6  },
    { symbol: 'WETH',  address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', decimals: 18 },
  ],
  base: [
    { symbol: 'USDC',  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6  },
    { symbol: 'WETH',  address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  ],
  optimism: [
    { symbol: 'USDC',  address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', decimals: 6  },
    { symbol: 'USDT',  address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', decimals: 6  },
    { symbol: 'WETH',  address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  ],
  avalanche: [
    { symbol: 'USDC',  address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6  },
    { symbol: 'USDT.e',address: '0xc7198437980c041c805A1EDcbA50c1Ce5db95118', decimals: 6  },
    { symbol: 'WAVAX', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', decimals: 18 },
  ],
  sepolia: [
    { symbol: 'USDC',  address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6  },
    { symbol: 'WETH',  address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', decimals: 18 },
  ],
};

async function fetchBalance(address) {
  try {
    ethBalance.textContent = '…';
    const bal = await getBalance(address, currentNetwork.rpc);
    ethBalance.textContent = bal + ' ' + currentNetwork.nativeSymbol;
  } catch {
    ethBalance.textContent = '?';
  }
  fetchTokenBalances(address);
  renderTxHistory(address);
}

async function renderTxHistory(address) {
  txHistoryCard.style.display = 'block';
  if (!currentNetwork.blockscout) {
    txHistoryList.innerHTML =
      `<div style="font-size:0.75rem;color:var(--muted);padding:0.3rem 0;">${t('msg.tx.no.blockscout')}</div>`;
    return;
  }
  txHistoryList.innerHTML =
    '<div style="font-size:0.75rem;color:var(--muted);padding:0.3rem 0;">…</div>';

  try {
    const txs = await fetchTxHistory(address, currentNetwork);
    txHistoryList.innerHTML = '';

    if (!txs.length) {
      txHistoryList.innerHTML =
        `<div style="font-size:0.75rem;color:var(--muted);padding:0.3rem 0;">${t('msg.tx.empty')}</div>`;
      return;
    }

    for (const tx of txs) {
      const out   = tx.from?.hash?.toLowerCase() === address.toLowerCase();
      const val   = weiToEth(tx.value ?? '0');
      const short = tx.hash.slice(0, 6) + '…' + tx.hash.slice(-4);
      const ok    = tx.status === 'ok';

      const row = document.createElement('div');
      row.className = 'tx-hist-row';

      const dir  = document.createElement('span');
      dir.textContent = out ? '→' : '←';
      dir.style.cssText = `color:${out ? '#ffa502' : '#4CAF50'};width:1.1rem;flex-shrink:0;font-size:0.8rem;`;

      const amount = document.createElement('span');
      amount.style.cssText = `flex:1;font-family:monospace;color:${ok ? 'var(--text)' : 'var(--danger)'};`;
      amount.textContent = (ok ? '' : '✗ ') + val + ' ' + currentNetwork.nativeSymbol;

      const link = document.createElement('a');
      link.className = 'tx-hist-hash';
      link.href = currentNetwork.explorer + tx.hash;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = short;

      const age = document.createElement('span');
      age.style.cssText = 'color:var(--muted);font-size:0.68rem;width:2rem;text-align:right;flex-shrink:0;';
      age.textContent = txAge(tx.timestamp);

      row.append(dir, amount, link, age);
      txHistoryList.appendChild(row);
    }
  } catch {
    txHistoryList.innerHTML =
      `<div style="font-size:0.75rem;color:var(--muted);padding:0.3rem 0;">${t('msg.tx.unavailable')}</div>`;
  }
}

function txAge(ts) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60)    return `${Math.floor(s)}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

async function fetchTokenBalances(address) {
  const tokens = TOKEN_LIST[currentNetwork.key] ?? [];
  tokenBalances.innerHTML = '';
  tokenBalanceCache.clear();

  await Promise.allSettled(tokens.map(async tok => {
    try {
      const raw = await getTokenBalance(tok.address, address, currentNetwork.rpc);
      tokenBalanceCache.set(tok.symbol, raw);
      if (raw === 0n) return;
      const row = document.createElement('div');
      row.className = 'balance-row';
      row.style.marginTop = '0.3rem';
      row.innerHTML =
        `<span class="balance-label">${tok.symbol}:</span>` +
        `<span class="balance-value" style="color:#a78bfa">${formatToken(raw, tok.decimals)}</span>`;
      tokenBalances.appendChild(row);
    } catch { /* unknown token or RPC error — skip */ }
  }));
}

// ── WalletConnect v2 ──────────────────────────────────────────────────────

async function ensureWCInit() {
  if (wcReady()) return;
  if (!WC_PROJECT_ID) {
    setMsg(t('msg.wc.no.project.id'), 'error');
    return;
  }
  await initWC({
    onProposal:      handleWCProposal,
    onRequest:       handleWCRequest,
    onSessionDelete: () => updateWCBar(),
  });
}

function updateWCBar() {
  const sessions = wcGetSessions();
  if (sessions.length) {
    const name = sessions[0].peer?.metadata?.name ?? 'dApp';
    wcDappName.textContent = name;
    wcBar.classList.add('visible');
  } else {
    wcBar.classList.remove('visible');
  }
}

async function handleWCProposal(proposal) {
  const meta    = proposal.params?.proposer?.metadata ?? {};
  const address = ethAddress.textContent;
  const approved = await showWCProposalModal(meta);
  if (approved) {
    await wcApprove(proposal.id, address, getAllNetworks().map(n => n.chainId));
    setMsg(t('msg.wc.connected', { name: meta.name ?? t('wc.proposal.unknown') }), 'ok');
  } else {
    await wcRejectProposal(proposal.id);
    setMsg(t('msg.wc.rejected'), '');
  }
  updateWCBar();
}

async function handleWCRequest(event) {
  const { topic, id, params } = event;
  const method = params.request.method;

  if (ethAddress.textContent === '—') {
    pendingWCReq = event;
    setMsg(t('msg.wc.incoming', { method }), 'ok');
    return;
  }

  await dispatchWCRequest(topic, id, params);
}

async function dispatchWCRequest(topic, id, params) {
  const method = params.request.method;

  if (method === 'eth_sendTransaction') {
    await handleWCEthSend(topic, id, params.request.params[0]);
  } else if (method === 'personal_sign') {
    await handleWCPersonalSign(topic, id, params.request.params[0]);
  } else if (method === 'wallet_switchEthereumChain') {
    await handleWCSwitchChain(topic, id, params.request.params[0]);
  } else {
    await wcRespondError(topic, id, `Unsupported: ${method}`);
    setMsg(t('msg.wc.unsupported', { method }), 'error');
  }
}

async function handleWCSwitchChain(topic, id, { chainId: hexChain }) {
  const requested = parseInt(hexChain, 16);
  const match = getAllNetworks().find(n => n.chainId === requested);
  if (!match) {
    await wcRespondError(topic, id, `Unsupported network: ${hexChain}`);
    setMsg(t('msg.wc.chain.unknown', { chain: hexChain }), 'error');
    return;
  }
  currentNetwork = match;
  btnNetwork.textContent = currentNetwork.name;
  btnNetwork.classList.toggle('mainnet', !currentNetwork.testnet);
  await wcRespondOk(topic, id, null);
  await wcEmitChainChanged(topic, currentNetwork.chainId);
  setMsg(t('msg.network.switch', { name: currentNetwork.name }), 'ok');
  const addr = ethAddress.textContent;
  if (addr && addr !== '—') fetchBalance(addr);
}

async function handleWCEthSend(topic, id, wcTx) {
  const address = ethAddress.textContent;
  if (cooldownMs() > 0) { await wcRespondError(topic, id, 'Cooldown active'); return; }

  setMsg(t('msg.network.fee'), '');
  let nonce, feeData, gasLimit;
  try {
    const txValue = BigInt(wcTx.value ?? '0x0');
    const txData  = wcTx.data ?? '0x';
    const txTo    = wcTx.to;
    [nonce, feeData] = await Promise.all([
      getNonce(address, currentNetwork.rpc),
      getFeeData(currentNetwork.rpc),
    ]);
    gasLimit = await estimateGas(
      { from: address, to: txTo, value: txValue, data: txData },
      currentNetwork.rpc, 65000n,
    );

    const wcTxPayload = {
      to:                   wcTx.to,
      value:                (BigInt(wcTx.value ?? '0x0')).toString(),
      data:                 wcTx.data ?? '0x',
      nonce,
      gasLimit:             gasLimit.toString(),
      chainId:              currentNetwork.chainId,
      maxFeePerGas:         feeData.maxFeePerGas.toString(),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas.toString(),
    };

    const { fingerprint: wcFp } = await callWorker('COMMIT_TX', { tx: wcTxPayload });

    const { confirmed: wcConfirmed, userInput: wcUserInput } = await showConfirm({
      to:          wcTx.to,
      amount:      weiToEth(wcTxPayload.value) + ' ' + currentNetwork.nativeSymbol,
      gas:         `~${weiToEth((gasLimit * feeData.maxFeePerGas).toString())} ETH`,
      network:     currentNetwork.name + ' (dApp)',
      fingerprint: wcFp,
    });
    if (!wcConfirmed) {
      await callWorker('CANCEL_TX');
      await wcRespondError(topic, id);
      setMsg(t('msg.wc.tx.rejected'), '');
      return;
    }

    setScanning(true);
    setMsg(t('msg.signing.dapp'), '');
    const meta      = JSON.parse(localStorage.getItem('biowallet_meta'));
    const embedding = await captureEmbedding(video);
    await callWorker('BIO_CAPTURE', { embedding, P: meta.P, userInput: wcUserInput }, [embedding.buffer]);
    bioSuccess();

    const { signed } = await callWorker('SIGN', { tx: wcTxPayload });
    setScanning(false);
    const txHash = await broadcastTx(signed, currentNetwork.rpc);
    await wcRespondOk(topic, id, txHash);
    setMsg(t('msg.wc.tx.sent', { hash: txHash.slice(0,10) + '…' }), 'ok');
  } catch (e) {
    setScanning(false);
    if (e.message?.includes('BIO_MISMATCH')) bioFail();
    await wcRespondError(topic, id, e.message);
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
  }
}

async function handleWCPersonalSign(topic, id, hexMsg) {
  if (cooldownMs() > 0) { await wcRespondError(topic, id, 'Cooldown active'); return; }

  const approved = await showWCSignModal(hexMsg);
  if (!approved) { await wcRespondError(topic, id); return; }

  try {
    setScanning(true);
    setMsg(t('msg.signing.msg'), '');
    const meta      = JSON.parse(localStorage.getItem('biowallet_meta'));
    const embedding = await captureEmbedding(video);
    await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);
    bioSuccess();
    const { signature } = await callWorker('PERSONAL_SIGN', { message: hexMsg });
    setScanning(false);
    await wcRespondOk(topic, id, signature);
    setMsg(t('msg.wc.msg.signed'), 'ok');
  } catch (e) {
    setScanning(false);
    if (e.message?.includes('BIO_MISMATCH')) bioFail();
    await wcRespondError(topic, id, e.message);
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
  }
}

// ── WC modals ─────────────────────────────────────────────────────────────

function showWCPairModal() {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    ov.innerHTML = `
      <div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;width:100%;max-width:400px;padding:1.5rem;">
        <div style="font-size:1rem;font-weight:700;color:#6c63ff;margin-bottom:0.8rem;">${t('wc.pair.title')}</div>
        <div style="font-size:0.78rem;color:#6b6b80;margin-bottom:0.8rem;line-height:1.5;">
          ${t('wc.pair.desc')}
        </div>
        <textarea id="_wc_uri" style="width:100%;background:#1e1e24;border:1px solid #2a2a35;border-radius:10px;
          padding:0.6rem;color:#e8e8f0;font-size:0.75rem;font-family:monospace;resize:vertical;min-height:70px;outline:none;"
          placeholder="wc:..."></textarea>
        <div id="_wc_err" style="font-size:0.72rem;color:#ff4757;margin-top:0.4rem;min-height:1em;"></div>
        <div style="display:flex;gap:0.75rem;margin-top:0.8rem;">
          <button id="_wc_cancel" style="flex:1;padding:0.7rem;border-radius:10px;border:1px solid #2a2a35;background:#1e1e24;color:#e8e8f0;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.pair.cancel')}</button>
          <button id="_wc_ok" style="flex:1;padding:0.7rem;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.pair.connect')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_wc_cancel').onclick = () => { ov.remove(); resolve(null); };
    ov.querySelector('#_wc_ok').onclick = async () => {
      const uri = ov.querySelector('#_wc_uri').value.trim();
      if (!uri.startsWith('wc:')) {
        ov.querySelector('#_wc_err').textContent = t('wc.pair.invalid.uri'); return;
      }
      ov.remove(); resolve(uri);
    };
  });
}

function showWCProposalModal(meta) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    ov.innerHTML = `
      <div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;width:100%;max-width:400px;padding:1.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#ffa502;margin-bottom:0.3rem;">${t('wc.proposal.label')}</div>
        <div style="font-size:1rem;font-weight:700;color:#e8e8f0;margin-bottom:0.25rem;">${meta.name ?? t('wc.proposal.unknown')}</div>
        <div style="font-size:0.75rem;color:#6b6b80;margin-bottom:0.25rem;">${meta.url ?? ''}</div>
        <div style="font-size:0.78rem;color:#a0a0b0;margin-bottom:1rem;line-height:1.5;">${meta.description ?? ''}</div>
        <div style="font-size:0.75rem;color:#6b6b80;padding:0.5rem 0.7rem;background:#1e1e24;border-radius:8px;margin-bottom:1rem;line-height:1.5;">
          ${t('wc.proposal.info')}
        </div>
        <div style="display:flex;gap:0.75rem;">
          <button id="_wc_reject" style="flex:1;padding:0.7rem;border-radius:10px;border:1px solid #5a2020;background:#2b0a0a;color:#ff4757;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.proposal.reject')}</button>
          <button id="_wc_approve" style="flex:1;padding:0.7rem;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.proposal.approve')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_wc_reject').onclick  = () => { ov.remove(); resolve(false); };
    ov.querySelector('#_wc_approve').onclick = () => { ov.remove(); resolve(true); };
  });
}

function showWCSignModal(hexMsg) {
  let decoded = hexMsg;
  try {
    const bytes = hexMsg.startsWith('0x')
      ? new Uint8Array(hexMsg.slice(2).match(/../g).map(h => parseInt(h,16)))
      : new TextEncoder().encode(hexMsg);
    const txt = new TextDecoder().decode(bytes);
    if (/^[\x20-\x7E\n\r\t]+$/.test(txt)) decoded = txt;
  } catch { /* leave as hex */ }

  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    ov.innerHTML = `
      <div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;width:100%;max-width:400px;padding:1.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#ffa502;margin-bottom:0.3rem;">${t('wc.sign.label')}</div>
        <div style="font-size:0.78rem;color:#6b6b80;margin-bottom:0.6rem;">${t('wc.sign.desc')}</div>
        <div style="background:#1e1e24;border:1px solid #2a2a35;border-radius:8px;padding:0.7rem;
             font-family:monospace;font-size:0.75rem;color:#e8e8f0;word-break:break-all;
             max-height:120px;overflow-y:auto;margin-bottom:1rem;line-height:1.5;">${decoded}</div>
        <div style="display:flex;gap:0.75rem;">
          <button id="_wcs_reject" style="flex:1;padding:0.7rem;border-radius:10px;border:1px solid #5a2020;background:#2b0a0a;color:#ff4757;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.sign.reject')}</button>
          <button id="_wcs_sign" style="flex:1;padding:0.7rem;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.sign.sign')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_wcs_reject').onclick = () => { ov.remove(); resolve(false); };
    ov.querySelector('#_wcs_sign').onclick   = () => { ov.remove(); resolve(true); };
  });
}

function updateTokenSelector() {
  const sym    = currentNetwork.nativeSymbol ?? 'ETH';
  const tokens = TOKEN_LIST[currentNetwork.key] ?? [];
  tokenSelector.innerHTML = '';

  for (const tok of [{ symbol: sym }, ...tokens]) {
    const isNative = tok.symbol === sym && !tok.address;
    const isActive = isNative ? selectedToken === null : selectedToken?.symbol === tok.symbol;
    const btn      = document.createElement('button');
    btn.className  = 'token-pill' + (isActive ? ' active' : '');
    btn.textContent = tok.symbol;
    btn.addEventListener('click', () => {
      selectedToken = isNative ? null : tok;
      const label = t('btn.send.token', { sym: selectedToken?.symbol ?? sym });
      sendCardLabel.textContent = label;
      amountUnit.textContent    = selectedToken?.symbol ?? sym;
      sendBtnLabel.textContent  = label;
      updateTokenSelector();
    });
    tokenSelector.appendChild(btn);
  }

  if (selectedToken && !tokens.find(t => t.symbol === selectedToken.symbol)) {
    selectedToken = null;
    const label = t('btn.send.token', { sym });
    sendCardLabel.textContent = label;
    amountUnit.textContent    = sym;
    sendBtnLabel.textContent  = label;
    updateTokenSelector();
  }
}

// ── Token timer (Worker STATUS polling) ───────────────────────────────────
function startTimer() {
  clearInterval(timerID);
  timerID = setInterval(async () => {
    const cd = cooldownMs();
    if (cd > 0) {
      inCooldown = true;
      btnScan.disabled = true;
      setMsg(t('msg.cooldown', { sec: Math.ceil(cd / 1000) }), 'error');
      return;
    }
    if (inCooldown) {
      inCooldown = false;
      btnScan.disabled = false;
      setMsg(t('msg.cooldown.over'), '');
      return;
    }

    if (!vaultReady) return;
    let s;
    try { s = await callWorker('STATUS'); } catch { return; }

    if (s.state === 'NO_TOKEN' || s.state === 'NO_VAULT') {
      tokenBadge.className  = 'token-badge';
      tokenText.textContent = t('status.locked');
      ttlBars.classList.remove('visible');
      return;
    }

    const remOpen = Math.max(0, 30000 - s.age);
    const remSign = Math.max(0, 10000 - s.age);
    const pctOpen = remOpen / 300;
    const pctSign = remSign / 100;

    tokenBadge.className  = 'token-badge ' +
      (remOpen > 15000 ? 'active' : remOpen > 5000 ? 'warning' : 'expired');
    tokenText.textContent = `${(remOpen / 1000).toFixed(0)}s`;

    const openFill = document.getElementById('ttl-open');
    const signFill = document.getElementById('ttl-sign');
    const openT    = document.getElementById('ttl-open-t');
    const signT    = document.getElementById('ttl-sign-t');

    openFill.style.width      = pctOpen + '%';
    openFill.style.background = remOpen > 10000 ? '#4CAF50' : remOpen > 5000 ? '#ffa502' : '#ff4757';
    signFill.style.width      = pctSign + '%';
    signFill.style.background = remSign > 5000  ? '#6c63ff' : '#ff4757';
    openT.textContent = (remOpen / 1000).toFixed(0) + 's';
    signT.textContent = (remSign / 1000).toFixed(0) + 's';

    ttlBars.classList.add('visible');
  }, 500);
}

// ── Confirm overlay ───────────────────────────────────────────────────────
// Returns { confirmed: boolean, userInput: string|null }
// When fingerprint is provided, the confirm button is locked until user types 4 chars.
function showConfirm({ to, amount, gas, network, fingerprint = null }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;
      display:flex;align-items:center;justify-content:center;padding:1rem;
    `;

    const fpSection = fingerprint ? `
      <div style="margin-top:1rem;background:#0d1a0d;border:1px solid #1a4a1a;
                  border-radius:10px;padding:0.75rem 0.9rem;">
        <div style="font-size:0.68rem;font-weight:700;letter-spacing:0.07em;
                    text-transform:uppercase;color:#4CAF50;margin-bottom:0.4rem;">
          ${t('confirm.fp.label')}
        </div>
        <div id="_fp_display" style="font-family:monospace;font-size:1.2rem;font-weight:700;
                  letter-spacing:0.18em;color:#e8e8f0;margin-bottom:0.6rem;">${fingerprint}</div>
        <div style="font-size:0.72rem;color:#6b6b80;margin-bottom:0.4rem;">
          ${t('confirm.fp.hint')}
        </div>
        <input id="_fp_input" type="text" maxlength="4" autocomplete="off" spellcheck="false"
               style="width:100%;background:#1e1e24;border:1px solid #2a2a35;border-radius:8px;
                      padding:0.5rem 0.6rem;color:#e8e8f0;font-family:monospace;font-size:1rem;
                      font-weight:600;letter-spacing:0.12em;outline:none;box-sizing:border-box;"
               placeholder="_ _ _ _">
      </div>` : '';

    overlay.innerHTML = `
      <div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;
                  width:100%;max-width:400px;padding:1.5rem;">
        <div style="font-size:1rem;font-weight:700;color:#6c63ff;margin-bottom:1rem;">
          ${t('confirm.title')}
        </div>
        <table style="width:100%;font-size:0.82rem;border-collapse:collapse;">
          <tr><td style="color:#6b6b80;padding:0.3rem 0;">${t('confirm.network')}</td>
              <td style="color:#e8e8f0;text-align:right;">${network}</td></tr>
          <tr><td style="color:#6b6b80;padding:0.3rem 0;">${t('confirm.to')}</td>
              <td style="color:#e8e8f0;text-align:right;font-family:monospace;font-size:0.72rem;word-break:break-all;">${to}</td></tr>
          <tr><td style="color:#6b6b80;padding:0.3rem 0;">${t('confirm.amount')}</td>
              <td style="color:#4CAF50;text-align:right;font-weight:600;">${amount}</td></tr>
          <tr><td style="color:#6b6b80;padding:0.3rem 0;">${t('confirm.gas')}</td>
              <td style="color:#ffa502;text-align:right;">${gas}</td></tr>
        </table>
        ${fpSection}
        <div style="display:flex;gap:0.75rem;margin-top:1.2rem;">
          <button id="_cancel" style="flex:1;padding:0.75rem;border-radius:10px;
            border:1px solid #2a2a35;background:#1e1e24;color:#e8e8f0;
            font-size:0.9rem;font-weight:600;cursor:pointer;">${t('confirm.cancel')}</button>
          <button id="_confirm" style="flex:1;padding:0.75rem;border-radius:10px;
            border:none;background:#6c63ff;color:#fff;
            font-size:0.9rem;font-weight:600;cursor:pointer;
            ${fingerprint ? 'opacity:0.4;cursor:not-allowed;' : ''}"
            ${fingerprint ? 'disabled' : ''}>${t('confirm.send')}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const confirmBtn = overlay.querySelector('#_confirm');

    if (fingerprint) {
      const fpInput = overlay.querySelector('#_fp_input');
      fpInput.addEventListener('input', () => {
        const ready = fpInput.value.length === 4;
        confirmBtn.disabled = !ready;
        confirmBtn.style.opacity  = ready ? '1' : '0.4';
        confirmBtn.style.cursor   = ready ? 'pointer' : 'not-allowed';
      });
      fpInput.focus();
    }

    overlay.querySelector('#_cancel').onclick = () => {
      overlay.remove();
      resolve({ confirmed: false, userInput: null });
    };
    confirmBtn.onclick = () => {
      const userInput = fingerprint ? overlay.querySelector('#_fp_input').value : null;
      overlay.remove();
      resolve({ confirmed: true, userInput });
    };
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────
function showPanel(name) {
  panelSetup.classList.toggle('visible',  name === 'setup');
  panelImport.classList.toggle('visible', name === 'import');
  panelLock.classList.toggle('visible',   name === 'lock');
  panelVault.classList.toggle('visible',  name === 'vault');
  ttlBars.classList.toggle('visible',     name === 'vault');
  if (name !== 'vault') {
    deviceRow.style.display = 'none';
    btnScan.disabled        = false;
    btnSign.disabled        = false;
    ethAddress.textContent  = '—';
    ethBalance.textContent  = '—';
    txResult.style.display  = 'none';
    sendToInput.value       = '';
    sendAmountInput.value   = '';
    sendToInput.classList.remove('error');
    sendAmountInput.classList.remove('error');
    tokenBalances.innerHTML     = '';
    tokenBalanceCache.clear();
    txHistoryCard.style.display = 'none';
    txHistoryList.innerHTML     = '';
    selectedToken               = null;
    const sym = currentNetwork.nativeSymbol ?? 'ETH';
    const label = t('btn.send.token', { sym });
    sendCardLabel.textContent   = label;
    amountUnit.textContent      = sym;
    sendBtnLabel.textContent    = label;
    tokenSelector.innerHTML     = '';
    ensResolved                 = null;
    ensHint.style.display   = 'none';
    qrWrap.style.display    = 'none';
    wcBar.classList.remove('visible');
  }
}

function setScanning(on, detected = false) {
  faceGuide.className = 'face-guide' + (on ? ' scanning' : detected ? ' detected' : '');
  scanHint.textContent = on ? t('scan.hint.active') : t('scan.hint.done');
}

function setMsg(text, type = '', i18nKey = null) {
  msg.textContent = text;
  msg.className   = 'msg-bar' + (type ? ' ' + type : '');
  _currentMsgKey  = i18nKey;
}

function setMsgK(key, type = '', vars = {}) {
  setMsg(t(key, vars), type, key);
}

function downloadBlob(data, filename) {
  const blob = data instanceof ArrayBuffer
    ? new Blob([data])
    : new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'),
    { href: url, download: filename }).click();
  URL.revokeObjectURL(url);
}

async function pickFile(accept) {
  return new Promise((resolve, reject) => {
    const inp = Object.assign(document.createElement('input'),
      { type: 'file', accept });
    inp.onchange = e => e.target.files[0] ? resolve(e.target.files[0]) : reject(new Error(t('msg.no.file')));
    inp.click();
  });
}

// ── Friendly error messages ───────────────────────────────────────────────
function friendlyError(m) {
  if (!m) return t('err.unknown');
  if (m.includes('TX_MISMATCH'))     return t('err.tx.mismatch');
  if (m.includes('BIO_MISMATCH'))    return t('err.bio.mismatch');
  if (m.includes('EXPIRED'))         return t('err.expired');
  if (m.includes('NO_TOKEN'))        return t('err.no.token');
  if (m.includes('VAULT_ID_MISMATCH')) return t('err.vault.mismatch');
  if (m.includes('ALREADY_CONSUMED')) return t('err.consumed');
  if (m.toLowerCase().includes('invalid mnemonic') ||
      m.toLowerCase().includes('invalid phrase') ||
      m.toLowerCase().includes('invalid word'))
    return t('err.mnemonic');
  return m;
}

// ── User guide modal ──────────────────────────────────────────────────────
{
  const overlay  = document.getElementById('guide-modal');
  const btnOpen  = document.getElementById('btn-help');
  const btnClose = document.getElementById('btn-modal-close');

  btnOpen .addEventListener('click', ()  => overlay.classList.add('open'));
  btnClose.addEventListener('click', ()  => overlay.classList.remove('open'));
  overlay .addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
  document.addEventListener('keydown',(e) => { if (e.key === 'Escape') overlay.classList.remove('open'); });
}

// ── Contextual ℹ help modals ──────────────────────────────────────────────

function showInfoModal(key) {
  const info = getInfoContent(key);
  if (!info) return;
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:3000;display:flex;align-items:center;justify-content:center;padding:1rem;';
  ov.innerHTML = `
    <div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;width:100%;max-width:420px;max-height:80vh;overflow-y:auto;padding:1.5rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
        <div style="font-size:0.95rem;font-weight:700;color:#e8e8f0;">${info.title}</div>
        <button id="_info_close" style="background:none;border:none;color:#6b6b80;font-size:1.1rem;cursor:pointer;padding:0.2rem 0.4rem;">✕</button>
      </div>
      <div style="font-size:0.82rem;color:#b0b0c0;line-height:1.7;">${info.body}</div>
    </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector('#_info_close').onclick = close;
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
}

document.addEventListener('click', e => {
  const btn = e.target.closest('[data-info]');
  if (btn) { e.stopPropagation(); showInfoModal(btn.dataset.info); }
});

// ── Network selector modal ────────────────────────────────────────────────

function showNetworkModal() {
  const all = getAllNetworks();
  const ov  = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto;';

  const box = document.createElement('div');
  box.style.cssText = 'background:#16161a;border:1px solid #2a2a35;border-radius:16px;width:100%;max-width:380px;max-height:80vh;overflow-y:auto;';

  const hdr = document.createElement('div');
  hdr.style.cssText = 'padding:1rem 1.5rem 0.75rem;border-bottom:1px solid #2a2a35;font-size:0.95rem;font-weight:700;color:#e8e8f0;';
  hdr.textContent = t('net.title');
  box.appendChild(hdr);

  for (const net of all) {
    const isCurrent = net.chainId === currentNetwork.chainId;
    const isCustom  = !BUILTIN_NETWORKS.find(b => b.chainId === net.chainId);

    const row = document.createElement('div');
    row.style.cssText = `display:flex;align-items:center;gap:0.75rem;padding:0.75rem 1rem;border-bottom:1px solid #1e1e24;cursor:pointer;${isCurrent ? 'background:#16162a;' : ''}`;

    const info = document.createElement('div');
    info.style.flex = '1';
    const testnetLabel = net.testnet ? t('net.testnet') : '';
    info.innerHTML =
      `<div style="font-size:0.85rem;font-weight:${isCurrent ? '700' : '600'};color:#e8e8f0;">${net.name}</div>` +
      `<div style="font-size:0.68rem;color:#6b6b80;">ChainID: ${net.chainId} · ${net.nativeSymbol ?? 'ETH'}${testnetLabel}</div>`;
    row.appendChild(info);

    if (isCurrent) {
      const chk = document.createElement('span');
      chk.style.cssText = 'color:#6c63ff;font-size:0.9rem;flex-shrink:0;';
      chk.textContent = '✓';
      row.appendChild(chk);
    }

    if (isCustom) {
      const del = document.createElement('button');
      del.textContent = '✕';
      del.title = t('net.delete.title');
      del.style.cssText = 'background:none;border:none;color:#ff4757;font-size:0.85rem;cursor:pointer;padding:0.2rem 0.5rem;flex-shrink:0;';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(t('net.delete.confirm', { name: net.name }))) return;
        deleteCustomNetwork(net.chainId);
        if (currentNetwork.chainId === net.chainId) _switchNetwork(BUILTIN_NETWORKS.find(n => n.key === 'sepolia'));
        ov.remove();
      });
      row.appendChild(del);
    }

    row.addEventListener('click', () => { _switchNetwork(net); ov.remove(); });
    box.appendChild(row);
  }

  const addBtn = document.createElement('button');
  addBtn.textContent = t('net.add.btn');
  addBtn.style.cssText = 'width:100%;padding:0.75rem;border:none;background:none;color:#6c63ff;font-size:0.85rem;font-weight:600;cursor:pointer;border-top:1px solid #2a2a35;';
  addBtn.addEventListener('click', async () => { ov.remove(); await showAddNetworkModal(); });
  box.appendChild(addBtn);

  ov.appendChild(box);
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
}

function _switchNetwork(net) {
  currentNetwork = net;
  btnNetwork.textContent = currentNetwork.name;
  btnNetwork.classList.toggle('mainnet', !currentNetwork.testnet);
  updateTokenSelector();
  const addr = ethAddress.textContent;
  if (addr && addr !== '—') fetchBalance(addr);
}

function showAddNetworkModal() {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#16161a;border:1px solid #2a2a35;border-radius:16px;width:100%;max-width:380px;padding:1.5rem;';

    const fields = [
      ['_cn_name',  t('net.add.f.name')],
      ['_cn_chain', t('net.add.f.chain')],
      ['_cn_rpc',   t('net.add.f.rpc')],
      ['_cn_exp',   t('net.add.f.exp')],
      ['_cn_sym',   t('net.add.f.sym')],
    ];

    box.innerHTML = `
      <div style="font-size:0.95rem;font-weight:700;color:#e8e8f0;margin-bottom:1rem;">${t('net.add.title')}</div>
      <div style="font-size:0.72rem;color:#ffa502;background:rgba(255,165,2,0.07);border-left:2px solid #ffa502;
                  padding:0.4rem 0.7rem;border-radius:0 6px 6px 0;margin-bottom:1rem;line-height:1.5;">
        ${t('net.add.csp')}
      </div>
      ${fields.map(([id, label]) => `
        <div style="margin-bottom:0.65rem;">
          <div style="font-size:0.72rem;color:#6b6b80;margin-bottom:0.25rem;">${label}</div>
          <input id="${id}" style="width:100%;background:#1e1e24;border:1px solid #2a2a35;border-radius:8px;
            padding:0.5rem 0.7rem;color:#e8e8f0;font-size:0.82rem;outline:none;" />
        </div>`).join('')}
      <div id="_cn_err" style="font-size:0.72rem;color:#ff4757;min-height:1rem;margin-bottom:0.5rem;"></div>
      <div style="display:flex;gap:0.75rem;">
        <button id="_cn_cancel" style="flex:1;padding:0.7rem;border-radius:10px;border:1px solid #2a2a35;background:#1e1e24;color:#e8e8f0;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('net.add.cancel')}</button>
        <button id="_cn_add"    style="flex:1;padding:0.7rem;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('net.add.confirm')}</button>
      </div>`;

    ov.appendChild(box);
    document.body.appendChild(ov);

    const err = box.querySelector('#_cn_err');
    box.querySelector('#_cn_cancel').addEventListener('click', () => { ov.remove(); resolve(); });
    box.querySelector('#_cn_add').addEventListener('click', () => {
      const name    = box.querySelector('#_cn_name').value.trim();
      const chainId = parseInt(box.querySelector('#_cn_chain').value.trim(), 10);
      const rpc     = box.querySelector('#_cn_rpc').value.trim();
      const explorer= box.querySelector('#_cn_exp').value.trim();
      const sym     = box.querySelector('#_cn_sym').value.trim() || 'ETH';

      if (!name)                         { err.textContent = t('net.add.err.name'); return; }
      if (!chainId || isNaN(chainId))    { err.textContent = t('net.add.err.chain'); return; }
      if (!rpc.startsWith('https://'))   { err.textContent = t('net.add.err.rpc'); return; }
      if (!explorer.startsWith('https://')) { err.textContent = t('net.add.err.exp'); return; }

      const net = { key: `custom_${chainId}`, name, chainId, rpc, explorer, nativeSymbol: sym, blockscout: null, testnet: false };
      saveCustomNetwork(net);
      ov.remove();
      resolve(net);
    });
    ov.addEventListener('click', e => { if (e.target === ov) { ov.remove(); resolve(); } });
  });
}
