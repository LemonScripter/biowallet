# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 (2026-06-21, commit `9860eb3`)

| Fájl | SHA-256 |
|------|---------|
| `index.html` | `1cae922e193ba2e36f3154a6f6fa89aabafd3dcb07b22da641a0456b2a861fa9` |
| `app.js` | `51d3dbb91ef1ed891416f2bef00486c3d7ffda85d2d90376617c3306360363fa` |
| `vault_worker.js` | `2de5146c63daf2e8dbe792f03121406cec40c5941f607c1240ec0cbee61a11e8` |
| `vault.js` | `4e458607c47aab21e07a3f71b8496220beb906b6149e034ca32883abb75c6596` |
| `recovery_formula.js` | `dae76b4d4e7232481fc534cf44eb6e46cc1c43d872aaadefb558709e9ab0d833` |

**Combined fingerprint:** `206f8745676af515`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
