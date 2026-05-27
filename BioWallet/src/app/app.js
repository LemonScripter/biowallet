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
  ethToWei, weiToEth, isValidAddress,
} from '../core/rpc.js?v=11';

// ── Worker init ───────────────────────────────────────────────────────────

const worker  = new Worker('./vault_worker.js?v=11', { type: 'module' });
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
const btnSwitchWallet = document.getElementById('btn-switch-wallet');
const btnImportEnroll= document.getElementById('btn-import-enroll');
const btnImportCancel= document.getElementById('btn-import-cancel');
const importPhrase   = document.getElementById('import-phrase');
const btnScan        = document.getElementById('btn-scan');
const btnSign        = document.getElementById('btn-sign');
const btnExport      = document.getElementById('btn-export');
const btnLock        = document.getElementById('btn-lock');
const btnCopy        = document.getElementById('btn-copy');
const btnNetwork     = document.getElementById('btn-network');
const btnRefresh     = document.getElementById('btn-refresh');

const ethBalance     = document.getElementById('eth-balance');
const sendToInput    = document.getElementById('send-to');
const sendAmountInput= document.getElementById('send-amount');
const txResult       = document.getElementById('tx-result');
const txLink         = document.getElementById('tx-link');

const dots = [0,1,2,3,4].map(i => document.getElementById(`dot-${i}`));

// ── State ─────────────────────────────────────────────────────────────────
let stream         = null;
let timerID        = null;
let currentNetwork = NETWORKS.sepolia;
let vaultReady     = false;   // worker-ben van-e aktív vault

// ── Init ──────────────────────────────────────────────────────────────────
(async () => {
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.getRegistrations()
      .then(rs => rs.forEach(r => r.unregister())).catch(() => {});

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
})();

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

// ── Seed megjelenítő modal (alert helyett — scrollable) ───────────────────
function showSeedModal(words) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.92);z-index:2000;
      display:flex;align-items:flex-start;justify-content:center;
      padding:1rem;overflow-y:auto;
    `;

    const grid = words.map((w, i) =>
      `<div style="display:flex;gap:0.5rem;align-items:baseline;padding:0.25rem 0;border-bottom:1px solid #1e1e24;">
        <span style="color:#6b6b80;font-size:0.72rem;width:1.8rem;text-align:right;flex-shrink:0;">${i+1}.</span>
        <span style="color:#e8e8f0;font-family:monospace;font-size:0.88rem;">${w}</span>
       </div>`
    ).join('');

    overlay.innerHTML = `
      <div style="background:#16161a;border:1px solid #ff4757;border-radius:16px;
                  width:100%;max-width:400px;margin:auto;padding:1.5rem;">
        <div style="color:#ff4757;font-size:0.72rem;font-weight:700;letter-spacing:0.08em;
                    text-transform:uppercase;margin-bottom:0.3rem;">BIZALMASAN</div>
        <div style="font-size:1rem;font-weight:700;color:#e8e8f0;margin-bottom:0.3rem;">
          BIP39 Seed Phrase (${words.length} szó)
        </div>
        <div style="font-size:0.78rem;color:#6b6b80;margin-bottom:1rem;">
          MetaMaskba importálható · Soha ne ossza meg senkivel
        </div>
        <div style="margin-bottom:1.2rem;">${grid}</div>
        <button id="_seed_close" style="width:100%;padding:0.75rem;border-radius:10px;
          border:1px solid #ff4757;background:#2b0a0a;color:#ff4757;
          font-size:0.9rem;font-weight:600;cursor:pointer;">
          Bezárás (a kulcs törlődik a memóriából)
        </button>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#_seed_close').onclick = () => { overlay.remove(); resolve(); };
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

    importPhrase.value = '';
    vaultReady = true;
    setScanning(false);
    enrollDots.style.display = 'none';
    setMsg('Wallet importálva! Mentse el a letöltött fájlokat.', 'ok');
    showPanel('lock');
  } catch (e) {
    setScanning(false);
    enrollDots.style.display = 'none';
    setMsg(friendlyError(e.message), 'error');
    btnImportEnroll.disabled = false;
  }
});

// ── Megnyitás ─────────────────────────────────────────────────────────────
btnScan.addEventListener('click', async () => {
  btnScan.disabled = true;
  setScanning(true);
  setMsg('Arc-scan folyamatban...', '');

  try {
    const meta      = JSON.parse(localStorage.getItem('biowallet_meta'));
    const vaultFile = await pickFile('.biowallet');
    const embedding = await captureEmbedding(video);

    await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);

    const encBuf = await vaultFile.arrayBuffer();
    const { address } = await callWorker('OPEN', { encryptedVault: encBuf, P: meta.P }, [encBuf]);

    ethAddress.textContent = address;
    fetchBalance(address);
    setScanning(false, true);
    setMsg('Vault nyitva.', 'ok');
    showPanel('vault');
  } catch (e) {
    setScanning(false);
    setMsg(friendlyError(e.message), 'error');
    btnScan.disabled = false;
  }
});

// ── ETH küldése ───────────────────────────────────────────────────────────
btnSign.addEventListener('click', async () => {
  const toAddr    = sendToInput.value.trim();
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
  btnSign.disabled = true;
  setScanning(true);
  setMsg('Arc-scan az aláíráshoz (10 mp ablak)...', '');

  try {
    const meta      = JSON.parse(localStorage.getItem('biowallet_meta'));
    const embedding = await captureEmbedding(video);
    await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);

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
    setMsg(e.message, 'error');
    btnSign.disabled = false;
  }
});

// ── Seed export ───────────────────────────────────────────────────────────
btnExport.addEventListener('click', async () => {
  setScanning(true);
  setMsg('Arc-scan a seed megjelenítéséhez (5 mp ablak)...', '');

  try {
    const meta      = JSON.parse(localStorage.getItem('biowallet_meta'));
    const embedding = await captureEmbedding(video);
    await callWorker('BIO_CAPTURE', { embedding, P: meta.P }, [embedding.buffer]);

    const { phrase } = await callWorker('EXPORT');
    const words = phrase.split(' ');

    setScanning(false);
    await showSeedModal(words);
    setMsg('Seed megjelenítve. Vault zárolva.', 'ok');
    showPanel('lock');
  } catch (e) {
    setScanning(false);
    setMsg(e.message, 'error');
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

async function fetchBalance(address) {
  try {
    ethBalance.textContent = '…';
    const bal = await getBalance(address, currentNetwork.rpc);
    ethBalance.textContent = bal + ' ETH';
  } catch {
    ethBalance.textContent = '?';
  }
}

// ── Token timer (Worker STATUS polling) ───────────────────────────────────
function startTimer() {
  clearInterval(timerID);
  timerID = setInterval(async () => {
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
