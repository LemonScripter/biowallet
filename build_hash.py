#!/usr/bin/env python3
"""BioWallet build fingerprint — Phase 9.1e verifiable build."""
import hashlib, os, sys

FILES = [
    'src/app/index.html',
    'src/app/app.js',
    'src/app/vault_worker.js',
    'src/core/vault.js',
    'src/core/recovery_formula.js',
]

base = os.path.dirname(os.path.abspath(__file__))
hashes = []

print(f"{'File':<30} {'SHA-256'}")
print('-' * 96)
for rel in FILES:
    path = os.path.join(base, rel)
    with open(path, 'rb') as f:
        h = hashlib.sha256(f.read()).hexdigest()
    hashes.append((os.path.basename(rel), h))
    print(f"{os.path.basename(rel):<30} {h}")

combined = hashlib.sha256(''.join(h for _, h in hashes).encode()).hexdigest()[:16]
print(f"\nCombined fingerprint: {combined}")
print()

# HASHES.md frissítése
import subprocess
try:
    git_hash = subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD'],
                                        cwd=base, text=True).strip()
    git_date = subprocess.check_output(['git', 'log', '-1', '--format=%ci'],
                                        cwd=base, text=True).strip()[:10]
except Exception:
    git_hash, git_date = 'unknown', 'unknown'

rows = '\n'.join(f'| `{name}` | `{h}` |' for name, h in hashes)
md = f"""# BioWallet — Build Hashes

A `Build: <fingerprint>` értéke az app footer-ében ezekkel egyezik meg, ha a szerver
nem módosított fájlokat szolgált ki.

## v0.9 ({git_date}, commit `{git_hash}`)

| Fájl | SHA-256 |
|------|---------|
{rows}

**Combined fingerprint:** `{combined}`

### Ellenőrzés

```bash
cd BioWallet
python build_hash.py
```

Az app által mutatott fingerprint == a fenti Combined érték → a szerver hiteles.
"""

out = os.path.join(base, 'HASHES.md')
with open(out, 'w', encoding='utf-8') as f:
    f.write(md)
print(f"HASHES.md frissítve: {out}")
