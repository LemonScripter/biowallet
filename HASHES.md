# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 (2026-06-03, commit `05a28d7`)

| Fájl | SHA-256 |
|------|---------|
| `index.html` | `271e606edbc5a36928eb8e84e3f41d77da7e9e43ec86fcb4b4bfa7e2f9602d10` |
| `app.js` | `55ce18f4a9d123888b06d13ee1bdc6b1743276ca6f7b4990b2b30cb087b6df58` |
| `vault_worker.js` | `d2f4ed5902d63d5702fc969458f4e61ed3606bd7d4404fced99992fa77a5f9bf` |
| `vault.js` | `5db91d6ddf78382c3c6b56ab1e480b1446cf88a02b686653f23fdf4ce718ac4c` |
| `recovery_formula.js` | `dae76b4d4e7232481fc534cf44eb6e46cc1c43d872aaadefb558709e9ab0d833` |

**Combined fingerprint:** `96cebbc81a81f442`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
