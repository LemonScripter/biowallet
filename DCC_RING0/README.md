# DCC Ring 0 — Digital Causal Closure, kernel-szintű implementáció

## Mi ez?

A Cyber Genesis Challenge logikailag bizonyítja a Digital Causal Closure paradigmát:
minden állapotváltozás egy hardware-gyökerű kauzális láncon keresztül megy.

Ez a projekt ugyanezt valósítja meg Ring 0-ban, eBPF LSM hook-okon keresztül,
a tokiói GCP szerveren (Debian 12, kernel 6.1, CONFIG_BPF_LSM=y).

## Amit bizonyítunk

Az autonóm folyamat-osztály (malware, ransomware, spyware) matematikailag képtelen
állapotot változtatni, mert a kauzális lánc első kapcsát (hardware IRQ) szoftverből
nem lehet generálni. Ez nem "security policy" — architektúrális következmény.

## Könyvtárszerkezet

```
DCC_RING0/
├── spec/
│   └── DCC_RING0_SPEC.md      ← teljes architektúra + fejlesztési terv
├── src/
│   ├── dcc_causality.bpf.c    ← input IRQ → token generálás
│   ├── dcc_axiom.bpf.c        ← LSM hook → axioma ellenőrzés (LOG-ONLY alapból)
│   ├── dcc_audit.bpf.c        ← immutable ring buffer audit log
│   └── Makefile
├── userspace/
│   ├── dcc_monitor.py         ← real-time audit megjelenítő
│   └── dcc_loader.py          ← eBPF program betöltő
└── tests/
    ├── test_autonomous_block.py   ← T1: autonóm folyamat UNSAT
    ├── test_legitimate_write.py   ← T2: valódi IRQ → SAT
    ├── test_replay_block.py       ← T3: token újrahasználat UNSAT
    └── test_timeout_block.py      ← T4: időablak lejárat UNSAT
```

## Szerver

```
Instance:  instance-20260213-231819  (asia-northeast1-b, Tokió)
OS:        Debian 12, kernel 6.1.0-43-cloud-amd64
eBPF dir:  /home/lszok/dcc_ebpf/    ← teljesen elkülönített
Bot dir:   /home/lszok/metaspace_bot/ ← ÉRINTHETETLEN
```

## Fejlesztési fázisok

| Fázis | Leírás | Állapot |
|-------|--------|---------|
| 0 | Toolchain telepítés + vmlinux.h | KÉSZ |
| 1 | Causality Monitor (input → token) | folyamatban |
| 2 | Axiom Validator (LOG-ONLY) | folyamatban |
| 3 | Audit Log daemon | tervezett |
| 4 | Integráció + whitelist | tervezett |
| 5 | Thread inheritance | tervezett |

## Biztonság

Az eBPF hook **LOG-ONLY módban** indul — nem blokkol semmit.
Blokkoló mód csak T6 (bot interferencia) teszt után kapcsolható be:

```bash
# Szerveren:
make -C /home/lszok/dcc_ebpf/src enable_blocking   # CSAK T6 után!
make -C /home/lszok/dcc_ebpf/src enable_logonly     # visszakapcsolás
```

## Gyors indítás (szerveren)

```bash
cd /home/lszok/dcc_ebpf/src
make              # fordítás
sudo make load    # betöltés (LOG-ONLY mód)
sudo python3 ../userspace/dcc_monitor.py   # audit megjelenítő
```
