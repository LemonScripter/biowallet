# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 (2026-06-21, commit `469c130`)

| Fájl | SHA-256 |
|------|---------|
| `index.html` | `719ada76cd18ac3205ab2c1b4a1d2d65ea0963c12764c3e44ba26ca07f823319` |
| `app.js` | `32749e4d86588c5d37d37d5479dfa56434071d62ca31cdb76fef5d4048fe5775` |
| `vault_worker.js` | `2de5146c63daf2e8dbe792f03121406cec40c5941f607c1240ec0cbee61a11e8` |
| `vault.js` | `4e458607c47aab21e07a3f71b8496220beb906b6149e034ca32883abb75c6596` |
| `recovery_formula.js` | `dae76b4d4e7232481fc534cf44eb6e46cc1c43d872aaadefb558709e9ab0d833` |

**Combined fingerprint:** `ddd2dcf840e512a6`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
