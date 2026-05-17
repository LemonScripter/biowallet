# Mérföldkő: Fázis 0 — Toolchain + Első kernelbetöltés

**Dátum:** 2026-05-17  
**Szerver:** instance-20260213-231819, asia-northeast1-b (Tokió)

## Elvégzett munka

### Helyi gépen
- `DCC_RING0/` könyvtár létrehozva a `_MetaSpace_CPU` projecten belül
- `spec/DCC_RING0_SPEC.md` — teljes architektúra + 8-kapocs eseménylánc modell
- `src/dcc_causality.bpf.c` — Causality Monitor (raw_tp CO-RE, javított)
- `src/dcc_axiom.bpf.c` — Axiom Validator (LSM, LOG-ONLY mód)
- `src/Makefile`
- `userspace/dcc_monitor.py`
- `tests/test_autonomous_block.py`, `tests/test_legitimate_write.py`

### Tokiói szerveren
- `/home/lszok/dcc_ebpf/` — teljesen elkülönített könyvtár
- Toolchain telepítve: `clang 14.0.6`, `bpftool v7.1.0`, `libbpf-dev`
- `src/vmlinux.h` — 106 282 sor, BTF CO-RE generált
- `dcc_causality.bpf.c` lefordítva ÉS **kernelbe töltve** (sudo) ✓

## Bizonyított tény

```
495: raw_tracepoint  name dcc_input_event  tag 2a88a3664446f513  gpl
     loaded_at 2026-05-17T09:10:58+0000
     xlated 328B  jited 189B  memlock 4096B  btf_id 75
```

**Ring 0-ban futott eBPF kód a tokiói szerveren.** 189 bájt JIT-fordított
kernel kód. A bot (23 python3 folyamat) zavartalanul futott végig.

## Következő lépés: Fázis 1 → Fázis 2
- `dcc_core.bpf.c` (kombinált: causality + axiom + audit ring buffer)
- LOG-ONLY módban betölteni
- `dcc_monitor.py` elindítani
- Megfigyelni: a bot autonóm folyamatai `UNSAT:NO_TOKEN`-t kapnak
  (mert headless szerveren nincs hardware IRQ — ez pontosan a DCC állítása)
