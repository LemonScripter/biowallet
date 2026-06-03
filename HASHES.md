# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 (2026-06-03, commit `7626226`)

| Fájl | SHA-256 |
|------|---------|
| `index.html` | `271e606edbc5a36928eb8e84e3f41d77da7e9e43ec86fcb4b4bfa7e2f9602d10` |
| `app.js` | `8c00975192be516e0f97a4ae6e937a95c2213d5df42eda112a4a308a0f3ff63f` |
| `vault_worker.js` | `cea9956359f02aadf0927f1b5b9cdf1b5fc9cd58c273ac7b3019d14919b741f1` |
| `vault.js` | `5db91d6ddf78382c3c6b56ab1e480b1446cf88a02b686653f23fdf4ce718ac4c` |
| `recovery_formula.js` | `dae76b4d4e7232481fc534cf44eb6e46cc1c43d872aaadefb558709e9ab0d833` |

**Combined fingerprint:** `519a57bc01bbed2f`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
