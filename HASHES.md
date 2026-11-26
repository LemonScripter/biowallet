# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 (2026-11-26, commit `202fedb`)

| Fájl | SHA-256 |
|------|---------|
| `index.html` | `036ef3a4389ec5b27d4886da17b2fa181b916fdd086dbadf476542fb67598d04` |
| `app.js` | `a7c88d6835d8f2a25e8ede18f1f5c9a089da130b967c198a1851e3f557c061a3` |
| `vault_worker.js` | `ffe9dcdd445553a7f6a1145abd94823fc26e4e3b3f6cd731e0bd89055a51bc1e` |
| `vault.js` | `4e458607c47aab21e07a3f71b8496220beb906b6149e034ca32883abb75c6596` |
| `recovery_formula.js` | `dae76b4d4e7232481fc534cf44eb6e46cc1c43d872aaadefb558709e9ab0d833` |

**Combined fingerprint:** `47d9181b6a8f82bb`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
