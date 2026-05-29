/**
 * BioWallet — App Controller (Phase 5)
 *
 * Kripto: vault_worker.js (Worker szál) — main thread nem látja a kulcsot.
 * EIP-1559: getFeeData() + estimateGas() — pontos gasbecslés.
 * Megerősítés: küldés előtt TX overlay.
 */

import { openCamera, enrollEmbedding, captureEmbedding } from '../core/bio_capture.js?v=11';
import {
  NETWORKS, getBalance, getNonce,
  getFeeData, estimateGas, broadcastTx,
  ethToWei, weiToEth, isValidAddress, resolveENS,
  getTokenBalance, formatToken, fetchTxHistory,
} from '../core/rpc.js?v=16';

// ── Worker init ───────────────────────────────────────────────────────────

const worker  = new Worker('./vault_worker.js?v=18', { type: 'module' });
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
const txHistoryCard  = document.getElementById('tx-history-card');
const txHistoryList  = document.getElementById('tx-history-list');
const btnQR          = document.getElementById('btn-qr');
const qrWrap         = document.getElementById('qr-wrap');
const qrCanvas       = document.getElementById('qr-canvas');
const ensHint        = document.getElementById('ens-hint');

const dots = [0,1,2,3,4].map(i => document.getElementById(`dot-${i}`));

// ── State ─────────────────────────────────────────────────────────────────
let stream         = null;
let timerID        = null;
let currentNetwork = NETWORKS.sepolia;
let vaultReady     = false;   // worker-ben van-e aktív vault
let ensResolved    = null;    // ENS → ETH cím (ha feloldva)
let inCooldown     = false;   // brute-force védelem aktív

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
    setScanning(false, true);
    setMsg('Vault nyitva.', 'ok');
    showPanel('vault');
  } catch (e) {
    setScanning(false);
    if (e.message.includes('BIO_MISMATCH')) bioFail();
    setMsg(friendlyError(e.message) + bioFailHint(), 'error');
    btnScan.disabled = false;
  }
});

// ── ETH küldése ───────────────────────────────────────────────────────────
btnSign.addEventListener('click', async () => {
  const toAddr    = ensResolved || sendToInput.value.trim();
  const amountStr = sendAmountInput.value.trim().replace(',', '.');
  const address   = ethAddress.textContent;

  // Input validáció
  if (!isValidAddress(toAddr)) {
    sendToInput.classList.add('error');
    setMsg('Érvénytelen Ethereum cím.', 'error');
    return;
  }
  sendToInput.classList.remove('error');

  let valueWei;
  try {
    valueWei = ethToWei(amountStr);
    if (valueWei <= 0n) throw new Error();
  } catch {
    sendAmountInput.classList.add('error');
    setMsg('Érvénytelen összeg (pl.: 0.001).', 'error');
    return;
  }
  sendAmountInput.classList.remove('error');

  // Egyenleg-ellenőrzés
  setMsg('Hálózati adatok lekérdezése...', '');
  let nonce, feeData, gasLimit;
  try {
    [nonce, feeData] = await Promise.all([
      getNonce(address, currentNetwork.rpc),
      getFeeData(currentNetwork.rpc),
    ]);
    gasLimit = await estimateGas(
      { from: address, to: toAddr, value: valueWei },
      currentNetwork.rpc
    );
    const gasCost = gasLimit * feeData.maxFeePerGas;
    const totalWei = valueWei + gasCost;
    const balanceEth = parseFloat(ethBalance.textContent);
    const totalEth   = Number(totalWei) / 1e18;
    if (totalEth > balanceEth + 0.000001) {
      setMsg(`Elégtelen egyenleg. Kell: ~${totalEth.toFixed(6)} ETH (összeg + gas).`, 'error');
      return;
    }
  } catch (e) {
    setMsg(`Hálózati hiba: ${e.message}`, 'error');
    return;
  }

  // Megerősítő overlay
  const gasCostEth = weiToEth(gasLimit * feeData.maxFeePerGas);
  const confirmed  = await showConfirm({
    to:      toAddr,
    amount:  amountStr + ' ETH',
    gas:     `~${gasCostEth} ETH`,
    network: currentNetwork.name,
  });
  if (!confirmed) {
    setMsg('Küldés megszakítva.', '');
    return;
  }

  // Arc-scan + aláírás (Worker)
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
        to:                   toAddr,
        value:                valueWei.toString(),     // BigInt → string (strukturált klónozás)
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

    // Auto-zárolás
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

  await Promise.allSettled(tokens.map(async tok => {
    try {
      const raw = await getTokenBalance(tok.address, address, currentNetwork.rpc);
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
    txHistoryCard.style.display = 'none';
    txHistoryList.innerHTML     = '';
    ensResolved                 = null;
    ensHint.style.display   = 'none';
    qrWrap.style.display    = 'none';
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
