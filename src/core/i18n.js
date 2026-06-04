/**
 * BioWallet — bilingual UI strings (EN + HU)
 * Usage: import { t, setLang, getLang, applyI18n, getInfoContent } from './i18n.js';
 */

const STRINGS = {
  hu: {
    /* ── Status badge ──────────────────────────────────────────────── */
    'status.locked':  'ZÁROLT',
    'status.expired': 'LEJÁRT',

    /* ── Scan hint ─────────────────────────────────────────────────── */
    'scan.hint':       'Nézzen egyenesen a kamerába',
    'scan.hint.active':'Nézzen egyenesen a kamerába...',
    'scan.hint.done':  'Kész — nyomjon egy gombot',

    /* ── TTL labels ────────────────────────────────────────────────── */
    'ttl.open':  'NYITVA',
    'ttl.sign':  'ALÁÍRÁS',

    /* ── Buttons / help ────────────────────────────────────────────── */
    'btn.help.title': 'Használati útmutató',
    'btn.info.title': 'Hogyan működik?',
    'lang.switch':    'EN',
    'header.security':      '↗ Összehas.',
    'header.security.href': '/docs/security_comparison_hu.html',

    /* ── Setup panel ───────────────────────────────────────────────── */
    'setup.info':       'Az arc-adatokból egyedi titkosítókulcs keletkezik a vaulton belül. Az arc-adatok soha nem hagyják el az eszközt.',
    'btn.enroll':       'Wallet létrehozása',
    'btn.enroll.sub':   '5 arc-scan → BIP39 seed generálás',
    'btn.import':       'Wallet importálása',
    'btn.import.sub':   '12–24 szavas seed phrase vagy privát kulcs → biometriai titkosítás',
    'btn.restore':      'Meglévő wallet visszaállítása',
    'btn.restore.sub':  '.P.json fájl betöltése → arc-scannel megnyitható',

    /* ── Import panel ──────────────────────────────────────────────── */
    'import.info1': '<strong style="color:#ffa502;font-size:0.75rem;">Mikor érdemes importálni?</strong><br>Ha meglévő MetaMask / Ledger wallet-ját szeretné arc-scannel védeni. Az importálás után a seed phrase biometriailag titkosítva tárolódik — az eredeti szavak azonnal törölhetők.',
    'import.info2': '<strong style="color:#4CAF50;">Miért biztonságos?</strong><br>A seed phrase / privát kulcs soha nem hagyja el a böngészőt — ellenőrizhető:<br><span style="color:#6b6b80;">DevTools → Network → nincs kérés beírás közben.</span><br>Ajánlott: <strong>kapcsolja le az internetet</strong> importálás előtt (PWA offline mód).',
    'import.blur.hint': 'A szöveg homályos — kattintson bele az íráshoz / olvasáshoz.',
    'import.tab.phrase':         '12/24 szó',
    'import.tab.privkey':        'Privát kulcs (0x…)',
    'btn.import.enroll':         'Beolvasás + importálás',
    'btn.import.enroll.sub':     '5 arc-scan → biometriai titkosítás · szavak azonnal törlődnek',
    'btn.import.enroll.sub.pk':  '5 arc-scan → biometriai titkosítás · privát kulcs azonnal törlődik',
    'btn.import.cancel':     'Vissza',

    /* ── Lock panel ────────────────────────────────────────────────── */
    'lock.info':             'A privát kulcs titkosítva tárolódik. Kizárólag az Ön arca tudja megnyitni.',
    'btn.load.vault':        'Vault fájl betöltése',
    'btn.load.vault.sub':    '.biowallet · egyszer kell, aztán gyorsítótárazva',
    'vault.paste.title':     'Vault JSON beillesztése',
    'vault.paste.desc':      'Nyisd meg a .biowallet fájlt szövegszerkesztővel, másold ki az összes tartalmat, majd illeszd be ide:',
    'vault.paste.btn':       'Betöltés',
    'btn.scan':              'Megnyitás arc-scannel',
    'btn.scan.sub':          'Sikeres scan után 30 mp-es nyitva tartás',
    'btn.switch.wallet':     'Másik wallet / importálás',
    'btn.switch.wallet.sub': 'Új wallet létrehozása vagy 12–24 szó / privát kulcs importálása',

    /* ── Vault panel ───────────────────────────────────────────────── */
    "card.address.label": "Ethereum cím (m/44'/60'/0'/0/0)",
    'balance.label':      'Egyenleg:',
    'balance.refresh':    'Egyenleg frissítése',
    'btn.copy':           '⎘ Cím másolása',
    'btn.qr':             '▦ QR kód',
    'card.send.label':    'ETH küldése',
    'input.to.ph':        '0x… vagy name.eth',
    'btn.sign':           'ETH küldése',
    'btn.sign.sub':       'Fogadó cím + összeg megadása · arc-scan · auto-zárolás',
    'btn.send.token':     '{sym} küldése',
    'card.tx.label':      'Tranzakciók',
    'btn.wc':             'dApp kapcsolat',
    'btn.wc.sub':         'WalletConnect v2 — Uniswap, OpenSea stb.',
    'btn.swap':           'Token csere',
    'btn.swap.sub':       'Paraswap · 0.15% fee · arc-scan',
    'btn.paper':          'Papírképlet készítése',
    'btn.paper.sub':      'Visszafejtő kód — a seed phrase nem jelenik meg digitálisan',
    'btn.lock':           'Azonnali zárolás',
    'btn.lock.sub':       'Privát kulcs törlése a memóriából',
    'btn.device':         'Eszköz hozzáadása',
    'btn.device.sub':     'Ez az eszköz legyen második faktor — ujjlenyomat / Windows Hello',
    'btn.device.remove':  'Eszköz eltávolítása',
    'btn.device.remove.sub': 'Ezt az eszközt eltávolítja a második faktorok közül',
    'btn.sss':               '2-of-3 védelem',
    'btn.sss.sub':           'Shamir titkosítás — bármely 2: arc / eszköz / papír elegendő',
    'sss.info.title':        '2-of-3 védelem — mi ez?',
    'sss.info.body':         '<p>A vault kulcsát a Shamir-titkosítás 3 részre osztja. Bármely 2 rész elegendő a megnyitáshoz — de 1 rész önmagában semmit nem árul el.</p><ul><li><strong>Arc</strong> (1. rész) — biometrikus azonosítás, mint most</li><li><strong>Eszköz</strong> (2. rész) — ujjlenyomat / Windows Hello</li><li><strong>Papír</strong> (3. rész) — 64 vagy 66 karakteres kód, offline tárolva</li></ul><p>Ha elveszted az eszközödet: <em>arc + papír</em>. Ha megváltozik a biometriád: <em>eszköz + papír</em>. Egyetlen tényező elvesztése nem jelent örökös kizárást.</p><p style="color:#ffa502;margin-top:0.5rem">⚠ A papír share-t most kell felírni — a vault fájlban nem tárolódik.</p>',
    'sss.paper.modal.title': 'Papír share — írd fel!',
    'sss.paper.modal.body':  'Ez a 66 karakteres kód a 3. faktorod. A tárca fájlban <strong>nem tárolódik</strong>. Ha elveszted az eszközödet <em>és</em> ezt a kódot is, a tárca örökre zárolva marad.',
    'sss.paper.copy':        'Másolás',
    'sss.paper.copied':      'Másolva ✓',
    'sss.paper.confirm':     'Felírtam és biztonságos helyen tároltam',
    'sss.paper.done':        'Kész — 2-of-3 védelem aktív',
    'sss.info.btn.ok':       'Engedélyezés',
    'sss.lock.paper.label':  'Papír share (ha nincs regisztrált eszköz)',
    'sss.lock.paper.ph':     '64 vagy 66 karakter — pl. 3a9f…',
    'footer':             'BioWallet · DCC kauzális lánc · BCH-255 · AES-256-GCM · secp256k1',

    /* ── Buy/Sell module ───────────────────────────────────────────── */
    'buy.btn':              'Kripto Vétel/Eladás',
    'buy.btn.sub':          'Ramp Network · EUR ↔ Kripto · arc-scan kötelező',
    'buy.modal.title':      'Kripto Vétel/Eladás',
    'buy.tab.buy':          'Vásárlás',
    'buy.tab.sell':         'Eladás',
    'buy.desc.buy':         'EUR-ért vásárolhatsz kriptót. Az arc-szkennelés jóváhagyja a fogadó cím-et.',
    'buy.desc.sell':        'Kriptót adhatsz el EUR-ért. A tranzakciót arc-szkennelés hagyja jóvá.',
    'buy.desc.buy.short':   'EUR → Kripto',
    'buy.desc.sell.short':  'Kripto → EUR',
    'buy.confirm.buy':      'Folytatás arc-szkennelással',
    'buy.confirm.sell':     'Folytatás arc-szkennelással',
    'buy.scanning':         'Arc-szkennelés…',
    'buy.loading':          'Szolgáltató betöltése…',
    'buy.success':          'Sikeres tranzakció!',
    'buy.popup.opened':     'Transak megnyílt — fejezd be a vásárlást az új ablakban.',
    'buy.err.liveness':     'Élőség-ellenőrzés sikertelen. Próbáld újra.',
    'buy.err.no_address':   'Nincs aktív wallet cím.',
    'buy.err.provider':     'Szolgáltató nem elérhető',

    /* ── Dynamic messages ──────────────────────────────────────────── */
    'msg.camera.init':        'Kamera inicializálása…',
    'msg.camera.error':       'Kamera nem érhető el — ellenőrizze, hogy egy másik alkalmazás nem foglalja le, majd próbálja újra.',
    'msg.model.loading':      'Arcfelismerés inicializálása (~8 MB)…',
    'msg.model.error':        'Arcfelismerés betöltési hiba — frissítse az oldalt.',
    'liveness.turn':          '↔ Fordítsa el kissé a fejét jobbra vagy balra!',
    'liveness.look_straight': '✓ Köszönjük — nézzen egyenesen a kamerába...',
    'err.liveness.timeout':   'Élő jelenlét nem igazolódott — fordítsa el kissé a fejét, majd próbálja újra.',
    'msg.vault.loaded':       'Vault betöltve — arc-scan a megnyitáshoz.',
    'msg.vault.file.loaded':   'Vault fájl betöltve — most scannelhetsz.',
    'msg.vault.file.required': 'Előbb töltse be a vault fájlt (.biowallet)!',
    'msg.invalid.vault.file':  'Érvénytelen vault fájl.',
    'msg.vault.outdated':     'Elavult vault formátum — regisztráljon újra.',
    'msg.vault.corrupted':    'Sérült mentés — hozzon létre új walletot.',
    'msg.first.launch':       'Első indítás — hozzon létre walletot.',
    'msg.scanning.face':      'Tartsa arcát a keretben...',
    'msg.scan.progress':      'Beolvasás {n}/5...',
    'msg.wallet.created':     'Wallet létrehozva!',
    'msg.wallet.imported':    'Wallet importálva!',
    'msg.vault.open':         'Vault nyitva.',
    'msg.vault.locked':       'Vault zárolva. Privát kulcs törölve.',
    'msg.address.copied':     '✓ Másolva!',
    'msg.restore.ok':         'Wallet visszaállítva — töltse be a .biowallet fájlt, aztán scannelhet.',
    'msg.restore.error':      'Visszaállítás sikertelen — ellenőrizze, hogy érvényes .P.json fájlt töltött be.',
    'msg.invalid.pjson.ver':  'Érvénytelen .P.json fájl (rossz verzió).',
    'msg.invalid.pjson.bch':  'Érvénytelen .P.json fájl (hiányzó BCH adat).',
    'msg.import.enter.phrase':'Adja meg a seed phrase-t (12–24 szó) vagy privát kulcsát.',
    'msg.import.word.count':  '{n} szót adott meg — 12, 15, 18, 21 vagy 24 szó szükséges.',
    'msg.import.scanning':    'Tartsa arcát a keretben — biometriai regisztráció...',
    'msg.open.scanning':      'Arc-scan folyamatban...',
    'msg.network.fee':        'Hálózati adatok lekérdezése...',
    'msg.network.switch':     'Hálózat váltva: {name}',
    'msg.signing':            'Arc-scan az aláíráshoz (10 mp ablak)...',
    'msg.signing.dapp':       'Arc-scan a dApp TX aláíráshoz...',
    'msg.signing.msg':        'Arc-scan az üzenet aláíráshoz...',
    'msg.broadcast':          'Broadcast folyamatban...',
    'msg.tx.sent':            'Küldés sikeres! TX: {hash}',
    'msg.tx.cancelled':       'Küldés megszakítva.',
    'msg.paper.scanning':     'Arc-scan a papírképlet generálásához (5 mp ablak)...',
    'msg.paper.done':         'Papírképlet generálva. Vault zárolva.',
    'msg.new.wallet':         'Hozzon létre új walletot vagy importáljon meglévőt.',
    'msg.wc.pairing':         'WC párosítás folyamatban — várja a dApp jóváhagyási kérést...',
    'msg.wc.error':           'WalletConnect hiba — próbálja újra.',
    'msg.wc.connected':       '{name} csatlakoztatva.',
    'msg.wc.rejected':        'WalletConnect kapcsolat elutasítva.',
    'msg.wc.disconnected':    'WalletConnect kapcsolat bontva.',
    'msg.wc.incoming':        'Bejövő dApp kérés — nyissa meg a tárcát az arc-scannel.',
    'msg.wc.unsupported':     'dApp kérés elutasítva — {method} nem támogatott.',
    'msg.wc.chain.unknown':   'dApp hálózatváltás elutasítva — chainId {chain} nem ismert.',
    'msg.wc.chain.added':     'Hálózat hozzáadva: {name}',
    'msg.wc.asset.added':     '{sym} token hozzáadva.',
    'msg.wc.tx.rejected':     'dApp TX elutasítva.',
    'msg.wc.tx.sent':         'dApp TX elküldve: {hash}',
    'msg.wc.msg.signed':      'Üzenet aláírva.',
    'msg.wc.typed.signed':    'EIP-712 adat aláírva.',
    'msg.wc.no.project.id':   'WalletConnect nincs konfigurálva.',
    'msg.cooldown':           'Biztonsági zárolás ({mult}x) — {sec}s múlva próbálkozhat újra.',
    'msg.cooldown.over':      'Zárolás feloldva — próbálkozhat újra.',
    'msg.invalid.address':    'Érvénytelen Ethereum cím.',
    'msg.invalid.amount':     'Érvénytelen összeg (pl.: 0.001).',
    'msg.invalid.amount2':    'Érvénytelen összeg (pl.: 1.5).',
    'msg.insuf.balance':      'Elégtelen ETH egyenleg. {hint}',
    'msg.insuf.token':        'Elégtelen {sym} egyenleg.',
    'msg.gas.hint.token':     'Gas díjhoz ~{eth} ETH szükséges.',
    'msg.gas.hint.eth':       'Kell: ~{eth} ETH (összeg + gas).',
    'msg.network.error':      'Hálózati hiba — ellenőrizze az internetkapcsolatot.',
    'msg.ens.resolving':      'ENS feloldás…',
    'msg.ens.not.found':      'ENS nem található',
    'msg.no.file':            'Nem választott fájlt',
    'msg.tx.no.blockscout':   'TX history ezen a hálózaton nem elérhető',
    'msg.tx.empty':           'Még nincsenek tranzakciók',
    'msg.tx.unavailable':     'Nem elérhető',
    /* ── PIN modal ────────────────────────────────────────────────── */
    'pin.setup.title':  'PIN beállítása',
    'pin.setup.desc':   'Ez a PIN-kód szükséges másik eszközről való megnyitáshoz. Sehol nem tárolódik — csak Ön tudja.',
    'pin.open.title':   'PIN megadása',
    'pin.open.desc':    'Adja meg PIN-kódját az arc-scan mellé.',
    'pin.label':        'PIN kód',
    'pin.confirm.label':'Megerősítés',
    'pin.min.hint':     'Minimum 4 karakter',
    'pin.mismatch':     'A két PIN nem egyezik.',
    'pin.btn.set':      'PIN beállítása',
    'pin.btn.open':     'Megnyitás',
    'pin.btn.cancel':   'Mégse',
    'msg.pin.required': 'Adja meg PIN-kódját az arc-scan mellé.',

    /* ── Device messages ───────────────────────────────────────────── */
    'msg.device.auth':        'Eszközhitelesítés folyamatban...',
    'msg.device.fallback':    'Eszköz kihagyva — arc-alapú belépés.',
    'msg.device.enrolled':    'Eszköz regisztrálva!',
    'msg.device.offer':       'Regisztrálja ezt az eszközt második faktorként? (ujjlenyomat / Windows Hello)',
    'msg.device.removed':     'Eszköz eltávolítva.',

    /* ── Save modal ────────────────────────────────────────────────── */
    'save.title':         'Fájlok mentése',
    'save.name.label':    'Tárca neve',
    'save.name.ph':       'pl. sajat-tarca',
    'save.vault.desc':    'Titkosított tárca — minden eszközön szükséges a megnyitáshoz.',
    'save.vault.keep':    'MEGŐRZENDŐ',
    'save.pjson.desc':    'Arcadat helper — új eszközön kell az arc-alapú feloldáshoz.',
    'save.pjson.keep':    'MEGŐRZENDŐ',
    'save.device.warn':   'A korábbi <strong>{name}.biowallet</strong> (eszköz nélküli) mostantól törölhető — az új fájl mindkét megnyitási módot tartalmazza.',
    'save.btn.download':  '↓ Letöltés',
    'save.btn.done':      'Kész',
    'save.saved':         '✓ Mentve',

    /* ── Confirm modal ─────────────────────────────────────────────── */
    'confirm.title':    'Tranzakció megerősítése',
    'confirm.network':  'Hálózat',
    'confirm.to':       'Fogadó',
    'confirm.amount':   'Összeg',
    'confirm.gas':      'Max. gas',
    'confirm.cancel':   'Mégse',
    'confirm.send':     'Küldés',
    'confirm.fp.label':  'Tranzakció ujjlenyomat',
    'confirm.fp.hint':   'Írd be az első 4 karaktert:',
    'confirm.fn.label':  'Művelet',

    /* ── WC modals ─────────────────────────────────────────────────── */
    'wc.pair.title':       'dApp kapcsolódás',
    'wc.pair.desc':        'Nyissa meg a dApp-ot (pl. Uniswap), kattintson a <strong style="color:#e8e8f0">WalletConnect</strong> gombra, másolja a URI-t és illessze be ide.',
    'wc.pair.cancel':      'Mégse',
    'wc.pair.connect':     'Kapcsolódás',
    'wc.pair.invalid.uri': 'Érvénytelen WC URI (wc:... formátum szükséges).',
    'wc.proposal.label':   'dApp kapcsolódási kérés',
    'wc.proposal.unknown': 'Ismeretlen dApp',
    'wc.proposal.info':    'A dApp olvasni fogja az Ethereum <strong style="color:#e8e8f0">címét</strong> és aláírási kéréseket küldhet.<br><strong style="color:#4CAF50">Minden aláírás külön arc-scant igényel.</strong>',
    'wc.proposal.reject':      'Elutasít',
    'wc.proposal.approve':     'Jóváhagy',
    'wc.proposal.guide.link':  'dApp útmutató — támogatott műveletek',
    'wc.sign.label':       'Üzenet aláírási kérés',
    'wc.sign.desc':        'A dApp az alábbi üzenetet kéri aláírni:',
    'wc.sign.reject':      'Elutasít',
    'wc.sign.sign':        'Arc-scan + Aláír',
    'wc.typed.title':      'EIP-712 típusos adat aláírás',
    'wc.typed.desc':       'A dApp strukturált adatot kér aláírni (pl. Uniswap permit, OpenSea order).',
    'wc.typed.domain':     'Alkalmazás / domain',
    'wc.typed.fields':     'Adat mezők',
    'wc.typed.warn':       '⚠ Csak megbízható dApp-tól fogadja el! Ez az aláírás pénzügyi műveletet engedélyezhet.',
    'wc.typed.sign':          'Arc-scan + Aláír',
    'wc.addchain.title':      'Hálózat hozzáadása',
    'wc.addchain.name':       'Hálózat neve',
    'wc.addchain.symbol':     'Natív token',
    'wc.addchain.add':        'Hozzáad',
    'wc.watchasset.title':    'Token hozzáadása',
    'wc.watchasset.decimals': 'Tizedesjegyek',
    'wc.watchasset.add':      'Token hozzáadása',

    /* ── Network modal ─────────────────────────────────────────────── */
    'net.title':          'Hálózat választás',
    'net.testnet':        ' · Testnet',
    'net.delete.title':   'Törlés',
    'net.delete.confirm': 'Törölje: {name}?',
    'net.add.btn':        '+ Hálózat hozzáadása',
    'net.add.title':      'Egyéni hálózat hozzáadása',
    'net.add.csp':        '⚠ Az egyéni hálózat RPC URL-je ismeretlen — a szerver CSP miatt kapcsolat problémák léphetnek fel.',
    'net.add.f.name':     'Hálózat neve',
    'net.add.f.chain':    'ChainID (szám)',
    'net.add.f.rpc':      'RPC URL (https://...)',
    'net.add.f.exp':      'Explorer TX URL (https://.../tx/)',
    'net.add.f.sym':      'Natív token szimbóluma (pl. ETH)',
    'net.add.cancel':     'Mégse',
    'net.add.confirm':    'Hozzáadás',
    'net.add.err.name':      'Hálózat neve kötelező.',
    'net.add.err.chain':     'Érvénytelen ChainID.',
    'net.add.err.rpc':       'RPC URL https://-vel kell kezdődjön.',
    'net.add.err.exp':       'Explorer URL https://-vel kell kezdődjön.',
    'net.add.verifying':     'RPC ellenőrzése...',
    'net.add.err.mismatch':  'ChainID eltérés: megadott {expected}, RPC szerint {actual}.',
    'net.add.err.timeout':   'RPC nem válaszolt (timeout). Ellenőrizd az URL-t.',
    'net.add.err.rpc.fail':  'RPC nem érhető el: {msg}',

    /* ── Recovery paper modal ──────────────────────────────────────── */
    'paper.step.label':  '2 LÉPÉSES FOLYAMAT — 1. LÉPÉS',
    'paper.title':       'BioWallet — Papír Recovery (Nyers adatok)',
    'paper.desc':        'Írja le mindkét papírt, majd folytassa a <strong>recovery_tool.html ENCODE</strong> módban — ott adja meg P-jét, és kapja meg a <strong>Végleges Papír A-t</strong>.',
    'paper.warn':        '⚠ Ez a NYERS Papír A — P-vel <strong>még nem véglegesítve</strong>! Ne tárolja véglegesen — a 2. lépés után semmisítse meg és csak a Végleges Papír A-t őrizze.',
    'paper.a.title':     'NYERS PAPÍR A · (raw_A_j) — ideiglenes!',
    'paper.b.title':     'PAPÍR B · Eltolások (r_j)',
    'paper.step2.title': '2. LÉPÉS — Véglegesítés (offline)',
    'paper.step2.steps': '<li>Nyissa meg a <strong>recovery_tool.html</strong> oldalt <strong>offline</strong> (internet lekapcsolva)</li><li>Válassza az <strong>ENCODE</strong> fület</li><li>Írja be a Nyers Papír A számait + a fejben tartott <strong>P-jét</strong></li><li>A kapott <strong>Végleges Papír A-t</strong> nyomtassa ki és tárolja a Papír B-vel KÜLÖN helyen</li><li>Semmisítse meg a Nyers Papír A-t</li>',
    'paper.step2.note':  '✓ A BioWallet soha nem tudja meg a P értékét — csak Ön és a recovery_tool.html offline kombinálhatja.',
    'paper.btn.print':   '🖨 Nyomtatás',
    'paper.btn.close':   'Bezárás · memória törlése',

    /* ── Post-import checklist ─────────────────────────────────────── */
    'postimport.badge':   'IMPORT SIKERES',
    'postimport.title':   'Következő lépések',
    'postimport.desc':    'A wallet biometriailag titkosítva tárolódik. Javasolt sorrendben hajtsa végre:',
    'postimport.steps': [
      'Nyissa meg arc-scannel → ellenőrizze, hogy az ETH cím egyezik az eredeti tárcájával.',
      'Generáljon papír biztonsági mentést (Papírképlet gomb → recovery_tool.html ENCODE offline).',
      'Ha a papír backup kész és ellenőrzött: törölje az eredeti seed phrase papírját.',
      'Deaktiválja / törölje az eredeti tárcát (MetaMask / Ledger).',
    ],
    'postimport.warning': '⚠ Az eredeti seed phrase-t csak akkor törölje, ha a papír biztonsági mentés elkészült és ellenőrzött. Visszaút nincs.',
    'postimport.ok':      'Értettem — bezárás',

    /* ── Switch wallet ─────────────────────────────────────────────── */
    'switch.wallet.confirm': 'A jelenlegi wallet törlődik ebből a böngészőből.\nA .biowallet fájl megmarad — bármikor újra betölthető.\n\nFolytatja?',

    /* ── Error messages ────────────────────────────────────────────── */
    'err.unknown':            'Ismeretlen hiba.',
    'err.camera.unavailable': 'Kamera nem elérhető. Ellenőrizze a böngésző engedélyeket, majd próbálja újra.',
    'err.scan.timeout':       'A szkennelés időtúllépett. Próbálja újra.',
    'err.self.heal.title':    'Váratlan hiba történt',
    'btn.self.heal.restart':  'Újraindítás',
    'err.vault.corrupted': 'A tárca fájl sérült. Töltse be újra a .biowallet fájlt, vagy hozzon létre új tárcát.',
    'err.bio.mismatch':  'Az arc nem egyezik. Tipp: a tárcát abban a böngészőben nyissa meg, amelyikben létrehozta (Firefox ↔ Chrome eltérő képfeldolgozás).',
    'err.expired':       'A biometriai token lejárt — próbálja újra.',
    'err.no.token':      'Nincs érvényes biometriai token — szkennelje be arcát.',
    'err.vault.mismatch':'Rossz .biowallet fájl — ez nem az Ön tárcájához tartozik.',
    'err.consumed':      'A token már felhasználásra került — próbálja újra.',
    'err.paper.privkey': 'Privát kulccsal importált tárca — a papírképlet nem elérhető. Mentse el a privát kulcsát biztonságos helyre.',
    'err.paper.crc':     'A papír kód ellenőrző összege nem egyezik — ellenőrizze a beírt karaktereket.',
    'msg.vault.v4.no.face.warn': 'Figyelem: a tárca eszköz+papír kombinációval nyílt meg, arc-azonosítás nélkül. Az arc-alapú belépés visszaállításához kattintson az „Arc profil frissítése" gombra.',
    'msg.vault.v4.legacy.warn':  'Ez a tárca régebbi biztonsági formátumot használ. Az „Arc profil frissítése" gombbal erősítheti meg a védelmet.',
    'err.worker.crash':  'A kriptográfiai modul összeomlott — frissítse az oldalt.',
    'err.worker.timeout':'A kriptográfiai modul nem válaszolt időben — frissítse az oldalt.',
    'err.mnemonic':      'Érvénytelen seed phrase — ellenőrizze a szavakat és a sorrendet (BIP39 szólista).',
    'err.tx.mismatch':   'Tranzakció ujjlenyomat mismatch — aláírás blokkolva.',
    'err.genesis.mismatch': 'Biometriai azonosság nem egyezik a tárca létrehozójával — aláírás blokkolva.',
    'err.device.prf':    'WebAuthn PRF nem támogatott ezen az eszközön/böngészőn.',
    'btn.security.advanced': '⚙ Biztonsági eszközök',
    'btn.reenroll':      'Arc profil frissítése',
    'btn.reenroll.sub':  'Új arc-beolvasás regisztrálása (pl. böngészőváltás után)',
    'msg.reenroll.done': 'Arc profil sikeresen frissítve. Mentse el az új .biowallet fájlt.',
    'msg.reenroll.confirm': 'Arc profil újra-regisztrálása?\n\nA régi papír share érvénytelenné válik — új papír share-t kell felírni.\n\nFolytatja?',
    'msg.reenroll.mandatory': '⚠️ Kötelező arc-regisztráció',
    'msg.reenroll.mandatory.sub': 'A tárcát papír + eszköz hitelesítéssel nyitottad meg. Az arc-alapú belépés visszaállításához most be kell olvasnod az arcodat. Ez a lépés nem hagyható ki.',
    'msg.reenroll.reminder': 'Az arc profil utoljára {days} napja lett frissítve. Az öregedési változások és böngészőváltás elkerülése érdekében javasolt évente frissíteni.',
    'msg.reenroll.reminder.urgent': 'Az arc profil több mint {days} napja nem lett frissítve — sürgős frissítés ajánlott a hozzáférés elvesztésének elkerüléséhez.',
    'msg.reenroll.reminder.btn': 'Frissítés most',
    'btn.genesis.recover':     'Visszaállítás arccal',
    'btn.genesis.recover.sub': 'Arc + P fájl → 12–24 szó (vészhelyzeti visszaállítás)',
    'msg.genesis.recover.scanning': 'Arc azonosítás...',
    'msg.genesis.recover.done':     'Seed visszaállítva — jegyezze fel a szavakat!',
    'err.genesis.backup.unavailable': 'Genesis backup nem elérhető — csak frissen létrehozott v5 walleteken működik.',
    'genesis.recover.preflight.title': '⚠ Vészhelyzeti visszaállítás — biztonsági ellenőrzés',
    'genesis.recover.preflight.body':  'Mikor használja ezt a funkciót?\nHa nem tud belépni, mert nincs aktív eszköz és nincs papír hash — csak az arca, a P.json és a .biowallet fájl áll rendelkezésre.\n\nMi történik ezután?\nA BioWallet NEM nyílik meg. A 24 szót megkapja, amellyel más tárcában (pl. MetaMask) elérheti a pénzét, vagy a BioWallet importálás funkciójával új tárcát hozhat létre.\n\nFolytatás előtt:\n1. Kapcsolja le az internetkapcsolatot\n2. Győződjön meg hogy senki nem látja a képernyőt\n3. Készítsen elő papírt és tollat\n\nA 24 szó bezáráskor törlődik a memóriából és a vágólapról.',
    'genesis.recover.preflight.ok':    'Megértettem — folytatás',
    'genesis.recover.preflight.cancel':'Mégsem',
    'err.genesis.recover.fail': 'Az arc nem egyezik a tárca létrehozójával. Próbálja jobb megvilágításban, egyenesen a kamerába nézve.',
    'genesis.recover.warning': '⚠ Írd fel a szavakat papírra! Bezáráskor törlődik a memóriából és a vágólapról.',
    'genesis.recover.copy':        'Másolás (kockázatos)',
    'genesis.recover.copy.ok':     '✓ Másolva',
    'genesis.recover.copy.fail':   '✗ Nem sikerült',
    'genesis.recover.close':       'Bezárás és törlés',
    'bf.remaining':      ' · még {n} próba a zárolásig',

    /* ── Device enrollment offer (during wallet creation) ─────────── */
    'device.offer.title': 'Ujjlenyomat / Face ID regisztrálása',
    'device.offer.body':  'Ez az eszköz biometrikus hitelesítőjét (ujjlenyomat / Face ID) second faktorként rögzíthetjük. Ha regisztrálod, az arc-scan mellé automatikusan érvényesül — PIN vagy papírképlet nélkül nyílik a tárca ezen az eszközön. Ha most kihagyod, a papírképlettel tudod megnyitni.',
    'device.offer.now':   'Regisztrálás most',
    'device.offer.skip':  'Kihagyás',
    'msg.device.relink':  '⚡ A tárca tartalmaz eszközfaktort — kattints az Eszköz gombra a gyors belépés visszaállításához.',
    'msg.device.relink.warn': '⚠ Eszköz újracsatolás elérhető — DE FIGYELEM: az eszköz csatolása ÉRVÉNYTELENÍTI a jelenlegi papírkódodat! Csak akkor csatold, ha az ÚJ papírkódot azonnal le tudod jegyezni.',
    'sss.paper.modal.reenroll.warn': '🔴 A RÉGI PAPÍRKÓD MÁR ÉRVÉNYTELEN! Ez az ÚJ kód — írd le most. A régi papírkód nem fog többé működni.',
    'sss.paper.reenroll.confirm2': 'Megértettem: a régi papírkód ÉRVÉNYTELEN — csak ez az ÚJ kód érvényes',
    'sss.paper.required.warn': '⚠ Papírkód szükséges — ezen a böngészőn nincs aktív device. Adja meg a papírkódot a scan előtt.',
    'sss.lock.paper.required': '🔴 Papírkód KÖTELEZŐ (nincs aktív device ezen a böngészőn)',

    /* ── Guide modal ───────────────────────────────────────────────── */
    'guide.modal.title': 'BioWallet — Használati útmutató',
  },

  en: {
    /* ── Status badge ──────────────────────────────────────────────── */
    'status.locked':  'LOCKED',
    'status.expired': 'EXPIRED',

    /* ── Scan hint ─────────────────────────────────────────────────── */
    'scan.hint':       'Look directly into the camera',
    'scan.hint.active':'Look directly into the camera...',
    'scan.hint.done':  'Ready — press a button',

    /* ── TTL labels ────────────────────────────────────────────────── */
    'ttl.open':  'OPEN',
    'ttl.sign':  'SIGNING',

    /* ── Buttons / help ────────────────────────────────────────────── */
    'btn.help.title': 'User guide',
    'btn.info.title': 'How does it work?',
    'lang.switch':    'HU',
    'header.security':      '↗ Security',
    'header.security.href': '/docs/security_comparison_en.html',

    /* ── Setup panel ───────────────────────────────────────────────── */
    'setup.info':       'A unique encryption key is derived from your face inside the vault. Face data never leaves the device.',
    'btn.enroll':       'Create wallet',
    'btn.enroll.sub':   '5 face scans → BIP39 seed generation',
    'btn.import':       'Import wallet',
    'btn.import.sub':   '12–24-word seed phrase or private key → biometric encryption',
    'btn.restore':      'Restore existing wallet',
    'btn.restore.sub':  'Load .P.json file → open with face scan',

    /* ── Import panel ──────────────────────────────────────────────── */
    'import.info1': '<strong style="color:#ffa502;font-size:0.75rem;">When should I import?</strong><br>If you want to protect your existing MetaMask / Ledger wallet with face scan. After import, the seed phrase is biometrically encrypted — the original words can be deleted immediately.',
    'import.info2': '<strong style="color:#4CAF50;">Why is this secure?</strong><br>Your seed phrase or private key never leaves the browser — verifiable:<br><span style="color:#6b6b80;">DevTools → Network → no request sent while typing.</span><br>Recommended: <strong>go offline</strong> before importing (PWA offline mode).',
    'import.blur.hint': 'Text is blurred — click inside to read or write.',
    'import.tab.phrase':         '12/24 words',
    'import.tab.privkey':        'Private key (0x…)',
    'btn.import.enroll':         'Scan + import',
    'btn.import.enroll.sub':     '5 face scans → biometric encryption · words erased immediately',
    'btn.import.enroll.sub.pk':  '5 face scans → biometric encryption · private key erased immediately',
    'btn.import.cancel':     'Back',

    /* ── Lock panel ────────────────────────────────────────────────── */
    'lock.info':             'The private key is stored encrypted. Only your face can unlock it.',
    'btn.load.vault':        'Load Vault File',
    'btn.load.vault.sub':    '.biowallet · one-time load, then cached',
    'vault.paste.title':     'Paste Vault JSON',
    'vault.paste.desc':      'Open the .biowallet file with a text editor, copy all the content, then paste it here:',
    'vault.paste.btn':       'Load',
    'btn.scan':              'Unlock with face scan',
    'btn.scan.sub':          'Vault stays open 30 s after successful scan',
    'btn.switch.wallet':     'Switch wallet / import',
    'btn.switch.wallet.sub': 'Create new wallet or import 12–24 words / private key',

    /* ── Vault panel ───────────────────────────────────────────────── */
    "card.address.label": "Ethereum address (m/44'/60'/0'/0/0)",
    'balance.label':      'Balance:',
    'balance.refresh':    'Refresh balance',
    'btn.copy':           '⎘ Copy address',
    'btn.qr':             '▦ QR code',
    'card.send.label':    'Send ETH',
    'input.to.ph':        '0x… or name.eth',
    'btn.sign':           'Send ETH',
    'btn.sign.sub':       'Enter recipient + amount · face scan · auto-lock',
    'btn.send.token':     'Send {sym}',
    'card.tx.label':      'Transactions',
    'btn.wc':             'dApp connection',
    'btn.wc.sub':         'WalletConnect v2 — Uniswap, OpenSea etc.',
    'btn.swap':           'Token Swap',
    'btn.swap.sub':       'Paraswap · 0.15% fee · face scan',
    'btn.paper':          'Generate paper recovery',
    'btn.paper.sub':      'Recovery code — seed phrase never appears digitally',
    'btn.lock':           'Lock immediately',
    'btn.lock.sub':       'Erase private key from memory',
    'btn.device':         'Add this device',
    'btn.device.sub':     'Make this device a second factor — fingerprint / Windows Hello',
    'btn.device.remove':  'Remove device',
    'btn.device.remove.sub': 'Remove this device from the second factors',
    'btn.sss':               '2-of-3 Protection',
    'btn.sss.sub':           'Shamir secret sharing — any 2 of: face / device / paper',
    'sss.info.title':        '2-of-3 Protection — what is this?',
    'sss.info.body':         '<p>Shamir secret sharing splits your vault key into 3 shares. Any 2 shares are enough to open — but 1 share alone reveals nothing.</p><ul><li><strong>Face</strong> (share 1) — biometric, same as today</li><li><strong>Device</strong> (share 2) — fingerprint / Windows Hello</li><li><strong>Paper</strong> (share 3) — a 64 or 66-character code stored offline</li></ul><p>Lost your device? Use <em>face + paper</em>. Changed browser / camera? Use <em>device + paper</em>. Losing a single factor is no longer permanent lockout.</p><p style="color:#ffa502;margin-top:0.5rem">⚠ The paper share must be written down now — it is not stored in the vault file.</p>',
    'sss.paper.modal.title': 'Paper share — write it down!',
    'sss.paper.modal.body':  'This 66-character code is your 3rd factor. It is <strong>not stored</strong> in the wallet file. If you lose your device <em>and</em> this code, the wallet is permanently locked.',
    'sss.paper.copy':        'Copy',
    'sss.paper.copied':      'Copied ✓',
    'sss.paper.confirm':     'I have written it down and stored it safely',
    'sss.paper.done':        'Done — 2-of-3 protection active',
    'sss.info.btn.ok':       'Enable',
    'sss.lock.paper.label':  'Paper share (if no enrolled device)',
    'sss.lock.paper.ph':     '64 or 66 chars — e.g. 3a9f…',
    'footer':             'BioWallet · DCC causal chain · BCH-255 · AES-256-GCM · secp256k1',

    /* ── Buy/Sell module ───────────────────────────────────────────── */
    'buy.btn':              'Buy / Sell Crypto',
    'buy.btn.sub':          'Ramp Network · EUR ↔ Crypto · face scan required',
    'buy.modal.title':      'Buy / Sell Crypto',
    'buy.tab.buy':          'Buy',
    'buy.tab.sell':         'Sell',
    'buy.desc.buy':         'Purchase crypto with EUR. Face scan confirms the receiving address.',
    'buy.desc.sell':        'Sell crypto for EUR. Transaction approval requires face scan.',
    'buy.desc.buy.short':   'EUR → Crypto',
    'buy.desc.sell.short':  'Crypto → EUR',
    'buy.confirm.buy':      'Continue with face scan',
    'buy.confirm.sell':     'Continue with face scan',
    'buy.scanning':         'Face scanning…',
    'buy.loading':          'Loading provider…',
    'buy.success':          'Transaction successful!',
    'buy.popup.opened':     'Transak opened — complete the purchase in the new window.',
    'buy.err.liveness':     'Liveness check failed. Please try again.',
    'buy.err.no_address':   'No active wallet address.',
    'buy.err.provider':     'Provider unavailable',

    /* ── Dynamic messages ──────────────────────────────────────────── */
    'msg.camera.init':        'Initialising camera…',
    'msg.camera.error':       'Camera unavailable — check that no other app is using it, then try again.',
    'msg.model.loading':      'Initialising face recognition (~8 MB)…',
    'msg.model.error':        'Face recognition failed to load — please reload the page.',
    'liveness.turn':          '↔ Slightly turn your head left or right!',
    'liveness.look_straight': '✓ Thank you — look straight at the camera...',
    'err.liveness.timeout':   'Live presence not confirmed — slightly turn your head, then try again.',
    'msg.vault.loaded':       'Vault loaded — face scan to unlock.',
    'msg.vault.file.loaded':   'Vault file loaded — you can now scan.',
    'msg.vault.file.required': 'Load the vault file (.biowallet) first!',
    'msg.invalid.vault.file':  'Invalid vault file.',
    'msg.vault.outdated':     'Outdated vault format — please re-enroll.',
    'msg.vault.corrupted':    'Corrupted save — create a new wallet.',
    'msg.first.launch':       'First launch — create a wallet.',
    'msg.scanning.face':      'Keep your face in the frame...',
    'msg.scan.progress':      'Scanning {n}/5...',
    'msg.wallet.created':     'Wallet created!',
    'msg.wallet.imported':    'Wallet imported!',
    'msg.vault.open':         'Vault open.',
    'msg.vault.locked':       'Vault locked. Private key erased.',
    'msg.address.copied':     '✓ Copied!',
    'msg.restore.ok':         'Wallet restored — load the .biowallet file, then scan.',
    'msg.restore.error':      'Restore failed — check that you loaded a valid .P.json file.',
    'msg.invalid.pjson.ver':  'Invalid .P.json file (wrong version).',
    'msg.invalid.pjson.bch':  'Invalid .P.json file (missing BCH data).',
    'msg.import.enter.phrase':'Enter your seed phrase (12–24 words) or private key.',
    'msg.import.word.count':  '{n} words entered — 12, 15, 18, 21 or 24 words required.',
    'msg.import.scanning':    'Keep your face in the frame — biometric enrollment...',
    'msg.open.scanning':      'Face scan in progress...',
    'msg.network.fee':        'Fetching network data...',
    'msg.network.switch':     'Network switched: {name}',
    'msg.signing':            'Face scan to sign (10 s window)...',
    'msg.signing.dapp':       'Face scan for dApp TX signing...',
    'msg.signing.msg':        'Face scan for message signing...',
    'msg.broadcast':          'Broadcasting...',
    'msg.tx.sent':            'Sent! TX: {hash}',
    'msg.tx.cancelled':       'Send cancelled.',
    'msg.paper.scanning':     'Face scan to generate paper recovery (5 s window)...',
    'msg.paper.done':         'Paper recovery generated. Vault locked.',
    'msg.new.wallet':         'Create a new wallet or import an existing one.',
    'msg.wc.pairing':         'WC pairing in progress — waiting for dApp approval...',
    'msg.wc.error':           'WalletConnect error — please try again.',
    'msg.wc.connected':       '{name} connected.',
    'msg.wc.rejected':        'WalletConnect connection rejected.',
    'msg.wc.disconnected':    'WalletConnect disconnected.',
    'msg.wc.incoming':        'Incoming dApp request — open the wallet with face scan.',
    'msg.wc.unsupported':     'dApp request rejected — {method} not supported.',
    'msg.wc.chain.unknown':   'dApp chain switch rejected — chainId {chain} not recognised.',
    'msg.wc.chain.added':     'Network added: {name}',
    'msg.wc.asset.added':     '{sym} token added.',
    'msg.wc.tx.rejected':     'dApp TX rejected.',
    'msg.wc.tx.sent':         'dApp TX sent: {hash}',
    'msg.wc.msg.signed':      'Message signed.',
    'msg.wc.typed.signed':    'EIP-712 data signed.',
    'msg.wc.no.project.id':   'WalletConnect is not configured.',
    'msg.cooldown':           'Security lockout ({mult}x) — retry in {sec}s.',
    'msg.cooldown.over':      'Lockout lifted — you may try again.',
    'msg.invalid.address':    'Invalid Ethereum address.',
    'msg.invalid.amount':     'Invalid amount (e.g. 0.001).',
    'msg.invalid.amount2':    'Invalid amount (e.g. 1.5).',
    'msg.insuf.balance':      'Insufficient ETH balance. {hint}',
    'msg.insuf.token':        'Insufficient {sym} balance.',
    'msg.gas.hint.token':     'Gas fee requires ~{eth} ETH.',
    'msg.gas.hint.eth':       'Required: ~{eth} ETH (amount + gas).',
    'msg.network.error':      'Network error — check your internet connection.',
    'msg.ens.resolving':      'Resolving ENS…',
    'msg.ens.not.found':      'ENS not found',
    'msg.no.file':            'No file selected',
    'msg.tx.no.blockscout':   'TX history not available on this network',
    'msg.tx.empty':           'No transactions yet',
    'msg.tx.unavailable':     'Unavailable',
    /* ── PIN modal ────────────────────────────────────────────────── */
    'pin.setup.title':  'Set PIN',
    'pin.setup.desc':   'This PIN is required to open the wallet on a new device. It is never stored — only you know it.',
    'pin.open.title':   'Enter PIN',
    'pin.open.desc':    'Enter your PIN alongside the face scan.',
    'pin.label':        'PIN code',
    'pin.confirm.label':'Confirm',
    'pin.min.hint':     'Minimum 4 characters',
    'pin.mismatch':     'The two PINs do not match.',
    'pin.btn.set':      'Set PIN',
    'pin.btn.open':     'Open',
    'pin.btn.cancel':   'Cancel',
    'msg.pin.required': 'Enter your PIN alongside the face scan.',

    /* ── Device messages ───────────────────────────────────────────── */
    'msg.device.auth':        'Device authentication in progress...',
    'msg.device.fallback':    'Device skipped — face-only unlock.',
    'msg.device.enrolled':    'Device enrolled!',
    'msg.device.offer':       'Register this device as a second factor? (fingerprint / Windows Hello)',
    'msg.device.removed':     'Device removed.',

    /* ── Save modal ────────────────────────────────────────────────── */
    'save.title':         'Save files',
    'save.name.label':    'Wallet name',
    'save.name.ph':       'e.g. my-wallet',
    'save.vault.desc':    'Encrypted vault — required on every device to open the wallet.',
    'save.vault.keep':    'KEEP',
    'save.pjson.desc':    'Face data helper — required on a new device for face unlock.',
    'save.pjson.keep':    'KEEP',
    'save.device.warn':   'The previous <strong>{name}.biowallet</strong> (without device) can now be deleted — the new file covers both unlock paths.',
    'save.btn.download':  '↓ Download',
    'save.btn.done':      'Done',
    'save.saved':         '✓ Saved',

    /* ── Confirm modal ─────────────────────────────────────────────── */
    'confirm.title':    'Confirm transaction',
    'confirm.network':  'Network',
    'confirm.to':       'Recipient',
    'confirm.amount':   'Amount',
    'confirm.gas':      'Max. gas',
    'confirm.cancel':   'Cancel',
    'confirm.send':     'Send',
    'confirm.fp.label':  'Transaction fingerprint',
    'confirm.fp.hint':   'Enter the first 4 characters:',
    'confirm.fn.label':  'Function',

    /* ── WC modals ─────────────────────────────────────────────────── */
    'wc.pair.title':       'Connect dApp',
    'wc.pair.desc':        'Open the dApp (e.g. Uniswap), click the <strong style="color:#e8e8f0">WalletConnect</strong> button, copy the URI and paste it here.',
    'wc.pair.cancel':      'Cancel',
    'wc.pair.connect':     'Connect',
    'wc.pair.invalid.uri': 'Invalid WC URI (must start with wc:...).',
    'wc.proposal.label':   'dApp connection request',
    'wc.proposal.unknown': 'Unknown dApp',
    'wc.proposal.info':    'The dApp will read your Ethereum <strong style="color:#e8e8f0">address</strong> and may send signing requests.<br><strong style="color:#4CAF50">Every signature requires a separate face scan.</strong>',
    'wc.proposal.reject':      'Reject',
    'wc.proposal.approve':     'Approve',
    'wc.proposal.guide.link':  'dApp guide — supported operations',
    'wc.sign.label':       'Message signing request',
    'wc.sign.desc':        'The dApp requests you to sign the following message:',
    'wc.sign.reject':      'Reject',
    'wc.sign.sign':        'Face scan + Sign',
    'wc.typed.title':      'EIP-712 Typed Data Signature',
    'wc.typed.desc':       'The dApp requests a structured data signature (e.g. Uniswap permit, OpenSea order).',
    'wc.typed.domain':     'Application / domain',
    'wc.typed.fields':     'Data fields',
    'wc.typed.warn':       '⚠ Only accept from trusted dApps! This signature may authorise a financial operation.',
    'wc.typed.sign':          'Face scan + Sign',
    'wc.addchain.title':      'Add Network',
    'wc.addchain.name':       'Network name',
    'wc.addchain.symbol':     'Native token',
    'wc.addchain.add':        'Add network',
    'wc.watchasset.title':    'Add Token',
    'wc.watchasset.decimals': 'Decimals',
    'wc.watchasset.add':      'Add token',

    /* ── Network modal ─────────────────────────────────────────────── */
    'net.title':          'Select network',
    'net.testnet':        ' · Testnet',
    'net.delete.title':   'Remove',
    'net.delete.confirm': 'Remove: {name}?',
    'net.add.btn':        '+ Add network',
    'net.add.title':      'Add custom network',
    'net.add.csp':        '⚠ The custom network RPC URL is unknown — CSP restrictions may cause connection issues.',
    'net.add.f.name':     'Network name',
    'net.add.f.chain':    'ChainID (number)',
    'net.add.f.rpc':      'RPC URL (https://...)',
    'net.add.f.exp':      'Explorer TX URL (https://.../tx/)',
    'net.add.f.sym':      'Native token symbol (e.g. ETH)',
    'net.add.cancel':     'Cancel',
    'net.add.confirm':    'Add',
    'net.add.err.name':   'Network name is required.',
    'net.add.err.chain':  'Invalid ChainID.',
    'net.add.err.rpc':    'RPC URL must start with https://.',
    'net.add.err.exp':       'Explorer URL must start with https://.',
    'net.add.verifying':     'Verifying RPC...',
    'net.add.err.mismatch':  'Chain ID mismatch: entered {expected}, RPC reports {actual}.',
    'net.add.err.timeout':   'RPC timed out. Check the URL.',
    'net.add.err.rpc.fail':  'RPC unreachable: {msg}',

    /* ── Recovery paper modal ──────────────────────────────────────── */
    'paper.step.label':  '2-STEP PROCESS — STEP 1',
    'paper.title':       'BioWallet — Paper Recovery (Raw data)',
    'paper.desc':        'Write down both papers, then continue in <strong>recovery_tool.html ENCODE</strong> mode — enter your P value there to get the <strong>Final Paper A</strong>.',
    'paper.warn':        '⚠ This is the RAW Paper A — <strong>not yet finalised</strong> with P! Do not store permanently — destroy it after step 2 and keep only Final Paper A.',
    'paper.a.title':     'RAW PAPER A · (raw_A_j) — temporary!',
    'paper.b.title':     'PAPER B · Offsets (r_j)',
    'paper.step2.title': 'STEP 2 — Finalise (offline)',
    'paper.step2.steps': '<li>Open <strong>recovery_tool.html</strong> <strong>offline</strong> (internet disconnected)</li><li>Select the <strong>ENCODE</strong> tab</li><li>Enter the Raw Paper A numbers + your memorised <strong>P value</strong></li><li>Print the resulting <strong>Final Paper A</strong> and store it separately from Paper B</li><li>Destroy the Raw Paper A</li>',
    'paper.step2.note':  '✓ BioWallet never learns your P value — only you and the offline recovery_tool.html can combine them.',
    'paper.btn.print':   '🖨 Print',
    'paper.btn.close':   'Close · erase from memory',

    /* ── Post-import checklist ─────────────────────────────────────── */
    'postimport.badge':   'IMPORT SUCCESSFUL',
    'postimport.title':   'Next steps',
    'postimport.desc':    'Your wallet is biometrically encrypted. Complete these steps in order:',
    'postimport.steps': [
      'Open with face scan → verify the ETH address matches your original wallet.',
      'Generate paper recovery backup (Paper recovery button → recovery_tool.html ENCODE offline).',
      'Once the paper backup is ready and verified: destroy the original seed phrase paper.',
      'Deactivate / delete the original wallet (MetaMask / Ledger).',
    ],
    'postimport.warning': '⚠ Delete the original seed phrase only after the paper backup is complete and verified. There is no going back.',
    'postimport.ok':      'Understood — close',

    /* ── Switch wallet ─────────────────────────────────────────────── */
    'switch.wallet.confirm': 'The current wallet will be removed from this browser.\nThe .biowallet file remains — it can be reloaded at any time.\n\nContinue?',

    /* ── Error messages ────────────────────────────────────────────── */
    'err.unknown':            'Unknown error.',
    'err.camera.unavailable': 'Camera not available. Check browser permissions and try again.',
    'err.scan.timeout':       'Scan timed out. Please try again.',
    'err.self.heal.title':    'Unexpected error occurred',
    'btn.self.heal.restart':  'Restart',
    'err.vault.corrupted': 'Vault file is corrupted. Please reload the .biowallet file or create a new wallet.',
    'err.bio.mismatch':  'Face does not match. Tip: open the wallet in the same browser used for enrollment (Firefox ↔ Chrome use different image processing).',
    'err.expired':       'Biometric token expired — please try again.',
    'err.no.token':      'No valid biometric token — scan your face.',
    'err.vault.mismatch':'Wrong .biowallet file — this does not belong to your wallet.',
    'err.consumed':      'Token already consumed — please try again.',
    'err.paper.privkey': 'Private key wallet — paper recovery formula is not available. Keep your private key stored securely.',
    'err.paper.crc':     'Paper code checksum mismatch — please re-check the entered characters.',
    'msg.vault.v4.no.face.warn': 'Warning: wallet opened without face scan (device + paper). To restore face access, click "Update Face Profile".',
    'msg.vault.v4.legacy.warn':  'This wallet uses an older security format. Click "Update Face Profile" to strengthen protection.',
    'err.worker.crash':  'Crypto module crashed — please reload the page.',
    'err.worker.timeout':'Crypto module did not respond in time — please reload the page.',
    'err.mnemonic':      'Invalid seed phrase — check the words and their order (BIP39 word list).',
    'err.tx.mismatch':   'Transaction fingerprint mismatch — signing blocked.',
    'err.genesis.mismatch': 'Biometric identity does not match the wallet creator — signing blocked.',
    'err.device.prf':    'WebAuthn PRF not supported on this device/browser.',
    'btn.security.advanced': '⚙ Security tools',
    'btn.reenroll':      'Update face profile',
    'btn.reenroll.sub':  'Register a new face scan (e.g. after browser migration)',
    'msg.reenroll.done': 'Face profile updated successfully. Save the new .biowallet file.',
    'msg.reenroll.confirm': 'Update face profile?\n\nThe old paper share becomes invalid — you must write down a new paper share.\n\nContinue?',
    'msg.reenroll.mandatory': '⚠️ Face re-enrollment required',
    'msg.reenroll.mandatory.sub': 'The wallet was opened using paper + device authentication. To restore face-based access on this browser, you must scan your face now. This step cannot be skipped.',
    'msg.reenroll.reminder': 'Face profile was last updated {days} days ago. To prevent access loss due to gradual biometric drift, annual re-enrollment is recommended.',
    'msg.reenroll.reminder.urgent': 'Face profile has not been updated for {days} days — urgent re-enrollment recommended to avoid losing access.',
    'msg.reenroll.reminder.btn': 'Update now',
    'btn.genesis.recover':     'Face Recovery',
    'btn.genesis.recover.sub': 'Face + P file → 12–24 words (emergency recovery)',
    'msg.genesis.recover.scanning': 'Identifying face...',
    'msg.genesis.recover.done':     'Seed recovered — write down your words!',
    'err.genesis.backup.unavailable': 'Genesis backup not available — only works on freshly created v5 wallets.',
    'genesis.recover.preflight.title': '⚠ Emergency Recovery — Security Check',
    'genesis.recover.preflight.body':  'When to use this?\nIf you cannot log in because you have no active device and no paper hash — only your face, P.json and .biowallet file are available.\n\nWhat happens next?\nBioWallet will NOT be unlocked. You will receive your 24 words to access your funds in another wallet (e.g. MetaMask), or you can create a new BioWallet using the import feature.\n\nBefore continuing:\n1. Disconnect from the internet\n2. Make sure no one can see your screen\n3. Prepare paper and pen\n\nThe 24 words will be wiped from memory and clipboard on close.',
    'genesis.recover.preflight.ok':    'I understand — continue',
    'genesis.recover.preflight.cancel':'Cancel',
    'err.genesis.recover.fail': 'Face does not match the wallet creator. Try again in better lighting, looking straight at the camera.',
    'genesis.recover.warning': '⚠ Write down your words on paper! They will be wiped from memory and clipboard on close.',
    'genesis.recover.copy':        'Copy (risky)',
    'genesis.recover.copy.ok':     '✓ Copied',
    'genesis.recover.copy.fail':   '✗ Failed',
    'genesis.recover.close':       'Close & wipe',
    'bf.remaining':      ' · {n} attempts left before lockout',

    /* ── Device enrollment offer (during wallet creation) ─────────── */
    'device.offer.title': 'Set up fingerprint / Face ID',
    'device.offer.body':  'Register this device\'s biometric authenticator (fingerprint / Face ID) as a second factor. Once enrolled, vault opens automatically on this device after a face scan — no PIN or paper formula needed here. You can skip this now and always use your paper formula instead.',
    'device.offer.now':   'Set up now',
    'device.offer.skip':  'Skip',
    'msg.device.relink':  '⚡ This vault has a device factor — click the Device button to restore quick access on this browser.',
    'msg.device.relink.warn': '⚠ Device re-linking available — WARNING: linking a device will INVALIDATE your current paper code! Only proceed if you can immediately write down the NEW paper code.',
    'sss.paper.modal.reenroll.warn': '🔴 YOUR OLD PAPER CODE IS NOW INVALID! This is your NEW code — write it down now. The old paper code will no longer work.',
    'sss.paper.reenroll.confirm2': 'I understand: the old paper code is INVALID — only this NEW code is valid',
    'sss.paper.required.warn': '⚠ Paper code required — no active device on this browser. Enter your paper code before scanning.',
    'sss.lock.paper.required': '🔴 Paper code REQUIRED (no active device on this browser)',

    /* ── Guide modal ───────────────────────────────────────────────── */
    'guide.modal.title': 'BioWallet — User guide',
  },
};

/* ── Info tooltip content ─────────────────────────────────────────────── */

const INFO_CONTENT = {
  hu: {
    enroll: {
      title: 'Wallet létrehozása',
      body: `<p>A BioWallet <strong>nem jelszót, hanem az arcodat</strong> használja kulcsként.</p>
<ol><li>Kattints a gombra — a kamera bekapcsol.</li><li>A rendszer <strong>5 arc-scant</strong> kér egymás után.</li><li>Az arcmintából egyedi titkosítókulcs keletkezik.</li><li>Ezzel a kulccsal titkosít egy <strong>BIP39 seed phrase-t</strong> (24 szó).</li><li>A seed phrase-t soha nem látod — az arc az egyetlen hozzáférés.</li></ol>
<p style="color:#ffa502;font-size:0.8rem;">Mentsd el a papírképletet (Papírképlet gomb) — ez az egyetlen mentési lehetőség!</p>`,
    },
    import: {
      title: 'Wallet importálása',
      body: `<p>Ha már van meglévő Ethereum tárcád (MetaMask, Ledger, Trezor stb.), itt áthozhatod BioWallet-be.</p>
<ol><li>Add meg a <strong>12–24 szavas seed phrase-t vagy privát kulcsodat</strong> a mezőbe.</li><li>Kattints a Regisztráció gombra — a kamera bekapcsol.</li><li>5 arc-scan után a titkos adat arc-biometriával titkosítva tárolódik.</li><li>A wallet ezután csak az arcoddal nyitható meg.</li></ol>
<p style="color:#ffa502;font-size:0.8rem;">Importálás után töröld a seed phrase-t minden más helyről!</p>`,
    },
    restore: {
      title: 'Meglévő wallet visszaállítása',
      body: `<p>Ha korábban már volt BioWallet tárcád és elmentetted a <code>.P.json</code> fájlt, itt töltsd vissza.</p>
<ol><li>Kattints a gombra és válaszd ki a <code>.P.json</code> fájlt.</li><li>A fájl betöltődik — de <strong>zárolva marad</strong>.</li><li>Az arc-scannel nyitható meg, ugyanazzal az arccal, amellyel létrehoztad.</li></ol>
<p style="color:#6b6b80;font-size:0.8rem;">Más eszközre való átvitelhez: mentsd a .P.json fájlt, majd töltsd vissza az új eszközön.</p>`,
    },
    scan: {
      title: 'Megnyitás arc-scannel',
      body: `<p>A privát kulcsot csak az <strong>arcoddal</strong> tudod előhívni.</p>
<ol><li>Kattints a gombra — a kamera bekapcsol.</li><li>Tartsd az arcodat a kamera elé, jól megvilágított helyen.</li><li>A rendszer összehasonlítja a regisztrációkori arcmintával.</li><li>Ha egyeznek: a vault <strong>30 másodpercre</strong> kinyílik.</li><li>Ez idő alatt végezhetsz egy műveletet (küldés, aláírás, dApp kérés).</li><li>Után a vault automatikusan zárol.</li></ol>`,
    },
    send: {
      title: 'ETH / Token küldése',
      body: `<p>ETH-t vagy ERC-20 tokent küldhetsz bármely Ethereum-címre.</p>
<ol><li>Válassz tokent (ETH, USDC, USDT, WETH) a pill gombokkal.</li><li>Add meg a <strong>fogadó címet</strong> (0x… vagy ENS: name.eth).</li><li>Add meg az <strong>összeget</strong>.</li><li>Kattints a Küldés gombra → arc-scan → megerősítés.</li><li>A tranzakció broadcastolódik, TX hash megjelenik.</li></ol>
<p style="color:#6b6b80;font-size:0.8rem;">Minden tranzakció után a vault automatikusan zárol (DCC auto-lock).</p>`,
    },
    wc: {
      title: 'dApp kapcsolat (WalletConnect)',
      body: `<p>WalletConnect lehetővé teszi, hogy a BioWallettel csatlakozz bármely DeFi alkalmazáshoz (Uniswap, OpenSea, Aave stb.).</p>
<ol><li>Nyisd meg a dApp-ot <strong>egy másik böngészőfülön</strong>.</li><li>Kattints: <strong>Connect Wallet → WalletConnect → Copy URI</strong>.</li><li>Másold ki az URI-t (wc:… kezdetű).</li><li>Kattints ide, illeszd be, erősítsd meg.</li><li>Minden tranzakció jóváhagyása <strong>ebben a BioWallet fülben</strong> történik arc-scannel.</li></ol>
<p style="color:#6b6b80;font-size:0.8rem;">Támogatott: ETH küldés, ERC-20, EIP-712 aláírás (Uniswap permit, OpenSea), hálózat- és tokenkezelés.</p>
<p style="margin-top:0.6rem"><a href="/dapp-guide.html" target="_blank" rel="noopener" style="color:#6c63ff;font-weight:600;">↗ Teljes dApp útmutató — támogatott műveletek és kompatibilis alkalmazások</a></p>`,
    },
    paper: {
      title: 'Papírképlet készítése',
      body: `<p>A 24 szavas seed phrase-t a BioWallet <strong>soha nem mutatja meg digitálisan</strong>.</p>
<p>Ehelyett egy <strong>papírra nyomtatható kódot</strong> generál, amelyből offline visszaállítható a tárca — de csak akkor, ha tudod a személyes számodat (P).</p>
<ol><li>Kattints a gombra → arc-scan → a kódok megjelennek.</li><li>Nyomtasd ki vagy írd le a kódokat biztonságos helyre.</li><li>A P számot <strong>soha ne tárolj digitálisan</strong>.</li></ol>
<p style="color:#ffa502;font-size:0.8rem;">Ez az egyetlen mentési lehetőség! Ha elvész a tárca ÉS a papírképlet, a seed visszaszerezhetetlen.</p>`,
    },
    lock: {
      title: 'Azonnali zárolás',
      body: `<p>A privát kulcsot <strong>azonnal törli</strong> a böngésző memóriájából.</p>
<ul><li>Az egyenleg és az Ethereum-cím eltűnik a képernyőről.</li><li>Újbóli hozzáféréshez arc-scan szükséges.</li><li>A titkosított vault a localStorage-ban marad — csak az arc nyitja meg.</li></ul>
<p style="color:#6b6b80;font-size:0.8rem;">Ez automatikusan is megtörténik minden tranzakció és aláírás után (DCC auto-lock).</p>`,
    },
    device: {
      title: 'Eszköz hozzáadása',
      body: `<p>Az eszközregisztráció <strong>WebAuthn PRF</strong> technológiát használ — az ujjlenyomatolvasó vagy Windows Hello az arc-scan mellé második faktorként rögzítődik.</p>
<ol><li>Nyissa meg a vaultot, majd kattintson az <strong>Eszköz hozzáadása</strong> gombra.</li><li>Végezze el a platformbiometrikus azonosítást (Windows Hello / Touch ID / ujjlenyomat).</li><li>Töltse le az <strong>új .biowallet fájlt</strong> — tartalmazza az eszközadatot is.</li></ol>
<p>Ezután ezen az eszközön <strong>PIN-kód nélkül</strong>, csak arc-scannel nyitható meg a vault.</p>
<p style="color:#6b6b80;font-size:0.8rem;">Az eszközadat az adott eszközhöz kötött — más eszközre nem vihető át. Eltávolításhoz: Eszköz eltávolítása gomb.</p>`,
    },
    swap: {
      title: 'Token Swap — hogyan működik?',
      body: `<p>A BioWallet a <strong>Paraswap</strong> aggregátort használja — a legjobb árfolyamot keresi az összes nagy DEX-en (Uniswap, Curve, Balancer stb.).</p>
<table class="guide-table">
  <tr><th>Funkció</th><th></th></tr>
  <tr><td>Fee</td><td><strong>0.15%</strong> a BioWallet treasury-nek (output tokenben)</td></tr>
  <tr><td>Slippage</td><td>max 1% (automatikus)</td></tr>
  <tr><td>Hálózatok</td><td>Ethereum, BSC, Polygon, Arbitrum, Base, Optimism, Avalanche</td></tr>
</table>
<div class="guide-h2" style="margin-top:0.8rem;">Használat</div>
<ol>
  <li>Válaszd ki a <strong>küldendő</strong> és <strong>kapandó</strong> tokent.</li>
  <li>Add meg az összeget → kattints az <strong>Árfolyam</strong> gombra.</li>
  <li>Ellenőrizd a várható kimenetet (USD értékkel együtt).</li>
  <li>Kattints a <strong>Csere</strong> gombra → erősítsd meg a TX ujjlenyomatot → arc-scan.</li>
</ol>
<div class="guide-note">ERC-20 tokenek cseréjéhez (pl. USDC → ETH) egy <strong>Approve lépés</strong> is szükséges — összesen 3 arc-scan: jóváhagyás, vault-újranyitás, csere.</div>
<div class="guide-ok" style="margin-top:0.5rem;">Az árfolyam 30 másodpercig érvényes — utána kérd le újra az <em>Árfolyam</em> gombbal.</div>`,
    },
  },

  en: {
    enroll: {
      title: 'Create wallet',
      body: `<p>BioWallet uses <strong>your face — not a password</strong> — as the key.</p>
<ol><li>Click the button — the camera activates.</li><li>The system takes <strong>5 face scans</strong> in sequence.</li><li>A unique encryption key is derived from your face.</li><li>This key encrypts a <strong>BIP39 seed phrase</strong> (24 words).</li><li>You never see the seed phrase — your face is the only access.</li></ol>
<p style="color:#ffa502;font-size:0.8rem;">Save the paper recovery (Paper recovery button) — it is the only backup method!</p>`,
    },
    import: {
      title: 'Import wallet',
      body: `<p>If you already have an Ethereum wallet (MetaMask, Ledger, Trezor etc.), you can bring it into BioWallet.</p>
<ol><li>Enter your <strong>12–24-word seed phrase or private key</strong> in the text area.</li><li>Click the Enroll button — the camera activates.</li><li>After 5 face scans, your secret is biometrically encrypted.</li><li>The wallet can only be unlocked with your face from now on.</li></ol>
<p style="color:#ffa502;font-size:0.8rem;">After import, delete the seed phrase from everywhere else!</p>`,
    },
    restore: {
      title: 'Restore existing wallet',
      body: `<p>If you previously had a BioWallet and saved the <code>.P.json</code> file, load it here.</p>
<ol><li>Click the button and select the <code>.P.json</code> file.</li><li>The file loads — but the vault stays <strong>locked</strong>.</li><li>Open it with the face scan used during enrollment.</li></ol>
<p style="color:#6b6b80;font-size:0.8rem;">To transfer to another device: copy the .P.json file, then load it on the new device.</p>`,
    },
    scan: {
      title: 'Unlock with face scan',
      body: `<p>The private key can only be retrieved with <strong>your face</strong>.</p>
<ol><li>Click the button — the camera activates.</li><li>Hold your face in front of the camera in good lighting.</li><li>The system compares against the enrollment scan.</li><li>On match: the vault opens for <strong>30 seconds</strong>.</li><li>During this window you can perform one operation.</li><li>The vault auto-locks afterwards.</li></ol>`,
    },
    send: {
      title: 'Send ETH / Token',
      body: `<p>Send ETH or any ERC-20 token to any Ethereum address.</p>
<ol><li>Select the token (ETH, USDC, USDT, WETH) with the pill buttons.</li><li>Enter the <strong>recipient address</strong> (0x… or ENS: name.eth).</li><li>Enter the <strong>amount</strong>.</li><li>Click Send → face scan → confirm.</li><li>The transaction is broadcast and the TX hash appears.</li></ol>
<p style="color:#6b6b80;font-size:0.8rem;">The vault auto-locks after every transaction (DCC auto-lock).</p>`,
    },
    wc: {
      title: 'dApp connection (WalletConnect)',
      body: `<p>WalletConnect lets you connect BioWallet to any DeFi application (Uniswap, OpenSea, Aave etc.).</p>
<ol><li>Open the dApp <strong>in another browser tab</strong>.</li><li>Click: <strong>Connect Wallet → WalletConnect → Copy URI</strong>.</li><li>Copy the URI (starts with wc:…).</li><li>Click here, paste it, confirm.</li><li>All transaction approvals happen <strong>in this BioWallet tab</strong> with face scan.</li></ol>
<p style="color:#6b6b80;font-size:0.8rem;">Supported: ETH send, ERC-20, EIP-712 signing (Uniswap permit, OpenSea), network and token management.</p>
<p style="margin-top:0.6rem"><a href="/dapp-guide.html" target="_blank" rel="noopener" style="color:#6c63ff;font-weight:600;">↗ Full dApp guide — supported operations and compatible apps</a></p>`,
    },
    paper: {
      title: 'Generate paper recovery',
      body: `<p>BioWallet <strong>never displays the 24-word seed phrase digitally</strong>.</p>
<p>Instead it generates a <strong>printable recovery code</strong> that reconstructs the wallet offline — but only if you know your personal number (P).</p>
<ol><li>Click the button → face scan → codes appear.</li><li>Print or write the codes in a safe place.</li><li><strong>Never store the P value digitally.</strong></li></ol>
<p style="color:#ffa502;font-size:0.8rem;">This is the only backup method! If both the vault AND the paper recovery are lost, the seed is unrecoverable.</p>`,
    },
    lock: {
      title: 'Lock immediately',
      body: `<p>The private key is <strong>immediately erased</strong> from browser memory.</p>
<ul><li>The balance and Ethereum address disappear from the screen.</li><li>Face scan is required for access again.</li><li>The encrypted vault remains in localStorage — only the face unlocks it.</li></ul>
<p style="color:#6b6b80;font-size:0.8rem;">This also happens automatically after every transaction and signing (DCC auto-lock guarantee).</p>`,
    },
    device: {
      title: 'Add this device',
      body: `<p>Device enrollment uses <strong>WebAuthn PRF</strong> technology — your fingerprint sensor or Windows Hello is registered as a second factor alongside the face scan.</p>
<ol><li>Open the vault, then click the <strong>Add this device</strong> button.</li><li>Complete the platform biometric authentication (Windows Hello / Touch ID / fingerprint).</li><li>Download the <strong>new .biowallet file</strong> — it now includes the device credential.</li></ol>
<p>On this device the vault will open with <strong>face scan only — no PIN required</strong>.</p>
<p style="color:#6b6b80;font-size:0.8rem;">The device credential is device-bound — it cannot be transferred to another device. To remove: use the Remove device button.</p>`,
    },
    swap: {
      title: 'Token Swap — how it works',
      body: `<p>BioWallet uses the <strong>Paraswap</strong> aggregator — it finds the best rate across all major DEXes (Uniswap, Curve, Balancer etc.).</p>
<table class="guide-table">
  <tr><th>Feature</th><th></th></tr>
  <tr><td>Fee</td><td><strong>0.15%</strong> to BioWallet treasury (in the output token)</td></tr>
  <tr><td>Slippage</td><td>max 1% (automatic)</td></tr>
  <tr><td>Networks</td><td>Ethereum, BSC, Polygon, Arbitrum, Base, Optimism, Avalanche</td></tr>
</table>
<div class="guide-h2" style="margin-top:0.8rem;">How to use</div>
<ol>
  <li>Select the <strong>token to spend</strong> and the <strong>token to receive</strong>.</li>
  <li>Enter the amount → click <strong>Quote</strong>.</li>
  <li>Review the expected output (with USD estimate).</li>
  <li>Click <strong>Swap</strong> → confirm the TX fingerprint → face scan.</li>
</ol>
<div class="guide-note">Swapping ERC-20 tokens (e.g. USDC → ETH) requires an <strong>Approve step</strong> first — 3 face scans total: approve, vault re-open, swap.</div>
<div class="guide-ok" style="margin-top:0.5rem;">The quote is valid for ~30 seconds — click <em>Quote</em> again if it expires.</div>`,
    },
  },
};

/* ── Guide modal HTML ─────────────────────────────────────────────────── */

const GUIDE_HTML = {
  hu: `
    <div class="guide-note" style="border-color:#6c63ff;text-align:center;padding:0.9rem 1rem;margin-bottom:0.2rem">
      <strong style="color:#6c63ff;font-size:1rem">Ajánlott böngésző</strong><br>
      <span style="font-size:0.83rem">Legjobb élmény: <strong>Chrome</strong> (asztali &amp; Android PWA) · <strong>Edge</strong> (asztali)<br>
      Firefox alapvetően működik · <strong style="color:#ffa502">Samsung Internet: nem támogatott</strong> — fájlválasztásnál a kameraválasztó jelenik meg.</span>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">Mi a BioWallet?</div>
      <p class="guide-p">A BioWallet biometrikailag védett Ethereum-tárca. A privát kulcsot <strong>az Ön arca</strong> védi — a titkosítókulcs soha nem tárolódik lemezen, csak arc-scan után keletkezik, és minden művelet után automatikusan törlődik.</p>
      <p class="guide-p"><strong>Háromféle tárca létrehozható:</strong></p>
      <table class="guide-table"><thead><tr><th>Típus</th><th>Forrás</th><th>Mikor?</th></tr></thead><tbody>
        <tr><td><span style="color:#4CAF50;font-weight:700;">NATÍV</span></td><td>BioWallet generálja</td><td>Új tárca létrehozásakor</td></tr>
        <tr><td><span style="color:#ffa502;font-weight:700;">SEED</span></td><td>12–24 szavas seed phrase</td><td>MetaMask HD wallet importálásakor</td></tr>
        <tr><td><span style="color:#ff6b35;font-weight:700;">PRIVKULCS</span></td><td>0x... hex privát kulcs</td><td>MetaMask importált fiók importálásakor</td></tr>
      </tbody></table>
      <p class="guide-p" style="margin-top:0.5rem">Technológia: BCH hibajavító kód · DCC kauzális lánc · AES-256-GCM · WebAuthn PRF · Web Worker kripto-sandbox. Formálisan bizonyított: Z3 SMT solver.</p>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">1. Wallet létrehozása (natív)</div>
      <ol class="guide-ol"><li>Kattintson a <strong>Wallet létrehozása</strong> gombra.</li><li>Nézzen egyenesen a kamerába — 5 arc-scan (~10 mp).</li><li>Megjelenik a <strong>mentési modal</strong> — adjon nevet a tárcának, majd töltse le mindkét fájlt:</li></ol>
      <table class="guide-table" style="margin-top:0.4rem"><thead><tr><th>Fájl</th><th>Tartalom</th><th>Tárolás</th></tr></thead><tbody>
        <tr><td><code style="font-size:0.75rem">*.biowallet</code></td><td>Titkosított kulcstartó (AES-256-GCM)</td><td>MEGŐRZENDŐ</td></tr>
        <tr><td><code style="font-size:0.75rem">*.P.json</code></td><td>Arcadat helper — BCH szindróma, NEM arc-kép</td><td>MEGŐRZENDŐ</td></tr>
      </tbody></table>
      <div class="guide-note">⚠ Mentse mindkét fájlt biztonságos helyre. Elvesztésük esetén — seed phrase backup nélkül — a wallet visszaállíthatatlan.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">2. Wallet importálása (MetaMask)</div>
      <p class="guide-p">Meglévő MetaMask tárcát kétféleképpen importálhat:</p>
      <table class="guide-table"><thead><tr><th>Forrás</th><th>Mit kell megadni</th><th>Eredmény</th></tr></thead><tbody>
        <tr><td><strong>Seed phrase</strong></td><td>12, 15, 18, 21 vagy 24 szó</td><td>Ugyanaz az Ethereum cím, mint a MetaMask HD tárcánál</td></tr>
        <tr><td><strong>Privát kulcs</strong></td><td>0x... (64 hex karakter)</td><td>MetaMask importált fiók — ugyanaz a cím</td></tr>
      </tbody></table>
      <ol class="guide-ol" style="margin-top:0.5rem"><li>Setup panel → <strong>Wallet importálása</strong>.</li><li>Válassza ki a fület: <strong>12/24 szó</strong> vagy <strong>Privát kulcs</strong>.</li><li>Írja be az adatokat (a szöveg homályos, kattintson bele).</li><li>5 arc-scan → papír share megjelenítés → mentési modal.</li><li>Importálás után ellenőrizze, hogy az Ethereum-cím egyezik az eredeti tárcájéval!</li></ol>
      <div class="guide-ok">✓ Az adatok soha nem hagyják el a böngészőt — ellenőrizhető: DevTools → Network → nincs kérés beírás közben.</div>
      <div class="guide-note">⚠ <strong>Privát kulcsos tárca:</strong> a Papírképlet készítése funkció nem elérhető — nincs BIP39 seed phrase. Mentse el a privát kulcsát máshol is.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">3. Vault megnyitása</div>
      <p class="guide-p" style="font-weight:600;color:#a0a0b0;font-size:0.78rem;margin-bottom:0.4rem;">Ugyanaz az eszköz (első megnyitás után):</p>
      <ol class="guide-ol"><li>Arc-scan (3 scan, ~5 mp).</li><li>A vault automatikusan betöltődik — nincs fájlválasztás.</li></ol>
      <p class="guide-p" style="font-weight:600;color:#a0a0b0;font-size:0.78rem;margin:0.6rem 0 0.4rem;">Új eszköz / böngésző:</p>
      <ol class="guide-ol"><li>Setup → <strong>Meglévő wallet visszaállítása</strong> → töltse be a <code style="font-size:0.75rem">*.P.json</code> fájlt → 5 arc-scan.</li><li>Lock panel: arc-scan + <code style="font-size:0.75rem">*.biowallet</code> kiválasztása.</li></ol>
      <div class="guide-ok">✓ Az időablakot a TTL-csíkok mutatják valós időben. Sikeres egyezés esetén 30 mp-es ablak nyílik.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">4. Több tárca kezelése</div>
      <p class="guide-p">A BioWallet egyszerre több tárcát tud kezelni — mindegyik arc-scannel nyílik meg.</p>
      <ol class="guide-ol"><li>Vault panel → <strong>Másik wallet / importálás</strong> gomb.</li><li>Megjelenik a tárca-választó — minden tárca neve, Ethereum-cím-előnézete és típusjele látható.</li><li>Kattintson a <strong>Megnyitás</strong> gombra a kívánt tárca mellé → lock panel jelenik meg az adott tárcával.</li><li>Új tárca hozzáadásához kattintson a <strong>+ Új tárca hozzáadása</strong> gombra.</li></ol>
      <table class="guide-table" style="margin-top:0.4rem"><thead><tr><th>Jel</th><th>Tárca típusa</th></tr></thead><tbody>
        <tr><td><span style="color:#4CAF50;font-weight:700;border:1px solid #4CAF50;padding:1px 4px;border-radius:3px;font-size:0.75rem;">NATÍV</span></td><td>BioWallet által generált tárca</td></tr>
        <tr><td><span style="color:#ffa502;font-weight:700;border:1px solid #ffa502;padding:1px 4px;border-radius:3px;font-size:0.75rem;">SEED</span></td><td>Seed phrase alapú import (MetaMask HD)</td></tr>
        <tr><td><span style="color:#ff6b35;font-weight:700;border:1px solid #ff6b35;padding:1px 4px;border-radius:3px;font-size:0.75rem;">PRIVKULCS</span></td><td>Privát kulcs alapú import</td></tr>
      </tbody></table>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">5. Eszköz regisztrálása (opcionális)</div>
      <p class="guide-p">PIN helyett <strong>Windows Hello / Touch ID / ujjlenyomat</strong> is lehet második faktor — csak ezen az eszközön érvényes.</p>
      <ol class="guide-ol"><li>Vault megnyitása → <strong>Eszköz hozzáadása</strong> gomb.</li><li>Végezze el a platformbiometrikus azonosítást.</li><li>Töltse le az <strong>új .biowallet fájlt</strong> (tartalmazza az eszközadatot).</li></ol>
      <div class="guide-ok">✓ Ezután ezen az eszközön csak arc-scannel megnyílik a vault — PIN nem szükséges.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">6. ETH küldése</div>
      <ol class="guide-ol"><li>Adja meg a fogadó Ethereum-cím (0x… vagy ENS) és az összeget.</li><li>Kattintson az <strong>ETH küldése</strong> gombra — díjbecslés + egyenlegellenőrzés.</li><li>A <strong>megerősítő ablakban</strong> ellenőrizze a részleteket. Ha a tranzakció okosszerződés-hívást tartalmaz, a <strong>Művelet</strong> sor megmutatja a hívott függvényt (pl. <code style="font-size:0.75rem">transfer()</code>).</li><li>Írja be az ujjlenyomat első <strong>4 karakterét</strong> — ez a tranzakcióhoz köti az aláírást.</li><li>Arc-scan (10 mp-es aláírási ablak) → vault automatikusan <strong>zárolódik</strong>.</li></ol>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">7. Biztonsági útmutató</div>
      <table class="guide-table"><thead><tr><th>Adat</th><th>Hol tárolja?</th><th>Nyilvános?</th></tr></thead><tbody>
        <tr><td><code style="font-size:0.75rem">*.biowallet</code></td><td>Pendrive / titkosított felhő</td><td>NEM</td></tr>
        <tr><td><code style="font-size:0.75rem">*.P.json</code></td><td>Pendrive / titkosított felhő</td><td>NEM</td></tr>
        <tr><td>Seed phrase / privát kulcs</td><td>Papír, páncélszekrény</td><td>SOHA</td></tr>
        <tr><td>Ethereum cím</td><td>Bárhol</td><td>Igen</td></tr>
      </tbody></table>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">8. recovery_tool.html — offline visszafejtő</div>
      <p class="guide-p">A <strong>recovery_tool.html</strong> teljesen offline működő HTML eszköz a Papírképlet kezeléséhez. Csak <strong>natív és seed phrase</strong> tárcáknál érhető el.</p>
      <p class="guide-p"><strong>Letöltés:</strong> <a href="/recovery_tool.html" target="_blank" rel="noopener" style="color:#6c63ff;font-weight:600;">biowallet.metaspace.bio/recovery_tool.html</a></p>
      <table class="guide-table" style="margin-top:0.5rem"><thead><tr><th>Mód</th><th>Mit csinál?</th></tr></thead><tbody>
        <tr><td><strong>ENCODE</strong></td><td>Nyers Papír A + P → <strong>Végleges Papír A</strong> (ezt kell eltenni)</td></tr>
        <tr><td><strong>DECODE</strong></td><td>Végleges Papír A + Papír B + P → <strong>12 vagy 24 BIP39 szó</strong> → MetaMask import</td></tr>
      </tbody></table>
      <div class="guide-ok" style="margin-top:0.5rem">✓ ENCODE után semmisítse meg a Nyers Papír A-t. Papír A-t és B-t <strong>különböző helyen</strong> tárolja.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">9. Hibaelhárítás</div>
      <table class="guide-table"><thead><tr><th>Hibaüzenet / jelenség</th><th>Teendő</th></tr></thead><tbody>
        <tr><td><span class="guide-badge badge-err">BIO_MISMATCH</span></td><td>Arc nem egyezik — ugyanabban a böngészőben próbálja (Firefox ↔ Chrome eltérő feldolgozás)</td></tr>
        <tr><td><span class="guide-badge badge-err">EXPIRED</span></td><td>Az időablak lejárt — indítson új arc-scant</td></tr>
        <tr><td><span class="guide-badge badge-err">TX_MISMATCH</span></td><td>Ujjlenyomat nem egyezett — tranzakció módosult, aláírás blokkolva</td></tr>
        <tr><td><span class="guide-badge badge-err">Papírképlet nem elérhető</span></td><td>Privát kulcsos tárca — nincs BIP39 seed phrase, a funkció nem alkalmazható</td></tr>
        <tr><td><span class="guide-badge badge-err">Papír kód ellenőrző összeg hiba</span></td><td>Elírás a papír kódban — ellenőrizze a karaktereket egyenként</td></tr>
        <tr><td><span class="guide-badge badge-sym">Vault nem nyílik</span></td><td>Ugyanaz a böngésző kell, amellyel regisztrált. Ellenőrizze a .P.json és .biowallet fájlokat.</td></tr>
        <tr><td><span class="guide-badge badge-err">Kamera hiba</span></td><td>HTTPS szükséges; helyi tesztnél: <code style="font-size:0.72rem">http://localhost:8080</code></td></tr>
        <tr><td><span class="guide-badge badge-sym">Samsung Internet böngésző</span></td><td><strong>Nem támogatott.</strong> Használjon <strong>Chrome-ot</strong> (lehetőleg PWA-ként telepítve).</td></tr>
      </tbody></table>
      <div class="guide-ok" style="margin-top:0.7rem">✓ Tipp: egyenes tartás, közvetlen fényforrás szemből, kerülje az erős háttérvilágítást.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">8. PWA telepítés</div>
      <p class="guide-p">A BioWallet elérhető és közvetlenül a böngészőből telepíthető alkalmazásként (PWA):</p>
      <p class="guide-p" style="text-align:center;margin:0.5rem 0"><a href="https://biowallet.metaspace.bio" target="_blank" rel="noopener" style="color:#6c63ff;font-weight:700;font-size:1rem;">https://biowallet.metaspace.bio</a></p>
      <table class="guide-table" style="margin-top:0.4rem"><thead><tr><th>Platform</th><th>Telepítés</th></tr></thead><tbody>
        <tr><td>Chrome / Edge (asztali)</td><td>Telepítés ikon (⊕) a böngésző-sávban → Telepítés</td></tr>
        <tr><td>Chrome (Android)</td><td>Menü (⋮) → Hozzáadás a kezdőképernyőhöz</td></tr>
        <tr><td>iOS Safari</td><td>Megosztás (□↑) → Hozzáadás a főképernyőhöz</td></tr>
      </tbody></table>
      <div class="guide-ok" style="margin-top:0.5rem">✓ PWA módban offline is működik — arc-scan + vault megnyitás internet nélkül is.</div>
      <div class="guide-note" style="margin-top:0.4rem">⚠ ETH küldés és egyenleglekérdezés internetkapcsolatot igényel. Offline módban a tranzakció nem tárolódik — net nélkül a küldés meghiúsul.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">9. Kanonikus verzió és alkotmányvédelem</div>
      <p class="guide-p"><strong style="color:#ffa502;">Csak a hivatalos telepítési forrásból telepített alkalmazás megbízható.</strong></p>
      <p class="guide-p">A BioWallet kanonikus, ellenőrzött példánya kizárólag itt érhető el:</p>
      <p class="guide-p" style="text-align:center;margin:0.5rem 0"><a href="https://biowallet.metaspace.bio" target="_blank" rel="noopener" style="color:#6c63ff;font-weight:700;font-size:1rem;">https://biowallet.metaspace.bio</a></p>
      <p class="guide-p">A forráskód nyilvános, de a <strong>DCC alkotmány</strong> (<code style="font-size:0.75rem">spec/biowallet.bio</code>) módosítása kriptográfiailag detektálható — az eredeti fájl SHA-256 lenyomata blokkláncon rögzített:</p>
      <div class="guide-ok" style="font-family:'SF Mono','Fira Code',monospace;font-size:0.67rem;word-break:break-all;margin-top:0.4rem">
        793cac74939d658e3cebde0e8066b2ac754ab34e9c85657043c5f58a0a1866e2<br>
        <span style="color:var(--muted)">Arbitrum One · TX: 0x1c1c485f19fdc1a7f448f06ea8e8c5d0ef0094640cf376e11f42ae14f264a35c</span>
      </div>
      <div class="guide-note" style="margin-top:0.6rem">⚠ Ha olyan "BioWallet" alkalmazást lát, amely <strong>nem a fenti URL-ről</strong> érhető el, ne használja — a biztonsági alkotmány módosítva lehet. Ellenőrizze a hash-t: <code style="font-size:0.72rem">sha256sum spec/biowallet.bio</code></div>
    </div>
    <hr class="guide-sep">
    <p style="font-size:0.75rem;color:var(--muted);text-align:center;line-height:1.9">
      Nyílt forráskód · <a href="https://github.com/LemonScripter/biowallet" target="_blank" rel="noopener" style="color:#6c63ff;">github.com/LemonScripter/biowallet</a><br>
      <span style="font-size:0.68rem">MetaSpace.Bio Logic Engine · metaspace.bio</span>
    </p>`,

  en: `
    <div class="guide-note" style="border-color:#6c63ff;text-align:center;padding:0.9rem 1rem;margin-bottom:0.2rem">
      <strong style="color:#6c63ff;font-size:1rem">Recommended browser</strong><br>
      <span style="font-size:0.83rem">Best experience: <strong>Chrome</strong> (desktop &amp; Android PWA) · <strong>Edge</strong> (desktop)<br>
      Firefox works with basic support · <strong style="color:#ffa502">Samsung Internet: not supported</strong> — file picker shows camera chooser.</span>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">What is BioWallet?</div>
      <p class="guide-p">BioWallet is a biometrically protected Ethereum wallet. Your private key is protected by <strong>your face</strong> — the encryption key is derived solely from your face scan, never stored on disk, and erased after every operation.</p>
      <p class="guide-p"><strong>Three wallet types are supported:</strong></p>
      <table class="guide-table"><thead><tr><th>Type</th><th>Source</th><th>When?</th></tr></thead><tbody>
        <tr><td><span style="color:#4CAF50;font-weight:700;">NATIVE</span></td><td>Generated by BioWallet</td><td>New wallet creation</td></tr>
        <tr><td><span style="color:#ffa502;font-weight:700;">SEED</span></td><td>12–24-word seed phrase</td><td>Importing a MetaMask HD wallet</td></tr>
        <tr><td><span style="color:#ff6b35;font-weight:700;">PRIVKEY</span></td><td>0x... hex private key</td><td>Importing a MetaMask imported account</td></tr>
      </tbody></table>
      <p class="guide-p" style="margin-top:0.5rem">Technology: BCH error-correcting code · DCC causal chain · AES-256-GCM · WebAuthn PRF · Web Worker crypto sandbox. Formally verified: Z3 SMT solver.</p>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">1. Create wallet (native)</div>
      <ol class="guide-ol"><li>Click <strong>Create wallet</strong>.</li><li>Look straight into the camera — 5 face scans (~10 seconds).</li><li>A <strong>save dialog</strong> appears — name your wallet and download both files:</li></ol>
      <table class="guide-table" style="margin-top:0.4rem"><thead><tr><th>File</th><th>Contents</th><th>Storage</th></tr></thead><tbody>
        <tr><td><code style="font-size:0.75rem">*.biowallet</code></td><td>Encrypted key store (AES-256-GCM)</td><td>KEEP</td></tr>
        <tr><td><code style="font-size:0.75rem">*.P.json</code></td><td>Biometric helper — BCH syndrome, NOT a face image</td><td>KEEP</td></tr>
      </tbody></table>
      <div class="guide-note">⚠ Save both files securely. Without them — and without a seed phrase backup — the wallet is unrecoverable.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">2. Import wallet (MetaMask)</div>
      <p class="guide-p">Import an existing MetaMask wallet in two ways:</p>
      <table class="guide-table"><thead><tr><th>Source</th><th>What to enter</th><th>Result</th></tr></thead><tbody>
        <tr><td><strong>Seed phrase</strong></td><td>12, 15, 18, 21 or 24 words</td><td>Same Ethereum address as MetaMask HD wallet</td></tr>
        <tr><td><strong>Private key</strong></td><td>0x... (64 hex chars)</td><td>MetaMask imported account — same address</td></tr>
      </tbody></table>
      <ol class="guide-ol" style="margin-top:0.5rem"><li>Setup → <strong>Import wallet</strong>.</li><li>Choose tab: <strong>12/24 words</strong> or <strong>Private key</strong>.</li><li>Enter your data (text is blurred — click to type).</li><li>5 face scans → paper share display → save dialog.</li><li>After import verify the Ethereum address matches your original wallet.</li></ol>
      <div class="guide-ok">✓ Your data never leaves the browser — verifiable: DevTools → Network → no request sent while typing.</div>
      <div class="guide-note">⚠ <strong>Private key wallets:</strong> the Paper recovery feature is unavailable — there is no BIP39 seed phrase. Store your private key separately.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">3. Open vault</div>
      <p class="guide-p" style="font-weight:600;color:#a0a0b0;font-size:0.78rem;margin-bottom:0.4rem;">Same device (after first open):</p>
      <ol class="guide-ol"><li>Face scan (3 scans, ~5 seconds).</li><li>The vault loads automatically — no file picker.</li></ol>
      <p class="guide-p" style="font-weight:600;color:#a0a0b0;font-size:0.78rem;margin:0.6rem 0 0.4rem;">New device / browser:</p>
      <ol class="guide-ol"><li>Setup → <strong>Restore existing wallet</strong> → load your <code style="font-size:0.75rem">*.P.json</code> → 5 face scans.</li><li>Lock panel: face scan + select <code style="font-size:0.75rem">*.biowallet</code>.</li></ol>
      <div class="guide-ok">✓ The TTL bars show remaining time in real time. A 30-second window opens on success.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">4. Multiple wallets</div>
      <p class="guide-p">BioWallet manages multiple wallets — each opens with face scan.</p>
      <ol class="guide-ol"><li>Vault panel → <strong>Switch wallet / import</strong> button.</li><li>The wallet switcher shows all wallets with name, address preview and type badge.</li><li>Click <strong>Open</strong> next to a wallet → lock panel for that wallet.</li><li>To add a wallet click <strong>+ Add new wallet</strong>.</li></ol>
      <table class="guide-table" style="margin-top:0.4rem"><thead><tr><th>Badge</th><th>Wallet type</th></tr></thead><tbody>
        <tr><td><span style="color:#4CAF50;font-weight:700;border:1px solid #4CAF50;padding:1px 4px;border-radius:3px;font-size:0.75rem;">NATIVE</span></td><td>BioWallet-generated wallet</td></tr>
        <tr><td><span style="color:#ffa502;font-weight:700;border:1px solid #ffa502;padding:1px 4px;border-radius:3px;font-size:0.75rem;">SEED</span></td><td>Seed phrase import (MetaMask HD)</td></tr>
        <tr><td><span style="color:#ff6b35;font-weight:700;border:1px solid #ff6b35;padding:1px 4px;border-radius:3px;font-size:0.75rem;">PRIVKEY</span></td><td>Private key import</td></tr>
      </tbody></table>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">5. Register device (optional)</div>
      <p class="guide-p">Use <strong>Windows Hello / Touch ID / fingerprint</strong> as second factor — valid on this device only.</p>
      <ol class="guide-ol"><li>Open vault → click <strong>Add this device</strong>.</li><li>Complete platform biometric authentication.</li><li>Download the <strong>new .biowallet file</strong> (includes device data).</li></ol>
      <div class="guide-ok">✓ On this device the vault now opens with face scan only — no PIN required.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">6. Send ETH</div>
      <ol class="guide-ol"><li>Enter the recipient address (0x… or ENS) and amount.</li><li>Click <strong>Send ETH</strong> — fee estimation + balance check.</li><li>The <strong>confirmation dialog</strong> shows transaction details. If the transaction calls a contract, the <strong>Function</strong> row shows the called function (e.g. <code style="font-size:0.75rem">transfer()</code>).</li><li>Type the first <strong>4 characters</strong> of the fingerprint — binds the signature to the exact transaction.</li><li>Face scan (10-second window) → vault auto-<strong>locks</strong>.</li></ol>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">7. Security guide</div>
      <table class="guide-table"><thead><tr><th>Data</th><th>Where to store</th><th>Public?</th></tr></thead><tbody>
        <tr><td><code style="font-size:0.75rem">*.biowallet</code></td><td>USB drive / encrypted cloud</td><td>NO</td></tr>
        <tr><td><code style="font-size:0.75rem">*.P.json</code></td><td>USB drive / encrypted cloud</td><td>NO</td></tr>
        <tr><td>Seed phrase / private key</td><td>Paper, fireproof safe</td><td>NEVER</td></tr>
        <tr><td>Ethereum address</td><td>Anywhere</td><td>Yes</td></tr>
      </tbody></table>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">8. recovery_tool.html — offline decoder</div>
      <p class="guide-p">Standalone fully offline HTML tool for Paper Recovery. Available for <strong>native and seed phrase wallets only</strong>.</p>
      <p class="guide-p"><strong>Download:</strong> <a href="/recovery_tool.html" target="_blank" rel="noopener" style="color:#6c63ff;font-weight:600;">biowallet.metaspace.bio/recovery_tool.html</a></p>
      <table class="guide-table" style="margin-top:0.5rem"><thead><tr><th>Mode</th><th>What it does</th></tr></thead><tbody>
        <tr><td><strong>ENCODE</strong></td><td>Raw Paper A + P → <strong>Final Paper A</strong> (keep this)</td></tr>
        <tr><td><strong>DECODE</strong></td><td>Final Paper A + Paper B + P → <strong>12 or 24 BIP39 words</strong> → MetaMask import</td></tr>
      </tbody></table>
      <div class="guide-ok" style="margin-top:0.5rem">✓ After ENCODE destroy Raw Paper A. Store Paper A and B in <strong>separate locations</strong>.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">9. Troubleshooting</div>
      <table class="guide-table"><thead><tr><th>Error / symptom</th><th>Action</th></tr></thead><tbody>
        <tr><td><span class="guide-badge badge-err">BIO_MISMATCH</span></td><td>Face does not match — use the same browser as enrollment (Firefox ↔ Chrome differ)</td></tr>
        <tr><td><span class="guide-badge badge-err">EXPIRED</span></td><td>Window expired — start a new face scan</td></tr>
        <tr><td><span class="guide-badge badge-err">TX_MISMATCH</span></td><td>Fingerprint mismatch — transaction was altered, signing blocked</td></tr>
        <tr><td><span class="guide-badge badge-err">Paper recovery unavailable</span></td><td>Private key wallet — no BIP39 seed phrase, feature not applicable</td></tr>
        <tr><td><span class="guide-badge badge-err">Paper code checksum error</span></td><td>Typo in paper code — check each character carefully</td></tr>
        <tr><td><span class="guide-badge badge-sym">Vault won't open</span></td><td>Use the same browser used for enrollment. Check .P.json and .biowallet files.</td></tr>
        <tr><td><span class="guide-badge badge-err">Camera error</span></td><td>HTTPS required; for local testing: <code style="font-size:0.72rem">http://localhost:8080</code></td></tr>
        <tr><td><span class="guide-badge badge-sym">Samsung Internet browser</span></td><td><strong>Not supported.</strong> Use <strong>Chrome</strong> (preferably installed as a PWA).</td></tr>
      </tbody></table>
      <div class="guide-ok" style="margin-top:0.7rem">✓ Tip: hold head straight, direct front lighting, avoid strong backlight.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">8. Install as PWA</div>
      <p class="guide-p">BioWallet is available and installable directly from the browser (PWA):</p>
      <p class="guide-p" style="text-align:center;margin:0.5rem 0"><a href="https://biowallet.metaspace.bio" target="_blank" rel="noopener" style="color:#6c63ff;font-weight:700;font-size:1rem;">https://biowallet.metaspace.bio</a></p>
      <table class="guide-table" style="margin-top:0.4rem"><thead><tr><th>Platform</th><th>How to install</th></tr></thead><tbody>
        <tr><td>Chrome / Edge (desktop)</td><td>Install icon (⊕) in the address bar → Install</td></tr>
        <tr><td>Chrome (Android)</td><td>Menu (⋮) → Add to home screen</td></tr>
        <tr><td>iOS Safari</td><td>Share (□↑) → Add to Home Screen</td></tr>
      </tbody></table>
      <div class="guide-ok" style="margin-top:0.5rem">✓ Works offline in PWA mode — face scan + vault open without internet.</div>
      <div class="guide-note" style="margin-top:0.4rem">⚠ ETH send and balance queries require an internet connection. Transactions are not queued offline — sending will fail without a network.</div>
    </div>
    <hr class="guide-sep">
    <div class="guide-section">
      <div class="guide-h2">9. Canonical version &amp; constitution protection</div>
      <p class="guide-p"><strong style="color:#ffa502;">Only the app installed from the official source is trustworthy.</strong></p>
      <p class="guide-p">The canonical, verified instance of BioWallet is available exclusively at:</p>
      <p class="guide-p" style="text-align:center;margin:0.5rem 0"><a href="https://biowallet.metaspace.bio" target="_blank" rel="noopener" style="color:#6c63ff;font-weight:700;font-size:1rem;">https://biowallet.metaspace.bio</a></p>
      <p class="guide-p">The source code is open, but any modification to the <strong>DCC constitution</strong> (<code style="font-size:0.75rem">spec/biowallet.bio</code>) is cryptographically detectable — the original file's SHA-256 fingerprint is anchored on-chain:</p>
      <div class="guide-ok" style="font-family:'SF Mono','Fira Code',monospace;font-size:0.67rem;word-break:break-all;margin-top:0.4rem">
        793cac74939d658e3cebde0e8066b2ac754ab34e9c85657043c5f58a0a1866e2<br>
        <span style="color:var(--muted)">Arbitrum One · TX: 0x1c1c485f19fdc1a7f448f06ea8e8c5d0ef0094640cf376e11f42ae14f264a35c</span>
      </div>
      <div class="guide-note" style="margin-top:0.6rem">⚠ If you encounter a "BioWallet" app <strong>not served from the URL above</strong>, do not use it — the security constitution may have been altered. Verify the hash: <code style="font-size:0.72rem">sha256sum spec/biowallet.bio</code></div>
    </div>
    <hr class="guide-sep">
    <p style="font-size:0.75rem;color:var(--muted);text-align:center;line-height:1.9">
      Open source · <a href="https://github.com/LemonScripter/biowallet" target="_blank" rel="noopener" style="color:#6c63ff;">github.com/LemonScripter/biowallet</a><br>
      <span style="font-size:0.68rem">MetaSpace.Bio Logic Engine · metaspace.bio</span>
    </p>`,
};

/* ── Public API ───────────────────────────────────────────────────────── */

let _lang = localStorage.getItem('bw_lang') ?? 'hu';

export function getLang()       { return _lang; }

export function setLang(lang) {
  _lang = lang;
  localStorage.setItem('bw_lang', lang);
  applyI18n();
}

export function t(key, vars = {}) {
  const str = (STRINGS[_lang] ?? STRINGS.hu)[key] ?? key;
  if (typeof str !== 'string') return key;
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), str
  );
}

export function tArr(key) {
  return ((STRINGS[_lang] ?? STRINGS.hu)[key]) ?? [];
}

export function getInfoContent(key) {
  return (INFO_CONTENT[_lang] ?? INFO_CONTENT.hu)[key];
}

export function getGuideHTML() {
  return GUIDE_HTML[_lang] ?? GUIDE_HTML.hu;
}

export function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  document.querySelectorAll('[data-i18n-href]').forEach(el => {
    el.href = t(el.dataset.i18nHref);
  });
  document.documentElement.lang = _lang;
}
