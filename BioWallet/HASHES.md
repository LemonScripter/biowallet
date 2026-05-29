# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 (2026-05-29, commit `a43e7e3`)

| Fájl | SHA-256 |
|------|---------|
| `index.html` | `8bfba7b3a2cb00afea9683d3a2ba94c92a05068d5a4bb4d038ff8066e952ec12` |
| `app.js` | `97daf6bbd13998c6a8424883789c85859f6fd71aecfa232253a2ada240ca73e9` |
| `vault_worker.js` | `80c32f3aa45f965ab59c1a2576a17aab4880f277edd4328364a4027c2ae5fe23` |
| `vault.js` | `1664e48a2ff5797e9cdc2864bf4902b331f6b05d0e699c1c841e2c2122d2cd26` |
| `recovery_formula.js` | `c5fb3b5b0e0949308c07a4f0390729cff8eed494180a12153738f23f0d5bec52` |

**Combined fingerprint:** `4952ecc97a9762e7`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
