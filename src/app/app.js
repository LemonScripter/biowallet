/**
 * BioWallet — App Controller
 *
 * Crypto: vault_worker.js (Worker thread) — main thread never sees the key.
 * EIP-1559: getFeeData() + estimateGas() — accurate gas estimation.
 * Confirm overlay before every send.
 */

const APP_VERSION = 'v33.2';

import { t, setLang, getLang, applyI18n, getInfoContent, getGuideHTML, tArr } from '../core/i18n.js?v=12';
import { openCamera, enrollEmbedding, captureEmbedding } from '../core/bio_capture.js?v=11';
import {
  WC_PROJECT_ID, initWC, wcPair, wcApprove, wcRejectProposal, wcEmitChainChanged,
  wcRespondOk, wcRespondError, wcGetSessions, wcDisconnect, wcReady,
} from '../core/wc2.js';
import { isSwapSupported, buildSwapTx, buildApproveTx, getParaswapSpender, formatOutput, ETH_ADDR } from '../core/swap.js';
import {
  BUILTIN_NETWORKS, getAllNetworks, saveCustomNetwork, deleteCustomNetwork,
  getBalance, getNonce,
  getFeeData, estimateGas, broadcastTx,
  ethToWei, weiToEth, isValidAddress, resolveENS,
  getTokenBalance, formatToken, fetchTxHistory,
  tokenToRaw, encodeTransfer, getAllowance,
} from '../core/rpc.js?v=22';

// ── Worker init ───────────────────────────────────────────────────────────

const worker  = new Worker('./vault_worker.js?v=25', { type: 'module' });
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
const sendHexDataInput = document.getElementById('send-hexdata');
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
const btnSwap        = document.getElementById('btn-swap');
const swapRow        = document.getElementById('swap-row');

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
  const verEl = document.getElementById('app-version');
  if (verEl) verEl.textContent = APP_VERSION;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/app/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const banner = document.getElementById('update-banner');
      const btn    = document.getElementById('update-reload-btn');
      const text   = document.getElementById('update-banner-text');
      if (!banner) return;
      const isHu = document.documentElement.lang !== 'en';
      text.textContent = isHu ? '🔄 Új verzió elérhető' : '🔄 New version available';
      btn.textContent  = isHu ? 'Frissítés' : 'Reload';
      btn.onclick = () => window.location.reload();
      banner.classList.add('visible');
    });
  }

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
        await callWorker('INIT_VAULT', { vaultId: meta.vaultId, bfState: _bfGet() });
        vaultReady = true;
        // Show paper share input field if vault is v4 or v5
        if (meta.vaultJson) {
          const vMatch = meta.vaultJson.match(/"v"\s*:\s*(\d+)/);
          if (vMatch && parseInt(vMatch[1]) >= 4) {
            const pr = document.getElementById('sss-paper-row');
            if (pr) pr.style.display = '';
            // Auto-restore meta.device from vault if missing (e.g. after P.json restore + page reload)
            if (!meta.device) {
              try {
                const _v = JSON.parse(meta.vaultJson);
                const cred = _v.deviceWrap ?? _v.sss?.deviceShare ?? null;
                if (cred?.credentialId && cred?.prfSalt) {
                  const hexToArr = h => Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i*2, i*2+2), 16));
                  meta.device = { credentialId: hexToArr(cred.credentialId), prfSalt: hexToArr(cred.prfSalt) };
                  localStorage.setItem('biowallet_meta', JSON.stringify(meta));
                }
              } catch {}
            }
            let vaultHasDevice = false;
            try { const _v = JSON.parse(meta.vaultJson); vaultHasDevice = !!((_v.sss?.deviceShare) || _v.deviceWrap); } catch {}
            const paperLabel = document.querySelector('#sss-paper-row label');
            if (paperLabel) {
              if (vaultHasDevice && !meta.device) {
                paperLabel.style.color = '#ff4757';
                paperLabel.setAttribute('data-i18n', 'sss.lock.paper.required');
                paperLabel.textContent = t('sss.lock.paper.required');
              }
            }
          }
          if (vMatch && parseInt(vMatch[1]) >= 5 && meta.P?.genesisS) {
            const grr = document.getElementById('genesis-recover-row');
            if (grr) grr.style.display = '';
          }
        }
        showPanel('lock');
        setMsgK('msg.vault.loaded');
        const lvr = document.getElementById('load-vault-row');
        if (lvr) lvr.style.display = meta.vaultJson ? 'none' : '';
        _showReenrollReminder(_reenrollReminderDays(meta));
        _showWalletBadge(meta);
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

// ── Camera helpers ─────────────────────────────────────────────────────────
function _stopCamera() {
  if (!stream) return;
  stream.getTracks().forEach(t => t.stop());
  stream = null;
  video.srcObject = null;
}

async function _ensureCamera() {
  if (stream && stream.getTracks().every(t => t.readyState === 'live')) return;
  try { stream = await openCamera(video, m => setMsg(m, '')); }
  catch (e) { setMsg(t('msg.camera.error', { err: e.message }), 'error'); }
}

async function _ensureCameraForScan() {
  await _ensureCamera();
  if (!stream || !stream.getTracks().some(tr => tr.readyState === 'live')) {
    throw new Error('CAMERA_UNAVAILABLE');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Restart camera if stream killed when app went to background ───────────────
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  // Also catches muted tracks (not just ended) for better mobile compat
  if (!stream || stream.getTracks().some(t => t.readyState !== 'live')) {
    try { stream = await openCamera(video, m => setMsg(m, '')); }
    catch (e) { setMsg(t('msg.camera.error', { err: e.message }), 'error'); }
  }
});

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

function playBioSuccessSound() {
  try {
    const ctx   = new AudioContext();
    const notes = [523.25, 659.25, 783.99]; // C5 → E5 → G5 (dúr akkord)
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0.28, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.start(t);
      osc.stop(t + 0.18);
    });
  } catch { /* AudioContext nem elérhető — csend */ }
}

function bioSuccess() {
  localStorage.removeItem('biowallet_bf');
  playBioSuccessSound();
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

async function _offerDeviceEnroll() {
  const ok = await PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false);
  if (!ok) return null;
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem';
    ov.innerHTML =
      `<div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;width:100%;max-width:380px;padding:1.5rem">` +
        `<div style="font-size:1rem;font-weight:700;color:#6c63ff;margin-bottom:0.5rem">${t('device.offer.title')}</div>` +
        `<div style="font-size:0.82rem;color:#b0b0c0;line-height:1.6;margin-bottom:1.2rem">${t('device.offer.body')}</div>` +
        `<div style="display:flex;gap:0.75rem">` +
          `<button id="_dev_skip" style="flex:1;padding:0.7rem;border-radius:10px;border:1px solid #2a2a35;background:#1e1e24;color:#e8e8f0;font-size:0.88rem;cursor:pointer">${t('device.offer.skip')}</button>` +
          `<button id="_dev_now" style="flex:1;padding:0.7rem;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.88rem;font-weight:600;cursor:pointer">${t('device.offer.now')}</button>` +
        `</div>` +
      `</div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_dev_skip').addEventListener('click', () => { ov.remove(); resolve(null); });
    ov.querySelector('#_dev_now').addEventListener('click', async () => {
      ov.remove();
      setMsg(t('msg.device.auth'), '');
      resolve(await enrollWebAuthn());
    });
  });
}

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
  setMsg(t('msg.camera.init'), '');
  await _ensureCameraForScan();
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

  // Step 2: optional device factor (fingerprint / Face ID)
  const wa = await _offerDeviceEnroll();

  try {
    const { vaultId, P, encryptedVault, paperShareY } = await callWorker('CREATE_V5', {
      embedding,
      ...(wa ? { devicePrf: wa.devicePrf, credentialId: wa.credentialId, prfSalt: wa.prfSalt } : {}),
    }, [embedding.buffer]);

    const vaultJson = new TextDecoder().decode(encryptedVault);
    const newMeta = { vaultId, P, vaultJson };
    if (wa) newMeta.device = { credentialId: wa.credentialId, prfSalt: wa.prfSalt };
    localStorage.setItem('biowallet_meta', JSON.stringify(newMeta));

    // Step 3: mandatory paper share display
    const paperHex = Array.from(paperShareY).map(b => b.toString(16).padStart(2, '0')).join('');
    await showPaperShareModal(paperHex);

    // Step 4: save files
    const walletName = await showSaveModal(encryptedVault, JSON.stringify(P), 'create');
    newMeta.walletName = walletName;
    localStorage.setItem('biowallet_meta', JSON.stringify(newMeta));

    // Show SSS and genesis-recover rows immediately
    const pr = document.getElementById('sss-paper-row');
    if (pr) pr.style.display = '';
    const grr = document.getElementById('genesis-recover-row');
    if (grr && P?.genesisS) grr.style.display = '';

    vaultReady = true;
    setMsg(t('msg.wallet.created'), 'ok');
    showPanel('lock');
    _showReenrollReminder(_reenrollReminderDays(newMeta));
    _showWalletBadge(newMeta);
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

    localStorage.setItem('biowallet_meta', JSON.stringify({ vaultId, P, walletName: vaultId }));
    await callWorker('INIT_VAULT', { vaultId, bfState: _bfGet() });
    vaultReady = true;
    showPanel('lock');
    setMsgK('msg.restore.ok', 'ok');
    const lvr = document.getElementById('load-vault-row');
    if (lvr) lvr.style.display = '';
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
  setMsg(t('msg.camera.init'), '');
  await _ensureCameraForScan();
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

  // Step 2: optional device factor
  const wa = await _offerDeviceEnroll();

  try {
    const { vaultId, P, encryptedVault, paperShareY } = await callWorker('IMPORT_V5', {
      mnemonic: words.join(' '),
      embedding,
      ...(wa ? { devicePrf: wa.devicePrf, credentialId: wa.credentialId, prfSalt: wa.prfSalt } : {}),
    }, [embedding.buffer]);

    const vaultJson = new TextDecoder().decode(encryptedVault);
    const newMeta = { vaultId, P, vaultJson };
    if (wa) newMeta.device = { credentialId: wa.credentialId, prfSalt: wa.prfSalt };
    localStorage.setItem('biowallet_meta', JSON.stringify(newMeta));

    // Step 3: mandatory paper share display
    const paperHex = Array.from(paperShareY).map(b => b.toString(16).padStart(2, '0')).join('');
    await showPaperShareModal(paperHex);

    // Step 4: save files
    const walletName = await showSaveModal(encryptedVault, JSON.stringify(P), 'import');
    newMeta.walletName = walletName;
    localStorage.setItem('biowallet_meta', JSON.stringify(newMeta));

    const pr = document.getElementById('sss-paper-row');
    if (pr) pr.style.display = '';
    const grr = document.getElementById('genesis-recover-row');
    if (grr && P?.genesisS) grr.style.display = '';

    vaultReady = true;
    setMsg(t('msg.wallet.imported'), 'ok');
    showPanel('lock');
    await showPostImportChecklist();
    _showReenrollReminder(_reenrollReminderDays(newMeta));
    _showWalletBadge(newMeta);
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

  // Guard: vault must be pre-loaded via btn-load-vault before scanning.
  // Calling pickFile() after async awaits breaks the user-gesture chain on Samsung Browser,
  // causing it to open its native media picker (camera/video/photo) instead of the file manager.
  const meta = JSON.parse(localStorage.getItem('biowallet_meta') ?? 'null');
  if (!meta?.vaultJson) {
    setMsgK('msg.vault.file.required', 'error');
    const lvr = document.getElementById('load-vault-row');
    if (lvr) lvr.style.display = '';
    return;
  }

  btnScan.disabled = true;
  setMsg(t('msg.camera.init'), '');

  // Pre-scan: if vault has deviceShare but no device linked here, paper code is mandatory
  {
    let _vaultHasDevice = false;
    try { const _v = JSON.parse(meta.vaultJson); _vaultHasDevice = !!((_v.sss?.deviceShare) || _v.deviceWrap); } catch {}
    if (_vaultHasDevice && !meta.device) {
      const _paperInput = document.getElementById('sss-paper-input');
      const _hex = (_paperInput?.value ?? '').trim().toLowerCase().replace(/\s/g, '');
      if (!(_hex.length === 64 && /^[0-9a-f]+$/.test(_hex))) {
        setMsg(t('sss.paper.required.warn'), 'error');
        btnScan.disabled = false;
        return;
      }
    }
  }

  await _ensureCameraForScan();

  setScanning(true);
  setMsg(t('msg.open.scanning'), '');

  try {
    const embedding = await captureEmbedding(video);
    await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);

    // Try device factor if this vault has one registered on this device
    let devicePrf = null;
    if (meta.device?.credentialId) {
      setMsg(t('msg.device.auth'), '');
      try {
        devicePrf = await getDevicePrf(meta.device.credentialId, meta.device.prfSalt);
      } catch { /* fall through — face-only open */ }
      if (!devicePrf) setMsg(t('msg.device.fallback'), '');
    }

    // Vault from cache — guaranteed present by the guard above
    const encBuf = new TextEncoder().encode(meta.vaultJson).buffer;

    // v3 vault without device PRF → PIN required
    // v4 vault → collect paper share from input if provided
    const vaultVersion = _getVaultVersion(encBuf);
    let pin = null;
    let paperShareY = null;

    if (vaultVersion >= 4) {
      const paperInput = document.getElementById('sss-paper-input');
      const hexStr = (paperInput?.value ?? '').trim().toLowerCase().replace(/\s/g, '');
      if (hexStr.length === 64 && /^[0-9a-f]+$/.test(hexStr)) {
        paperShareY = Array.from(hexStr.match(/../g).map(h => parseInt(h, 16)));
      }
    } else if (vaultVersion === 3 && !devicePrf) {
      setMsg(t('msg.pin.required'), '');
      pin = await showPinModal('open');
      if (pin === null) {
        setScanning(false);
        btnScan.disabled = false;
        return;
      }
    }

    const { address, hasDevice, usedDevice, usedFace, isV4, isV5 } = await callWorker(
      'OPEN',
      { encryptedVault: encBuf, P: meta.P, devicePrf, pin, paperShareY },
      [encBuf]
    );

    bioSuccess(); // csak sikeres vault nyitás után nullázzuk a bf számlálót
    ethAddress.textContent = address;
    fetchBalance(address);
    updateTokenSelector();
    setScanning(false, true);

    _updateDeviceRow(hasDevice, usedDevice);
    deviceRow.style.display = '';
    swapRow.style.display   = isSwapSupported(currentNetwork.chainId) ? '' : 'none';
    const sssRow = document.getElementById('sss-row');
    if (sssRow) sssRow.style.display = (isV4 || isV5) ? 'none' : '';
    const reenrollRow = document.getElementById('reenroll-row');
    if (reenrollRow) reenrollRow.style.display = isV5 ? '' : 'none';

    // SSS paper+device nyitás v5-ön: kötelező arc re-enrollment
    if (!usedFace && isV5) {
      await _mandatoryReenroll(meta);
      return;
    }

    setMsg(t('msg.vault.open'), 'ok');
    showPanel('vault');
    _showWalletBadge(meta);
    ensureWCInit().catch(() => {});
    if (pendingWCReq) {
      const req = pendingWCReq;
      pendingWCReq = null;
      dispatchWCRequest(req.topic, req.id, req.params).catch(() => {});
    }

    // Offer device enrollment if vault has no device yet and WebAuthn is available
    if (!hasDevice && navigator.credentials) {
      setTimeout(() => setMsg(t('msg.device.offer'), ''), 1500);
    } else if (hasDevice && !meta.device && navigator.credentials) {
      setTimeout(() => setMsg(t('msg.device.relink.warn'), 'error'), 1500);
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

  // Optional hex data (for contract calls, anchor TXs, etc.)
  const rawHexData = sendHexDataInput?.value.trim() ?? '';
  if (rawHexData) {
    if (!/^0x[0-9a-fA-F]*$/.test(rawHexData)) {
      setMsg('Érvénytelen hex data (0x... formátum szükséges)', 'error');
      return;
    }
    txData = rawHexData;
  }

  if (!selectedToken) {
    try {
      txValue = ethToWei(amountStr || '0');
      if (txValue < 0n) throw new Error();
      if (txValue === 0n && txData === '0x') throw new Error();
    } catch {
      sendAmountInput.classList.add('error');
      setMsg(t('msg.invalid.amount'), 'error');
      return;
    }
    confirmAmount = (amountStr || '0') + ' ' + currentNetwork.nativeSymbol;
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
  await _ensureCameraForScan();
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
    if (e.message.includes('BIO_MISMATCH') || e.message.includes('GENESIS_MISMATCH')) bioFail();
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
    btnSign.disabled = false;
  }
});

// ── Paper recovery (Phase 9.1b — P never enters the app) ─────────────────
btnPaper.addEventListener('click', async () => {
  if (cooldownMs() > 0) return;
  await _ensureCameraForScan();
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

// ── 2-of-3 SSS info modal ────────────────────────────────────────────────
function showSSSInfoModal() {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    ov.innerHTML = `
      <div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;width:100%;max-width:380px;padding:1.5rem;max-height:90vh;overflow-y:auto;">
        <div style="font-size:1rem;font-weight:700;color:#6c63ff;margin-bottom:0.75rem">${t('sss.info.title')}</div>
        <div style="font-size:0.78rem;color:#b0b0c0;line-height:1.6;margin-bottom:1rem">${t('sss.info.body')}</div>
        <div style="display:flex;gap:0.75rem;margin-top:0.5rem">
          <button id="_sss_cancel" style="flex:1;padding:0.75rem;border-radius:10px;border:1px solid #2a2a35;background:#1e1e24;color:#e8e8f0;font-size:0.9rem;font-weight:600;cursor:pointer">${t('pin.btn.cancel')}</button>
          <button id="_sss_ok" style="flex:1;padding:0.75rem;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.9rem;font-weight:600;cursor:pointer">${t('sss.info.btn.ok')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_sss_cancel').addEventListener('click', () => { ov.remove(); resolve(false); });
    ov.querySelector('#_sss_ok').addEventListener('click',     () => { ov.remove(); resolve(true);  });
  });
}

// ── Paper share modal (shown after v4 creation/upgrade) ──────────────────
// isReenroll=true → device enrollment context: old paper code is now invalid
function showPaperShareModal(paperShareHex, isReenroll = false) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto;';
    const reenrollBanner = isReenroll
      ? `<div style="background:#2b0a0a;border:1px solid #ff4757;border-radius:8px;padding:0.75rem;margin-bottom:1rem;font-size:0.8rem;font-weight:700;color:#ff4757;line-height:1.5;">${t('sss.paper.modal.reenroll.warn')}</div>`
      : '';
    const check2Html = isReenroll
      ? `<label style="display:flex;align-items:flex-start;gap:0.6rem;cursor:pointer;font-size:0.8rem;color:#ff9f43;margin-bottom:0.75rem">
          <input type="checkbox" id="_psc_check2" style="width:1.1rem;height:1.1rem;margin-top:0.1rem;flex-shrink:0;accent-color:#ff4757">
          ${t('sss.paper.reenroll.confirm2')}
        </label>`
      : '';
    ov.innerHTML = `
      <div style="background:#16161a;border:1px solid ${isReenroll ? '#ff4757' : '#ffa502'};border-radius:16px;width:100%;max-width:400px;padding:1.5rem;margin:auto;">
        <div style="font-size:1rem;font-weight:700;color:${isReenroll ? '#ff4757' : '#ffa502'};margin-bottom:0.6rem">${t('sss.paper.modal.title')}</div>
        ${reenrollBanner}
        <div style="font-size:0.78rem;color:#b0b0c0;line-height:1.6;margin-bottom:1rem">${t('sss.paper.modal.body')}</div>
        <div style="background:#0d0d10;border:1px solid #2a2a35;border-radius:10px;padding:0.85rem;margin-bottom:0.85rem;font-family:monospace;font-size:0.78rem;color:#e8e8f0;word-break:break-all;letter-spacing:0.05em;line-height:1.7">${paperShareHex}</div>
        <div style="display:flex;gap:0.6rem;margin-bottom:1rem">
          <button id="_psc" style="flex:1;padding:0.6rem;border-radius:8px;border:1px solid #2a2a35;background:#1e1e24;color:#e8e8f0;font-size:0.82rem;font-weight:600;cursor:pointer">${t('sss.paper.copy')}</button>
        </div>
        <label style="display:flex;align-items:center;gap:0.6rem;cursor:pointer;font-size:0.8rem;color:#b0b0c0;margin-bottom:0.75rem">
          <input type="checkbox" id="_psc_check" style="width:1.1rem;height:1.1rem;accent-color:#6c63ff">
          ${t('sss.paper.confirm')}
        </label>
        ${check2Html}
        <button id="_psc_done" disabled style="width:100%;padding:0.75rem;border-radius:10px;border:none;background:#333;color:#666;font-size:0.9rem;font-weight:600;cursor:not-allowed">${t('sss.paper.done')}</button>
      </div>`;
    document.body.appendChild(ov);

    const copyBtn  = ov.querySelector('#_psc');
    const checkbox = ov.querySelector('#_psc_check');
    const checkbox2 = ov.querySelector('#_psc_check2');
    const doneBtn  = ov.querySelector('#_psc_done');

    const updateDone = () => {
      const ok = checkbox.checked && (!checkbox2 || checkbox2.checked);
      doneBtn.disabled = !ok;
      doneBtn.style.background = ok ? '#6c63ff' : '#333';
      doneBtn.style.color      = ok ? '#fff'    : '#666';
      doneBtn.style.cursor     = ok ? 'pointer' : 'not-allowed';
    };

    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(paperShareHex).catch(() => {});
      copyBtn.textContent = t('sss.paper.copied');
    });

    checkbox.addEventListener('change', updateDone);
    checkbox2?.addEventListener('change', updateDone);

    doneBtn.addEventListener('click', () => { ov.remove(); resolve(); });
  });
}

// ── Genesis recover preflight confirmation ────────────────────────────────
function showGenesisRecoverPreflight() {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:2000;display:flex;align-items:flex-start;justify-content:center;padding:1rem;overflow-y:auto;';
    ov.innerHTML = `
      <div style="background:#1a1a2e;border:2px solid #ff4757;border-radius:16px;padding:1.5rem;max-width:400px;width:100%;margin:auto;">
        <div style="font-size:1rem;font-weight:700;color:#ff4757;margin-bottom:1rem;">${t('genesis.recover.preflight.title')}</div>
        <div style="font-size:0.82rem;color:#c0c0d0;line-height:1.8;white-space:pre-line;margin-bottom:1.25rem;">${t('genesis.recover.preflight.body')}</div>
        <div style="display:flex;gap:0.75rem;">
          <button id="_grp_cancel" style="flex:1;padding:0.75rem;border-radius:10px;border:1px solid #2a2a35;background:#1e1e24;color:#e8e8f0;font-size:0.9rem;font-weight:600;cursor:pointer;">${t('genesis.recover.preflight.cancel')}</button>
          <button id="_grp_ok" style="flex:1;padding:0.75rem;border-radius:10px;border:none;background:#ff4757;color:#fff;font-size:0.9rem;font-weight:600;cursor:pointer;">${t('genesis.recover.preflight.ok')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_grp_cancel').onclick = () => { ov.remove(); resolve(false); };
    ov.querySelector('#_grp_ok').onclick     = () => { ov.remove(); resolve(true); };
  });
}

// ── Genesis recover modal (shows 24-word mnemonic after face recovery) ───
function showGenesisRecoverModal(mnemonic) {
  return new Promise(resolve => {
    const words    = mnemonic.split(' ');
    const wordsHtml = words.map((w, i) =>
      `<span style="font-family:monospace;padding:0.15rem 0.4rem;background:#1e1e2a;border-radius:4px;margin:0.1rem;display:inline-block;color:#e8e8f0;font-size:0.85rem;">` +
      `<span style="color:#666;font-size:0.7rem;margin-right:0.25rem">${i + 1}.</span>${w}</span>`
    ).join('');
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.95);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    ov.innerHTML = `
      <div style="background:#1a1a2e;border:2px solid #ff4757;border-radius:16px;padding:1.5rem;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;">
        <div style="font-size:0.88rem;font-weight:600;color:#ff4757;margin-bottom:0.9rem;">${t('genesis.recover.warning')}</div>
        <div style="margin-bottom:1.1rem;line-height:2;">${wordsHtml}</div>
        <div style="display:flex;gap:0.75rem;">
          <button id="_gr_copy" style="flex:1;padding:0.6rem;border:1px solid #6c63ff;background:transparent;color:#6c63ff;border-radius:8px;cursor:pointer;font-size:0.9rem;">${t('genesis.recover.copy')}</button>
          <button id="_gr_close" style="flex:1;padding:0.6rem;border:1px solid #ff4757;background:#2b0a0a;color:#ff4757;border-radius:8px;cursor:pointer;font-size:0.9rem;font-weight:600;">${t('genesis.recover.close')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    const copyBtn = ov.querySelector('#_gr_copy');
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(mnemonic);
        copyBtn.textContent = t('genesis.recover.copy.ok');
        copyBtn.style.borderColor = '#4CAF50';
        copyBtn.style.color = '#4CAF50';
      } catch {
        // Fallback: select a temporary textarea
        const ta = document.createElement('textarea');
        ta.value = mnemonic;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) {
          copyBtn.textContent = t('genesis.recover.copy.ok');
          copyBtn.style.borderColor = '#4CAF50';
          copyBtn.style.color = '#4CAF50';
        } else {
          copyBtn.textContent = t('genesis.recover.copy.fail');
          copyBtn.style.borderColor = '#ff4757';
          copyBtn.style.color = '#ff4757';
        }
      }
    };
    ov.querySelector('#_gr_close').onclick = () => {
      ov.remove();
      navigator.clipboard?.writeText('').catch(() => {});
      resolve();
    };
  });
}

// ── btn-genesis-recover: face → 24 words (emergency recovery) ────────────
document.getElementById('btn-genesis-recover')?.addEventListener('click', async () => {
  const meta = JSON.parse(localStorage.getItem('biowallet_meta') ?? 'null');
  if (!meta) return;

  if (!meta.P?.genesisS) {
    setMsg(t('err.genesis.backup.unavailable'), 'error');
    return;
  }

  if (!meta.vaultJson) {
    setMsgK('msg.vault.file.required', 'error');
    const lvr = document.getElementById('load-vault-row');
    if (lvr) lvr.style.display = '';
    return;
  }

  const confirmed = await showGenesisRecoverPreflight();
  if (!confirmed) return;

  await _ensureCameraForScan();
  setScanning(true);
  setMsg(t('msg.genesis.recover.scanning'), '');

  let embedding;
  try {
    embedding = await captureEmbedding(video);
  } catch (e) {
    setScanning(false);
    setMsg(friendlyError(e.message), 'error');
    return;
  }

  setScanning(false);

  try {
    const encBuf = new TextEncoder().encode(meta.vaultJson).buffer;
    const { mnemonic } = await callWorker(
      'GENESIS_RECOVER',
      { encryptedVault: encBuf, embedding, P: meta.P },
      [encBuf, embedding.buffer]
    );
    await showGenesisRecoverModal(mnemonic);
    setMsg(t('msg.genesis.recover.done'), 'ok');
  } catch (e) {
    if (e.message.includes('GENESIS_DECODE_FAIL') || e.message.includes('GENESIS_MISMATCH')) {
      bioFail();
      setMsg(t('err.genesis.recover.fail') + bioFailHint(), 'error');
    } else {
      setMsg(friendlyError(e.message), 'error');
    }
  }
});

// ── btn-sss info button ───────────────────────────────────────────────────
document.getElementById('btn-sss-info')?.addEventListener('click', () => showSSSInfoModal());

// ── btn-sss: upgrade vault to 2-of-3 ─────────────────────────────────────
document.getElementById('btn-sss')?.addEventListener('click', async () => {
  const meta = JSON.parse(localStorage.getItem('biowallet_meta') ?? 'null');
  if (!meta) return;

  const confirmed = await showSSSInfoModal();
  if (!confirmed) return;

  // Try to enroll device factor
  let wa = null;
  if (navigator.credentials) {
    setMsg(t('msg.device.auth'), '');
    wa = await enrollWebAuthn();
  }

  try {
    const { encryptedVault, paperShareY } = await callWorker('UPGRADE_V5', {
      devicePrf:    wa?.devicePrf    ?? null,
      credentialId: wa?.credentialId ?? null,
      prfSalt:      wa?.prfSalt      ?? null,
    });

    const paperHex = Array.from(paperShareY).map(b => b.toString(16).padStart(2, '0')).join('');
    await showPaperShareModal(paperHex);

    meta.vaultJson = new TextDecoder().decode(encryptedVault);
    if (wa) meta.device = { credentialId: wa.credentialId, prfSalt: wa.prfSalt };
    localStorage.setItem('biowallet_meta', JSON.stringify(meta));

    const walletName = await showSaveModal(encryptedVault, null, 'device', meta.walletName || 'biowallet');
    meta.walletName = walletName;
    localStorage.setItem('biowallet_meta', JSON.stringify(meta));

    document.getElementById('sss-row').style.display = 'none';
    setMsg(t('sss.paper.done'), 'ok');
  } catch (e) {
    setMsg(e.message, 'error');
  }
});

// ── Re-enrollment emlékeztető (dna_chain kor ellenőrzés) ─────────────────────
function _reenrollReminderDays(meta) {
  try {
    const vault = JSON.parse(meta?.vaultJson ?? 'null');
    if (!vault || vault.v !== 5 || !vault.dna_chain?.length) return 0;
    const lastTs = vault.dna_chain[vault.dna_chain.length - 1].ts;
    return Math.floor((Date.now() - lastTs) / 86400000);
  } catch { return 0; }
}

function _showReenrollReminder(days) {
  const existing = document.getElementById('reenroll-reminder-banner');
  if (existing) existing.remove();
  if (days < 365) return;
  if (sessionStorage.getItem('reenroll-reminder-dismissed')) return;

  const urgent = days > 730;
  const banner = document.createElement('div');
  banner.id = 'reenroll-reminder-banner';
  const msgKey = urgent ? 'msg.reenroll.reminder.urgent' : 'msg.reenroll.reminder';
  banner.style.cssText = [
    'margin:0.6rem 0 0.2rem',
    'padding:0.65rem 0.9rem',
    'border-radius:8px',
    `background:${urgent ? '#ff6b2b18' : '#ffb30018'}`,
    `border:1px solid ${urgent ? '#ff6b2b66' : '#ffb30066'}`,
    `color:${urgent ? '#ff8c55' : '#e6a800'}`,
    'font-size:0.84rem',
    'display:flex',
    'gap:0.5rem',
    'align-items:flex-start',
  ].join(';');
  banner.innerHTML = `
    <span style="flex:1;line-height:1.4">
      ${urgent ? '🔴' : '🟡'} ${t(msgKey, { days })}
    </span>
    <button id="btn-reenroll-reminder-now"
      style="background:none;border:none;cursor:pointer;color:inherit;font-size:0.84rem;text-decoration:underline;padding:0;white-space:nowrap;flex-shrink:0">
      ${t('msg.reenroll.reminder.btn')}
    </button>
    <button id="btn-reenroll-reminder-dismiss"
      style="background:none;border:none;cursor:pointer;color:inherit;font-size:1rem;padding:0 0 0 0.3rem;flex-shrink:0"
      title="${t('btn.close') || '✕'}">✕</button>
  `;

  const lockPanel = document.getElementById('panel-lock');
  if (lockPanel) lockPanel.insertBefore(banner, lockPanel.firstChild);

  document.getElementById('btn-reenroll-reminder-dismiss')?.addEventListener('click', () => {
    banner.remove();
    sessionStorage.setItem('reenroll-reminder-dismissed', '1');
  });
  document.getElementById('btn-reenroll-reminder-now')?.addEventListener('click', () => {
    banner.remove();
    document.getElementById('btn-reenroll')?.click();
  });
}

// ── Visual wallet badge (genesis.dna → identicon) ────────────────────────────
function _genesisFromMeta(meta) {
  try {
    const vault = JSON.parse(meta?.vaultJson ?? 'null');
    return vault?.genesis?.dna ?? null;
  } catch { return null; }
}

function _walletBadgeSvg(dna, size) {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(dna.slice(i * 2, i * 2 + 2), 16);
  const hue = (bytes[0] << 8 | bytes[1]) % 360;
  const sat = 55 + (bytes[2] % 30);
  const lit = 47 + (bytes[3] % 18);
  const fg  = `hsl(${hue},${sat}%,${lit}%)`;
  const bg  = `hsl(${hue},28%,10%)`;
  // 15-bit pattern: cols 0,1,2 × rows 0-4; col 3 mirrors col 1, col 4 mirrors col 0
  const bits = (bytes[4] << 7) | (bytes[5] >> 1);
  let cells = '';
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      if (!((bits >> (row * 3 + col)) & 1)) continue;
      const cols = col === 2 ? [2] : [col, 4 - col];
      for (const c of cols) {
        cells += `<rect x="${c + 0.1}" y="${row + 0.1}" width="0.8" height="0.8" rx="0.15" fill="${fg}"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 5 5"><rect width="5" height="5" rx="0.6" fill="${bg}"/>${cells}</svg>`;
}

function _showWalletBadge(meta) {
  document.getElementById('wallet-badge-lock')?.remove();
  document.getElementById('wallet-badge-vault')?.remove();
  const dna = _genesisFromMeta(meta);
  if (!dna) return;
  const fp   = dna.slice(0, 8) + '…' + dna.slice(-4);
  const name = (meta.walletName || 'BioWallet').replace(/</g, '&lt;');

  const lockPanel = document.getElementById('panel-lock');
  if (lockPanel) {
    const el = document.createElement('div');
    el.id = 'wallet-badge-lock';
    el.style.cssText = 'display:flex;align-items:center;gap:0.75rem;margin:0.5rem 0 0.6rem';
    el.innerHTML =
      `<div style="flex-shrink:0;border-radius:10px;overflow:hidden">${_walletBadgeSvg(dna, 56)}</div>` +
      `<div style="min-width:0">` +
        `<div style="font-weight:700;font-size:0.95rem;color:#e8e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${name}">${name}</div>` +
        `<div style="font-size:0.72rem;color:#666;font-family:monospace;letter-spacing:0.02em" title="${dna}">${fp}</div>` +
      `</div>`;
    const ref = lockPanel.querySelector('.info-text');
    if (ref) ref.after(el);
    else lockPanel.insertBefore(el, lockPanel.firstChild);
  }

  const vaultPanel = document.getElementById('panel-vault');
  if (vaultPanel) {
    const el = document.createElement('div');
    el.id = 'wallet-badge-vault';
    el.style.cssText = 'display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;opacity:0.75';
    el.innerHTML =
      `<div style="flex-shrink:0;border-radius:6px;overflow:hidden">${_walletBadgeSvg(dna, 32)}</div>` +
      `<div style="min-width:0">` +
        `<div style="font-weight:600;font-size:0.85rem;color:#e8e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${name}">${name}</div>` +
        `<div style="font-size:0.68rem;color:#666;font-family:monospace;letter-spacing:0.02em" title="${dna}">${fp}</div>` +
      `</div>`;
    const firstCard = vaultPanel.querySelector('.card');
    if (firstCard) vaultPanel.insertBefore(el, firstCard);
    else vaultPanel.insertBefore(el, vaultPanel.firstChild);
  }
}

// ── Kötelező arc re-enrollment SSS paper+device nyitás után ─────────────────
async function _mandatoryReenroll(meta) {
  showPanel('lock');
  setMsg(t('msg.reenroll.mandatory'), 'error');

  while (true) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.82);z-index:9000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.2rem;padding:1.5rem;text-align:center';
    overlay.innerHTML = `
      <div style="font-size:1.6rem">⚠️</div>
      <div style="font-weight:700;font-size:1.1rem;color:#ff4757">${t('msg.reenroll.mandatory')}</div>
      <div style="color:#ccc;max-width:340px;font-size:0.93rem">${t('msg.reenroll.mandatory.sub')}</div>
      <button id="btn-mandatory-scan" class="btn btn-primary" style="min-width:200px">${t('btn.reenroll')}</button>
    `;
    document.body.appendChild(overlay);

    await new Promise(resolve => {
      document.getElementById('btn-mandatory-scan').addEventListener('click', resolve, { once: true });
    });

    overlay.remove();

    await _ensureCameraForScan();
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
      setMsg(friendlyError(e.message), 'error');
      continue;
    }

    setScanning(false);
    enrollDots.style.display = 'none';

    try {
      const { P, encryptedVault, paperShareY } = await callWorker(
        'RE_ENROLL_FACE', { embedding }, [embedding.buffer]
      );

      const paperHex = Array.from(paperShareY).map(b => b.toString(16).padStart(2, '0')).join('');
      await showPaperShareModal(paperHex);

      meta.P         = P;
      meta.vaultJson = new TextDecoder().decode(encryptedVault);
      meta.device    = null;
      localStorage.setItem('biowallet_meta', JSON.stringify(meta));

      await showSaveModal(encryptedVault, JSON.stringify(P), 'reenroll', meta.walletName || 'biowallet');
      localStorage.setItem('biowallet_meta', JSON.stringify(meta));

      setMsg(t('msg.reenroll.done'), 'ok');
      showPanel('vault');
      _showWalletBadge(meta);
      ensureWCInit().catch(() => {});
      return;
    } catch (e) {
      setMsg(friendlyError(e.message), 'error');
      continue;
    }
  }
}

// ── btn-reenroll: re-enroll face for v5 vaults ────────────────────────────
document.getElementById('btn-reenroll')?.addEventListener('click', async () => {
  const meta = JSON.parse(localStorage.getItem('biowallet_meta') ?? 'null');
  if (!meta) return;

  const confirmed = confirm(t('msg.reenroll.confirm'));
  if (!confirmed) return;

  await _ensureCameraForScan();
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
    setMsg(friendlyError(e.message), 'error');
    return;
  }

  setScanning(false);
  enrollDots.style.display = 'none';

  try {
    const { P, encryptedVault, paperShareY } = await callWorker(
      'RE_ENROLL_FACE', { embedding }, [embedding.buffer]
    );

    const paperHex = Array.from(paperShareY).map(b => b.toString(16).padStart(2, '0')).join('');
    await showPaperShareModal(paperHex);

    meta.P         = P;
    meta.vaultJson = new TextDecoder().decode(encryptedVault);
    meta.device    = null; // device share invalidated by new salt; re-enroll device separately
    localStorage.setItem('biowallet_meta', JSON.stringify(meta));

    const walletName = await showSaveModal(encryptedVault, JSON.stringify(P), 'reenroll', meta.walletName || 'biowallet');
    meta.walletName = walletName;
    localStorage.setItem('biowallet_meta', JSON.stringify(meta));

    setMsg(t('msg.reenroll.done'), 'ok');
  } catch (e) {
    setMsg(friendlyError(e.message), 'error');
  }
});

// ── Load vault file ──────────────────────────────────────────────────────────
function _applyVaultJson(meta, vaultText) {
  meta.vaultJson = vaultText;
  const vMatch = vaultText.match(/"v"\s*:\s*(\d+)/);
  if (vMatch && parseInt(vMatch[1]) >= 4) {
    const pr = document.getElementById('sss-paper-row');
    if (pr) pr.style.display = '';

    // Auto-restore meta.device from vault if not already set (e.g. after P.json restore).
    // credentialId/prfSalt are hex strings in vault → convert to number arrays for WebAuthn.
    if (!meta.device) {
      try {
        const _v = JSON.parse(vaultText);
        const cred = _v.deviceWrap ?? _v.sss?.deviceShare ?? null;
        if (cred?.credentialId && cred?.prfSalt) {
          const hexToArr = h => Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.slice(i*2, i*2+2), 16));
          meta.device = { credentialId: hexToArr(cred.credentialId), prfSalt: hexToArr(cred.prfSalt) };
        }
      } catch {}
    }

    let vaultHasDevice = false;
    try { const _v = JSON.parse(vaultText); vaultHasDevice = !!((_v.sss?.deviceShare) || _v.deviceWrap); } catch {}
    const paperLabel = document.querySelector('#sss-paper-row label');
    if (paperLabel) {
      if (vaultHasDevice && !meta.device) {
        paperLabel.style.color = '#ff4757';
        paperLabel.setAttribute('data-i18n', 'sss.lock.paper.required');
        paperLabel.textContent = t('sss.lock.paper.required');
      } else {
        paperLabel.style.color = '';
        paperLabel.setAttribute('data-i18n', 'sss.lock.paper.label');
        paperLabel.textContent = t('sss.lock.paper.label');
      }
    }
  }
  if (vMatch && parseInt(vMatch[1]) >= 5 && meta.P?.genesisS) {
    const grr = document.getElementById('genesis-recover-row');
    if (grr) grr.style.display = '';
  }
  localStorage.setItem('biowallet_meta', JSON.stringify(meta));
  document.getElementById('load-vault-row').style.display = 'none';
  setMsgK('msg.vault.file.loaded', 'ok');
  _showReenrollReminder(_reenrollReminderDays(meta));
  _showWalletBadge(meta);
}

function _validateAndApplyVault(meta, vaultText) {
  if (!vaultText || vaultText[0] !== '{') { setMsg(t('msg.invalid.vault.file'), 'error'); return false; }
  let vaultObj;
  try { vaultObj = JSON.parse(vaultText); } catch { setMsg(t('msg.invalid.vault.file'), 'error'); return false; }
  if (!vaultObj.salt || !vaultObj.vaultId) { setMsg(t('msg.invalid.vault.file'), 'error'); return false; }
  _applyVaultJson(meta, vaultText);
  return true;
}

document.getElementById('btn-load-vault')?.addEventListener('click', async () => {
  const meta = JSON.parse(localStorage.getItem('biowallet_meta') ?? 'null');
  if (!meta) return;
  try {
    const vaultFile = await pickFile('.biowallet');
    const encBuf    = await vaultFile.arrayBuffer();
    if (new Uint8Array(encBuf)[0] !== 0x7b) { setMsg(t('msg.invalid.vault.file'), 'error'); return; }
    meta.walletName = vaultFile.name.replace(/\.biowallet$/i, '').replace(/^.*[/\\]/, '') || meta.walletName;
    _validateAndApplyVault(meta, new TextDecoder().decode(encBuf));
  } catch (e) {
    if (e.message && !e.message.includes('no.file')) setMsg(friendlyError(e.message), 'error');
  }
  // File picker may interrupt camera stream on mobile — restart if needed
  _ensureCamera().catch(() => {});
});

document.getElementById('btn-vault-paste-close')?.addEventListener('click', () => {
  document.getElementById('vault-paste-modal').classList.remove('open');
});

document.getElementById('btn-vault-paste-ok')?.addEventListener('click', () => {
  const text = (document.getElementById('vault-paste-area')?.value ?? '').trim();
  document.getElementById('vault-paste-modal').classList.remove('open');
  if (!text) return;
  const meta = JSON.parse(localStorage.getItem('biowallet_meta') ?? 'null');
  if (!meta) return;
  _validateAndApplyVault(meta, text);
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
    const { encryptedVault, paperShareY } = await callWorker('ENROLL_DEVICE', {
      devicePrf:    wa.devicePrf,
      credentialId: wa.credentialId,
      prfSalt:      wa.prfSalt,
    });

    meta.device   = { credentialId: wa.credentialId, prfSalt: wa.prfSalt };
    meta.vaultJson = new TextDecoder().decode(encryptedVault);
    localStorage.setItem('biowallet_meta', JSON.stringify(meta));

    // Legacy v4/old v5: SSS re-split → new paper code (old is now invalid)
    // New v5: paperShareY is null — paper code unchanged, no modal needed
    if (paperShareY) {
      const paperHex = paperShareY.map(b => b.toString(16).padStart(2, '0')).join('');
      await showPaperShareModal(paperHex, true);
    }

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
  } else if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData') {
    await handleWCTypedSign(topic, id, params.request.params[1]);
  } else if (method === 'wallet_switchEthereumChain') {
    await handleWCSwitchChain(topic, id, params.request.params[0]);
  } else if (method === 'wallet_addEthereumChain') {
    await handleWCAddChain(topic, id, params.request.params[0]);
  } else if (method === 'wallet_watchAsset') {
    await handleWCWatchAsset(topic, id, params.request.params);
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

// ── Custom token storage ──────────────────────────────────────────────────
function getCustomTokens(networkKey) {
  try {
    const all = JSON.parse(localStorage.getItem('biowallet_custom_tokens') ?? '{}');
    return all[networkKey] ?? [];
  } catch { return []; }
}

function saveCustomToken(networkKey, token) {
  try {
    const all = JSON.parse(localStorage.getItem('biowallet_custom_tokens') ?? '{}');
    const existing = all[networkKey] ?? [];
    if (!existing.find(t => t.address.toLowerCase() === token.address.toLowerCase())) {
      all[networkKey] = [...existing, token];
      localStorage.setItem('biowallet_custom_tokens', JSON.stringify(all));
    }
  } catch {}
}

async function handleWCAddChain(topic, id, chainParams) {
  const chainId   = parseInt(chainParams.chainId, 16);
  const existing  = getAllNetworks().find(n => n.chainId === chainId);
  if (existing) {
    // Chain already known — just switch
    currentNetwork = existing;
    btnNetwork.textContent = currentNetwork.name;
    btnNetwork.classList.toggle('mainnet', !currentNetwork.testnet);
    await wcRespondOk(topic, id, null);
    await wcEmitChainChanged(topic, currentNetwork.chainId);
    return;
  }

  const rpcUrl = chainParams.rpcUrls?.[0] ?? '';
  if (!rpcUrl.startsWith('https://')) {
    await wcRespondError(topic, id, 'RPC URL must use HTTPS');
    setMsg(t('net.add.err.rpc'), 'error');
    return;
  }

  const approved = await showWCAddChainModal(chainParams);
  if (!approved) { await wcRespondError(topic, id); return; }

  const net = {
    key:      `custom_${chainId}`,
    name:     chainParams.chainName ?? `Chain ${chainId}`,
    chainId,
    rpc:      rpcUrl,
    symbol:   chainParams.nativeCurrency?.symbol ?? 'ETH',
    decimals: chainParams.nativeCurrency?.decimals ?? 18,
    explorer: chainParams.blockExplorerUrls?.[0] ?? '',
    testnet:  false,
  };
  saveCustomNetwork(net);
  currentNetwork = net;
  btnNetwork.textContent = currentNetwork.name;
  btnNetwork.classList.toggle('mainnet', !currentNetwork.testnet);
  await wcRespondOk(topic, id, null);
  await wcEmitChainChanged(topic, currentNetwork.chainId);
  setMsg(t('msg.wc.chain.added', { name: net.name }), 'ok');
  updateTokenSelector();
}

async function handleWCWatchAsset(topic, id, params) {
  // params can be object {type,options} or array [{type,options}]
  const p = Array.isArray(params) ? params[0] : params;
  if (p?.type !== 'ERC20' || !p?.options?.address) {
    await wcRespondError(topic, id, 'Only ERC20 supported');
    return;
  }
  const { address, symbol, decimals, image } = p.options;
  const approved = await showWCWatchAssetModal({ address, symbol, decimals: decimals ?? 18, image });
  if (!approved) { await wcRespondError(topic, id, 'User rejected'); return; }

  saveCustomToken(currentNetwork.key, { symbol, address, decimals: decimals ?? 18 });
  updateTokenSelector();
  await wcRespondOk(topic, id, true);
  setMsg(t('msg.wc.asset.added', { sym: symbol }), 'ok');
}

function showWCAddChainModal(p) {
  return new Promise(resolve => {
    const chainId = parseInt(p.chainId, 16);
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    ov.innerHTML = `
      <div style="background:#16161a;border:1px solid #6c63ff;border-radius:16px;width:100%;max-width:380px;padding:1.5rem;">
        <div style="font-size:1rem;font-weight:700;color:#6c63ff;margin-bottom:0.75rem;">${t('wc.addchain.title')}</div>
        <div style="background:#1e1e24;border:1px solid #2a2a35;border-radius:10px;padding:0.75rem;margin-bottom:0.9rem;font-size:0.82rem;">
          <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem"><span style="color:#888">${t('wc.addchain.name')}</span><span style="color:#e8e8f0;font-weight:600">${p.chainName ?? '—'}</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem"><span style="color:#888">Chain ID</span><span style="color:#e8e8f0;font-family:monospace">${chainId}</span></div>
          <div style="display:flex;justify-content:space-between;margin-bottom:0.3rem"><span style="color:#888">${t('wc.addchain.symbol')}</span><span style="color:#e8e8f0">${p.nativeCurrency?.symbol ?? '—'}</span></div>
          <div style="color:#888;margin-top:0.4rem;font-size:0.7rem;word-break:break-all">${p.rpcUrls?.[0] ?? ''}</div>
        </div>
        <div style="display:flex;gap:0.75rem;">
          <button id="_wcac_rej" style="flex:1;padding:0.7rem;border-radius:10px;border:1px solid #2a2a35;background:#1e1e24;color:#e8e8f0;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.sign.reject')}</button>
          <button id="_wcac_ok" style="flex:1;padding:0.7rem;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.addchain.add')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_wcac_rej').onclick = () => { ov.remove(); resolve(false); };
    ov.querySelector('#_wcac_ok').onclick  = () => { ov.remove(); resolve(true); };
  });
}

function showWCWatchAssetModal({ address, symbol, decimals, image }) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    const imgHtml = image ? `<img src="${image}" style="width:32px;height:32px;border-radius:50%;margin-right:0.5rem;vertical-align:middle" onerror="this.style.display='none'">` : '';
    ov.innerHTML = `
      <div style="background:#16161a;border:1px solid #4CAF50;border-radius:16px;width:100%;max-width:360px;padding:1.5rem;">
        <div style="font-size:1rem;font-weight:700;color:#4CAF50;margin-bottom:0.75rem;">${t('wc.watchasset.title')}</div>
        <div style="background:#1e1e24;border:1px solid #2a2a35;border-radius:10px;padding:0.75rem;margin-bottom:0.9rem;">
          <div style="font-size:1rem;font-weight:700;color:#e8e8f0;margin-bottom:0.3rem;">${imgHtml}${symbol ?? '—'}</div>
          <div style="font-size:0.72rem;color:#888;word-break:break-all">${address}</div>
          <div style="font-size:0.72rem;color:#888;margin-top:0.2rem">${t('wc.watchasset.decimals')}: ${decimals}</div>
        </div>
        <div style="display:flex;gap:0.75rem;">
          <button id="_wcwa_rej" style="flex:1;padding:0.7rem;border-radius:10px;border:1px solid #2a2a35;background:#1e1e24;color:#e8e8f0;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.sign.reject')}</button>
          <button id="_wcwa_ok" style="flex:1;padding:0.7rem;border-radius:10px;border:none;background:#4CAF50;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.watchasset.add')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_wcwa_rej').onclick = () => { ov.remove(); resolve(false); };
    ov.querySelector('#_wcwa_ok').onclick  = () => { ov.remove(); resolve(true); };
  });
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

    await _ensureCameraForScan();
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
    if (e.message?.includes('BIO_MISMATCH') || e.message?.includes('GENESIS_MISMATCH')) bioFail();
    await wcRespondError(topic, id, e.message);
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
  }
}

async function handleWCPersonalSign(topic, id, hexMsg) {
  if (cooldownMs() > 0) { await wcRespondError(topic, id, 'Cooldown active'); return; }

  const approved = await showWCSignModal(hexMsg);
  if (!approved) { await wcRespondError(topic, id); return; }

  try {
    await _ensureCameraForScan();
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
    if (e.message?.includes('BIO_MISMATCH') || e.message?.includes('GENESIS_MISMATCH')) bioFail();
    await wcRespondError(topic, id, e.message);
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
  }
}

async function handleWCTypedSign(topic, id, typedDataJson) {
  if (cooldownMs() > 0) { await wcRespondError(topic, id, 'Cooldown active'); return; }

  const approved = await showWCTypedSignModal(typedDataJson);
  if (!approved) { await wcRespondError(topic, id); return; }

  try {
    await _ensureCameraForScan();
    setScanning(true);
    setMsg(t('msg.signing.msg'), '');
    const meta      = JSON.parse(localStorage.getItem('biowallet_meta'));
    const embedding = await captureEmbedding(video);
    await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);
    bioSuccess();
    const { signature } = await callWorker('SIGN_TYPED_DATA', { typedDataJson });
    setScanning(false);
    await wcRespondOk(topic, id, signature);
    setMsg(t('msg.wc.typed.signed'), 'ok');
  } catch (e) {
    setScanning(false);
    if (e.message?.includes('BIO_MISMATCH') || e.message?.includes('GENESIS_MISMATCH')) bioFail();
    await wcRespondError(topic, id, e.message);
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
  }
}

function showWCTypedSignModal(typedDataJson) {
  return new Promise(resolve => {
    let parsed = null;
    try { parsed = JSON.parse(typedDataJson); } catch {}

    const domainName  = parsed?.domain?.name   ?? '—';
    const primaryType = parsed?.primaryType     ?? '—';
    const msgEntries  = parsed?.message ? Object.entries(parsed.message) : [];
    const msgHtml = msgEntries.slice(0, 8).map(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      const short = val.length > 42 ? val.slice(0, 42) + '…' : val;
      return `<tr><td style="color:#888;padding:0.15rem 0.5rem 0.15rem 0;font-size:0.72rem;white-space:nowrap">${k}</td><td style="color:#e8e8f0;font-size:0.72rem;word-break:break-all;font-family:monospace">${short}</td></tr>`;
    }).join('');

    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:2000;display:flex;align-items:flex-start;justify-content:center;padding:1rem;overflow-y:auto;';
    ov.innerHTML = `
      <div style="background:#16161a;border:1px solid #ffa502;border-radius:16px;width:100%;max-width:400px;padding:1.5rem;margin:auto;">
        <div style="font-size:1rem;font-weight:700;color:#ffa502;margin-bottom:0.25rem;">${t('wc.typed.title')}</div>
        <div style="font-size:0.78rem;color:#6b6b80;margin-bottom:0.9rem;">${t('wc.typed.desc')}</div>
        <div style="background:#1e1e24;border:1px solid #2a2a35;border-radius:10px;padding:0.75rem;margin-bottom:0.75rem;">
          <div style="font-size:0.72rem;color:#888;margin-bottom:0.25rem;">${t('wc.typed.domain')}</div>
          <div style="font-size:0.88rem;font-weight:600;color:#e8e8f0;">${domainName}</div>
          <div style="font-size:0.72rem;color:#6c63ff;margin-top:0.2rem;">${primaryType}</div>
        </div>
        ${msgHtml ? `
        <div style="background:#1e1e24;border:1px solid #2a2a35;border-radius:10px;padding:0.75rem;margin-bottom:0.9rem;overflow-x:auto;">
          <div style="font-size:0.72rem;color:#888;margin-bottom:0.4rem;">${t('wc.typed.fields')}</div>
          <table style="border-collapse:collapse;width:100%">${msgHtml}</table>
        </div>` : ''}
        <div style="font-size:0.72rem;color:#ff4757;margin-bottom:0.9rem;">${t('wc.typed.warn')}</div>
        <div style="display:flex;gap:0.75rem;">
          <button id="_wcts_reject" style="flex:1;padding:0.7rem;border-radius:10px;border:1px solid #2a2a35;background:#1e1e24;color:#e8e8f0;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.sign.reject')}</button>
          <button id="_wcts_ok" style="flex:1;padding:0.7rem;border-radius:10px;border:none;background:#ffa502;color:#000;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.typed.sign')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_wcts_reject').onclick = () => { ov.remove(); resolve(false); };
    ov.querySelector('#_wcts_ok').onclick     = () => { ov.remove(); resolve(true); };
  });
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
        <div style="font-size:0.75rem;color:#6b6b80;padding:0.5rem 0.7rem;background:#1e1e24;border-radius:8px;margin-bottom:0.75rem;line-height:1.5;">
          ${t('wc.proposal.info')}
        </div>
        <a href="/app/dapp-guide.html" target="_blank" rel="noopener" style="display:block;text-align:center;font-size:0.75rem;color:#6c63ff;margin-bottom:0.9rem;">↗ ${t('wc.proposal.guide.link')}</a>
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

// ── Swap ──────────────────────────────────────────────────────────────────

btnSwap.addEventListener('click', () => { if (vaultReady) _showSwapPanel(); });

async function _showSwapPanel() {
  const isHu    = document.documentElement.lang !== 'en';
  const sym     = currentNetwork.nativeSymbol ?? 'ETH';
  const tokens  = [...(TOKEN_LIST[currentNetwork.key] ?? [])];
  const address = ethAddress.textContent;

  if (!tokens.length) {
    setMsg(isHu ? 'Ezen a hálózaton nincs swap token.' : 'No tokens available for swap.', 'error');
    return;
  }

  // From options: native + ERC-20 tokens
  const fromOptions = [
    `<option value="${ETH_ADDR}" data-sym="${sym}" data-dec="18">${sym}</option>`,
    ...tokens.map(t => `<option value="${t.address}" data-sym="${t.symbol}" data-dec="${t.decimals}">${t.symbol}</option>`),
  ].join('');
  const toOptions = [
    `<option value="${ETH_ADDR}" data-sym="${sym}" data-dec="18">${sym}</option>`,
    ...tokens.map(t => `<option value="${t.address}" data-sym="${t.symbol}" data-dec="${t.decimals}">${t.symbol}</option>`),
  ].join('');

  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;overflow-y:auto;';
  ov.innerHTML = `
    <div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;width:100%;max-width:400px;padding:1.5rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6c63ff;margin-bottom:0.75rem;">Token Swap — Paraswap</div>

      <div style="font-size:0.75rem;color:#6b6b80;margin-bottom:0.3rem;">${isHu ? 'Elköltöm:' : 'You spend:'}</div>
      <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;">
        <select id="_sw_fromToken" style="flex:1;background:#1e1e24;border:1px solid #2a2a35;border-radius:8px;padding:0.6rem;font-size:0.85rem;color:#e8e8f0;outline:none;">${fromOptions}</select>
        <input id="_sw_amount" type="text" placeholder="0.01"
          style="flex:2;background:#1e1e24;border:1px solid #2a2a35;border-radius:8px;padding:0.6rem 0.8rem;font-size:0.85rem;color:#e8e8f0;outline:none;" autocomplete="off">
      </div>

      <div style="font-size:0.75rem;color:#6b6b80;margin-bottom:0.3rem;">${isHu ? 'Kapom:' : 'You receive:'}</div>
      <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;">
        <select id="_sw_toToken" style="flex:1;background:#1e1e24;border:1px solid #2a2a35;border-radius:8px;padding:0.6rem;font-size:0.85rem;color:#e8e8f0;outline:none;">${toOptions}</select>
        <div id="_sw_output" style="flex:2;background:#1e1e24;border:1px solid #2a2a35;border-radius:8px;padding:0.6rem 0.8rem;font-size:0.85rem;color:#6b6b80;display:flex;align-items:center;">—</div>
      </div>

      <div id="_sw_details" style="display:none;font-size:0.72rem;color:#6b6b80;background:#1e1e24;border:1px solid #2a2a35;border-radius:8px;padding:0.6rem 0.8rem;margin-bottom:0.75rem;line-height:1.8;"></div>
      <div id="_sw_err" style="display:none;font-size:0.72rem;color:#ff4757;background:#2b0a0a;border:1px solid #5a2020;border-radius:6px;padding:0.5rem 0.7rem;margin-bottom:0.6rem;"></div>

      <div style="display:flex;gap:0.5rem;">
        <button id="_sw_quote" style="flex:1;padding:0.65rem;border-radius:10px;border:1px solid #6c63ff;background:transparent;color:#6c63ff;font-size:0.82rem;font-weight:600;cursor:pointer;">
          ${isHu ? 'Árfolyam' : 'Quote'}
        </button>
        <button id="_sw_exec" disabled style="flex:2;padding:0.65rem;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;opacity:0.5;">
          ${isHu ? '⚡ Csere' : '⚡ Swap'}
        </button>
        <button id="_sw_cancel" style="flex:1;padding:0.65rem;border-radius:10px;border:1px solid #5a2020;background:#2b0a0a;color:#ff4757;font-size:0.82rem;font-weight:600;cursor:pointer;">
          ${isHu ? 'Mégse' : 'Cancel'}
        </button>
      </div>
    </div>`;

  document.body.appendChild(ov);

  const fromSel   = ov.querySelector('#_sw_fromToken');
  const amountEl  = ov.querySelector('#_sw_amount');
  const toSel     = ov.querySelector('#_sw_toToken');
  const outputEl  = ov.querySelector('#_sw_output');
  const detailsEl = ov.querySelector('#_sw_details');
  const errEl     = ov.querySelector('#_sw_err');
  const execBtn   = ov.querySelector('#_sw_exec');

  let pendingSwapTx    = null;
  let pendingApproveTx = null;

  ov.querySelector('#_sw_cancel').addEventListener('click', () => ov.remove());

  ov.querySelector('#_sw_quote').addEventListener('click', async () => {
    errEl.style.display = 'none';
    outputEl.textContent = '…'; outputEl.style.color = '#6b6b80';
    detailsEl.style.display = 'none';
    execBtn.disabled = true; execBtn.style.opacity = '0.5';
    pendingSwapTx = null; pendingApproveTx = null;

    const amtStr = amountEl.value.trim().replace(',', '.');
    const amt    = parseFloat(amtStr);
    if (!amtStr || isNaN(amt) || amt <= 0) {
      errEl.textContent = isHu ? 'Adj meg pozitív összeget!' : 'Enter a positive amount.';
      errEl.style.display = 'block'; outputEl.textContent = '—'; return;
    }

    const fromOpt   = fromSel.selectedOptions[0];
    const fromAddr  = fromOpt.value;
    const fromSym   = fromOpt.dataset.sym;
    const fromDec   = parseInt(fromOpt.dataset.dec);
    const toOpt     = toSel.selectedOptions[0];
    const toAddr    = toOpt.value;

    if (fromAddr.toLowerCase() === toAddr.toLowerCase()) {
      errEl.textContent = isHu ? 'Ugyanaz a token!' : 'Same token selected.';
      errEl.style.display = 'block'; outputEl.textContent = '—'; return;
    }

    const amountWei = (BigInt(Math.round(amt * 10 ** Math.min(fromDec, 9))) * BigInt(10 ** Math.max(fromDec - 9, 0))).toString();

    try {
      const result = await buildSwapTx(currentNetwork.chainId, fromAddr, toAddr, amountWei, address);
      pendingSwapTx = result;

      // Allowance check for ERC-20 from token
      let needsApprove = false;
      if (fromAddr.toLowerCase() !== ETH_ADDR.toLowerCase()) {
        const spender   = result.spender ?? await getParaswapSpender(currentNetwork.chainId);
        const allowance = await getAllowance(fromAddr, address, spender, currentNetwork.rpc);
        needsApprove    = allowance < BigInt(amountWei);
        if (needsApprove) pendingApproveTx = buildApproveTx(fromAddr, spender, amountWei);
      }

      const outFmt = formatOutput(result.outputAmount, result.outputDecimals);
      outputEl.textContent = `${outFmt} ${result.outputSymbol}`;
      outputEl.style.color = '#4CAF50';

      const approveNote = needsApprove
        ? `<div style="color:#ffa502;">🔓 ${isHu ? 'Approve szükséges (1. arc-scan) → Swap (2. arc-scan)' : 'Approval needed (scan 1) → Swap (scan 2)'}</div>`
        : '';
      detailsEl.innerHTML =
        `<div>${isHu ? 'Elköltöm:' : 'From:'} <b>${amtStr} ${fromSym}</b></div>` +
        `<div>${isHu ? 'Kapom (min):' : 'Receive (min):'} <b>${outFmt} ${result.outputSymbol}</b></div>` +
        `<div>${isHu ? 'Slippage:' : 'Slippage:'} max 1% · <span style="color:#ffa502;">0.15% fee</span></div>` +
        approveNote;
      detailsEl.style.display = 'block';

      execBtn.textContent = needsApprove
        ? (isHu ? '⚡ Approve + Swap (2 scan)' : '⚡ Approve + Swap (2 scans)')
        : (isHu ? '⚡ Csere (1 scan)' : '⚡ Swap (1 scan)');
      execBtn.disabled = false; execBtn.style.opacity = '1';
    } catch (e) {
      errEl.textContent = _swapApiMsg(e.message, isHu);
      errEl.style.display = 'block';
      outputEl.textContent = '—';
    }
  });

  execBtn.addEventListener('click', async () => {
    if (!pendingSwapTx || cooldownMs() > 0) return;
    ov.remove();
    if (pendingApproveTx) {
      await _executeApproveAndSwap(pendingApproveTx, pendingSwapTx);
    } else {
      await _executeSwap(pendingSwapTx);
    }
  });
}

// ── Sign helper (shared by approve and swap steps) ─────────────────────────
async function _signAndBroadcast(tx, meta, label) {
  const isHu = document.documentElement.lang !== 'en';
  const { fingerprint } = await callWorker('COMMIT_TX', { tx });
  const userInput = await _showSwapConfirm(tx, null, fingerprint, label);
  if (!userInput) { await callWorker('CANCEL_TX'); return null; }

  // 1.5s: felhasználónak legyen ideje a kamerához pozicionálni
  setMsg(isHu ? '⏱ Arc-scan 1.5s múlva — nézzen a kamerába…' : '⏱ Face scan in 1.5s — look at the camera…', '');
  await new Promise(r => setTimeout(r, 1500));

  await _ensureCameraForScan();
  setScanning(true);
  setMsg(label, '');
  const embedding = await captureEmbedding(video);
  await callWorker('BIO_CAPTURE', { embedding, P: meta.P, userInput }, [embedding.buffer]);
  bioSuccess();
  const { signed } = await callWorker('SIGN', { tx });
  setScanning(false);
  return signed;
}

async function _reopenVaultForSwap(meta, stepLabel) {
  // P7 auto-lock után újra kell nyitni a vault-ot a swap TX aláírásához.
  const isHu = document.documentElement.lang !== 'en';
  setMsg(stepLabel, '');
  await _ensureCameraForScan();
  setScanning(true);

  const embedding = await captureEmbedding(video);
  await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);

  let devicePrf = null;
  if (meta.device?.credentialId) {
    try { devicePrf = await getDevicePrf(meta.device.credentialId, meta.device.prfSalt); } catch {}
  }
  const encBuf = new TextEncoder().encode(meta.vaultJson).buffer;
  await callWorker('OPEN', { encryptedVault: encBuf, P: meta.P, devicePrf }, [encBuf]);
  setScanning(false);
}

async function _executeApproveAndSwap(approveResult, swapResult) {
  const isHu = document.documentElement.lang !== 'en';
  try {
    const meta = JSON.parse(localStorage.getItem('biowallet_meta'));

    // P7 auto-lock check: ha az előző SIGN bezárta a vault-ot, nyissuk újra
    const status = await callWorker('STATUS').catch(() => ({ vaultOpen: true }));
    if (!status.vaultOpen) {
      await _reopenVaultForSwap(meta,
        isHu ? 'Vault újranyitás (P7-lock)…' : 'Re-opening vault (P7 lock)…');
    }

    const feeData   = await getFeeData(currentNetwork.rpc);
    const baseNonce = await getNonce(ethAddress.textContent, currentNetwork.rpc);

    // 1/3 — Approve TX (nonce N)
    const approveTx = {
      to:                   approveResult.to,
      value:                '0',
      data:                 approveResult.data,
      nonce:                baseNonce.toString(),
      chainId:              currentNetwork.chainId,
      gasLimit:             approveResult.gasLimit,
      maxFeePerGas:         feeData.maxFeePerGas.toString(),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas.toString(),
    };
    const signedApprove = await _signAndBroadcast(approveTx, meta,
      isHu ? '1/3 — Approve arc-scan…' : '1/3 — Approve face scan…');
    if (!signedApprove) return;

    await broadcastTx(signedApprove, currentNetwork.rpc);
    setMsg(isHu ? 'Approve elküldve — vault újranyitás…' : 'Approval sent — re-opening vault…', 'ok');

    // 2/3 — Vault újranyitás (P7 auto-lock miatt szükséges)
    await _reopenVaultForSwap(meta,
      isHu ? '2/3 — Vault újranyitása a swaphoz…' : '2/3 — Re-opening vault for swap…');

    // 3/3 — Swap TX (nonce N+1)
    const swapTx = {
      to:                   swapResult.tx.to,
      value:                swapResult.tx.value ?? '0',
      data:                 swapResult.tx.data,
      nonce:                (baseNonce + 1).toString(),
      chainId:              currentNetwork.chainId,
      gasLimit:             swapResult.tx.gasLimit ?? '400000',
      maxFeePerGas:         feeData.maxFeePerGas.toString(),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas.toString(),
    };
    const signedSwap = await _signAndBroadcast(swapTx, meta,
      isHu ? '3/3 — Swap arc-scan…' : '3/3 — Swap face scan…');
    if (!signedSwap) return;

    const swapHash = await broadcastTx(signedSwap, currentNetwork.rpc);
    setMsg((isHu ? 'Swap elküldve: ' : 'Swap sent: ') + swapHash.slice(0, 12) + '…', 'ok');
  } catch (e) {
    setScanning(false);
    if (e.message?.includes('BIO_MISMATCH') || e.message?.includes('WORKER_COOLDOWN')) bioFail();
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
  }
}

async function _executeSwap(swapResult) {
  const isHu = document.documentElement.lang !== 'en';
  try {
    const meta = JSON.parse(localStorage.getItem('biowallet_meta'));

    // P7 auto-lock check: ha az előző SIGN bezárta a vault-ot, nyissuk újra
    const status = await callWorker('STATUS').catch(() => ({ vaultOpen: true }));
    if (!status.vaultOpen) {
      await _reopenVaultForSwap(meta,
        isHu ? 'Vault újranyitás (P7-lock)…' : 'Re-opening vault (P7 lock)…');
    }

    const feeData = await getFeeData(currentNetwork.rpc);
    const tx = {
      to:                   swapResult.tx.to,
      value:                swapResult.tx.value ?? '0',
      data:                 swapResult.tx.data,
      nonce:                (await getNonce(ethAddress.textContent, currentNetwork.rpc)).toString(),
      chainId:              currentNetwork.chainId,
      gasLimit:             swapResult.tx.gasLimit ?? '400000',
      maxFeePerGas:         feeData.maxFeePerGas.toString(),
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas.toString(),
    };
    const signed = await _signAndBroadcast(tx, meta, isHu ? 'Swap arc-scan…' : 'Swap face scan…');
    if (!signed) return;
    const txHash = await broadcastTx(signed, currentNetwork.rpc);
    setMsg((isHu ? 'Swap elküldve: ' : 'Swap sent: ') + txHash.slice(0, 12) + '…', 'ok');
  } catch (e) {
    setScanning(false);
    if (e.message?.includes('BIO_MISMATCH') || e.message?.includes('WORKER_COOLDOWN')) bioFail();
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
  }
}

function _showSwapConfirm(tx, swapResult, fingerprint, label) {
  const isHu = document.documentElement.lang !== 'en';
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    const detailHtml = swapResult
      ? `<div>${isHu ? 'Kapom (min):' : 'Receive (min):'} <b style="color:#4CAF50;">${formatOutput(swapResult.outputAmount, swapResult.outputDecimals)} ${swapResult.outputSymbol}</b></div>
         <div style="color:#ffa502;">0.15% ${isHu ? 'protokoll fee' : 'protocol fee'}</div>`
      : `<div style="color:#ffa502;">${isHu ? 'Token engedélyezés a Paraswap routernek' : 'Token approval for Paraswap router'}</div>`;
    ov.innerHTML = `
      <div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;width:100%;max-width:400px;padding:1.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#ffa502;margin-bottom:0.6rem;">${label ?? (isHu ? 'Megerősítés' : 'Confirm')}</div>
        <div style="background:#1e1e24;border:1px solid #2a2a35;border-radius:8px;padding:0.7rem;margin-bottom:0.75rem;font-size:0.78rem;line-height:1.8;">
          ${detailHtml}
          <div>${isHu ? 'Router:' : 'Router:'} <span style="font-family:monospace;font-size:0.7rem;color:#a78bfa;">${tx.to.slice(0,10)}…${tx.to.slice(-6)}</span></div>
        </div>
        <div style="font-size:0.75rem;color:#6b6b80;margin-bottom:0.3rem;">${isHu ? 'TX ujjlenyomat (első 4 kar.):' : 'TX fingerprint (first 4 chars):'}</div>
        <div style="font-family:monospace;font-size:1.1rem;font-weight:700;color:#6c63ff;letter-spacing:0.15em;margin-bottom:0.5rem;">${fingerprint}</div>
        <input id="_sc_fp" type="text" maxlength="4" placeholder="${isHu ? '4 karakter' : '4 chars'}"
          style="width:100%;background:#1e1e24;border:1px solid #2a2a35;border-radius:8px;padding:0.6rem;
                 font-size:1rem;color:#e8e8f0;text-align:center;font-family:monospace;letter-spacing:0.1em;outline:none;margin-bottom:0.75rem;">
        <div style="display:flex;gap:0.75rem;">
          <button id="_sc_cancel" style="flex:1;padding:0.7rem;border-radius:10px;border:1px solid #5a2020;background:#2b0a0a;color:#ff4757;font-size:0.85rem;font-weight:600;cursor:pointer;">${isHu ? 'Mégse' : 'Cancel'}</button>
          <button id="_sc_ok" style="flex:2;padding:0.7rem;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">⚡ ${isHu ? 'Aláírom' : 'Sign'}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_sc_cancel').addEventListener('click', () => { ov.remove(); resolve(null); });
    ov.querySelector('#_sc_ok').addEventListener('click', () => { const v = ov.querySelector('#_sc_fp').value.trim(); ov.remove(); resolve(v || null); });
  });
}

function _parseSIWE(text) {
  // EIP-4361: "<domain> wants you to sign in with your Ethereum account:"
  const m = text.match(/^([^\n]+) wants you to sign in with your Ethereum account:/i);
  if (!m) return null;
  const domain = m[1].trim();
  const stmtM  = text.match(/\n\n([^\n]+)\n\n/);
  const uriM   = text.match(/URI:\s*(\S+)/);
  const chainM = text.match(/Chain ID:\s*(\d+)/);
  return { domain, statement: stmtM?.[1] ?? '', uri: uriM?.[1] ?? '', chainId: chainM?.[1] ?? '' };
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

  const siwe = _parseSIWE(decoded);
  const isHu = document.documentElement.lang !== 'en';

  let headerColor, labelHtml, bodyHtml;
  if (siwe) {
    headerColor = '#4CAF50';
    labelHtml = isHu ? 'Bejelentkezési kérés (EIP-4361)' : 'Sign-In Request (EIP-4361)';
    bodyHtml = `
      <div style="background:#1e1e24;border:1px solid #2a2a35;border-radius:8px;padding:0.7rem;margin-bottom:0.6rem;font-size:0.78rem;line-height:1.6;">
        <div><span style="color:#6b6b80;">${isHu ? 'Domain:' : 'Domain:'}</span> <b style="color:#e8e8f0;">${siwe.domain}</b></div>
        ${siwe.statement ? `<div><span style="color:#6b6b80;">${isHu ? 'Üzenet:' : 'Message:'}</span> <span style="color:#e8e8f0;">${siwe.statement}</span></div>` : ''}
        ${siwe.chainId   ? `<div><span style="color:#6b6b80;">Chain ID:</span> <span style="color:#e8e8f0;">${siwe.chainId}</span></div>` : ''}
      </div>`;
  } else {
    headerColor = '#ffa502';
    labelHtml = isHu ? '⚠ Egyedi üzenet aláírása' : '⚠ Arbitrary Message Signing';
    bodyHtml = `
      <div style="font-size:0.72rem;color:#ffa502;background:#2a1f00;border:1px solid #5a4000;border-radius:6px;padding:0.5rem 0.7rem;margin-bottom:0.6rem;">
        ${isHu ? 'Ez nem EIP-4361 bejelentkezési kérés. Ellenőrizd az üzenetet!' : 'This is not an EIP-4361 sign-in request. Check the message carefully!'}
      </div>
      <div style="background:#1e1e24;border:1px solid #2a2a35;border-radius:8px;padding:0.7rem;
           font-family:monospace;font-size:0.75rem;color:#e8e8f0;word-break:break-all;
           max-height:120px;overflow-y:auto;margin-bottom:0.6rem;line-height:1.5;">${decoded}</div>`;
  }

  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;display:flex;align-items:center;justify-content:center;padding:1rem;';
    ov.innerHTML = `
      <div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;width:100%;max-width:400px;padding:1.5rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${headerColor};margin-bottom:0.5rem;">${labelHtml}</div>
        ${bodyHtml}
        <div style="display:flex;gap:0.75rem;">
          <button id="_wcs_reject" style="flex:1;padding:0.7rem;border-radius:10px;border:1px solid #5a2020;background:#2b0a0a;color:#ff4757;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.sign.reject')}</button>
          <button id="_wcs_sign" style="flex:1;padding:0.7rem;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">${t('wc.sign.sign')}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_wcs_reject').addEventListener('click', () => { ov.remove(); resolve(false); });
    ov.querySelector('#_wcs_sign').addEventListener('click',   () => { ov.remove(); resolve(true); });
  });
}

function updateTokenSelector() {
  const sym    = currentNetwork.nativeSymbol ?? 'ETH';
  const tokens = [...(TOKEN_LIST[currentNetwork.key] ?? []), ...getCustomTokens(currentNetwork.key)];
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
      const bf   = _bfGet();
      const mult = Math.min(2 ** (bf.n / BF_AFTER - 1), 8);
      setMsg(t('msg.cooldown', { sec: Math.ceil(cd / 1000), mult: Math.round(mult) }), 'error');
      return;
    }
    if (inCooldown) {
      inCooldown = false;
      btnScan.disabled = false;
      setMsg(t('msg.cooldown.over') + bioFailHint(), '');
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
  // Camera only needed for face panels; stop it during vault (authenticated) and text-input (import)
  if (name === 'vault' || name === 'import') {
    _stopCamera();
  } else {
    _ensureCamera().catch(() => {});
  }
  if (name !== 'vault') {
    deviceRow.style.display = 'none';
    btnScan.disabled        = false;
    btnSign.disabled        = false;
    ethAddress.textContent  = '—';
    ethBalance.textContent  = '—';
    txResult.style.display  = 'none';
    sendToInput.value       = '';
    sendAmountInput.value   = '';
    if (sendHexDataInput) sendHexDataInput.value = '';
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

// ── Swap API error → human-readable (used in swap modal errEl) ────────────
function _swapApiMsg(m, isHu) {
  if (!m) return isHu ? 'Ismeretlen hiba.' : 'Unknown error.';
  const ml = m.toLowerCase();
  if (ml.includes('no routes') || ml.includes('no route'))
    return isHu ? 'Erre a párra nincs elérhető swap útvonal.' : 'No swap route available for this pair.';
  if (ml.includes('liquidity'))
    return isHu ? 'Nincs elegendő likviditás.' : 'Not enough liquidity for this swap.';
  if (ml.includes('same token') || ml.includes('same') && ml.includes('token'))
    return isHu ? 'Ugyanaz a token!' : 'Same token selected.';
  if (ml.includes('paraswap') || m.match(/TX:\s*[45]\d\d/) || m.match(/quote:\s*[45]\d\d/))
    return isHu ? 'A swap API átmenetileg nem elérhető, próbálja újra.' : 'Swap API temporarily unavailable, please retry.';
  if (ml.includes('failed to fetch') || ml.includes('networkerror'))
    return isHu ? 'Hálózati hiba – ellenőrizze az internetkapcsolatot.' : 'Network error – check your connection.';
  return m;
}

// ── Friendly error messages ───────────────────────────────────────────────
function friendlyError(m) {
  if (!m) return t('err.unknown');
  if (m.includes('TX_MISMATCH'))              return t('err.tx.mismatch');
  if (m.includes('GENESIS_BACKUP_UNAVAILABLE')) return t('err.genesis.backup.unavailable');
  if (m.includes('GENESIS_DECODE_FAIL'))      return t('err.genesis.mismatch');
  if (m.includes('GENESIS_MISMATCH'))         return t('err.genesis.mismatch');
  if (m.includes('CAMERA_UNAVAILABLE'))        return t('err.camera.unavailable');
  if (m.includes('VAULT_CORRUPTED'))           return t('err.vault.corrupted');
  if (m.includes('WORKER_COOLDOWN')) { const sec = m.split(':')[1] ?? '?'; return t('err.bio.mismatch') + ` (${sec}s)`; }
  if (m.includes('BIO_MISMATCH'))             return t('err.bio.mismatch');
  if (m.includes('EXPIRED'))         return t('err.expired');
  if (m.includes('NO_TOKEN'))        return t('err.no.token');
  if (m.includes('VAULT_ID_MISMATCH')) return t('err.vault.mismatch');
  if (m.includes('ALREADY_CONSUMED')) return t('err.consumed');
  if (m.toLowerCase().includes('invalid mnemonic') ||
      m.toLowerCase().includes('invalid phrase') ||
      m.toLowerCase().includes('invalid word'))
    return t('err.mnemonic');
  // Swap API errors (execution path — same translations as _swapApiMsg)
  const isHu = document.documentElement.lang !== 'en';
  const ml = m.toLowerCase();
  if (ml.includes('no routes') || ml.includes('no route'))
    return isHu ? 'Erre a párra nincs elérhető swap útvonal.' : 'No swap route available for this pair.';
  if (ml.includes('liquidity'))
    return isHu ? 'Nincs elegendő likviditás.' : 'Not enough liquidity for this swap.';
  if (ml.includes('paraswap') || m.match(/TX:\s*[45]\d\d/) || m.match(/quote:\s*[45]\d\d/))
    return isHu ? 'A swap API átmenetileg nem elérhető, próbálja újra.' : 'Swap API temporarily unavailable, please retry.';
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
  if (vaultReady) swapRow.style.display = isSwapSupported(currentNetwork.chainId) ? '' : 'none';
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

// ── Self-healing watchdog ─────────────────────────────────────────────────
// Catches any unhandled promise rejection or JS error that slipped past
// feature-level try/catch blocks, resets stuck UI, and offers a one-click
// restart so the app never stays frozen.

const _MANAGED_ERRORS = [
  'WORKER_COOLDOWN', 'BIO_MISMATCH', 'VAULT_CORRUPTED', 'FE_DECODE_FAIL', 'CAMERA_UNAVAILABLE',
  'GENESIS_MISMATCH', 'GENESIS_DECODE_FAIL', 'GENESIS_BACKUP_UNAVAILABLE',
  'TX_MISMATCH', 'VAULT_ID_MISMATCH', 'ALREADY_CONSUMED', 'EXPIRED',
  'NO_TOKEN', 'no.file', 'AbortError', 'NotAllowedError', 'NotFoundError',
  'ResizeObserver', 'Script error'
];

function _isManagedError(msg) {
  return _MANAGED_ERRORS.some(k => (msg || '').includes(k));
}

function _showSelfHealToast(detail) {
  document.getElementById('_self_heal_toast')?.remove();
  const toast = document.createElement('div');
  toast.id = '_self_heal_toast';
  toast.style.cssText = [
    'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%)',
    'background:#1a1a2e;border:1px solid #ff4757;border-radius:12px',
    'padding:0.9rem 1.2rem;z-index:9999',
    'display:flex;align-items:center;gap:0.9rem;max-width:92vw',
    'box-shadow:0 4px 24px rgba(0,0,0,0.45)'
  ].join(';');
  toast.innerHTML = `
    <div style="color:#ff4757;font-size:1.1rem;flex-shrink:0">&#9888;</div>
    <div style="flex:1;min-width:0">
      <div style="color:#e8e8f0;font-size:0.88rem;font-weight:600">${t('err.self.heal.title')}</div>
      <div style="color:#888;font-size:0.74rem;margin-top:0.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${detail}">${detail}</div>
    </div>
    <button id="_self_heal_btn" style="background:#ff4757;color:#fff;border:none;border-radius:8px;padding:0.45rem 0.9rem;cursor:pointer;font-size:0.82rem;font-weight:600;white-space:nowrap;flex-shrink:0">${t('btn.self.heal.restart')}</button>
  `;
  document.body.appendChild(toast);
  document.getElementById('_self_heal_btn').addEventListener('click', () => location.reload(), { once: true });
  setTimeout(() => toast.remove(), 30000);
}

function _selfHealReset() {
  setScanning(false);
  btnScan.disabled         = false;
  btnEnroll.disabled       = false;
  btnImportEnroll.disabled = false;
}

// Scan watchdog — resets stuck scanning state after 40 s
{
  let _wdStart = 0;
  setInterval(() => {
    const scanning = faceGuide.classList.contains('scanning');
    if (scanning && !_wdStart)             _wdStart = Date.now();
    else if (!scanning)                     _wdStart = 0;
    else if (Date.now() - _wdStart > 40000) {
      _wdStart = 0;
      _selfHealReset();
      setMsg(t('err.scan.timeout'), 'error');
    }
  }, 5000);
}

// Camera freeze detector — video.currentTime must advance every 4 s when stream is live
{
  let _lastCamTime = 0;
  let _frozenTicks = 0;
  const _CAM_CHECK_MS  = 4000;
  const _CAM_MAX_FROZEN = 2; // 2 ticks (~8 s) before restart attempt

  setInterval(async () => {
    // Skip if scanning or camera intentionally off
    if (faceGuide.classList.contains('scanning')) { _frozenTicks = 0; return; }
    if (!stream || !video.srcObject) { _frozenTicks = 0; _lastCamTime = 0; return; }

    // Only check when stream reports live and video has data
    const isLive = stream.getTracks().some(t => t.readyState === 'live');
    if (!isLive || video.readyState < 2 || video.currentTime === 0) return;

    if (video.currentTime === _lastCamTime) {
      _frozenTicks++;
      if (_frozenTicks >= _CAM_MAX_FROZEN) {
        _frozenTicks = 0;
        _lastCamTime = 0;
        // Silent restart attempt
        try {
          _stopCamera();
          stream = await openCamera(video, () => {});
          // success — no message, seamless recovery
        } catch {
          _showSelfHealToast('Camera frozen');
        }
      }
    } else {
      _frozenTicks = 0;
      _lastCamTime = video.currentTime;
    }
  }, _CAM_CHECK_MS);
}

window.addEventListener('unhandledrejection', e => {
  const msg = e.reason?.message || String(e.reason ?? 'Unknown');
  if (_isManagedError(msg)) return;
  e.preventDefault();
  _selfHealReset();
  _showSelfHealToast(msg.slice(0, 120));
});

window.addEventListener('error', e => {
  if (_isManagedError(e.message)) return;
  _showSelfHealToast((e.message || 'Script error').slice(0, 120));
});
