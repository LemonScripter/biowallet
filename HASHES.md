# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 (2026-06-03, commit `dfdbd2a`)

| Fájl | SHA-256 |
|------|---------|
| `index.html` | `cf4053823129eb55796204380325b0b14eb49779438a4110b5fd7201e7a91a73` |
| `app.js` | `44b07036238fc0c50374d5d3034fa041b24642256f5f7eaa8dc1469e47d1fdad` |
| `vault_worker.js` | `60f882d36ad459a8265d3d352bcde08c4bd2569fe4a5aaf7a9a2ee91d3ef63aa` |
| `vault.js` | `41754d48699410dd2e58ee497e6a3c980a6efff77e0e29d43e823e8680297e2b` |
| `recovery_formula.js` | `dae76b4d4e7232481fc534cf44eb6e46cc1c43d872aaadefb558709e9ab0d833` |

**Combined fingerprint:** `f757ebd219559b20`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
