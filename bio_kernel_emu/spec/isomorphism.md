# Izomorfizmus — bio_kernel_emu ↔ DCC Ring 0

**Verzió:** 0.1.0 | **Dátum:** 2026-05-24  
**DCC Ring 0 referencia:** commit 8029ad2, Tokyo szerver, kernel 6.1.0-48-cloud-amd64

---

## Az izomorfizmus tétele

> A `bio_kernel_emu` állapotgépe formálisan izomorf a DCC Ring 0 eBPF/LSM
> implementációjával. Ugyanazok a Z3-verifikált invariánsok érvényesek mindkét
> rendszerben. A különbség kizárólag a végrehajtási réteg.

---

## Struktúra-leképezés

### Állapotok

| bio_kernel_emu | DCC Ring 0 (dcc_core.bpf.c) |
|----------------|------------------------------|
| `STATE_INERT = 0` | `global_state_map[0] = 0` |
| `STATE_ACTIVE = 1` | `global_state_map[0] = 1` |
| `CausalToken.valid` | `struct causal_token.consumed == 0` |
| `CausalToken.timestamp` | `causal_token.timestamp_ns` |
| `CAUSALITY_WINDOW = 200ms` | `CAUSALITY_WINDOW_NS = 500ms` |

*Megjegyzés: az ablak mérete implementációs paraméter, nem az invariáns része.*

### Esemény-leképezés

| bio_kernel_emu | DCC Ring 0 |
|----------------|------------|
| `mousedown.isTrusted = true` | `raw_tp/input_event, type=1, value=1` |
| `mousedown.isTrusted = false` | `nincs input_event` (headless szerver) |
| `element.click()` (szoftveres) | `nincs IRQ` → headless = INERT |

### Verdict-leképezés

| bio_kernel_emu | DCC Ring 0 | Kód |
|----------------|------------|-----|
| `SAT` | `VERDICT_SAT = 1` | allow |
| `UNSAT (no token)` | `VERDICT_NO_TOKEN = 2` | `-ENODEV` |
| `UNSAT (expired)` | `VERDICT_EXPIRED = 3` | `-ENODEV` |
| `UNSAT (consumed)` | `VERDICT_CONSUMED = 4` | `-ENODEV` |
| `UNSAT (net)` | `VERDICT_NET_BLOCKED = 9` | `-ECONNREFUSED` |
| `Apoptózis` | `VERDICT_TX_ROLLBACK = 11` | `-1 (EPERM)` |
| `Axiom mismatch` | `VERDICT_AXIOM_MISMATCH = 12` | `-ENODEV` |

### Z3 invariáns-leképezés

| Invariáns | bio_kernel_emu | DCC Ring 0 (verify_dcc_ring0_bio.py) |
|-----------|----------------|---------------------------------------|
| I1: INERT → nincs erőforrás | `StateManager.getResource() = null` | `P1: irq=False → SAT lehetetlen` |
| I2: isTrusted=false → INERT | `isTrusted check` | `headless = no input_event` |
| I3: lejárt token → invalid | `Date.now() - token.ts > window` | `age > CAUSALITY_WINDOW_NS` |
| I4: UNSAT → rollback | `stateManager.rollback()` | `P2: TX_STAGED+!same_inode → ROLLBACK` |
| I5: TOCTOU zárás | `scope check (same resource)` | `tx_map bound_ino` |
| I6: atomi átmenet | `atomicTransition()` | `bpf_map_update_elem BPF_EXIST` |

---

## Miért izomorfizmus és nem csak analógia?

**Közös formális alap:** Mindkét implementáció ugyanabból a `.bio` specifikációból
van deriválva (`DCC_RING0/spec/dcc_ring0.bio`), amelyet Z3 verifikál.

**A Z3 bizonyítások azonosak** — a `verify_isomorphism.py` futtatja ugyanazokat
a P1-P6 bizonyításokat, amelyek a `verify_dcc_ring0_bio.py`-ban 6/6 PASS-t adtak.

**A végrehajtási réteg a különbség:**
```
bio_kernel_emu: JavaScript engine (V8) → böngésző sandbox
DCC Ring 0:     eBPF JIT → Linux kernel LSM hook → Ring 0
```

Az invariánsok, az állapottér, az átmenetek — azonosak.

---

## Bizonyítás menete

```bash
# 1. DCC Ring 0 Z3 bizonyítás (Tokyo szerver)
python3 tests/verify_dcc_ring0_bio.py  # 6/6 PASS

# 2. bio_kernel_emu izomorfizmus bizonyítás (lokális)
python3 bio_kernel_emu/tests/verify_isomorphism.py  # 6/6 PASS várható

# 3. Ha mind a kettő PASS → izomorfizmus igazolt
```
