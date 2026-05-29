/**
 * BioWallet — App Controller (Phase 5)
 *
 * Kripto: vault_worker.js (Worker szál) — main thread nem látja a kulcsot.
 * EIP-1559: getFeeData() + estimateGas() — pontos gasbecslés.
 * Megerősítés: küldés előtt TX overlay.
 */

import { openCamera, enrollEmbedding, captureEmbedding } from '../core/bio_capture.js?v=11';
import {
  WC_PROJECT_ID, initWC, wcPair, wcApprove, wcRejectProposal,
  wcRespondOk, wcRespondError, wcGetSessions, wcDisconnect, wcReady,
} from '../core/wc2.js';
import {
  NETWORKS, getBalance, getNonce,
  getFeeData, estimateGas, broadcastTx,
  ethToWei, weiToEth, isValidAddress, resolveENS,
  getTokenBalance, formatToken, fetchTxHistory,
  tokenToRaw, encodeTransfer,
} from '../core/rpc.js?v=20';

// ── Worker init ───────────────────────────────────────────────────────────

const worker  = new Worker('./vault_worker.js?v=20', { type: 'module' });
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

const dots = [0,1,2,3,4].map(i => document.getElementById(`dot-${i}`));

// ── State ─────────────────────────────────────────────────────────────────
let stream            = null;
let timerID           = null;
let currentNetwork    = NETWORKS.sepolia;
let vaultReady        = false;      // worker-ben van-e aktív vault
let ensResolved       = null;       // ENS → ETH cím (ha feloldva)
let inCooldown        = false;      // brute-force védelem aktív
let selectedToken       = null;       // null=ETH, egyéb={ symbol,address,decimals }
const tokenBalanceCache = new Map(); // symbol → raw BigInt
let pendingWCReq        = null;       // { topic, id, params } — WC kérés vault-lock esetén

// ── Init ──────────────────────────────────────────────────────────────────
(async () => {
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.register('/app/sw.js').catch(() => {});

  try {
    stream = await openCamera(video, m => setMsg(m, ''));
  } catch (e) {
    setMsg(`Kamera hiba: ${e.message}`, 'error');
  }

  const stored = localStorage.getItem('biowallet_meta');
  if (stored) {
    try {
      const meta = JSON.parse(stored);
      if (meta.P?.version === 'p1') {
        localStorage.clear();
        showPanel('setup');
        setMsg('Elavult vault formátum — regisztráljon újra.', 'error');
      } else {
        await callWorker('INIT_VAULT', { vaultId: meta.vaultId });
        vaultReady = true;
        showPanel('lock');
        setMsg('Vault betöltve — arc-scan a megnyitáshoz.', '');
      }
    } catch {
      localStorage.clear();
      showPanel('setup');
      setMsg('Sérült mentés — hozzon létre új walletot.', 'error');
    }
  } else {
    showPanel('setup');
    setMsg('Első indítás — hozzon létre walletot.', '');
  }

  startTimer();
  showVersionHash(); // non-blocking
})();

// ── Brute-force védelem (C5) ──────────────────────────────────────────────
const BF_AFTER = 3;    // mismatch darabszám, ami után cooldown indul
const BF_BASE  = 30;   // alap cooldown másodpercben

function _bfGet() {
  try { return JSON.parse(localStorage.getItem('biowallet_bf') ?? 'null') ?? { n: 0, until: 0 }; }
  catch { return { n: 0, until: 0 }; }
}

function bioFail() {
  const s = _bfGet();
  s.n++;
  if (s.n % BF_AFTER === 0) {
    const mult = Math.min(2 ** (s.n / BF_AFTER - 1), 8); // 30s → 60s → 120s → 240s (max)
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
  return s.n > 0 && left < BF_AFTER ? ` · még ${left} próba a zárolásig` : '';
}

// ── Verzió hash (Phase 9.1e) — verifiable build fingerprint ──────────────
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
    el.title = 'Kattints a részletekért · SHA-256 ellenőrzés';

    el.addEventListener('click', () => {
      const existing = document.getElementById('hash-detail-box');
      if (existing) { existing.remove(); return; }

      const box = document.createElement('div');
      box.id = 'hash-detail-box';
      box.style.cssText = [
        'position:fixed', 'bottom:3.5rem', 'left:50%', 'transform:translateX(-50%)',
        'background:#16161a', 'border:1px solid #2a2a35', 'border-radius:12px',
        'padding:1rem 1.2rem', 'font-family:monospace', 'font-size:0.68rem',
        'color:#e8e8f0', 'white-space:pre', 'z-index:999', 'line-height:1.8',
        'box-shadow:0 8px 32px rgba(0,0,0,0.7)', 'max-width:calc(100vw - 2rem)',
        'overflow-x:auto',
      ].join(';');

      const lines = results.map(r =>
        `${r.name.padEnd(22)} ${r.hex.slice(0, 16)}…`
      ).join('\n');
      box.textContent =
        `SHA-256 Build Fingerprint\n${'─'.repeat(40)}\n${lines}\n\nCombined: ${fp}`;

      document.body.appendChild(box);
      setTimeout(() => box.remove(), 10000);
    });

    footer.appendChild(el);
  } catch { /* offline vagy fetch hiba — hash nem jelenik meg */ }
}

// ── Enrollment ────────────────────────────────────────────────────────────
btnEnroll.addEventListener('click', async () => {
  btnEnroll.disabled = true;
  setScanning(true);
  enrollDots.style.display = 'flex';
  setMsg('Tartsa arcát a keretben...', '');

  try {
    const embedding = await enrollEmbedding(video, (n) => {
      dots.forEach((d, i) => d.classList.toggle('done', i < n));
      setMsg(`Beolvasás ${n}/5...`, '');
    });

    const { vaultId, P, encryptedVault } = await callWorker(
      'ENROLL', { embedding }, [embedding.buffer]
    );

    localStorage.setItem('biowallet_meta', JSON.stringify({ vaultId, P }));
    downloadBlob(encryptedVault, `${vaultId}.biowallet`);
    downloadBlob(JSON.stringify(P), `${vaultId}.P.json`);

    vaultReady = true;
    setScanning(false);
    enrollDots.style.display = 'none';
    setMsg('Wallet létrehozva! Mentse el a letöltött fájlokat.', 'ok');
    showPanel('lock');
  } catch (e) {
    setScanning(false);
    enrollDots.style.display = 'none';
    setMsg(e.message, 'error');
    btnEnroll.disabled = false;
  }
});

// ── Papírképlet megjelenítő modal (nyomtatható) ──────────────────────────
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
                    text-transform:uppercase;margin-bottom:0.3rem;">2 LÉPÉSES FOLYAMAT — 1. LÉPÉS</div>
        <div style="font-size:1.05rem;font-weight:700;color:#e8e8f0;margin-bottom:0.3rem;">
          BioWallet — Papír Recovery (Nyers adatok)
        </div>
        <div style="font-size:0.78rem;color:#6b6b80;margin-bottom:0.8rem;line-height:1.5;">
          Írja le mindkét papírt, majd folytassa a <strong>recovery_tool.html ENCODE</strong>
          módban — ott adja meg P-jét, és kapja meg a <strong>Végleges Papír A-t</strong>.
        </div>

        <!-- Figyelmeztetés -->
        <div style="font-size:0.78rem;color:#ff4757;background:rgba(255,71,87,0.08);
                    border:1px solid rgba(255,71,87,0.4);border-radius:8px;
                    padding:0.6rem 0.8rem;margin-bottom:0.8rem;line-height:1.5;">
          ⚠ Ez a NYERS Papír A — P-vel <strong>még nem véglegesítve</strong>!
          Ne tárolja véglegesen — a 2. lépés után semmisítse meg és csak a Végleges Papír A-t őrizze.
        </div>

        <!-- Nyers Paper A: raw_A_j -->
        <div class="paper-section" style="background:#1e1e24;border:1px solid #3a2a00;
                                          border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
          <div style="font-size:0.8rem;font-weight:700;color:#ffa502;margin-bottom:0.6rem;">
            NYERS PAPÍR A · (raw_A_j) — ideiglenes!
          </div>
          <div class="paper-grid">${rows(rawA)}</div>
        </div>

        <div class="paper-cut">✂  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  ✂</div>

        <!-- Paper B: r_j -->
        <div class="paper-section" style="background:#1e1e24;border:1px solid #2a2a35;
                                          border-radius:10px;padding:1rem;margin-bottom:0.8rem;">
          <div style="font-size:0.8rem;font-weight:700;color:#4CAF50;margin-bottom:0.6rem;">
            PAPÍR B · Eltolások (r_j)
          </div>
          <div class="paper-grid">${rows(r)}</div>
        </div>

        <div class="paper-cut">✂  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  ✂</div>

        <!-- 2. lépés útmutató -->
        <div class="paper-section" style="background:#0d1a2b;border:1px solid #1a3a5c;
                                          border-radius:10px;padding:1rem;margin-bottom:0.8rem;
                                          font-size:0.78rem;line-height:1.6;color:#e8e8f0;">
          <div style="font-weight:700;color:#6c63ff;margin-bottom:0.5rem;">
            2. LÉPÉS — Véglegesítés (offline)
          </div>
          <ol style="padding-left:1.3rem;margin-bottom:0.5rem;">
            <li>Nyissa meg a <strong>recovery_tool.html</strong> oldalt <strong>offline</strong> (internet lekapcsolva)</li>
            <li>Válassza az <strong>ENCODE</strong> fület</li>
            <li>Írja be a Nyers Papír A számait + a fejben tartott <strong>P-jét</strong></li>
            <li>A kapott <strong>Végleges Papír A-t</strong> nyomtassa ki és tárolja a Papír B-vel KÜLÖN helyen</li>
            <li>Semmisítse meg a Nyers Papír A-t</li>
          </ol>
          <p style="color:#4CAF50;font-size:0.74rem;">
            ✓ A BioWallet soha nem tudja meg a P értékét — csak Ön és a recovery_tool.html offline kombinálhatja.
          </p>
        </div>

        <div class="no-print" style="display:flex;gap:0.75rem;margin-top:1rem;">
          <button id="_paper_print" style="flex:1;padding:0.75rem;border-radius:10px;
            border:none;background:#6c63ff;color:#fff;
            font-size:0.9rem;font-weight:600;cursor:pointer;">🖨 Nyomtatás</button>
          <button id="_paper_close" style="flex:1;padding:0.75rem;border-radius:10px;
            border:1px solid #ff4757;background:#2b0a0a;color:#ff4757;
            font-size:0.9rem;font-weight:600;cursor:pointer;">Bezárás · memória törlése</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#_paper_print').onclick = () => window.print();
    overlay.querySelector('#_paper_close').onclick = () => { overlay.remove(); resolve(); };
  });
}

// ── Wallet váltás (lock panelről → setup) ────────────────────────────────
btnSwitchWallet.addEventListener('click', () => {
  if (!confirm('A jelenlegi wallet törlődik ebből a böngészőből.\nA .biowallet fájl megmarad — bármikor újra betölthető.\n\nFolytatja?')) return;
  localStorage.clear();
  vaultReady = false;
  callWorker('LOCK').catch(() => {});
  showPanel('setup');
  setMsg('Hozzon létre új walletot vagy importáljon meglévőt.', '');
});

// ── Meglévő wallet visszaállítása (.P.json fájlból) ──────────────────────
btnRestore.addEventListener('click', async () => {
  try {
    const pFile = await pickFile('.json,application/json');
    const text  = await pFile.text();
    const P     = JSON.parse(text);

    if (!P.version || !['p2', 'p3'].includes(P.version)) {
      setMsg('Érvénytelen .P.json fájl (rossz verzió).', 'error');
      return;
    }
    if (!P.W_seed || !P.syndrome) {
      setMsg('Érvénytelen .P.json fájl (hiányzó BCH adat).', 'error');
      return;
    }

    // .biowallet fájlnévből vaultId — vagy generálunk INIT-hez
    // (a .P.json önmagában nem tartalmazza a vaultId-t, csak a BCH helper-t)
    // A valódi vaultId csak a .biowallet visszafejtésekor derül ki — addig
    // egy ideiglenes id-t használunk.
    const vaultId = pFile.name.replace(/\.P\.json$/i, '').replace(/^.*[/\\]/, '');

    localStorage.setItem('biowallet_meta', JSON.stringify({ vaultId, P }));
    await callWorker('INIT_VAULT', { vaultId });
    vaultReady = true;
    showPanel('lock');
    setMsg('Wallet visszaállítva — arc-scan + .biowallet a megnyitáshoz.', 'ok');
  } catch (e) {
    setMsg(`Visszaállítás hiba: ${e.message}`, 'error');
  }
});

// ── Import ────────────────────────────────────────────────────────────────
btnImport.addEventListener('click', () => {
  importPhrase.value = '';
  showPanel('import');
  setMsg('Adja meg a 24 szavas seed phrase-t.', '');
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
    setMsg(`${words.length} szót adott meg — pontosan 24 szó szükséges.`, 'error');
    return;
  }

  // Szavak azonnal törlése — ne legyenek a képernyőn a scan alatt
  importPhrase.value = '';
  importPhrase.blur();

  btnImportEnroll.disabled = true;
  setScanning(true);
  enrollDots.style.display = 'flex';
  setMsg('Tartsa arcát a keretben — biometriai regisztráció...', '');

  try {
    const embedding = await enrollEmbedding(video, (n) => {
      dots.forEach((d, i) => d.classList.toggle('done', i < n));
      setMsg(`Beolvasás ${n}/5...`, '');
    });

    const { vaultId, P, encryptedVault } = await callWorker(
      'IMPORT', { mnemonic: words.join(' '), embedding }, [embedding.buffer]
    );

    localStorage.setItem('biowallet_meta', JSON.stringify({ vaultId, P }));
    downloadBlob(encryptedVault, `${vaultId}.biowallet`);
    downloadBlob(JSON.stringify(P), `${vaultId}.P.json`);

    vaultReady = true;
    setScanning(false);
    enrollDots.style.display = 'none';
    setMsg('Wallet importálva! Mentse el a letöltött fájlokat.', 'ok');
    showPanel('lock');
    await showPostImportChecklist();
  } catch (e) {
    setScanning(false);
    enrollDots.style.display = 'none';
    importPhrase.value = '';
    setMsg(friendlyError(e.message), 'error');
    btnImportEnroll.disabled = false;
  }
});

// ── Post-import ellenőrzési lista ─────────────────────────────────────────
function showPostImportChecklist() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:2000;
      display:flex;align-items:flex-start;justify-content:center;
      padding:1rem;overflow-y:auto;
    `;

    const steps = [
      ['Nyissa meg arc-scannel → ellenőrizze, hogy az ETH cím egyezik az eredeti tárcájával.', false],
      ['Generáljon papír biztonsági mentést (Papírképlet gomb → recovery_tool.html ENCODE offline).', false],
      ['Ha a papír backup kész és ellenőrzött: törölje az eredeti seed phrase papírját.', false],
      ['Deaktiválja / törölje az eredeti tárcát (MetaMask / Ledger).', false],
    ];

    const stepHtml = steps.map(([text], i) => `
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
          IMPORT SIKERES
        </div>
        <div style="font-size:1rem;font-weight:700;color:#e8e8f0;margin-bottom:0.3rem;">
          Következő lépések
        </div>
        <div style="font-size:0.76rem;color:#6b6b80;margin-bottom:1rem;line-height:1.5;">
          A wallet biometriailag titkosítva tárolódik. Javasolt sorrendben hajtsa végre:
        </div>
        <div style="border:1px solid #2a2a35;border-radius:10px;overflow:hidden;
                    margin-bottom:1rem;">
          ${stepHtml}
        </div>
        <div style="font-size:0.72rem;color:#ffa502;background:rgba(255,165,2,0.07);
                    border-left:2px solid #ffa502;padding:0.5rem 0.7rem;
                    border-radius:0 6px 6px 0;margin-bottom:1rem;line-height:1.5;">
          ⚠ Az eredeti seed phrase-t csak akkor törölje, ha a papír biztonsági mentés elkészült
          és ellenőrzött. Visszaút nincs.
        </div>
        <button id="_postimport_ok"
                style="width:100%;padding:0.85rem;border-radius:10px;border:none;
                       background:#6c63ff;color:#fff;font-size:0.9rem;
                       font-weight:600;cursor:pointer;">
          Értettem — bezárás
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

// ── Megnyitás ─────────────────────────────────────────────────────────────
btnScan.addEventListener('click', async () => {
  if (cooldownMs() > 0) return;
  btnScan.disabled = true;
  setScanning(true);
  setMsg('Arc-scan folyamatban...', '');

  try {
    const meta      = JSON.parse(localStorage.getItem('biowallet_meta'));
    const vaultFile = await pickFile('.biowallet');
    const embedding = await captureEmbedding(video);

    await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);
    bioSuccess();

    const encBuf = await vaultFile.arrayBuffer();
    const { address } = await callWorker('OPEN', { encryptedVault: encBuf, P: meta.P }, [encBuf]);

    ethAddress.textContent = address;
    fetchBalance(address);
    updateTokenSelector();
    setScanning(false, true);
    setMsg('Vault nyitva.', 'ok');
    showPanel('vault');
    ensureWCInit().catch(() => {});
    if (pendingWCReq) {
      const req = pendingWCReq;
      pendingWCReq = null;
      dispatchWCRequest(req.topic, req.id, req.params).catch(() => {});
    }
  } catch (e) {
    setScanning(false);
    if (e.message.includes('BIO_MISMATCH')) bioFail();
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
    btnScan.disabled = false;
  }
});

// ── ETH / ERC-20 küldése ─────────────────────────────────────────────────
btnSign.addEventListener('click', async () => {
  if (cooldownMs() > 0) return;

  const recipient = ensResolved || sendToInput.value.trim();
  const amountStr = sendAmountInput.value.trim().replace(',', '.');
  const address   = ethAddress.textContent;

  if (!isValidAddress(recipient)) {
    sendToInput.classList.add('error');
    setMsg('Érvénytelen Ethereum cím.', 'error');
    return;
  }
  sendToInput.classList.remove('error');

  // ── TX paraméterek (ETH vagy ERC-20 ág) ──────────────────────────────
  let txTo = recipient, txValue = 0n, txData = '0x', confirmAmount;

  if (!selectedToken) {
    // ETH küldés
    try {
      txValue = ethToWei(amountStr);
      if (txValue <= 0n) throw new Error();
    } catch {
      sendAmountInput.classList.add('error');
      setMsg('Érvénytelen összeg (pl.: 0.001).', 'error');
      return;
    }
    confirmAmount = amountStr + ' ETH';
  } else {
    // ERC-20 küldés
    let tokenAmount;
    try {
      tokenAmount = tokenToRaw(amountStr, selectedToken.decimals);
      if (tokenAmount <= 0n) throw new Error();
    } catch {
      sendAmountInput.classList.add('error');
      setMsg(`Érvénytelen összeg (pl.: 1.5).`, 'error');
      return;
    }
    const cachedBal = tokenBalanceCache.get(selectedToken.symbol) ?? 0n;
    if (tokenAmount > cachedBal) {
      setMsg(`Elégtelen ${selectedToken.symbol} egyenleg.`, 'error');
      return;
    }
    txTo          = selectedToken.address;
    txData        = encodeTransfer(recipient, tokenAmount);
    confirmAmount = `${amountStr} ${selectedToken.symbol}`;
  }
  sendAmountInput.classList.remove('error');

  // ── Hálózati díjak + gas ──────────────────────────────────────────────
  setMsg('Hálózati adatok lekérdezése...', '');
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
    const ethNeeded  = txValue + gasCost;   // token küldésnél txValue=0n → csak gas
    const balanceEth = parseFloat(ethBalance.textContent);
    if (Number(ethNeeded) / 1e18 > balanceEth + 0.000001) {
      const hint = selectedToken
        ? `Gas díjhoz ~${weiToEth(gasCost)} ETH szükséges.`
        : `Kell: ~${(Number(ethNeeded) / 1e18).toFixed(6)} ETH (összeg + gas).`;
      setMsg(`Elégtelen ETH egyenleg. ${hint}`, 'error');
      return;
    }
  } catch (e) {
    setMsg(`Hálózati hiba: ${e.message}`, 'error');
    return;
  }

  // ── Megerősítő overlay ────────────────────────────────────────────────
  const confirmed = await showConfirm({
    to:      recipient,
    amount:  confirmAmount,
    gas:     `~${weiToEth(gasLimit * feeData.maxFeePerGas)} ETH`,
    network: currentNetwork.name,
  });
  if (!confirmed) { setMsg('Küldés megszakítva.', ''); return; }

  // ── Arc-scan + aláírás ────────────────────────────────────────────────
  if (cooldownMs() > 0) return;
  btnSign.disabled = true;
  setScanning(true);
  setMsg('Arc-scan az aláíráshoz (10 mp ablak)...', '');

  try {
    const meta      = JSON.parse(localStorage.getItem('biowallet_meta'));
    const embedding = await captureEmbedding(video);
    await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);
    bioSuccess();

    const { signed } = await callWorker('SIGN', {
      tx: {
        to:                   txTo,
        value:                txValue.toString(),
        data:                 txData,
        nonce,
        gasLimit:             gasLimit.toString(),
        chainId:              currentNetwork.chainId,
        maxFeePerGas:         feeData.maxFeePerGas.toString(),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas.toString(),
      },
    });

    setScanning(false);
    setMsg('Broadcast folyamatban...', '');

    const txHash = await broadcastTx(signed, currentNetwork.rpc);

    txResult.style.display = 'block';
    txLink.href        = currentNetwork.explorer + txHash;
    txLink.textContent = txHash;
    setMsg(`Küldés sikeres! TX: ${txHash.slice(0,10)}…`, 'ok');

    setTimeout(async () => {
      await callWorker('LOCK');
      ethAddress.textContent = '—';
      ethBalance.textContent = '—';
      setScanning(false);
      setMsg('Vault zárolva. Privát kulcs törölve.', '');
      showPanel('lock');
    }, 5000);

  } catch (e) {
    setScanning(false);
    if (e.message.includes('BIO_MISMATCH')) bioFail();
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
    btnSign.disabled = false;
  }
});

// ── Papírképlet (Phase 9.1b — P soha nem kerül az app-ba) ────────────────
btnPaper.addEventListener('click', async () => {
  if (cooldownMs() > 0) return;
  setScanning(true);
  setMsg('Arc-scan a papírképlet generálásához (5 mp ablak)...', '');

  try {
    const meta      = JSON.parse(localStorage.getItem('biowallet_meta'));
    const embedding = await captureEmbedding(video);
    await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);
    bioSuccess();

    const { rawA, r } = await callWorker('RECOVERY_FORMULA', {});

    setScanning(false);
    await showRecoveryPaperModal(rawA, r);
    setMsg('Papírképlet generálva. Vault zárolva.', 'ok');
    showPanel('lock');
  } catch (e) {
    setScanning(false);
    if (e.message.includes('BIO_MISMATCH')) bioFail();
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
  }
});

// ── Zárolás ───────────────────────────────────────────────────────────────
btnLock.addEventListener('click', async () => {
  await callWorker('LOCK');
  ethAddress.textContent = '—';
  ethBalance.textContent = '—';
  setScanning(false);
  setMsg('Vault zárolva. Privát kulcs törölve.', '');
  showPanel('lock');
});

// ── Cím másolása ──────────────────────────────────────────────────────────
btnCopy.addEventListener('click', async () => {
  const addr = ethAddress.textContent;
  if (!addr || addr === '—') return;
  await navigator.clipboard.writeText(addr);
  btnCopy.textContent = '✓ Másolva!';
  setTimeout(() => { btnCopy.textContent = '⎘ Cím másolása'; }, 2000);
});

// ── Hálózat választó ──────────────────────────────────────────────────────
btnNetwork.addEventListener('click', () => {
  currentNetwork = currentNetwork === NETWORKS.sepolia ? NETWORKS.mainnet : NETWORKS.sepolia;
  btnNetwork.textContent = currentNetwork.name;
  btnNetwork.classList.toggle('mainnet', currentNetwork === NETWORKS.mainnet);
  updateTokenSelector();
  const addr = ethAddress.textContent;
  if (addr && addr !== '—') fetchBalance(addr);
});

// ── Egyenleg frissítése ───────────────────────────────────────────────────
btnRefresh.addEventListener('click', () => {
  const addr = ethAddress.textContent;
  if (addr && addr !== '—') fetchBalance(addr);
});

// ── QR kód toggle (C1) ────────────────────────────────────────────────────
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
  } catch { /* QR lib nem töltött be — offline PWA */ }
});

// ── WalletConnect gombok ──────────────────────────────────────────────────
btnWc.addEventListener('click', async () => {
  const uri = await showWCPairModal();
  if (!uri) return;
  try {
    await ensureWCInit();
    if (!wcReady()) return;
    await wcPair(uri);
    setMsg('WC párosítás folyamatban — várja a dApp jóváhagyási kérést...', '');
  } catch (e) {
    setMsg(`WC hiba: ${e?.message || e?.toString() || 'ismeretlen hiba'}`, 'error');
  }
});

btnWcDisc.addEventListener('click', async () => {
  const sessions = wcGetSessions();
  for (const s of sessions) await wcDisconnect(s.topic);
  updateWCBar();
  setMsg('WalletConnect kapcsolat bontva.', '');
});

// ── ENS feloldás (C3) — debounce 600ms ───────────────────────────────────
let _ensTimer = null;
sendToInput.addEventListener('input', () => {
  ensResolved = null;
  ensHint.style.display = 'none';
  clearTimeout(_ensTimer);
  const val = sendToInput.value.trim();
  if (!val.includes('.')) return;
  _ensTimer = setTimeout(async () => {
    ensHint.style.cssText = 'display:block;font-size:0.7rem;margin-top:0.3rem;color:#6b6b80;';
    ensHint.textContent = 'ENS feloldás…';
    const addr = await resolveENS(val);
    if (addr) {
      ensResolved = addr;
      ensHint.style.cssText = 'display:block;font-size:0.7rem;margin-top:0.3rem;color:#4CAF50;font-family:monospace;';
      ensHint.textContent = `→ ${addr}`;
    } else {
      ensResolved = null;
      ensHint.style.cssText = 'display:block;font-size:0.7rem;margin-top:0.3rem;color:#ff4757;';
      ensHint.textContent = 'ENS nem található';
    }
  }, 600);
});

// ERC-20 token lista — decimálisok hardcoded (nincs extra eth_call)
const TOKEN_LIST = {
  mainnet: [
    { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6  },
    { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6  },
    { symbol: 'WETH', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', decimals: 18 },
  ],
  sepolia: [
    { symbol: 'USDC', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6  },
    { symbol: 'WETH', address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', decimals: 18 },
  ],
};

async function fetchBalance(address) {
  try {
    ethBalance.textContent = '…';
    const bal = await getBalance(address, currentNetwork.rpc);
    ethBalance.textContent = bal + ' ETH';
  } catch {
    ethBalance.textContent = '?';
  }
  fetchTokenBalances(address);
  renderTxHistory(address);
}

async function renderTxHistory(address) {
  const networkKey = currentNetwork === NETWORKS.mainnet ? 'mainnet' : 'sepolia';
  txHistoryCard.style.display = 'block';
  txHistoryList.innerHTML =
    '<div style="font-size:0.75rem;color:var(--muted);padding:0.3rem 0;">…</div>';

  try {
    const txs = await fetchTxHistory(address, networkKey);
    txHistoryList.innerHTML = '';

    if (!txs.length) {
      txHistoryList.innerHTML =
        '<div style="font-size:0.75rem;color:var(--muted);padding:0.3rem 0;">Nincs tranzakció</div>';
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
      amount.textContent = (ok ? '' : '✗ ') + val + ' ETH';

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
      '<div style="font-size:0.75rem;color:var(--muted);padding:0.3rem 0;">Nem elérhető</div>';
  }
}

function txAge(ts) {
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60)    return `${Math.floor(s)}mp`;
  if (s < 3600)  return `${Math.floor(s / 60)}p`;
  if (s < 86400) return `${Math.floor(s / 3600)}ó`;
  return `${Math.floor(s / 86400)}n`;
}

async function fetchTokenBalances(address) {
  const key    = currentNetwork === NETWORKS.mainnet ? 'mainnet' : 'sepolia';
  const tokens = TOKEN_LIST[key] ?? [];
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
    } catch { /* ismeretlen token vagy RPC hiba — kihagyás */ }
  }));
}

// ── WalletConnect v2 ──────────────────────────────────────────────────────

async function ensureWCInit() {
  if (wcReady()) return;
  if (!WC_PROJECT_ID) {
    setMsg('WalletConnect Project ID nincs beállítva (src/core/wc2.js).', 'error');
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
    await wcApprove(proposal.id, address, currentNetwork.chainId);
    setMsg(`${meta.name ?? 'dApp'} csatlakoztatva.`, 'ok');
  } else {
    await wcRejectProposal(proposal.id);
    setMsg('WalletConnect kapcsolat elutasítva.', '');
  }
  updateWCBar();
}

async function handleWCRequest(event) {
  const { topic, id, params } = event;
  const method = params.request.method;

  // Ha vault zárolt: queue + üzenet
  if (ethAddress.textContent === '—') {
    pendingWCReq = event;
    setMsg(`Bejövő dApp kérés (${method}) — nyissa meg a vaultot az arc-scannel.`, 'ok');
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
  } else {
    await wcRespondError(topic, id, `Nem támogatott: ${method}`);
    setMsg(`dApp kérés elutasítva — ${method} nem támogatott.`, 'error');
  }
}

async function handleWCEthSend(topic, id, wcTx) {
  const address = ethAddress.textContent;
  if (cooldownMs() > 0) { await wcRespondError(topic, id, 'Cooldown aktív'); return; }

  setMsg('Hálózati adatok lekérdezése (dApp TX)...', '');
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

    const confirmed = await showConfirm({
      to:      txTo,
      amount:  weiToEth(txValue.toString()) + ' ETH',
      gas:     `~${weiToEth((gasLimit * feeData.maxFeePerGas).toString())} ETH`,
      network: currentNetwork.name + ' (dApp)',
    });
    if (!confirmed) { await wcRespondError(topic, id); setMsg('dApp TX elutasítva.', ''); return; }

    setScanning(true);
    setMsg('Arc-scan a dApp TX aláíráshoz...', '');
    const meta      = JSON.parse(localStorage.getItem('biowallet_meta'));
    const embedding = await captureEmbedding(video);
    await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);
    bioSuccess();

    const { signed } = await callWorker('SIGN', {
      tx: {
        to: wcTx.to, value: (BigInt(wcTx.value ?? '0x0')).toString(),
        data: wcTx.data ?? '0x', nonce,
        gasLimit: gasLimit.toString(), chainId: currentNetwork.chainId,
        maxFeePerGas: feeData.maxFeePerGas.toString(),
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas.toString(),
      },
    });
    setScanning(false);
    const txHash = await broadcastTx(signed, currentNetwork.rpc);
    await wcRespondOk(topic, id, txHash);
    setMsg(`dApp TX elküldve: ${txHash.slice(0,10)}…`, 'ok');
  } catch (e) {
    setScanning(false);
    if (e.message?.includes('BIO_MISMATCH')) bioFail();
    await wcRespondError(topic, id, e.message);
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
  }
}

async function handleWCPersonalSign(topic, id, hexMsg) {
  if (cooldownMs() > 0) { await wcRespondError(topic, id, 'Cooldown aktív'); return; }

  const approved = await showWCSignModal(hexMsg);
  if (!approved) { await wcRespondError(topic, id); return; }

  try {
    setScanning(true);
    setMsg('Arc-scan az üzenet aláíráshoz...', '');
    const meta      = JSON.parse(localStorage.getItem('biowallet_meta'));
    const embedding = await captureEmbedding(video);
    await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);
    bioSuccess();
    const { signature } = await callWorker('PERSONAL_SIGN', { message: hexMsg });
    setScanning(false);
    await wcRespondOk(topic, id, signature);
    setMsg('Üzenet aláírva.', 'ok');
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
        <div style="font-size:1rem;font-weight:700;color:#6c63ff;margin-bottom:0.8rem;">dApp kapcsolódás</div>
        <div style="font-size:0.78rem;color:#6b6b80;margin-bottom:0.8rem;line-height:1.5;">
          Nyissa meg a dApp-ot (pl. Uniswap), kattintson a <strong style="color:#e8e8f0">WalletConnect</strong> gombra,
          másolja a URI-t és illessze be ide.
        </div>
        <textarea id="_wc_uri" style="width:100%;background:#1e1e24;border:1px solid #2a2a35;border-radius:10px;
          padding:0.6rem;color:#e8e8f0;font-size:0.75rem;font-family:monospace;resize:vertical;min-height:70px;outline:none;"
          placeholder="wc:..."></textarea>
        <div id="_wc_err" style="font-size:0.72rem;color:#ff4757;margin-top:0.4rem;min-height:1em;"></div>
        <div style="display:flex;gap:0.75rem;margin-top:0.8rem;">
          <button id="_wc_cancel" style="flex:1;padding:0.7rem;border-radius:10px;border:1px solid #2a2a35;background:#1e1e24;color:#e8e8f0;font-size:0.85rem;font-weight:600;cursor:pointer;">Mégse</button>
          <button id="_wc_ok" style="flex:1;padding:0.7rem;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">Kapcsolódás</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_wc_cancel').onclick = () => { ov.remove(); resolve(null); };
    ov.querySelector('#_wc_ok').onclick = async () => {
      const uri = ov.querySelector('#_wc_uri').value.trim();
      if (!uri.startsWith('wc:')) {
        ov.querySelector('#_wc_err').textContent = 'Érvénytelen WC URI (wc:... formátum szükséges).'; return;
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
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#ffa502;margin-bottom:0.3rem;">dApp kapcsolódási kérés</div>
        <div style="font-size:1rem;font-weight:700;color:#e8e8f0;margin-bottom:0.25rem;">${meta.name ?? 'Ismeretlen dApp'}</div>
        <div style="font-size:0.75rem;color:#6b6b80;margin-bottom:0.25rem;">${meta.url ?? ''}</div>
        <div style="font-size:0.78rem;color:#a0a0b0;margin-bottom:1rem;line-height:1.5;">${meta.description ?? ''}</div>
        <div style="font-size:0.75rem;color:#6b6b80;padding:0.5rem 0.7rem;background:#1e1e24;border-radius:8px;margin-bottom:1rem;line-height:1.5;">
          A dApp olvasni fogja az Ethereum <strong style="color:#e8e8f0">címét</strong> és aláírási kéréseket küldhet.<br>
          <strong style="color:#4CAF50">Minden aláírás külön arc-scant igényel.</strong>
        </div>
        <div style="display:flex;gap:0.75rem;">
          <button id="_wc_reject" style="flex:1;padding:0.7rem;border-radius:10px;border:1px solid #5a2020;background:#2b0a0a;color:#ff4757;font-size:0.85rem;font-weight:600;cursor:pointer;">Elutasít</button>
          <button id="_wc_approve" style="flex:1;padding:0.7rem;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">Jóváhagy</button>
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
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#ffa502;margin-bottom:0.3rem;">Üzenet aláírási kérés</div>
        <div style="font-size:0.78rem;color:#6b6b80;margin-bottom:0.6rem;">A dApp az alábbi üzenetet kéri aláírni:</div>
        <div style="background:#1e1e24;border:1px solid #2a2a35;border-radius:8px;padding:0.7rem;
             font-family:monospace;font-size:0.75rem;color:#e8e8f0;word-break:break-all;
             max-height:120px;overflow-y:auto;margin-bottom:1rem;line-height:1.5;">${decoded}</div>
        <div style="display:flex;gap:0.75rem;">
          <button id="_wcs_reject" style="flex:1;padding:0.7rem;border-radius:10px;border:1px solid #5a2020;background:#2b0a0a;color:#ff4757;font-size:0.85rem;font-weight:600;cursor:pointer;">Elutasít</button>
          <button id="_wcs_sign" style="flex:1;padding:0.7rem;border-radius:10px;border:none;background:#6c63ff;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">Arc-scan + Aláír</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.querySelector('#_wcs_reject').onclick = () => { ov.remove(); resolve(false); };
    ov.querySelector('#_wcs_sign').onclick   = () => { ov.remove(); resolve(true); };
  });
}

function updateTokenSelector() {
  const key    = currentNetwork === NETWORKS.mainnet ? 'mainnet' : 'sepolia';
  const tokens = TOKEN_LIST[key] ?? [];
  tokenSelector.innerHTML = '';

  for (const tok of [{ symbol: 'ETH' }, ...tokens]) {
    const isEth    = tok.symbol === 'ETH';
    const isActive = isEth ? selectedToken === null : selectedToken?.symbol === tok.symbol;
    const btn      = document.createElement('button');
    btn.className  = 'token-pill' + (isActive ? ' active' : '');
    btn.textContent = tok.symbol;
    btn.addEventListener('click', () => {
      selectedToken = isEth ? null : tok;
      const label = selectedToken ? `${selectedToken.symbol} küldése` : 'ETH küldése';
      sendCardLabel.textContent = label;
      amountUnit.textContent    = selectedToken?.symbol ?? 'ETH';
      sendBtnLabel.textContent  = label;
      updateTokenSelector();
    });
    tokenSelector.appendChild(btn);
  }

  // Ha az aktuálisan kiválasztott token nem elérhető az új hálózaton
  if (selectedToken && !tokens.find(t => t.symbol === selectedToken.symbol)) {
    selectedToken = null;
    sendCardLabel.textContent = 'ETH küldése';
    amountUnit.textContent    = 'ETH';
    sendBtnLabel.textContent  = 'ETH küldése';
    updateTokenSelector();
  }
}

// ── Token timer (Worker STATUS polling) ───────────────────────────────────
function startTimer() {
  clearInterval(timerID);
  timerID = setInterval(async () => {
    // Cooldown ellenőrzés — vaultReady-től független
    const cd = cooldownMs();
    if (cd > 0) {
      inCooldown = true;
      btnScan.disabled = true;
      setMsg(`Brute-force védelem — ${Math.ceil(cd / 1000)}s`, 'error');
      return;
    }
    if (inCooldown) {
      inCooldown = false;
      btnScan.disabled = false;
      setMsg('Zárolás feloldva — próbálkozhat újra.', '');
      return;
    }

    if (!vaultReady) return;
    let s;
    try { s = await callWorker('STATUS'); } catch { return; }

    if (s.state === 'NO_TOKEN' || s.state === 'NO_VAULT') {
      tokenBadge.className  = 'token-badge';
      tokenText.textContent = 'ZÁROLT';
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

// ── Megerősítő overlay ────────────────────────────────────────────────────
function showConfirm({ to, amount, gas, network }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:2000;
      display:flex;align-items:center;justify-content:center;padding:1rem;
    `;
    overlay.innerHTML = `
      <div style="background:#16161a;border:1px solid #2a2a35;border-radius:16px;
                  width:100%;max-width:400px;padding:1.5rem;">
        <div style="font-size:1rem;font-weight:700;color:#6c63ff;margin-bottom:1rem;">
          Tranzakció megerősítése
        </div>
        <table style="width:100%;font-size:0.82rem;border-collapse:collapse;">
          <tr><td style="color:#6b6b80;padding:0.3rem 0;">Hálózat</td>
              <td style="color:#e8e8f0;text-align:right;">${network}</td></tr>
          <tr><td style="color:#6b6b80;padding:0.3rem 0;">Fogadó</td>
              <td style="color:#e8e8f0;text-align:right;font-family:monospace;font-size:0.72rem;word-break:break-all;">${to}</td></tr>
          <tr><td style="color:#6b6b80;padding:0.3rem 0;">Összeg</td>
              <td style="color:#4CAF50;text-align:right;font-weight:600;">${amount}</td></tr>
          <tr><td style="color:#6b6b80;padding:0.3rem 0;">Max. gas</td>
              <td style="color:#ffa502;text-align:right;">${gas}</td></tr>
        </table>
        <div style="display:flex;gap:0.75rem;margin-top:1.2rem;">
          <button id="_cancel" style="flex:1;padding:0.75rem;border-radius:10px;
            border:1px solid #2a2a35;background:#1e1e24;color:#e8e8f0;
            font-size:0.9rem;font-weight:600;cursor:pointer;">Mégse</button>
          <button id="_confirm" style="flex:1;padding:0.75rem;border-radius:10px;
            border:none;background:#6c63ff;color:#fff;
            font-size:0.9rem;font-weight:600;cursor:pointer;">Küldés</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#_cancel').onclick  = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('#_confirm').onclick = () => { overlay.remove(); resolve(true);  };
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
    sendCardLabel.textContent   = 'ETH küldése';
    amountUnit.textContent      = 'ETH';
    sendBtnLabel.textContent    = 'ETH küldése';
    tokenSelector.innerHTML     = '';
    ensResolved                 = null;
    ensHint.style.display   = 'none';
    qrWrap.style.display    = 'none';
    wcBar.classList.remove('visible');
  }
}

function setScanning(on, detected = false) {
  faceGuide.className = 'face-guide' + (on ? ' scanning' : detected ? ' detected' : '');
  scanHint.textContent = on
    ? 'Nézzen egyenesen a kamerába...'
    : 'Kész — nyomjon egy gombot';
}

function setMsg(text, type = '') {
  msg.textContent = text;
  msg.className   = 'msg-bar' + (type ? ' ' + type : '');
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
    inp.onchange = e => e.target.files[0] ? resolve(e.target.files[0]) : reject(new Error('Nem választott fájlt'));
    inp.click();
  });
}

// ── Hibaüzenet fordítás ───────────────────────────────────────────────────
function friendlyError(msg) {
  if (!msg) return 'Ismeretlen hiba.';
  if (msg.includes('BIO_MISMATCH'))
    return 'Az arc nem egyezik. Tipp: a tárcát abban a böngészőben nyissa meg, amelyikben létrehozta (Firefox ↔ Chrome eltérő képfeldolgozás).';
  if (msg.includes('EXPIRED'))
    return 'A biometriai token lejárt — próbálja újra.';
  if (msg.includes('NO_TOKEN'))
    return 'Nincs érvényes biometriai token — szkennelje be arcát.';
  if (msg.includes('VAULT_ID_MISMATCH'))
    return 'Rossz .biowallet fájl — ez nem az Ön tárcájához tartozik.';
  if (msg.includes('ALREADY_CONSUMED'))
    return 'A token már felhasználásra került — próbálja újra.';
  if (msg.toLowerCase().includes('invalid mnemonic') || msg.toLowerCase().includes('invalid phrase') || msg.toLowerCase().includes('invalid word'))
    return 'Érvénytelen seed phrase — ellenőrizze a szavakat és a sorrendet (BIP39 szólista).';
  return msg;
}

// ── Használati útmutató modal ─────────────────────────────────────────────
// Inline <script> és onclick attribútumok CSP script-src 'self' által blokkoltak —
// az event listener csak external module scriptből regisztrálható.
{
  const overlay  = document.getElementById('guide-modal');
  const btnOpen  = document.getElementById('btn-help');
  const btnClose = document.getElementById('btn-modal-close');

  btnOpen .addEventListener('click', ()  => overlay.classList.add('open'));
  btnClose.addEventListener('click', ()  => overlay.classList.remove('open'));
  overlay .addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('open'); });
  document.addEventListener('keydown',(e) => { if (e.key === 'Escape') overlay.classList.remove('open'); });
}
