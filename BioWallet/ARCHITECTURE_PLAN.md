# BioWallet — Célarchitektúra Terv
**Verzió:** 1.0 | **Dátum:** 2026-05-27 | **Státusz:** Tervezési fázis

---

## 1. Jelenlegi állapot (v0.10)

### Működő komponensek
- **Biometria:** Arc (FaceNet 128-dim, TinyFaceDetector + faceLandmark68Net)
- **Fuzzy extractor:** BCH(255,55,25) — max. 25 bithiba-korrekció
- **Kauzális lánc:** DCC Ring 3 (JavaScript Worker) — TTL: OPEN=30s, SIGN=10s, EXPORT=5s
- **Tárolás:** AES-256-GCM, PBKDF2-SHA256 (300k iteráció)
- **Wallet:** BIP39 (256 bit entrópia, 24 szó), secp256k1, EIP-1559
- **Deploy:** biowallet.metaspace.bio (Tokyo szerver, nginx, HTTPS)
- **Verifikáció:** Z3 SMT solver, 33/33 invariáns PASS

### Jelenlegi korlátok

| Korlát | Hatás |
|---|---|
| Csak arc-biometria | Chrome ↔ Firefox: >25 bithiba → MISMATCH |
| Ring 3 DCC | Malicious extension potenciálisan elfoghatja a postMessage-t |
| EXPORT funkció | Seed plaintext-ként utazik Worker → main thread (egyetlen sérülékeny pont) |
| Egy biometriai faktor | Ha az arc nem működik (GPU drift, sérülés) → csak seed phrase |
| Hardware-függőség | Böngészőfrissítés szisztematikus embeddingeltolást okozhat |

---

## 2. Célarchitektúra — Három fázis

```
Phase 7: Multi-biometrikus 2-of-3 (arc + ujj + vas)
Phase 8: Kalibrációs lánc (GPU/böngésző-drift automatikus korrekciója)
Phase 9: Szerver oldali papír-képlet generátor (MetaMask recovery)
```

---

## 3. Phase 7 — Multi-biometrikus 2-of-3

### Elvek
- Három faktor: **Arc (F)**, **Ujjlenyomat (P, WebAuthn)**, **Hardver (H)**
- Bármelyik kettő elegendő a vault megnyitásához
- Az EXPORT gomb megszűnik — a seed plaintext formában soha nem jelenik meg

### Faktorok részletezve

**Arc (F):**
- FaceNet 128-dim embedding (változatlan)
- BCH(255,55,25) fuzzy extractor
- Továbbra is böngésző/GPU érzékeny → Phase 8 kezeli

**Ujjlenyomat (P — WebAuthn platform authenticator):**
- Böngésző WebAuthn API → OS secure enclave
- Hardware-kötött, böngészőverzió-független
- Kimenet: kriptográfiai credential (nem nyers biometria)
- A credential_id stabil, eszközkötött

**Hardver (H):**
- WebGL GPU renderer + canvas fingerprint kombináció
- CPU concurrency + device memory
- Megjegyzés: a WebAuthn credential önmagában is device-kötött,
  a H faktor ezt erősíti meg

### Kriptográfiai struktúra — Shamir 2-of-3

```
R = vault kulcs (256 bit, random)

Shamir felosztás (2-of-3, GF(2^8) mező):
  share_F = Shamir_share(R, 1)   ← archoz kötve
  share_P = Shamir_share(R, 2)   ← ujjhoz kötve
  share_H = Shamir_share(R, 3)   ← hardverhez kötve

Tárolás (.biowallet v2):
  enc_F   = AES-GCM(fuzzyKey_F,   share_F)
  enc_P   = AES-GCM(webauthnKey,  share_P)
  enc_H   = AES-GCM(hwKey,        share_H)

Megnyitás (bármely 2 faktorral):
  share_i = AES-GCM.decrypt(enc_i, key_i)
  share_j = AES-GCM.decrypt(enc_j, key_j)
  R       = Shamir_reconstruct(share_i, share_j)
```

### Vault fájlformátum v2

```json
{
  "version": 2,
  "vaultId": "uuid",
  "salt": "hex(32B)",
  "factors": {
    "face": {
      "P": "BCH helper data (hex)",
      "enc_share": "AES-GCM(fuzzy_R, share_F)"
    },
    "fingerprint": {
      "credential_id": "WebAuthn credential ID",
      "enc_share": "AES-GCM(HKDF(credential_id), share_P)"
    },
    "hardware": {
      "hw_hash": "SHA256(GPU+canvas+cpu fingerprint)",
      "enc_share": "AES-GCM(HKDF(hw_hash), share_H)"
    }
  },
  "vault": "AES-GCM(KDF(R, salt), seed)"
}
```

### Módosítandó fájlok

| Fájl | Változás |
|---|---|
| `core/fuzzy_extractor.js` | `forcedCommit(E, R)` metódus hozzáadása |
| `core/vault.js` | Shamir 2-of-3 logika, EXPORT eltávolítása |
| `core/causal_chain.js` | CALIBRATE DCC művelet (Phase 8-hoz) |
| `core/wallet.js` | `seedToMnemonic()` export eltávolítása |
| `app/vault_worker.js` | Multi-faktor kezelés, EXPORT case törlése |
| `app/app.js` | WebAuthn enrollment/auth UI, EXPORT gomb eltávolítása |
| `app/index.html` | Enrollment flow frissítése |
| **Új:** `core/webauthn.js` | WebAuthn enrollment, assertion, key derivation |
| **Új:** `core/hardware_factor.js` | Device fingerprint számítás |
| **Új:** `core/shamir.js` | 2-of-3 secret sharing (GF(2^8)) |

### Biztonsági modell változása

| Forgatókönyv | v0.10 | Phase 7 |
|---|---|---|
| Chrome frissítés (arc driftél) | ❌ MISMATCH | ✅ Ujj+Vas megnyit |
| Firefox ↔ Chrome váltás | ❌ MISMATCH | ✅ Ujj+Vas megnyit |
| Ujjolvasó elromlott | N/A | ✅ Arc+Vas megnyit |
| Seed ellopása | ⚠️ EXPORT plaintext | ✅ Nem lehetséges (EXPORT eltávolítva) |
| Új eszköz | Seed phrase | Seed phrase (Phase 9-ig) |

---

## 4. Phase 8 — Kalibrációs Lánc (DNS-lánc)

### Probléma
Az arc-embedding böngészőverzió-frissítéskor szisztematikusan eltolódik.
A BCH 25 bites korrekciója a biológiai zajhoz elegendő, de nem a
szoftver-drift kezeléséhez.

### Megközelítés: Szintetikus szonda vektorok

Az arc-felismerési pipeline kalibrálása ismert bemenetek kimenetének
rögzítésével:

```
Enrollment:
  64 szintetikus szondavektor futtatása FaceNet-en
  probe_results_0 = [GPU(v_1), GPU(v_2), ..., GPU(v_64)]
  Rögzítés: kalibrációs blokk #0

Következő session (Chrome frissítés után):
  probe_results_1 = [GPU(v_1), ..., GPU(v_64)]
  drift = probe_results_1 - probe_results_0  (dimenziónként)
  T = linear_fit(drift)                       (korrekciós transzformáció)
  
  E_corrected = E_current - T(E_current)
  fuzzyExtract(E_corrected, P) → R            (működik!)
```

### Lánc struktúra

```json
{
  "calibration_chain": [
    {
      "block": 0,
      "type": "genesis",
      "probes_hash": "SHA256(probe_results_0)",
      "timestamp": 1234567890,
      "dcc_sig": "genesis"
    },
    {
      "block": 1,
      "type": "drift_correction",
      "probes_hash": "SHA256(probe_results_1)",
      "drift_linear_T": [[...], [...], ...],
      "delta_bits_corrected": 18,
      "timestamp": 1234567891,
      "dcc_sig": "SHA256(block_0 + R)"
    }
  ]
}
```

### DCC CALIBRATE művelet

```
Feltétel:  vault éppen nyitva van (OPEN gate érvényes)
TTL:       60 másodperc
Folyamat:  új szondafuttatás → drift számítás → blokk DCC-aláírva
           → P.json frissítve → auto-lock
```

### Mit old meg

| Eset | Megoldja? |
|---|---|
| Chrome minor frissítés | ✅ Automatikus drift korrekció |
| Chrome major frissítés | ✅ Ha ≥1 faktor még működik → rekalibrál |
| Firefox ↔ Chrome | ❌ Nem (Phase 7 Ujj+Vas kezeli) |
| GPU csere | ❌ Új hardware → Phase 9 |

### Módosítandó fájlok

| Fájl | Változás |
|---|---|
| **Új:** `core/calibration_chain.js` | Szonda generálás, drift számítás, lánc kezelés |
| `core/bio_capture.js` | Szondafuttatás integráció |
| `core/causal_chain.js` | CALIBRATE token típus |
| `app/vault_worker.js` | CALIBRATE üzenet kezelő |

---

## 5. Phase 9 — Szerver oldali Papír-képlet Generátor

### Alapelv

A 24 szó **soha nem jelenik meg digitálisan** — sehol, semmikor.

Helyette: a Tokyo szerver (Ring 0 BioOS védelme alatt) egy matematikai
**papír-képletet** generál, amellyel a felhasználó offline, kézzel,
egy BIP39 szólistával ki tudja számolni a 24 szavát.

A képlet önmagában értelmetlen. A BIP39 lista önmagában értelmetlen.
Együtt: a felhasználó megkapja a 24 szót — de azok soha nem tárolódnak,
soha nem utaznak hálózaton, soha nem jelennek meg képernyőn.

### A papír-képlet matematikája

**BIP39 seed → szóindexek:**
```
256 bit entrópia + 8 bit checksum = 264 bit
Felosztva: 24 × 11 bit → 24 szám (0-2047)
Szám → szó: BIP39 nyilvános szólista (2048 elem)
```

**A képlet (egyszerű moduláris összeadás):**
```
A szerver generál: [c_1, c_2, ..., c_24]  ← kódolt mutatók
                   [r_1, r_2, ..., r_24]  ← eltolási kulcs

Ahol: c_j = (i_j - r_j) mod 2048
      i_j = az eredeti szóindex
      r_j = véletlenszerű eltolás (0-2047)

Visszafejtés papíron:
  word_index_j = (c_j + r_j) mod 2048
  word_j       = BIP39_lista[word_index_j]
```

**A kinyomtatott papír formátuma:**

```
┌─────────────────────────────────────────────────────┐
│  BioWallet Recovery Formula — BIZALMASAN            │
│  Vault: [UUID] | Dátum: 2026-05-27                  │
│                                                     │
│  Utasítás: A + B összeadása (mod 2048) adja az      │
│  indexet. A BIP39 szólistában keresse fel.          │
│                                                     │
│  #  │   A   │   B   │  A+B mod 2048  │   Szó       │
│  ───┼───────┼───────┼────────────────┼──────────   │
│   1 │  1247 │   834 │    ________    │ _______     │
│   2 │   523 │  1456 │    ________    │ _______     │
│  ...│       │       │                │             │
│  24 │  2001 │    89 │    ________    │ _______     │
│                                                     │
│  FONTOS: Az A és B oszlopot külön tárolja!          │
│  Csak együtt adják meg a szavakat.                  │
└─────────────────────────────────────────────────────┘
```

Az A oszlop és a B oszlop **külön fizikai papíron** tárolható —
egyik sem elegendő önmagában. Shamir-szerű fizikai megosztás.

### A szerver oldali folyamat

```
1. Felhasználó kezdeményezi a recovery formula generálást
   (BioWallet UI, csak 2-of-3 faktor teljesítése után elérhető)

2. Biztonságos csatorna (TLS 1.3) megnyitása Tokyo szerver felé

3. Felhasználó küld:
   - .biowallet (titkosított blob)
   - R (vault kulcs, lokálisan biometriából derivált)
   - DCC token (kauzális bizonyíték a hitelesítésről)

4. Tokyo szerver (Ring 0 BioOS):
   a. DCC token validálása
   b. R-rel visszafejti a .biowallet-et → seed (plaintext, CSAK RAM)
   c. Seed → 24 szóindex [i_1, ..., i_24]
   d. 24 véletlenszerű eltolás generálása [r_1, ..., r_24]
   e. Kódolt mutatók: c_j = (i_j - r_j) mod 2048
   f. Nyomtatási parancs → fizikai nyomtató (Ring 0 syscall, alkotmány szerint engedélyezett)
   g. RAM törlése: R, seed, i_j, r_j, c_j → fill(0)
   h. Visszajelzés: "Nyomtatás kész" (semmi érzékeny adat nem utazik vissza)

5. Felhasználó megkapja a kinyomtatott papírt
   (a szerveren semmi nem marad)
```

### Ring 0 alkotmány a server-side művelethez

```bio
CELL RecoveryFormula {
  INVARIANTS {
    RULE dcc_required:
      decrypt_operation == TRUE IMPLIES dcc_token.valid == TRUE;

    RULE output_only_print:
      seed_in_memory == TRUE IMPLIES
        output_channel == PHYSICAL_PRINTER_ONLY;

    RULE no_network_output:
      (seed_in_memory == TRUE AND network_send == TRUE)
        IMPLIES VIOLATION;

    RULE zero_after_print:
      print_complete == TRUE IMPLIES
        NEXT(seed_in_memory) == FALSE;

    RULE single_use:
      formula_generated == TRUE IMPLIES
        NEXT(formula_generated) == FALSE;
  }
}
```

### Mi utazik a hálózaton

| Irány | Tartalom | Érzékeny? |
|---|---|---|
| Kliens → Szerver | .biowallet (titkosított) | Nem (már titkosított) |
| Kliens → Szerver | R (vault kulcs) | Igen — TLS 1.3 védi |
| Kliens → Szerver | DCC token | Nem (kauzális bizonyíték) |
| Szerver → Kliens | "OK" / hibaüzenet | Nem |
| Szerver → Nyomtató | Papír-képlet | Csak fizikailag |

**A 24 szó soha nem utazik hálózaton.**

### Módosítandó / új fájlok

| Fájl | Változás |
|---|---|
| **Új:** `server/recovery_formula.py` | Szerver oldali képlet generátor |
| **Új:** `server/bip39_wordlist.py` | BIP39 szólista + index számítás |
| **Új:** `server/printer_driver.py` | Ring 0 nyomtatási syscall |
| **Új:** `core/recovery_client.js` | Kliens oldali recovery UI + TLS handshake |
| `app/app.js` | Recovery formula gomb (EXPORT helyett) |
| `deploy/nginx_biowallet.conf` | `/api/recovery` endpoint |
| **Új:** `BioOS/spec/recovery_formula.bio` | Ring 0 alkotmány specifikáció |

---

## 6. Teljes biztonsági modell összehasonlítása

### Fenyegetési mátrix

| Támadás | v0.10 | Phase 7 | Phase 8 | Phase 9 |
|---|---|---|---|---|
| Seed ellopása (hálózat) | ⚠️ EXPORT plaintext | ✅ nincs EXPORT | ✅ | ✅ |
| Malicious extension | ⚠️ postMessage | ✅ plaintext nincs | ✅ | ✅ Ring 0 |
| Chrome frissítés | ❌ MISMATCH | ⚠️ Ujj+Vas megnyit | ✅ auto-drift | ✅ |
| Firefox ↔ Chrome | ❌ MISMATCH | ✅ Ujj+Vas | ✅ | ✅ |
| Rubber-hose | ⚠️ EXPORT kényszerből | ✅ felhasználó sem tudja | ✅ | ✅ |
| Hardware csere | Seed phrase | Seed phrase | Seed phrase | ✅ papír-képlet |
| Phishing | ⚠️ seed bekérése | ✅ nincs seed | ✅ | ✅ |

### A 24 szó életciklusa

```
v0.10:
  Enrollment → [Worker memória] → EXPORT → postMessage → alert() → papír
                                                ↑ sérülékeny

Phase 7-9:
  Enrollment → [Worker memória, auto-törlés]
  Recovery   → [Szerver RAM, Ring 0] → nyomtató → papír
               ↑ soha nem jelenik meg digitálisan
```

---

## 7. Implementációs sorrend

```
Phase 7a:  webauthn.js + hardware_factor.js + shamir.js (alapok)
Phase 7b:  vault.js v2 formátum + 2-of-3 logika
Phase 7c:  UI: enrollment flow (arc + ujj + vas regisztráció)
Phase 7d:  EXPORT eltávolítása, tesztelés

Phase 8a:  calibration_chain.js (szonda generálás + drift számítás)
Phase 8b:  DCC CALIBRATE művelet + vault_worker integráció
Phase 8c:  Automatikus rekalibrálás UI

Phase 9a:  BioOS recovery_formula.bio specifikáció + Z3 verifikáció
Phase 9b:  Szerver oldali recovery_formula.py (nyomtató nélkül, tesztelés)
Phase 9c:  Ring 0 alkotmány enforcement + nyomtató integráció
Phase 9d:  Kliens oldali recovery_client.js + UI
Phase 9e:  End-to-end teszt (fizikai papír → kézi számítás → MetaMask import)
```

---

## 8. Változatlanok maradó komponensek

- AES-256-GCM vault titkosítás
- PBKDF2-SHA256 kulcsszármaztatás (→ Argon2 Phase 6+ opcionalitás)
- secp256k1 + EIP-1559 tranzakció aláírás
- DCC kauzális lánc alapmechanizmus (TTL, vault-kötés, auto-lock)
- BCH(255,55,25) fuzzy extractor core logika
- Z3 SMT verifikáció
- BIP39 24 szavas entrópia standard
- Web Worker alapú kripto-sandbox (kulcs soha nem kerül a main thread-be)
