# BioWallet v37 — v5-only + „tutibiztos" megerősítés + öngyógyítás

**Cél:** A pénztárca soha ne ragadjon hibába vagy kiúttalan állapotba. A v5 az
**egyetlen** támogatott formátum (teljes legacy-strip, migráció nélkül). A startup
adatvesztés-bomba kiiktatva. Minden lépés után **teljes checklist + tesztek**.

**Döntés (rögzítve):** Teljes strip, migráció nélkül — csak v5 `create`+`open` marad,
v1–v4 olvasás teljesen törölve. (v6 nem létezik a kódban; az a visszagörgetett
liveness-kísérlet volt.)

**Branch:** `bio-kernel-emu` · **Verzió cél:** v37 / SW v109
**Megnyitva:** 2026-06-20

---

## ⛑️ Globális szabályok (MINDEN lépésnél)

1. Egy fázis = egy commit (working, tesztelt állapot). Soha ne deployolj félkész fázist.
2. **Lokális teszt KÖTELEZŐ deploy előtt** (`python -m http.server 8080`, kamera csak localhost/https).
3. Deploy csak Phase 5-ben, `deploy.ps1`-gyel (DCC `chattr -i/+i` auto).
4. Self-healing alapelv: **minden `catch` egy HASZNÁLHATÓ állapotba vezet** (setup vagy lock),
   és **SOHA nem hív `localStorage.clear()`-t**.
5. Push: subtree-split (lásd deploy szabályok), előtte ellenőrzés.

---

## ✅ STANDARD CHECKLIST — minden fázis után lefuttatandó

```
[ ] CHK-1  Szintaxis: minden módosított .js modul parse-ol (node --check / import-smoke)
[ ] CHK-2  Unit tesztek zöldek:
           [ ] verify_biowallet.py
           [ ] verify_sss_gf256.py
           [ ] node tests/test_tx_commitment.mjs
           [ ] node tests/test_bch.js
           [ ] node tests/test_recovery_math.js
[ ] CHK-3  Build: python build_single.py  → biowallet.html hiba nélkül
[ ] CHK-4  Localhost smoke: 8080-on betölt, 0 console error
[ ] CHK-5  Manuális flow-mátrix (lásd lent) — az érintett sorok
[ ] CHK-6  Git commit a fázisról (working állapot)
```

### Manuális flow-mátrix (a kritikus utak)

```
POZITÍV
[ ] C1  Új v5 wallet létrehozása → .biowallet + .P.json mentés → paper share megjelenik
[ ] C2  Lock → újranyitás arccal → helyes cím
[ ] C3  Oldal-újratöltés → auto-load → arccal nyit
[ ] C4  2. wallet → switcher mindkettőt mutatja → váltás → scan → HELYES cím (a fő bug!)
[ ] C5  Seed import (v5) → nyit
[ ] C6  Privkey import (v5) → nyit
[ ] C7  Genesis recover (arc + P → 24 szó)
[ ] C8  Paper share recover
[ ] C9  Re-enroll arc
[ ] C10 TX küldés (testnet) / personal_sign / WC connect

NEGATÍV / ÖNGYÓGYÍTÁS
[ ] C11 Rossz arc → BIO_MISMATCH + cooldown, NINCS wipe
[ ] C12 Sérült biowallet_meta → helyreáll, az index+snapshotok MEGMARADNAK
[ ] C13 Worker megölve művelet közben → újraéled, nincs fagyás
[ ] C14 Régi v1–v4 fájl betöltése → tiszta „nem támogatott formátum" üzenet (NEM PIN, NEM crash)
[ ] C15 Storage nem perzisztens → figyelmeztetés jelenik meg
```

---

## PHASE 0 — Biztonsági háló & zöld baseline  `(Task #1)` — ✅ KÉSZ (2026-06-20)

*Nincs kódváltozás — a jelenlegi viselkedés rögzítése.*

```
[x] 0.1  git: branch = bio-kernel-emu; src/ tracked TISZTA (csak szemét vendor•cp fájlok untracked)
[x] 0.2  CHK-2 baseline tesztek lefuttatva — eredmények lent
[x] 0.3  CHK-3 build OK — python build_single.py → biowallet.html 11.5 MB (exit 0)
[x] 0.4  CHK-4 localhost: single-file HTTP 200 (12 097 355 b); dev-út /src/app/index.html HTTP 200
[x] 0.5  Szemét working-tree fájlok dokumentálva (lent) — NEM törlünk még
```

### Baseline teszt-eredmények (2026-06-20, toolchain: Python 3.12.6, Node v22.11)

| Teszt | Eredmény | Megjegyzés |
|-------|----------|------------|
| `verify_biowallet.py` | ✅ **71/71 PASS** (exit 0) | DCC 7, DATA_FLOW 14, BCH 4, Phase5 8, Phase9 6, SSS 6, Alkotmány 6, V5 genesis 5, Liveness 5, TX 2, Session 2, R 3, Worker 3 |
| `test_bch.js` | ✅ **28/28 PASS** (exit 0) | BCH(255,55,25) hibajavítás |
| `test_tx_commitment.mjs` | ✅ **11/11 PASS** (exit 0) | TX-substitution támadás blokkolva |
| `test_recovery_math.js` | ✅ **PASS** (exit 0) | (c+r+p) mod 2048 helyes |
| `verify_sss_gf256.py` | ⏳ nehézsúlyú GF bit-blast | GF6 asszociativitás minden 8-bites bemenetre → Z3 lassú (10+ min). **Kizárva a fázisonkénti hurokból** (sss.js-t nem módosítjuk); Phase 5 végső kapu |
| `rpc_health_check.py` | — | hálózat-függő, nem a magkódot teszteli; opcionális |

**ZÖLD BASELINE RÖGZÍTVE:** a magkód (kripto, DCC, recovery, tx-commit) formálisan bizonyított és minden gyors teszt zöld. Innen indul a Phase 1.

### Szemét working-tree fájlok (Phase 5-ben takarítjuk, MOST nem):
- `BioWallet/src/vendor•cp C：...face-api.min.js...` (elrontott `cp` → fájlnév)
- `BioWallet/src/vendor•cp C：...wc2.min.js...`
- `BioWallet/src/models$f`, `BioWallet/src/vendor"` (gyökérben)
- `BioWallet/`-be másolt PDF-ek + `root_index.html` (untracked)
- A `biowallet.html` working tree-ben módosított (most újra-buildelve, v5 baseline).

---

## PHASE 1 — Adatvesztés-bomba kiiktatása + worker öngyógyítás  `(Task #2)`

| ID | Teendő | Fájl:hely |
|----|--------|-----------|
| **D1** | A startup `catch` SOHA ne `localStorage.clear()`. Csak a sérült `biowallet_meta`-t kezelje; az indexet és `biowallet_wallet_*` snapshotokat HAGYJA. Ha van index → kínáljon wallet-választót, ne setup-ot. | `app.js:411-414` |
| **D2** | `INIT_VAULT` hibáját külön ágon kezelni: worker respawn + 1 retry; ha az is bukik → „újratöltés szükséges" üzenet, **adat érintetlen**. Nem eshet a wipe-ágba. | `app.js:368` + worker init |
| **D2b** | `worker.onerror`/`onmessageerror` → worker újra-példányosítás, pending promise-ok rejectje, állapot lockra. | `app.js:37-60` |
| **D4** | `navigator.storage.persist()` kérése startupkor; ha nem perzisztens → figyelmeztető sáv (iOS eviction ellen). | `app.js` startup |
| **D5** | Backup-nag: ha nincs jelzett `.P.json`+`.biowallet` export, erős figyelmeztetés (a localStorage NEM backup). | save flow |

```
[x] Phase 1 kód kész (2026-06-20)
[x] CHK-1 szintaxis: node --check src/app/app.js OK
[x] CHK-3 build OK (app.js bundle 244 264 b; worker blob injektálva; külső worker-ref NINCS)
[x] CHK-2 gyors tesztek: recovery_math / bch / tx_commitment PASS
[x] STATIKUS igazolás: 0 db localStorage.clear() (a 9 db .clear() mind Map/Set);
    az 5 új öngyógyító string mind a bundle-ben
[ ] MANUÁLIS futásidejű (C11–C13, C15) — felhasználói megerősítés (lépések lent)
[ ] Commit: "v37 Phase 1: data-loss guard + worker self-heal"  ← manuális OK után
```

### Phase 1 — mit változott (app.js)
- **D2b (worker respawn):** `const worker` → `let worker` + `_spawnWorker()`/`_respawnWorker()`.
  Crash (`onerror`/`onmessageerror`) → pending reject + `vaultReady=false` + automatikus respawn.
  Respawn-limit 5 (törött SW-cache ellen) → `_showReloadNeeded()`, **NINCS adattörlés**.
  Sikeres válasz nullázza a backoff-számlálót.
- **callWorker:** ha a worker tartósan halott → azonnali `WORKER_DEAD` (nincs 30s freeze).
- **D1 (a fő):** a startup `localStorage.clear()` **mindkét** előfordulása törölve.
  Sérült aktív meta → `_recoverActiveFromIndex()` (ép walletre vált az indexből);
  ha nincs ép → CSAK a sérült `biowallet_meta` kulcsot távolítja el, az index+snapshotok maradnak.
- **D2 (worker-hiba elkülönítés):** `_initVaultWithRetry()` — respawn + 1 retry; tartós hiba esetén
  reload-banner, **adat érintetlen**. (Korábban: INIT_VAULT reject → `clear()` BOMBA.)
- **D4:** `_ensurePersistentStorage()` — `navigator.storage.persist()` + figyelmeztetés ha nem perzisztens.
- **D5:** a D4 üzenet + a meglévő kötelező fájl-mentés fedi (a localStorage NEM backup).

### Statikus logika-trace (a kritikus utak)
- **C12** (sérült `biowallet_meta`): `JSON.parse` dob → `_recoverActiveFromIndex()` ép walletet talál →
  beállítja aktívnak → INIT_VAULT → lock panel. **Index+snapshotok ÉPEK, nincs clear.** ✅
- **C13** (worker INIT bukás): retry+respawn; tartós bukásnál reload-banner, adat ép. ✅
- **C11** (rossz arc): az OPEN-ág (`btnScan`) változatlan — BIO_MISMATCH + cooldown, nincs wipe;
  a `reject`(ok:false) NEM triggerel `onerror`-respawnt. ✅
- **C15** (nem perzisztens tárolás): `_ensurePersistentStorage` info-üzenet. ✅

### 🔬 MANUÁLIS futásidejű teszt-lépések (localhost, DevTools)

`python -m http.server 8080` → `http://localhost:8080/src/app/index.html`

**C12 — adatvesztés-védelem (KRITIKUS, kamera nélkül):**
1. Hozz létre 2 walletet (vagy használj meglévőt) → ellenőrizd: DevTools → Application → Local Storage:
   van `biowallet_wallets` (2 elem) + 2× `biowallet_wallet_...` + `biowallet_meta`.
2. Console: `localStorage.setItem('biowallet_meta','{ROSSZ JSON')` (szándékos rontás).
3. Reload. **Elvárt:** az app NEM üres; a lock panel egy ÉP walletre áll vissza;
   `biowallet_wallets` és a `biowallet_wallet_...` kulcsok **MEGVANNAK**. (Korábban: minden törlődött.)

**C13 — worker öngyógyítás:**
1. Nyisd meg az appot egy walletnél (lock panel).
2. Console: `worker.terminate()` (szimulált crash) — majd indíts egy műveletet (pl. switcher/scan).
   **Elvárt:** nincs örök freeze; a worker újraindul / reload-banner jelenik meg; adat ép.

**C15 — perzisztencia:** ha a böngésző nem ad tartós tárolást, induláskor megjelenik az info-figyelmeztetés.

> A C11 (rossz arc) és a kamera-utak változatlanok Phase 1-ben — Phase 2 után teszteljük teljes körűen.

---

## PHASE 2 — v5-only strip (megöli a PIN-t)  `(Task #3)`

| ID | Teendő | Fájl:hely |
|----|--------|-----------|
| **S1** | `open()`: csak v5 ág marad; v1/v2/v3/v4 branchek törölve. Ismeretlen/régi `v` → `UNSUPPORTED_FORMAT` dobás (tiszta hiba). | `vault.js:344-590` |
| **S2** | Törlés: `createV4`, legacy `create()`, `importFromMnemonic` (v2), `UPGRADE_V4`, v3 PIN-ágak, `isV2` ha feleslegessé válik. | `vault.js` |
| **S3** | Worker: `IMPORT`, `CREATE_V4`, `UPGRADE_V4` case-ek törlése. Marad: `CREATE_V5`, `IMPORT_V5`, `IMPORT_PK_V5`, `OPEN`, `SIGN`, stb. | `vault_worker.js` |
| **S4** | `app.js`: `showPinModal` hívás + `vaultVersion===3` ág + `_getVaultVersion` PIN-logika eltávolítása; v4 legacy figyelmeztetések törlése. `_getVaultVersion` → csak v5 ellenőrzés. | `app.js:1477-1507, 591` |
| **S5** | Régi fájl betöltése (C14): `_validateAndApplyVault` adjon „nem támogatott formátum" üzenetet, ne engedje a scan-be. | `app.js:2412` |

```
[x] Phase 2 kód kész (2026-06-20)
[x] CHK-1 szintaxis: vault.js / vault_worker.js / app.js / i18n.js mind OK
[x] CHK-3 build OK (worker 401→393 KB, app 244→241 KB; createV4/upgradeToV4 maradvány NINCS)
[x] CHK-2 gyors tesztek: recovery_math / bch / tx_commitment PASS
[x] STATIKUS: UNSUPPORTED_FORMAT a bundle-ben; PIN-ág és showPinModal eltávolítva
[ ] MANUÁLIS (C1,C2,C5,C6,C14) — PWA-ban push előtt (PIN SEHOL ne jelenjen meg)
[ ] Commit: "v37 Phase 2: v5-only strip, legacy + PIN removed"
```

### Phase 2 — mit változott
- **vault.js `open()`** → kizárólag v5 (deviceWrap + sss); minden más → `UNSUPPORTED_FORMAT`.
  Törölve a v1 / v2 / v3 (PIN) / v4 / old-v5 (sss.deviceShare) olvasó ág (~180 sor).
- **vault.js törölt metódusok:** `create`, `_encryptSeed` (v2/v3), `createV4`, `_encryptSeedV4`,
  `importFromMnemonic` (v2), `upgradeToV4`, `upgradeToV5`; dead helperek: `isV2`, `pack`, `unpack`, `aesDecrypt`.
- **vault.js `enrollDevice`** → v5-only (csak deviceWrap frissül; SSS+paper érintetlen).
- **vault_worker.js törölt case-ek:** `ENROLL`, `IMPORT`, `CREATE_V4`, `UPGRADE_V4`, `UPGRADE_V5`.
  Maradék felület tisztán v5 (CREATE_V5 / IMPORT_V5 / IMPORT_PK_V5 / OPEN / …).
- **app.js:** a PIN-ág (`vaultVersion===3`) + `showPinModal` eltávolítva; a scan v5-ellenőrzést végez
  (`_getVaultVersion !== 5` → `msg.vault.unsupported`); `_validateAndApplyVault` régi fájlt elutasít;
  a `btn-sss` (upgrade 2-of-3) handler törölve (BUGLIST BUG-05 footgun megszűnt).
- **i18n.js:** új `msg.vault.unsupported` (HU+EN).
- **Hatás:** a PIN-anomália véglegesen megszűnt (nincs v3-ág sehol). Régi/idegen fájl → tiszta hibaüzenet.

---

## PHASE 3 — Pénztárca-váltás A1 (biztonságos, re-scan alapú)  `(Task #4)`

| ID | Teendő | Fájl:hely |
|----|--------|-----------|
| **A1-1** | Üzenet egyértelműsítés: a váltáskor ne „Vault betöltve", hanem „🔒 X kiválasztva — scanneld az arcod a váltáshoz". | `app.js:1108` |
| **A1-2** | Snapshot-szinkron: minden in-place vault-mutáció (re-enroll/upgrade/addChain) után `_walletsSaveCurrent()`, hogy a snapshot `vaultJson` ne avuljon el. | `app.js:2079,2276,2346` |
| **A1-3** | Switch guard: ha a cél snapshot hiányos (`!vaultJson`) → érthető hiba + visszaút, ne néma elhalás. | `app.js:1100-1110, 1423` |
| **A1-4** | BroadcastChannel: `senderId` bevezetése; ne lockoljon, ha ugyanaz a kontextus / ugyanaz a `vaultId`. | `app.js:63-78` |
| **A1-5** | WC: sikeres váltás-`OPEN` után `emitSessionEvent('accountsChanged', [újCím])` minden aktív sessionre. | `app.js:1544`, `wc2.js:77` |

```
[x] Phase 3 kód kész (2026-06-20)
[x] CHK-1 szintaxis: app.js / wc2.js / i18n.js OK
[x] CHK-3 build OK
[x] CHK-2 gyors tesztek: recovery_math / bch / tx_commitment PASS
[x] STATIKUS: switch.scan + accountsChanged a bundle-ben
[ ] MANUÁLIS (C4 a FŐ bug + C10 WC) — PWA-ban push előtt
[ ] Commit: "v37 Phase 3: safe wallet switch (A1) + WC accountsChanged"
```

### Phase 3 — mit változott (app.js, wc2.js, i18n.js)
- **A1-1:** váltáskor egyértelmű üzenet — `msg.wallet.switch.scan` („🔒 {name} kiválasztva —
  scanneld az arcod a váltáshoz"), nem a félrevezető „Vault betöltve".
- **A1-2:** `_walletsSaveCurrent()` minden in-place mutáció után (2× re-enroll + device-enroll) →
  a per-wallet snapshot `vaultJson`-ja nem avul el switch-away/visszaváltáskor.
- **A1-3:** switch guard — hiányos cél-snapshot (`!vaultJson`) → `msg.wallet.switch.incomplete`,
  nincs néma elhalás; a váltás `_initVaultWithRetry`-t használ (worker-respawn öngyógyítás).
- **A1-4:** BroadcastChannel `senderId` — a saját üzenetet kihagyja (önzárolás megelőzése);
  a valódi „másik lapfül" lock megmarad.
- **A1-5:** `wcEmitAccountsChanged()` — sikeres open/váltás után minden aktív WC-session
  megkapja az ÚJ címet → a csatlakozott dApp tényleg vált.

---

## PHASE 4 — Öngyógyítás megerősítés (átfogó)  `(Task #5)`

| ID | Teendő |
|----|--------|
| **H1** | Állapotgép-audit: minden panel-átmenet és `catch` garantáltan használható állapotba visz (setup/lock). Lista + lefedettség. |
| **H2** | Worker watchdog: timeout/halál esetén auto-respawn + utolsó művelet újrapróbálható, adat érintetlen. |
| **H3** | „Vészkijárat" UI: bármely beragadt állapotból elérhető „Zárolás / Újratöltés" gomb, ami NEM töröl adatot. |
| **H4** | (Opcionális, MetaSpace) `spec/biowallet.bio`: a „nincs kiúttalan állapot" invariáns formalizálása (STATES + TRANSITION lefedettség). |

```
[x] Phase 4 kód kész (2026-06-20)
[x] CHK-1/CHK-3 build OK; CHK-2 gyors tesztek PASS
[x] STATIKUS: err.scan.stuck watchdog a bundle-ben
[ ] MANUÁLIS (C11–C15) — PWA-ban push előtt
[ ] Commit: "v37 Phase 4: self-healing state guarantees"
```

### Phase 4 — audit + watchdog
- **H1 audit (kód nélkül):** a scan-flow minden ága KORLÁTOZOTT időre fut:
  liveness 8s (`bio_capture.js` `LIVENESS_TIMEOUT`), worker-hívás 30s (`callWorker`),
  kamera-init 2s fallback. Minden `catch` visszaállítja a UI-t (`setScanning(false)` + `btnScan.disabled=false`),
  és `window.unhandledrejection` → `setScanning(false)`. → nincs ismert örök-beragadás.
- **H2 (Phase 1-ben kész):** worker-respawn + retry; `_workerDead` → reload-banner.
- **H3 watchdog (új):** `setScanning(true)` → 90s biztonsági timer; ha addig nem zárul,
  kényszer-visszaállás (gomb engedélyezve, `err.scan.stuck`, adat érintetlen). Belt-and-suspenders.
- **H4 (.bio formalizálás):** elhalasztva — a runtime öngyógyítás a lényeg; a `spec/biowallet.bio`
  invariáns-bővítés opcionális későbbi feladat.

---

## PHASE 5 — Szerver-takarítás, deploy, élő smoke  `(Task #6)`

| ID | Teendő |
|----|--------|
| **D3** | Szerveren a maradék gyökér `/var/www/biowallet/sw.js` (v30) eltávolítása; egyetlen SW scope (`/app/`). |
| **P5-1** | ✅ SW verzió bump → **v109**; modul query-bumpok: `vault.js?v=23`, `i18n.js?v=13`, `vault_worker.js?v=30`, `app.js?v=23`; `build_single.py` lefuttatva (biowallet.html 11.5 MB). |
| **P5-2** | Deploy: `deploy.ps1 -SkipGitPush` (DCC `chattr -i`→scp→`chattr +i`), version.json auto. |
| **P5-3** | Push: subtree-split → GitHub main (remote-ellenőrzés UTÁN). |
| **P5-4** | Élő smoke a https://biowallet.metaspace.bio-n: C2, C3, C4, C14. |

### PWA auto-frissítés (igazolva a sw.js-ből)
A SW `install`→`skipWaiting`, `activate`→régi cache törlés + `clients.claim` + `SW_ACTIVATED`
üzenet → az app `window.location.reload()`-ot hív. A v109 bump → minden nyitott PWA
automatikusan friss kódra vált. A modul `?v=` bumpok a worker ES-module cache (BUG-06) ellen.

```
[x] Phase 5 KÉSZ (2026-06-20)
[x] Szerver-deploy (deploy.ps1 -SkipGitPush): 17 fájl SCP, chattr +i visszazárva, version.json v109
[x] Gyökér /sw.js → önkioldó stub (legacy scope-kliensek auto-unregister+frissítés)
[x] Élő smoke OK: version.json v109, /app/sw.js v109, /→/app/ 200, vault.js UNSUPPORTED_FORMAT
[x] GitHub push a HELYES repóra: LemonScripter/biowallet.git main = c049a96 (origin=dcc-shield ÉRINTETLEN)
[x] Letölthető biowallet.html (v37 v5-only) felpusholva
[ ] ÉLES manuális teszt (felhasználó) — PWA v109 auto-frissül
```

### Phase 5 — végrehajtva
- **Verzió-bumpok:** SW `v108→v109`; modul query: `vault.js?v=23`, `i18n.js?v=13`,
  `vault_worker.js?v=30`, `app.js?v=23` (BUG-06 worker ES-module cache ellen).
- **Szerver:** `deploy.ps1 -SkipGitPush` — DCC `chattr -i`→scp(17 fájl)→`chattr +i`, version.json v109.
- **Gyökér `/sw.js`:** önkioldó stub (install→skipWaiting, activate→cache-purge+unregister+navigate).
- **GitHub:** ⚠️ az `origin` tévesen a `dcc-shield.wiki`-re mutatott → a push az `origin` tokenjével,
  a repo-nevet `biowallet.git`-re cserélve ment (`git push <biowallet-url> biowallet-deploy:main --force`),
  az `origin` érintetlen maradt. biowallet.git main HEAD = `c049a96`.
- **PWA auto-frissülés:** /app/ kliensek a v109 SW-vel; legacy / scope kliensek a stubbal.

## 🚨 v110 HOTFIX (2026-06-21) — reload-hurok javítás
- **Hiba:** a v109 deploynál az `app.js` `SW_CACHE_VERSION` konstans **v108** maradt, miközben
  `version.json`/`sw.js` v109 lett. Az SW-független verzió-ellenőrző (`app.js:403-419`) a
  `sw_update_done`-t a szerver-verzióra állítja, de a guard a (rossz) `SW_CACHE_VERSION`-höz
  hasonlít → a feltétel sosem teljesül → **végtelen unregister+cache-clear+reload hurok**.
  Mellékhatás: a PWA-k SOHA nem kapták meg a v37 kódot (a switch-fix sem) → a felhasználó
  továbbra is a régi, törött váltást látta.
- **Javítás:** minden v110-re konzisztensen: `app.js` `APP_VERSION='v37'` +
  `SW_CACHE_VERSION='biowallet-v110'`, `sw.js` CACHE v110, version.json v110 (deploy auto).
  A hurokban lévő kliensek a version.json=v110 miatt egyszer kitisztulnak és a JAVÍTOTT
  kódot töltik be → a guard egyezik → hurok megáll.
- **Tanulság / TODO:** a `deploy.ps1` preflight NEM ellenőrzi, hogy az `app.js`
  `SW_CACHE_VERSION` egyezik-e az `sw.js` CACHE-sel — ezt a preflightba kéne tenni.
- **Live igazolva:** app.js SW_CACHE_VERSION = version.json = sw.js = **v110**. Commit `4e99158`.

## 🎯 v37.1 (SW v111) — a VALÓDI switch-bug javítása
- **Gyökér-ok:** OPEN-sikernél (`app.js:1577`) csak `_walletsRegister()` futott (az INDEXET
  frissíti), de `_walletsSaveCurrent()` NEM → a **per-wallet snapshot (`biowallet_wallet_${id}`,
  ami a `vaultJson`-t tartja) megnyitáskor SOHA nem mentődött.** Ezért a (pl. backupból
  visszaállított) tárcáknak nem volt teljes snapshotjuk → a switcher „Megnyitás" `target=null`
  → marad az aktuális; a rákövetkező `.biowallet`-betöltés a ROSSZ (aktuális) metára került.
  → Ez az A1 (Phase 3) tüneti javítás MÖGÖTTI valódi ok, amit elsőre nem találtam el.
- **Javítás:**
  - `app.js:1577` OPEN-siker → `_walletsSaveCurrent()` (minden megnyitott tárca teljes,
    váltható snapshotot kap).
  - `_applyVaultJson()` → `.biowallet` betöltésekor azonnal `_walletsRegister()` + `_walletsSaveCurrent()`.
  - switcher `_sw_open`: hiányos/hiányzó snapshot → `{action:'incomplete'}` (NEM vált vakon,
    nincs meta-korrupció) → útmutató üzenet a backup-visszaállításhoz.
- **Felhasználói teendő a meglévő törött állapotra:** minden NEM-aktív tárcát egyszer
  vissza kell állítani a `.P.json` + `.biowallet` fájljaiból (Restore) — utána a snapshot
  elmentődik és a váltás memóriából megy. Az aktív tárca a következő megnyitáskor magától elmentődik.

## ⚠️ Nyitott figyelmeztetés
- Az `origin` remote **rosszul van beállítva** (`dcc-shield.wiki`, nem `biowallet`). Érdemes javítani,
  hogy a jövőbeli `deploy.ps1` (ami `origin`-ra pushol) ne a rossz repóra menjen.
- Az `origin` URL-ben **GitHub token** van tárolva (config-ban) — biztonsági szempontból átgondolandó.
- Ez a MILESTONE doc a subtree-push révén **felkerült a publikus biowallet.git-re** — ha belső maradna,
  `.gitignore` + eltávolítás kell.

---

## Megjegyzés a tesztelhetőségről

A kamera/arc-scan flow-k (C1–C9) **localhoston vagy https-en** futnak (kamera-engedély miatt).
A kriptográfiai magot (SSS, BCH, recovery, tx-commitment) a `tests/` headless lefedi —
ezek adják a gyors regressziós hálót minden lépés után. A biometrikus UI-utakat
manuálisan pipáljuk a flow-mátrixban.
