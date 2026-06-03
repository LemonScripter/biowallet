# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 (2026-06-03, commit `77a869a`)

| Fájl | SHA-256 |
|------|---------|
| `index.html` | `271e606edbc5a36928eb8e84e3f41d77da7e9e43ec86fcb4b4bfa7e2f9602d10` |
| `app.js` | `08d4f946ea19be6023b9827307aeb2eb0a461874132ca9f0b4f5c7d22234bd4d` |
| `vault_worker.js` | `8067edc573535f148d6b52d2f4cf55d13eb282ffafa58409170aa66a4763a3ad` |
| `vault.js` | `1facd0ea9f9d01fcfca67d738e9bfd2a8bb24ca883127454866c3b03bf1d609c` |
| `recovery_formula.js` | `dae76b4d4e7232481fc534cf44eb6e46cc1c43d872aaadefb558709e9ab0d833` |

**Combined fingerprint:** `06596c3b0f0ba95a`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
