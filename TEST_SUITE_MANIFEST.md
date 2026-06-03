# BioWallet v35.4 — Test Suite Manifest

**Version:** v35.4  
**Date:** 2026-06-03  
**Scope:** Manual browser test checklist — all v35.4 features  
**Environment:** Chrome 124+ / Firefox 125+ / Safari 17+ / iPhone SE / Android

---

## Pre-test Checklist

- [ ] `checksums.txt` — all PASS (run: `sha256sum -c checksums.txt`)
- [ ] `python tests/verify_biowallet.py` — 71/71 PASS
- [ ] `python tests/verify_sss_gf256.py` — 13/13 PASS
- [ ] SW cache version = `biowallet-v97` (DevTools → Application → Service Workers)
- [ ] No console errors on fresh load

---

## 1. New Wallet Creation (v5 Vault)

### 1.1 Happy Path — Face + Device + Paper

- [ ] Open `/app/`, no existing wallet → Setup panel shown
- [ ] Click **"Create new wallet"**
- [ ] Liveness challenge: head-turn detected within 8 s
- [ ] Camera activates, face scan runs (liveness passes first)
- [ ] **Device enroll modal** appears ("Register fingerprint / Face ID")
- [ ] Click **"Register now"** → WebAuthn dialog appears → complete enrollment
- [ ] **Paper formula modal** appears immediately after device enroll
- [ ] Modal shows 4-word seed (Shamir x=3 share Y)
- [ ] Click **"I've copied it"** confirmation checkbox → close modal enabled
- [ ] **Save wallet modal** appears → save `.json` file
- [ ] Lock panel shown with wallet name, genesis badge (5×5 colored identicon), fingerprint icon
- [ ] Genesis badge is visually distinct and consistent across reloads

### 1.2 Happy Path — Face + Paper Only (Device Skipped)

- [ ] Repeat 1.1 but click **"Skip"** on device enroll modal
- [ ] Paper formula modal still appears (mandatory)
- [ ] Save + lock panel works correctly
- [ ] Badge shown on lock panel

### 1.3 Edge Case — Camera Deny

- [ ] Deny camera permission → visible error message, no crash
- [ ] Wallet creation blocked (requires face)

---

## 2. Import Existing Wallet (v5)

### 2.1 Import v5 Wallet File

- [ ] Setup panel → **"Restore existing wallet"**
- [ ] File picker → load v5 `.json` file
- [ ] Liveness challenge runs before face scan
- [ ] Camera activates, face scan runs
- [ ] **Device enroll modal** appears (import also offers device enrollment)
- [ ] After device (or skip) → **Paper formula modal** appears (mandatory for import too)
- [ ] Save updated wallet → lock panel with badge

### 2.2 Import v3/Legacy Wallet

- [ ] Load a v3 vault file → handled gracefully (no crash, appropriate message)

### 2.3 Import BIP39 Seed Phrase (12–24 words)

- [ ] Setup panel → import → enter 12-word or 24-word BIP39 mnemonic
- [ ] Address matches MetaMask HD wallet (`m/44'/60'/0'/0/0`)
- [ ] Vault saved successfully, face required to reopen

### 2.4 Import Raw Private Key

- [ ] Setup panel → import → enter 64-char hex private key
- [ ] Address matches MetaMask imported account
- [ ] Vault saved, face required to reopen

---

## 3. Unlock (Face Open)

### 3.1 Standard Unlock

- [ ] Lock panel shown → click **"Face scan"**
- [ ] Liveness challenge: head-turn detected before scan
- [ ] Camera activates, face scan succeeds
- [ ] Vault panel shown with address, balance, token list
- [ ] Badge (32px) shown on vault panel header

### 3.2 Wrong Face

- [ ] Deliberately present wrong face → error shown, vault stays locked

### 3.3 Liveness — Static Photo Blocked

- [ ] Hold a static photo in front of camera during liveness challenge
- [ ] Challenge times out (LIVENESS_TIMEOUT) → vault does NOT open

### 3.4 SSS 2-of-3 Paper Open

- [ ] On lock panel → click **"Paper recovery"**
- [ ] Enter 4-word paper share
- [ ] Liveness challenge + camera activates (face scan = second factor)
- [ ] Vault opens on 2-of-3 PASS

---

## 4. Vault Panel — Camera Restart After Operations

### 4.1 Paper Formula Button

- [ ] In vault panel → click **"Paper formula"**
- [ ] Liveness challenge runs
- [ ] Camera restarts AND screen scrolls to top
- [ ] Face scan runs successfully
- [ ] Paper share displayed after confirm

### 4.2 Sign Transaction

- [ ] Build a test transaction → click **"Sign"**
- [ ] Liveness challenge runs
- [ ] Camera restarts AND screen scrolls to top before face scan
- [ ] After face confirm → transaction signed (dry run / testnet)

### 4.3 Re-enrollment

- [ ] Click **"Re-enroll"** (btn-reenroll)
- [ ] Liveness challenge runs
- [ ] Camera restarts AND screen scrolls to top
- [ ] New face embedding enrolled, vault re-saved

### 4.4 Genesis Recovery

- [ ] Click genesis recovery button (if present)
- [ ] Liveness challenge runs
- [ ] Camera restarts AND screen scrolls to top

### 4.5 WalletConnect Sign

- [ ] Connect via WalletConnect QR
- [ ] Incoming sign request triggers liveness + camera restart + scroll
- [ ] Face approval → sign proceeds

---

## 5. Device Factor

### 5.1 Device Relink Hint

- [ ] Import wallet that has device share, but device factor is absent on current browser
- [ ] After face open: hint message "⚡ This wallet has a device factor" appears
- [ ] Click **"Device"** → WebAuthn registration completes
- [ ] Hint disappears on next open

### 5.2 Device Unlock

- [ ] Wallet with device factor registered → lock panel → click **"Device"**
- [ ] WebAuthn prompt → authenticate → vault opens (face = second factor)

---

## 6. Security & Header

### 6.1 Security Link Visible (Desktop)

- [ ] Viewport ≥ 380px → Security/Comparison link visible in header
- [ ] Click → security comparison page opens

### 6.2 Security Link on iPhone SE (375px)

- [ ] Token text hidden, green dot visible (compact token badge)
- [ ] Security link still visible at 375px
- [ ] Security link hidden only at ≤330px (fringe tiny screens)

### 6.3 Security Link on Mobile (general)

- [ ] Test on 390px (iPhone 14) → link visible
- [ ] Test on 360px (Android mid) → link visible

---

## 7. Genesis Wallet Badge

### 7.1 Badge on Lock Panel

- [ ] Badge is 56×56px, unique per wallet genesis.dna
- [ ] Wallet name displayed next to badge
- [ ] Fingerprint icon shown

### 7.2 Badge on Vault Panel

- [ ] Badge is 32×32px in header area
- [ ] Same visual pattern as lock panel badge (identical genesis.dna → identical badge)

### 7.3 Badge Persistence

- [ ] Close and reopen app → same badge displayed (not random on reload)
- [ ] Different wallet → different badge

### 7.4 No Badge Without Wallet

- [ ] Setup panel → no badge shown
- [ ] No console errors from missing genesis.dna

---

## 8. Recovery Tool

### 8.1 recovery_tool.html

- [ ] Load `/recovery_tool.html` standalone (no server needed)
- [ ] Paste P.json content → shows decoded shares, genesis.dna
- [ ] Works fully offline

---

## 9. Internationalisation

### 9.1 Language Toggle

- [ ] Switch HU → EN → all UI strings update
- [ ] Device offer modal strings present in both languages
- [ ] Device relink message present in both languages

---

## 10. PWA / Offline

### 10.1 Service Worker

- [ ] DevTools → Application → Service Workers → `biowallet-v97` active
- [ ] Simulate offline → app loads from cache
- [ ] All JS/HTML/models available offline

### 10.2 Auto-update via version.json

- [ ] Deploy new SW version → `version.json` updated on server
- [ ] On next app load: SW unregistered, caches cleared, page reloads with new version

### 10.3 Install to Home Screen

- [ ] Mobile browser → "Add to Home Screen" → app installs
- [ ] Splash screen shows correctly
- [ ] Opens in standalone mode (no browser chrome)

---

## 11. Multi-Network

- [ ] Switch network (Ethereum / Polygon / Arbitrum / Base)
- [ ] Address stays same, balance/tokens update for selected network
- [ ] RPC fallback works if primary endpoint down

---

## 12. Annual Re-enrollment Reminder

- [ ] Inject test enrollment timestamp > 1 year old into vault metadata
- [ ] On load → banner "Annual face re-enrollment due" visible
- [ ] Click banner → re-enrollment flow triggered
- [ ] After re-enroll → banner disappears

---

## 13. WalletConnect v2

- [ ] Generate WC2 QR from vault panel
- [ ] Connect test DApp (e.g., local test page)
- [ ] Personal sign → liveness + camera restarts → face approve → sign delivered
- [ ] eth_sendTransaction → liveness + camera restarts → face approve → tx sent
- [ ] Disconnect → session cleared

---

## Test Results Grid

| # | Test Area | Status | Notes |
|---|-----------|--------|-------|
| 1.1 | New wallet (face+device+paper) | ⬜ | |
| 1.2 | New wallet (face+paper only) | ⬜ | |
| 1.3 | Camera deny edge case | ⬜ | |
| 2.1 | Import v5 wallet | ⬜ | |
| 2.2 | Import legacy v3 | ⬜ | |
| 2.3 | Import BIP39 seed phrase | ⬜ | |
| 2.4 | Import raw private key | ⬜ | |
| 3.1 | Standard unlock | ⬜ | |
| 3.2 | Wrong face | ⬜ | |
| 3.3 | Liveness — static photo blocked | ⬜ | |
| 3.4 | SSS paper open | ⬜ | |
| 4.1 | Camera restart — paper formula | ⬜ | |
| 4.2 | Camera restart — sign | ⬜ | |
| 4.3 | Camera restart — re-enroll | ⬜ | |
| 4.4 | Camera restart — genesis recovery | ⬜ | |
| 4.5 | Camera restart — WC sign | ⬜ | |
| 5.1 | Device relink hint | ⬜ | |
| 5.2 | Device unlock | ⬜ | |
| 6.1 | Security link desktop | ⬜ | |
| 6.2 | Security link iPhone SE 375px | ⬜ | |
| 6.3 | Security link Android 360px | ⬜ | |
| 7.1 | Badge on lock panel | ⬜ | |
| 7.2 | Badge on vault panel | ⬜ | |
| 7.3 | Badge persistence | ⬜ | |
| 7.4 | No badge without wallet | ⬜ | |
| 8.1 | Recovery tool offline | ⬜ | |
| 9.1 | Language toggle HU/EN | ⬜ | |
| 10.1 | PWA offline cache | ⬜ | |
| 10.2 | Auto-update via version.json | ⬜ | |
| 10.3 | Install to home screen | ⬜ | |
| 11 | Multi-network switch | ⬜ | |
| 12 | Annual re-enrollment banner | ⬜ | |
| 13 | WalletConnect v2 | ⬜ | |

**⬜ = untested | ✅ = PASS | ❌ = FAIL**

---

## Automated Tests Summary (run before manual tests)

```
tests/verify_biowallet.py     → 71/71 PASS  (DCC + liveness + TX + session invariants)
tests/verify_sss_gf256.py     → 13/13 PASS  (SSS GF(2^8) shamir)
checksums.txt                 → all PASS    (canonical file integrity)
```

---

*This manifest covers all BioWallet v35.4 features. Incomplete items are tracked above.*
