# BioWallet — Tudományos háttér

> **English version:** [scientific-background.md](scientific-background.md)

A BioWallet több kriptográfiai és formális verifikációs technikát kombinál egy olyan tárca megvalósítása érdekében, amelynek nincs tárolt jelszava és nincs tárolt privát kulcsa. Ez a dokumentum az elméleti alapokat mutatja be, implementációs belső adatok nélkül.

---

## 1. Biometriai kulcslevezetés — BCH fuzzy extractor

### A probléma

Az arc-scan egy `Float32Array[128]` beágyazási vektort (FaceNet / face-api.js) produkál. Ugyanazon arc két különböző scan-jén kismértékben eltérő vektorok keletkeznek — megvilágítás, szög és kamerazaj mind eltérítik az eredményt. Egy szimmetrikus kulcslevezetési függvény *azonos* inputot igényel. Egy nyers arc-embedding ezért nem használható közvetlenül kulcsanyagként.

### Megoldás: BCH hibajavító fuzzy extractor

A BioWallet a 128 dimenziós beágyazást egy tömör bináris lánccá kvantálja, majd **GF(2⁸) feletti BCH hibajavító kódot** alkalmaz a regisztrálási és a hitelesítési scan közötti eltérés áthidalására.

| Paraméter | Érték | Jelentés |
|-----------|-------|---------|
| Kódszó hossza | n = 255 | 255 bites kódszó, GF(2⁸), prím polinom 0x11D |
| Üzenethossz | k = 55 | 55 bit biometriai entrópia |
| Hibajavítás | t = 25 | Legfeljebb 25 bit-hiba tolerálható a scanek között |
| Min. Hamming-távolság | d ≥ 51 | Két különböző arc legalább 51 bitben eltér |

**Regisztráláskor:** a kvantált kódszó `b` BCH-kódolásával szindróma `s` keletkezik. A szindróma a `.P.json` helper fájlban tárolódik.

**Hitelesítéskor:** az élő beágyazás `b'`-re kvantálódik; a tárolt szindrómával végzett BCH-dekódolás legfeljebb `t` bit-hibát javít, és visszaállítja az eredeti `b`-t. Ebből HKDF vezeti le a determinisztikus 256 bites `face_R` titkot.

**Biztonsági tulajdonság:** a `.P.json` fájl a szindrómát `s` és egy `W_seed` magot tartalmaz. Ezek BCH helper adatok — egy jelszó-salthoz hasonlóan. Csak akkor teszik lehetővé a `face_R` újralevezetését, ha biometriailag egyező arcot mutatnak be; önmagukban nem fedik fel a `face_R` értékét.

---

## 2. Vault titkosítás — csomagolt kulcs architektúra

### Kulcs-szétválasztás

A BioWallet soha nem vezeti le közvetlenül a vault-kulcsot a biometriából. Ehelyett:

1. Egy **véletlenszerű 32 bájtos vault-kulcs** keletkezik a regisztráláskor — soha nem tárolódik.
2. A vault-kulcsot egy vagy két levezetett kulcs **AES-GCM-mel csomagolja**:
   - **faceWrap kulcs** (mindig jelen van): `PBKDF2-SHA-256(face_R ‖ PIN_bájtok, salt, 300 000 iteráció)`
   - **deviceWrap kulcs** (opcionális): `HKDF-SHA-256(face_R ‖ device_prf, salt, info="biowallet-device-v2")`

Ez a szétválasztás lehetővé teszi, hogy az eszközfaktor hozzáadható vagy visszavonható legyen a biometrikus újraregisztráció nélkül.

### Miért 300 000 iterációs PBKDF2?

A 300 000 iterációs PBKDF2 az offline brute-force támadásokat számítási szempontból megdrágítja, még akkor is, ha a támadónak rendelkezésére áll a `.biowallet` fájl és a `.P.json` helper adat is. A `face_R` elé PBKDF2-be fűzött PIN-kód független második faktort jelent: a rossz PIN a levezetett kulcs minden output bitjét megváltoztatja, így a biometriai eltérés és a PIN-eltérés a támadó számára megkülönböztethetetlen.

### AES-256-GCM hitelesítés

Az AES-GCM egyszerre nyújt titkosítást és hitelesítést. A rossz arc, a rossz PIN vagy a rossz eszköz PRF helytelen levezetett kulcsot produkál; a GCM hitelesítési tag *azelőtt* meghiúsul, hogy bármilyen nyílt szöveget lehetne elérni. Nincs külön "rossz jelszó" ellenőrzés — a GCM tag-hiba az egyetlen jelzés.

Minden kriptográfiai művelet a böngésző natív Web Cryptography API-ján fut (`crypto.subtle`). Nincs egyedi AES implementáció.

---

## 3. WebAuthn PRF — eszköz második faktor

Ha egy platformhitelesítő (ujjlenyomat-olvasó, Windows Hello, Touch ID) regisztrálásra kerül, a BioWallet a **WebAuthn PRF kiterjesztést** használja egy 32 bájtos, hitelesítőhöz kötött determinisztikus `device_prf` titok megszerzéséhez. Ez a titok:

- **Az adott hitelesítő adathoz kötött** — más hitelesítőn nem reprodukálható
- **Kombinálódik a `face_R`-rel** HKDF előtt: `HKDF(face_R ‖ device_prf, salt, info="biowallet-device-v2")` → eszköz vault-kulcs
- **Önmagában nem elégséges**: az arc-scan továbbra is szükséges, mert a `face_R` az HKDF inputjának része

Regisztrált hitelesítővel rendelkező eszközön a vault arc-scan + platformbiometria kombinációjával nyílik meg, PIN nélkül. Bármely más eszközön arc-scan + PIN szükséges.

---

## 4. DCC Kauzális lánc — token protokoll

A **Digital Causal Closure (DCC)** protokoll biztosítja, hogy minden vault-művelet kauzálisan kapcsolódik egy friss biometriai eseményhez. Az invariánsok:

| Tulajdonság | Leírás |
|-------------|--------|
| P1 — Scan után kiadva | DCC token csak akkor létezik, ha épp befejeződött egy biometriai scan |
| P2 — Egyszeri felhasználás | A token egyetlen aláírási művelet után felhasználódik |
| P3 — Időkorlátolt | A token 30 másodperccel a kiadás után lejár |
| P4 — Vault-hoz kötött | A token egy konkrét vault ID-hoz kapcsolódik |
| P5 — Új scan nélkül nincs újrakiadás | Zárolt vault nem használhatja újra a korábbi tokent |

Token életciklus: `BIO_CAPTURE → OPEN (token_fresh ellenőrzés) → SIGN (token felhasználás) → LOCK (privát kulcs = null)`

A DCC specifikáció a `.bio` tartomány-specifikus nyelvben (DSL) van kifejezve, amely szándékosan Turing-hiányos — nem lehet benne végtelen ciklust írni — ami garantálja, hogy az állapotgép terminál és teljes állapottere formálisan bejárható.

---

## 5. Formális verifikáció

A BioWallet DCC invariánsait és a tágabb értelemben vett BioOS Kauzális Alkotmányt a **Z3 SMT solver** segítségével formálisan verifikáltuk. A `.bio` DSL szándékosan Turing-hiányos — nem tud végtelen ciklust kifejezni — ezért a teljes állapottér végesbe esik és gépileg bizonyítható.

A formális modell, a bizonyítások és a kauzális lánc elvének kernel-szintű instanciálása az alábbi tudományos publikációban olvasható:

---

### Hivatkozás

**Szőke L.-F.** (2026). *BioOS Causal Constitution: A Turing-Incomplete Kernel Safety Layer for Digital Causal Closure.* Working Paper v0.2.  
DOI: [10.5281/zenodo.20384701](https://doi.org/10.5281/zenodo.20384701)  
MetaSpace.bio Logic Engine · [metaspace.bio](https://metaspace.bio)

---

## 6. HD tárca — BIP39 + BIP44

A seed phrase és az Ethereum kulcslevezetés nyílt szabványokat követ:

```
Entrópia (128–256 bit)
  → BIP39 mnemonik (12–24 szó)
  → PBKDF2-HMAC-SHA-512 (2048 kör) → 512 bites seed
  → BIP32 mesterkulcs
  → m/44'/60'/0'/0/0 → Ethereum privát kulcs (secp256k1)
  → keccak256(public_key[1:])[-20:] → Ethereum cím
```

Ugyanez a levezetési útvonal azonos Ethereum-címet produkál minden EVM-kompatibilis láncon (Ethereum, Polygon, BNB Chain, Arbitrum stb.).

Minden BIP32/BIP39/BIP44 művelet egy dedikált **Web Worker**-ben fut (`vault_worker.js`), amely el van szigetelve a fő böngészőszáltól. A privát kulcs kizárólag a 30 másodperces DCC-ablak alatt tartózkodik a Worker memóriájában, és zároláskor explicit módon törlődik.

---

## 7. Kapcsolódó olvasnivalók

| Téma | Forrás |
|------|--------|
| BIP39 mnemonik szólista | [github.com/bitcoin/bips/blob/master/bip-0039](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) |
| BIP44 levezetési útvonalak | [github.com/bitcoin/bips/blob/master/bip-0044](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki) |
| face-api.js (FaceNet) | [github.com/justadudewhohacks/face-api.js](https://github.com/justadudewhohacks/face-api.js) |
| WebAuthn PRF kiterjesztés | [w3c.github.io/webauthn/#prf-extension](https://w3c.github.io/webauthn/#prf-extension) |
| Web Cryptography API | [w3.org/TR/WebCryptoAPI](https://www.w3.org/TR/WebCryptoAPI/) |
| BioOS Kauzális Alkotmány (akadémiai cikk) | [doi.org/10.5281/zenodo.20384701](https://doi.org/10.5281/zenodo.20384701) |
