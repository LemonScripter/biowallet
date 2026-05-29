# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 (2026-05-29, commit `a3e7167`)

| Fájl | SHA-256 |
|------|---------|
| `index.html` | `fe7f83172a478572a5afa104d73c8d80fd3425eaf11368956466c7fa7e717f03` |
| `app.js` | `25b98ae3929e54067e640e1c2c7370e527f2eefbe4e04dc21c0fd12b6b92be97` |
| `vault_worker.js` | `a9e46771b21ea1ea21c4777fb4a6fa5b28ea34300e89578652ade7c9f58ee7f7` |
| `vault.js` | `36e8820240da05070131abad04c4ac52ed96418d520f41b9734b19a1c60d8281` |
| `recovery_formula.js` | `c5fb3b5b0e0949308c07a4f0390729cff8eed494180a12153738f23f0d5bec52` |

**Combined fingerprint:** `3088b7e67446af29`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
