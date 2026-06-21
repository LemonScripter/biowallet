# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 (2026-06-21, commit `54b8edd`)

| Fájl | SHA-256 |
|------|---------|
| `index.html` | `99ad25e49b6e005ada2258536582c57a5205f6ed5a01c625e5a2d77e83daa0f1` |
| `app.js` | `c8482230e69edb4fdbe8108689e3cf66ee410502da76afa86eacd5bdc3995dac` |
| `vault_worker.js` | `2de5146c63daf2e8dbe792f03121406cec40c5941f607c1240ec0cbee61a11e8` |
| `vault.js` | `4e458607c47aab21e07a3f71b8496220beb906b6149e034ca32883abb75c6596` |
| `recovery_formula.js` | `dae76b4d4e7232481fc534cf44eb6e46cc1c43d872aaadefb558709e9ab0d833` |

**Combined fingerprint:** `8487a129d54d404e`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
