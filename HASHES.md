# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 (2026-06-03, commit `3a45715`)

| Fájl | SHA-256 |
|------|---------|
| `index.html` | `271e606edbc5a36928eb8e84e3f41d77da7e9e43ec86fcb4b4bfa7e2f9602d10` |
| `app.js` | `7bda385de1d813b3d5f6969c594af0038604da6f4b09be77e1c2f392916624d0` |
| `vault_worker.js` | `d2f4ed5902d63d5702fc969458f4e61ed3606bd7d4404fced99992fa77a5f9bf` |
| `vault.js` | `5db91d6ddf78382c3c6b56ab1e480b1446cf88a02b686653f23fdf4ce718ac4c` |
| `recovery_formula.js` | `dae76b4d4e7232481fc534cf44eb6e46cc1c43d872aaadefb558709e9ab0d833` |

**Combined fingerprint:** `c5502b8a120699c4`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
