# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 (2026-11-26, commit `eabdcc5`)

| Fájl | SHA-256 |
|------|---------|
| `index.html` | `49f3708999bd8b47891e41438bd6bfbbcde79d01a439e6801787f1a2e85c39ac` |
| `app.js` | `8071084ed7ae394cc3a9259bb77cef3f854f24fb05236aa699a63a6b85472b72` |
| `vault_worker.js` | `ffe9dcdd445553a7f6a1145abd94823fc26e4e3b3f6cd731e0bd89055a51bc1e` |
| `vault.js` | `4e458607c47aab21e07a3f71b8496220beb906b6149e034ca32883abb75c6596` |
| `recovery_formula.js` | `dae76b4d4e7232481fc534cf44eb6e46cc1c43d872aaadefb558709e9ab0d833` |

**Combined fingerprint:** `d70fd9f4be0bef17`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
