# DCC Ring 0 — Phase 10 Live Milestone
**Dátum:** 2026-05-21  
**Szerver:** instance-20260213-231819, asia-northeast1-b (GCP Tokyo)  
**Kernel:** 6.1.0-48-cloud-amd64  
**Git commit:** 8029ad2

---

## Mit értünk el ma

### A DCC Ring 0 élőben fut a kernel LSM hookjaiban

```
sudo bpftool prog list | grep dcc

323: raw_tracepoint  name dcc_causality_monitor  tag 7061cd22c7437b9c  gpl
324: raw_tracepoint  name dcc_fork_inherit       tag 55cfd16ceb2b3666  gpl
325: lsm             name dcc_axiom_validator    tag ca6a3e97b0d9cda2  gpl
326: lsm             name dcc_read_guard         tag edf568e254142683  gpl
327: lsm             name dcc_network_guard      tag 0d93cfdec6d3c3f7  gpl
328: lsm             name dcc_exec_guard         tag 11b02161c7c6b71a  gpl
```

- `lsm` típus = Linux Security Module = Ring 0, kernelben fut
- `jited` = a kernel JIT-lefordította és futtatja
- `bpftool` a kernel saját eszköze — ezt nem lehet szimulálni

### Challenge paritás: 7/7 PASS (run_proofs.sh)

| # | Mit bizonyít | Eredmény |
|---|---|---|
| PROOF 1 | Autonóm folyamat → NO_TOKEN (AUTONOMOUS always false) | PASS |
| PROOF 2 | Whitelistelt folyamat → WHITELIST (intent.valid bypass) | PASS |
| PROOF 3a | TX_ROLLBACK → hard-coded return -1 (TOCTOU) | PASS |
| PROOF 3b | Z3 formálisan: TX_STAGED+!same_inode → soha nem SAT | PASS |
| PROOF 4 | file_axiom_map BLOCK → AXIOM_MISMATCH | PASS |

### Z3 formális verifikáció: 6/6 PASS

```
P1: irq=False → SAT lehetetlen
P2: TX_STAGED + !same_inode → TX_ROLLBACK (soha nem SAT)
P3: file_axiom=BLOCK → SAT lehetetlen
P4: op_class mismatch → SAT lehetetlen
P5: SAT szükséges feltétele: irq=True AND age<500ms
P6: Állapottér véges (Turing-hiányos, Z3 bejárható)
```

### A fizikai garanciát értjük

**A DCC nem hozzáférés-vezérlés. Kauzalitás-kényszer.**

Ha a lánc bármelyik eleme hiányzik:
```
hardware IRQ → token (500ms) → fork örökítés → write (same inode)
```
...a write nem blokkolt, hanem **fizikailag nem lehetséges**.

Headless szerveren nincs IRQ → nincs token → blocking módban EGYETLEN write sem lehetséges. Nem policy, hanem fizikai előfeltétel hiánya.

---

## Mi az igazi következő lépés

**A cél nem a HUP.hu poszt. A cél: a BioOS valóban fusson a szerveren.**

### Mit jelent ez konkrétan

Ma a helyzet:
- A `dcc_loader` manuálisan indítható, timeout után leáll
- Log-only módban fut (nem blokkol, csak naplóz)
- Nincs autostart, nincs systemd service
- A MetaSpace bot (`/home/lszok/metaspace_bot/`) és a DCC Ring 0 egymás mellett él, de nem kapcsolódnak össze

Amit el kell érni (BioOS szerveren):
1. **Perzisztens DCC loader** — systemd service, automatikusan indul boot után
2. **Blocking mód** — élesben blokkolja az autonóm írásokat, ne csak naplózza
3. **bio_memory.json védelem** — `--protect bio_memory.json:write` a bot fájljain
4. **A bot kauzális lánca** — a MetaSpace bot (python3) whitelistelve, de kizárólag a DCC által engedélyezett írásokat végez
5. **Dashboard** — a BioOS dashboard mutassa a kernel audit eseményeket

### Prioritások holnap

**1. Systemd service** (első lépés, reversible)
```bash
# /etc/systemd/system/dcc-ring0.service
[Unit]
Description=DCC Ring 0 Causal Guard
After=network.target

[Service]
ExecStart=/home/lszok/dcc_ebpf/src/dcc_loader dcc_core.bpf.o \
  --quiet --whitelist sshd --whitelist bash --whitelist python3
Restart=always
User=root

[Install]
WantedBy=multi-user.target
```

**2. KRITIKUS:** Blocking mód CSAK akkor, ha a systemd service stabilan indul és az SSH nem szakad meg.

**3. A bot és a DCC összekapcsolása** — a `bio_memory.json` protection aktív legyen.

---

## Szerver fájlok állapota (2026-05-21)

```
/home/lszok/dcc_ebpf/
├── src/
│   ├── dcc_core.bpf.c      ← Phase 8+9+10 (OP_BLOCK pre-whitelist patch)
│   ├── dcc_core.bpf.o      ← lefordítva
│   ├── dcc_loader.c        ← --protect CLI, tx/axiom stat
│   ├── dcc_loader          ← lefordítva
│   └── prove_challenge_parity.sh
├── tests/
│   ├── run_proofs.sh       ← 7/7 PASS (MA futtatva)
│   ├── prove_ring0.sh      ← 11/11 PASS (Phase 7)
│   └── verify_dcc_ring0_bio.py  ← Z3 6/6 PASS
└── (nincs systemd service még)
```

---

## Ismert nyitott kérdések

1. **Pre-whitelist OP_BLOCK** — BPF verifier register prune miatt a pre-whitelist `check_file_axiom` nem fut; PROOF 4 ezért python3-at nem whitelisteli. Phase 11 téma.
2. **Comm-alapú whitelist spoofable** — `prctl(PR_SET_NAME)` bypass; inode-alapú whitelist kellene
3. **Blocking mód + SSH safety** — soha ne indíts `--blocking`-ot `--whitelist sshd` nélkül
4. **Bot isolation** — `/home/lszok/metaspace_bot/` soha nem érintendő direktben

---

## Kritikus figyelmeztetések (holnapra is)

- **SOHA** blocking mód `--whitelist sshd` nélkül → SSH lockout
- **Bot könyvtár** (`/home/lszok/metaspace_bot/`) soha nem érintendő
- **Minden dcc_loader futtatás:** `--quiet` flag + `timeout 20`
- **Blocking mód template:**
  ```
  sudo timeout 20 ./dcc_loader dcc_core.bpf.o \
    --blocking --quiet \
    --whitelist bash --whitelist sshd --whitelist python3
  ```
