# bio_kernel_emu — BioOS Kauzális Alkotmány Emulátor

**Projekt:** MetaSpace BioOS | **Feltaláló:** Szőke László-Ferenc | **Cég:** Citrom Média LTD  
**Szabadalom:** OSIM 20251221-2230 | **Kapcsolódó:** DCC Ring 0 (Tokyo szerver, eBPF/LSM)

---

## Mi ez?

A `bio_kernel_emu` egy böngészőben futó formális emulátor, amely egy BioOS-alapú
operációs rendszer kernelének kauzális alkotmányát valósítja meg.

**Nem szimuláció — formális modell.**  
Ugyanazok az invariánsok, ugyanaz a Z3-verifikált állapotgép, ami a Tokyo szerver
eBPF/LSM kerneljében fut. A kettő formálisan izomorf.

---

## Az izomorfizmus (DCC Ring 0 ↔ bio_kernel_emu)

| bio_kernel_emu (JS)         | DCC Ring 0 (eBPF/LSM)              |
|-----------------------------|-------------------------------------|
| `isTrusted` IRQ esemény     | `input_event` hardver megszakítás   |
| Causality Window (200ms)    | `CAUSALITY_WINDOW_NS` (500ms)       |
| `CausalToken` objektum      | `struct causal_token` a kernelben   |
| `SAT` → commit              | `VERDICT_SAT` → írás engedélyezve   |
| `UNSAT` → apoptózis         | `VERDICT_NO_TOKEN` → `-ENODEV`      |
| `STATE_INERT`               | `global_state_map = 0`              |
| `STATE_ACTIVE`              | `global_state_map = 1`              |
| Z3 (offline, JS-ben)        | Z3 (offline, Python-ban, 6/6 PASS)  |

**Kulcstény:** A Z3 bizonyítások azonosak. Az izomorfizmus formálisan igazolt.
Lásd: `spec/isomorphism.md` és `tests/verify_isomorphism.py`

---

## Architektúra

```
Fizikai érintés (touch/click)
        ↓
CausalIRQBridge          ← isTrusted check, 200ms causality window
        ↓
CausalToken generálás
        ↓
Z3Gatekeeper             ← Intent + Scope + Integrity döntési mátrix
        ↓
    SAT?
   /      \
igen      nem
  ↓         ↓
StateManager  Apoptózis
ACTIVE        INERT marad
  ↓
Erőforrás láthatóvá válik
(kamera stream, böngésző, hálózat)
```

---

## Komponensek

| Fájl | Szerepkör |
|------|-----------|
| `src/state_manager.js` | INERT/ACTIVE állapot, snapshot/rollback, apoptózis |
| `src/causal_irq_bridge.js` | Fizikai IRQ detekció, token generálás |
| `src/z3_gatekeeper.js` | SAT/UNSAT döntési mátrix (Intent+Scope+Integrity) |
| `src/audit_log.js` | "Denied: No Causal Chain Found" real-time log |
| `src/index.js` | Kernel entry point, komponensek összekapcsolása |
| `demo/index.html` | Vizuális demo — INERT/ACTIVE "életre kelés" |
| `demo/demo.js` | Demo logika (kamera, böngésző, audit feed) |
| `demo/styles.css` | Android-szerű UI |
| `spec/causal_constitution.md` | Formális specifikáció |
| `spec/isomorphism.md` | Izomorfizmus bizonyítás (DCC Ring 0 ↔ bio_kernel_emu) |
| `tests/verify_isomorphism.py` | Z3 izomorfizmus verifikátor |

---

## INERT állapot — "kauzális csend"

```
Ring 3 folyamat hozzáférési kísérlet
        ↓
bio_kernel_emu ellenőrzi: van-e érvényes CausalToken?
        ↓
NINCS → erőforrás "nem létezik"
  - Fájl/eszköz: ENODEV  ("No such device")
  - Hálózat:     ECONNREFUSED ("Connection refused")
  - Exec:        ENODEV
```

Az alkalmazás **nem kap EPERM hibát** — a hardver egyszerűen nem létezik számára.

---

## Verziókövetés

```
v0.1.0  — Könyvtárstruktúra, spec, README (ez a commit)
v0.2.0  — src/ implementáció (StateManager, CausalIRQBridge, Z3Gatekeeper, AuditLog)
v0.3.0  — demo/ vizuális demo
v0.4.0  — tests/ Z3 izomorfizmus verifikáció
v1.0.0  — Kész, DCC Ring 0 integrációval
```

---

## Kapcsolódó projektek

- `DCC_RING0/` — Valódi kernel implementáció (eBPF/LSM, Tokyo szerver)
- `CYBER_GENESIS_CHALLENGE/` — Challenge környezet (az izomorfizmus első bizonyítása)
- `BIO_OS_PROJECT/` — BioOS magasabb szintű OS réteg
