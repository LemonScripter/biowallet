# Threat Model — BioWallet

**Version:** v35.1 · **Date:** 2026-06-02 · **Scope:** browser PWA + Tokyo GCP deployment

---

## 1. Assets (védett javak)

| Asset | Hol él | Legrövidebb élettartam | Elsődleges védelem |
|-------|--------|------------------------|-------------------|
| Private key | Worker memória (signEthTx) | < 10 s, `seed.fill(0)` után | DCC auto-lock + Worker izoláció |
| Vault seed (32 B) | AES-256-GCM ct, `.biowallet` fájl | Decrypt → azonnal zeroed | BCH fuzzy extractor + AES-256-GCM |
| Biometric embedding | Float32[128], Worker postMessage | Soha nem tárolva | Nem perzisztált DOM/localStorage-ban |
| Face fuzzy secret (R) | Worker, PBKDF2 bemenet | < 30 s, DCC TTL | BCH correction + HKDF |
| SSS paper share (x=3) | Fizikai papír | Felhasználó felelőssége | SSS 2-of-3: önmagában elégthelen |
| WebAuthn PRF key | Platform authenticator | Soha nem exportálható | Hardware enclave |
| Genesis HMAC | `.biowallet` outer JSON | Minden open-on ellenőrzött | HMAC-SHA256(HKDF(vault_key)) |
| Recovery formula (rawA, r) | Papíron, P-érték nélkül | Megjelenítés után lock | Obfuszkált: c_j = (i_j − r_j) mod 2048 |

---

## 2. Trust Boundary-k

```
┌─────────────────────────────────────────────────────────┐
│  Browser main thread (UNTRUSTED — dApp hozzáfér)        │
│  ┌───────────────────────────────────────────────────┐  │
│  │  vault_worker.js (TRUSTED — same-origin Worker)   │  │
│  │  • Private key soha nem hagyja el ezt a határt    │  │
│  │  • DCC causal chain enforced itt                  │  │
│  └───────────────────────────────────────────────────┘  │
│  localStorage: csak titkosított vault JSON + P (publikus)│
└─────────────────────────────────────────────────────────┘
         │ HTTPS + CSP (script-src 'self')
┌────────▼──────────────┐    ┌──────────────────────┐
│  Tokyo GCP nginx       │    │  WalletConnect Relay  │
│  (statikus fájlok)     │    │  (csak relay, nem lát │
│  SRI hash-elt bundle-k │    │   unsigned payloadt)  │
└───────────────────────┘    └──────────────────────┘
```

---

## 3. Támadómodellek

| # | Támadó | Képességek | Célzott asset | Eredmény | Mitigáció |
|---|--------|-----------|---------------|----------|-----------|
| T1 | Távoli attacker | Hálózati hozzáférés, `.biowallet` ellopása | Vault seed | Brute-force infeasible: AES-256-GCM + PBKDF2(300k) | ✅ |
| T2 | Lokális malware | Olvashatja a file systemet, memóriát | Privát kulcs memóriában | Csak < 10 s ablakban létezik, Worker-izolált | ⚠️ Részleges (OS-szintű kompromittálás nem védhető) |
| T3 | Kompromittált böngészőbővítmény | DOM manipuláció, fetch intercept | TX adat módosítása | CSP `script-src 'self'` blokkolja, Worker nem elérhető bővítményből | ✅ |
| T4 | Rosszindulatú dApp (WalletConnect) | JSON-RPC kérés, metadata injekció | Jóváhagyás abuse, XSS | DCC: minden tx biometriát kér; h() escape az összes metadatán | ✅ |
| T5 | Ellopott eszköz | Fizikai hozzáférés, böngésző session | Vault file + P fájl | Vault AES-GCM titkosított; face nélkül nem nyitható | ✅ (kamera nélkül nem open-elható) |
| T6 | Shoulder-surfing | Látja a képernyőt | Seed phrase / recovery formula | Paper formula obfuszkált (r_j nélkül értelmezhetetlen) | ✅ |
| T7 | Kamera spoofing (foto/maszk) | 2D fotó vagy 3D maszk | Biometrikus autentikáció | **ISMERT LIMITÁCIÓ** — liveness detection NINCS | 🔴 SSS 2-of-3 mitigálja (foto = csak face share, paper/device nélkül elégtelen) |
| T8 | RPC endpoint MITM / kompromittált node | Módosított válaszok | TX fee, balance | DCC commit + fingerprint; HTTPS; nem silent | ⚠️ Nincs pinning |
| T9 | Supply chain (npm, CDN) | Módosított bundle | Minden | Nincs CDN; SRI hash-ellenőrzés; lokális bundle | ✅ |
| T10 | Brute-force / rainbow table | Offline vault file | Vault key | BCH fuzzy R nem reprodukálható face nélkül; 300k PBKDF2 | ✅ |

---

## 4. Out-of-Scope

| Nem védett | Indoklás |
|-----------|----------|
| OS-szintű kompromittálás (root, kernel exploit) | Worker izoláció browser-szintű; kernel szinten BioOS+DCC Ring 0 kísérlet, nem production |
| Jailbreakelt / rootolt eszköz | Trusted Execution Environment feltétel sérül |
| Fizikailag kompromittált hardware | TPM/Secure Enclave megkerülése out-of-scope |
| Felhasználó által önként kiadott kulcs | Social engineering nem kriptográfiai probléma |
| Ethereum hálózat / smart contract biztonság | Blockchain réteg nem BioWallet felelőssége |
| Browser engine 0-day exploit | Böngésző gyártójának felelőssége |

---

## 5. Biztonsági feltételezések

1. A böngésző helyesen enforcolja a Worker izolációt és a CSP-t.
2. A FaceNet embedding BCH-t megelőző lépése elegendő entropy-t ad — a biometrikus távolság stabil eszközön, ugyanazon böngészőben.
3. Az AES-256-GCM és a WebCrypto API implementációja korrekt (platform-provided).
4. A felhasználó az `.biowallet` fájlt és a paper share-t **fizikailag szeparáltan** tárolja.
5. A felhasználó ugyanazon böngészőben nyitja meg a vaultot, amellyel enrololta (cross-browser embedding eltérés nem tolerált).

---

## 6. Kockázati mátrix

| Kockázat | Valószínűség | Impact | Összesített | Mitigáció státusz |
|----------|-------------|--------|-------------|-------------------|
| Foto-alapú bypass (T7) | Közepes (közeli ismerős) | Magas | **Magas** | SSS 2-of-3 kötelező ajánlott; liveness roadmap |
| Kompromittált browser ext (T3) | Alacsony (CSP blokkol) | Magas | Közepes | ✅ CSP + Worker izoláció |
| Ellopott `.biowallet` (T1) | Közepes | Alagas (brute-force infeasible) | Alacsony | ✅ AES-256-GCM |
| RPC MITM (T8) | Alacsony | Közepes | Alacsony | ⚠️ HTTPS; pinning nincs |
| Supply chain (T9) | Nagyon alacsony | Kritikus | Közepes | ✅ SRI + lokális bundle |
