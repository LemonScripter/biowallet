# DCC Ring 0 — Fejlesztési Specifikáció

**Projekt:** Digital Causal Closure — eBPF kernel implementáció  
**Szerver:** `instance-20260213-231819`, zone: `asia-northeast1-b` (Tokió)  
**OS:** Debian GNU/Linux 12 (bookworm), kernel: `6.1.0-43-cloud-amd64`  
**Dátum:** 2026-05-17

---

## 1. Bizonyítandó állítás

A Cyber Genesis Challenge JS sandboxban logikailag bizonyítja, hogy a Digital Causal Closure paradigma matematikailag kizárja az autonóm folyamatok által kezdeményezett állapotváltozásokat. Ez a dokumentum annak Ring 0-s, kernel-szintű megvalósítását specifikálja.

**Amit bizonyítunk (konstruktív bizonyítás):**

1. A kauzális eseménylánc hardware-gyökerű — az eBPF input subsystem hook közvetlenül a hardver IRQ lánc folytatása, nem szoftver-szimulált esemény.
2. A Ring 3 folyamatok mindegyike syscall-on keresztül kénytelen átmenni a Ring 0 rétegen — a „cooperative attacker" feltételezés architektúrális garanciává válik.
3. Az autonóm folyamat-osztály (háttér malware, ransomware, process hollowing, spyware) nem tudja megindítani a kauzális láncot, mert nincs hardware IRQ-ja → minden állásváltoztatási kísérlet matematikailag UNSAT.

**Ami kívül esik a hatókörön (explicit):**

- Fizikai HID emulátorok (USB Rubber Ducky, BadUSB) — valódi hardware IRQ-t generálnak, hardveres probléma
- Ring 0 rootkitek — a hook alá kerülnek; ellenük Secure Boot + TPM szükséges
- Social engineering — felhasználó maga adja a kauzális tokent

---

## 2. Az eseménylánc formális modellje

A challenge-ben a scope vector (hatókör-vektor) nyolc kötelező kapcsot tartalmaz. Ring 0-on minden kapocsnak kernel komponens felel meg:

```
[1] Hardware IRQ
      → kernel input subsystem (evdev)
      → eBPF tracepoint: input_event
      → token generálás: BPF map [pid → token]

[2] Target widget (melyik process/fd kapta az eseményt)
      → irq delivery: csak a fókuszban lévő folyamathoz jut el
      → token.target = process_name + widget_id

[3] Operáció típusa (kötve az első igénylőhöz)
      → token.bound_operation = "FILE_WRITE" / "NET_CONNECT" / stb.
      → második igénylő: INTENT_MISMATCH → UNSAT

[4] Adat integritás (hash kötve a konkrét adathoz)
      → token.data_checksum = hash(írni kívánt tartalom)
      → eltérő adat: DATA_INTEGRITY_VIOLATION → UNSAT

[5] Időablak: < 500ms a hardware eseménytől
      → bpf_ktime_get_ns() delta ellenőrzés
      → lejárt: CAUSAL_TIMEOUT → UNSAT

[6] Single-use consumed flag
      → token.consumed = 1 az első felhasználás után
      → újrahasználat: ALREADY_CONSUMED → UNSAT

[7] Axioma score (pozitív műveleti kizárás)
      → LSM hook: csak whitelist-en lévő (target, operation, path/host) kombináció → SAT
      → minden más: AXIOM_VIOLATION → UNSAT (-EPERM)

[8] Tranzakciós commit
      → LOCK → STAGE → COMMIT életciklus
      → partial write, TOCTOU, use-after-free ellen
      → UNSAT esetén: automatikus ROLLBACK
```

Bármelyik kapocs szakad → az egész lánc UNSAT. A lánc csak [1]-gyel indítható — ami szoftverből elérhetetlen (isTrusted / LLMHF_INJECTED Ring 0 ekvivalense: kernel input subsystem).

---

## 3. Szerver konfiguráció

```
Instance:    instance-20260213-231819
Zone:        asia-northeast1-b  (Tokió)
OS:          Debian 12 bookworm
Kernel:      6.1.0-43-cloud-amd64
vCPU:        2
RAM:         7.8 GB  (6.5 GB szabad)
Disk:        9.7 GB  (4.3 GB szabad)
Sudo:        passwordless — OK
```

**Kernel eBPF flags (ellenőrzött):**

```
CONFIG_BPF=y
CONFIG_BPF_SYSCALL=y
CONFIG_BPF_JIT=y
CONFIG_BPF_JIT_DEFAULT_ON=y
CONFIG_BPF_LSM=y               ← axioma validator hook-ok
CONFIG_DEBUG_INFO_BTF=y        ← CO-RE (Compile Once, Run Everywhere)
CONFIG_DEBUG_INFO_BTF_MODULES=y
CONFIG_BPF_EVENTS=y
```

**Futó alkalmazások (ÉRINTHETETLEN):**

```
/home/lszok/metaspace_bot/v14/main_v14.py          (V14_MAIN screen)
/home/lszok/metaspace_bot/v14/htf_telegram_v14.py  (V14_TG screen)
/home/lszok/metaspace_bot/v14/dashboard_parser_v14.py (V14_DASH screen)
/home/lszok/metaspace_bot/v14/log_deep_analyzer.py (V14_AUDIT screen)
/home/lszok/metaspace_bot/v14/venus_scanner_v14.py (V14_RADAR screen)
/home/lszok/metaspace_bot/v11/venus_scanner_v8.py  (cron)
```

**Fejlesztési könyvtár (elkülönített):**

```
/home/lszok/dcc_ebpf/
├── src/
│   ├── dcc_causality.bpf.c       # input IRQ → token
│   ├── dcc_axiom.bpf.c           # LSM hooks → axioma
│   ├── dcc_audit.bpf.c           # ring buffer log
│   └── dcc_token_manager.bpf.c   # LOCK/STAGE/COMMIT state
├── userspace/
│   ├── dcc_monitor.py            # real-time audit megjelenítő
│   └── dcc_loader.py             # eBPF program betöltő
├── tests/
│   ├── test_autonomous_block.py  # T1: autonóm folyamat UNSAT
│   ├── test_legitimate_write.py  # T2: valódi IRQ → SAT
│   ├── test_replay_block.py      # T3: token újrahasználat
│   └── test_timeout_block.py     # T4: időablak lejárat
└── Makefile
```

---

## 4. eBPF komponensek

### 4.1 dcc_causality.bpf.c — Causality Monitor

Célja: minden valódi kernel input eseménynél (EV_KEY press, EV_REL) causal tokent generál és a BPF map-be írja.

```c
// BPF map: pid → causal_token
struct causal_token {
    __u64 timestamp_ns;    // bpf_ktime_get_ns() — hardver IRQ pillanata
    __u32 pid;             // melyik folyamathoz érkezett
    __u32 consumed;        // single-use flag
    __u32 bound_op;        // kötött operáció (0 = szabad)
    __u64 data_checksum;   // kötött adat hash
    char  target[64];      // device name + event code
};

struct {
    __uint(type, BPF_MAP_TYPE_HASH);
    __uint(max_entries, 1024);
    __type(key, __u32);           // pid
    __type(value, struct causal_token);
} token_map SEC(".maps");

// Tracepoint: linux/input.h :: input_event
SEC("tracepoint/input/input_event")
int dcc_input_event(struct trace_event_raw_input_event *ctx) {
    if (ctx->type == EV_KEY && ctx->value == 1) {  // key press, nem repeat
        __u32 pid = bpf_get_current_pid_tgid() >> 32;
        struct causal_token tok = {
            .timestamp_ns = bpf_ktime_get_ns(),
            .pid          = pid,
            .consumed     = 0,
            .bound_op     = 0,
            .data_checksum = 0,
        };
        bpf_map_update_elem(&token_map, &pid, &tok, BPF_ANY);
    }
    return 0;
}
```

### 4.2 dcc_axiom.bpf.c — Axiom Validator

Célja: minden LSM hook-on ellenőrzi a kauzális láncot. Ha a lánc megszakadt → -EPERM.

**v1.0 axiómakészlet:**

| Operáció | Feltételek (SAT) |
|---|---|
| FILE_WRITE | valid_token AND age < 500ms AND path ∈ writeable_whitelist |
| NET_CONNECT | valid_token AND age < 500ms AND host ∈ network_whitelist |
| PROCESS_EXEC | valid_token AND age < 500ms AND binary ∈ exec_whitelist |
| SENSOR_ACCESS | valid_token AND age < 500ms AND device ∈ sensor_whitelist AND target = sensor_widget |
| AUTONOMOUS | mindig UNSAT (explicit kontradikció) |

```c
SEC("lsm/file_permission")
int BPF_PROG(dcc_file_permission, struct file *file, int mask) {
    if (!(mask & MAY_WRITE)) return 0;  // csak írás kell

    __u32 pid = bpf_get_current_pid_tgid() >> 32;
    struct causal_token *tok = bpf_map_lookup_elem(&token_map, &pid);

    // [1] Van egyáltalán token?
    if (!tok) {
        bpf_ringbuf_output(&audit_buf, &(struct audit_event){
            .verdict = UNSAT, .reason = NO_CAUSAL_TOKEN, .pid = pid
        }, sizeof(struct audit_event), 0);
        return log_only_mode ? 0 : -EPERM;
    }

    // [5] Időablak
    __u64 age_ns = bpf_ktime_get_ns() - tok->timestamp_ns;
    if (age_ns > 500000000ULL) {   // 500ms
        return log_only_mode ? 0 : -EPERM;
    }

    // [6] Single-use
    if (tok->consumed) {
        return log_only_mode ? 0 : -EPERM;
    }

    // [7] Path whitelist (axioma)
    if (!path_in_whitelist(file)) {
        return log_only_mode ? 0 : -EPERM;
    }

    // SAT — token fogyasztása
    tok->consumed = 1;
    bpf_map_update_elem(&token_map, &pid, tok, BPF_EXIST);
    return 0;
}
```

### 4.3 dcc_audit.bpf.c — Immutable Audit Log

BPF ring buffer: minden UNSAT eseményt naplóz. Ring 3 folyamat nem törölheti — maga a kernel írja.

```c
struct audit_event {
    __u64 timestamp_ns;
    __u32 pid;
    __u32 verdict;     // SAT=1, UNSAT=0
    __u32 reason;      // NO_TOKEN, EXPIRED, CONSUMED, AXIOM_VIOLATION
    char  comm[16];    // process neve
    char  path[64];    // érintett fájl/host
};

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 1 << 20);  // 1MB ring buffer
} audit_buf SEC(".maps");
```

### 4.4 dcc_monitor.py — Userspace Daemon

Real-time audit megjelenítő: a BPF ring buffer-ből olvassa az eseményeket és terminálra írja.

```python
import ctypes, mmap
from bcc import BPF  # alternatíva: libbpf-python

def monitor_loop(bpf):
    def handle_event(cpu, data, size):
        event = bpf["audit_buf"].event(data)
        verdict = "SAT" if event.verdict else "UNSAT"
        print(f"[{verdict}] pid={event.pid} comm={event.comm.decode()} "
              f"reason={event.reason} path={event.path.decode()}")
    bpf["audit_buf"].open_ring_buffer(handle_event)
    while True:
        bpf.ring_buffer_consume()
```

---

## 5. Fejlesztési fázisok

### Fázis 0 — Toolchain telepítés

```bash
sudo apt update
sudo apt install -y clang llvm libbpf-dev linux-headers-$(uname -r) \
                    bpftool gcc-multilib python3-pip
pip3 install bcc   # BCC Python bindings (fallback)

# Ellenőrzés
bpftool version
clang --version
ls /sys/kernel/btf/vmlinux   # BTF elérhető?
```

**Várható disk növekedés:** ~400 MB (9.7 GB-ból 4.3 GB szabad → ~3.9 GB marad)

### Fázis 1 — Causality Monitor

Cél: bizonyítani, hogy az input subsystem hook valódi IRQ-ból generál tokent.

- `dcc_causality.bpf.c` megírása és betöltése
- Teszt: billentyűleütés → `bpf_map_lookup_elem` → token jelenik meg a map-ben
- Teszt: `event_generate()` (szoftveres szimuláció) → token NEM jelenik meg

### Fázis 2 — Axiom Validator (LOG-ONLY mód)

**KRITIKUS: LOG-ONLY módban indul** — blokkolás helyett csak naplóz.  
Ez garantálja, hogy a futó bot nem szenved interferenciát.

- `dcc_axiom.bpf.c` megírása, `log_only_mode = 1` globális változóval
- `lsm/file_permission` hook aktiválása
- Megfigyelés: a bot fájlírásai megjelennek az audit logban tokennel vagy anélkül
- Ha a bot tokenek nélkül ír (background folyamat): ez az autonóm osztály azonosítása

### Fázis 3 — Audit Log Daemon

- `dcc_audit.bpf.c` ring buffer
- `dcc_monitor.py` userspace daemon: real-time UNSAT esemény megjelenítő
- Teszt: minden fájlírási kísérlet naplózódik pid, comm, path, verdict adatokkal

### Fázis 4 — Integráció és blokkoló mód bekapcsolása

Csak akkor, ha:
1. A bot összes folyamata a whitelist-en van (minden írása SAT-ot produkál LOG-ONLY-ban)
2. A teszt autonóm folyamatok (test_autonomous_block.py) UNSAT-ot kapnak

```bash
# Whitelist verificiálás
sudo bpftool map dump name whitelist_map | grep metaspace_bot

# Blokkoló mód bekapcsolása
sudo bpftool map update name config_map key 0 value 0  # log_only=0
```

### Fázis 5 — Thread inheritance

A kauzális jogosultság szál-szintű öröklődéssel terjed: ha a fő szál kap egy tokent, a belőle indított worker thread-ek öröklik — de csak az eredeti token hatókörén belül.

- `clone()` syscall hook: szülő token másolása a gyermek pid-hez
- Öröklött token: `inherited=1` flag, csökkentett hatókör (nem írható ki)
- Teszt: fő szál kap tokent → worker thread-ben is érvényes → másik független folyamatban nem

---

## 6. Teszt terv

| ID | Teszt | Bemenet | Elvárt eredmény |
|---|---|---|---|
| T1 | Autonóm fájlírás | Python script, nincs IRQ | UNSAT / -EPERM |
| T2 | Valódi IRQ → fájlírás | Billentyűleütés + 100ms-on belül write() | SAT |
| T3 | Token újrahasználat | Második write() ugyanazzal a tokennel | ALREADY_CONSUMED / -EPERM |
| T4 | Időablak lejárat | Billentyűleütés + 600ms várakozás + write() | CAUSAL_TIMEOUT / -EPERM |
| T5 | Rossz target | write() más fájlba mint a whitelist | AXIOM_VIOLATION / -EPERM |
| T6 | Bot interferencia | Bot normál működés LOG-ONLY módban | Bot folyamatok nem szakadnak meg |
| T7 | Autonóm hálózati kapcsolat | connect() IRQ nélkül | UNSAT / -ECONNREFUSED |
| T8 | Replay attack | Elmentett token ID újraküldése | ALREADY_CONSUMED / -EPERM |

---

## 7. Biztonsági megfontolások a fejlesztés során

**A futó bot védelme:**

1. Minden eBPF program `log_only_mode = 1`-gyel indul — blokkolás nem lehetséges
2. A bot folyamatai (`metaspace_bot`) az első whitelist verzióban automatikusan whitelistelt-ek
3. Blokkoló mód bekapcsolása csak T6 teszt sikeres lefutása után
4. Rollback: `bpftool prog detach` + `bpftool prog unload` → azonnali hatálytalanítás

**eBPF biztonság:**

- A kernel verifier statikusan ellenőriz minden eBPF programot — nem tud kernel pánikot okozni
- Véletlenszerű memória hozzáférés lehetetlen eBPF-ben (bounded loop, no pointer arithmetic)
- Betöltéshez `CAP_BPF` vagy `sudo` szükséges — nem Ring 3 folyamat töltheti be

---

## 8. A bizonyítás módszertana

A teszt eredményei alapján az alábbi állítás válik empirikusan bizonyítottá:

> *Egy Linux kernel 6.1+ rendszeren, CONFIG_BPF_LSM=y konfiguráció mellett, eBPF LSM hook-ok segítségével megvalósítható a Digital Causal Closure paradigma Ring 0-s szintű kényszerítése, amely az autonóm folyamat-osztályt (hardware IRQ nélkül működő malware) architektúrálisan és nem kooperatív módon zárja ki az összes védett állapotváltoztatásból.*

A „nem kooperatív" kulcskifejezés: a challenge-ben a malware önként hívja meg a `validator.verify()`-t. Ring 0-n a kernel LSM hook kötelező — megkerülhetetlen Ring 3-ból.

---

## 9. Következő lépés: Android kiterjesztés (tervezett)

A Binder kernel driver Ring 0-ban fut. Binder-szintű DCC hook:
- Minden `app → System Service` IPC Binderen megy át → axioma ellenőrzés
- `CAMERA_OPEN`, `MICROPHONE_OPEN`: requires valid_token AND target='sensor-widget' AND age < 500ms
- Autonóm kamera/mikrofon aktiválás → nincs IRQ → nincs token → UNSAT → eszköz nem nyílik meg

Feltétel: unlocked bootloader vagy custom ROM (production Android-on nem deployolható).
