# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 (2026-10-22, commit `da0dbe1`)

| Fájl | SHA-256 |
|------|---------|
| `index.html` | `63329c359dc3c2319f06418caefb186ed12e77a86bcba1fa284f798b97d0208a` |
| `app.js` | `f2ba0e51e1576ee5cfca50a3dfaea3e7c05ce50450988c7b648cdcd478f109d0` |
| `vault_worker.js` | `ffe9dcdd445553a7f6a1145abd94823fc26e4e3b3f6cd731e0bd89055a51bc1e` |
| `vault.js` | `4e458607c47aab21e07a3f71b8496220beb906b6149e034ca32883abb75c6596` |
| `recovery_formula.js` | `dae76b4d4e7232481fc534cf44eb6e46cc1c43d872aaadefb558709e9ab0d833` |

**Combined fingerprint:** `cc522cdb04a8c875`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
