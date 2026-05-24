# Kauzális Alkotmány — Formális Specifikáció

**Verzió:** 0.1.0 | **Dátum:** 2026-05-24

---

## 1. Alapelv

A rendszer alapértelmezett állapota a **kauzális csend** (`STATE_INERT`).
Ebben az állapotban minden Ring 3 folyamat számára a hardveres erőforrások
fizikailag nem léteznek — nem azért mert tilos a hozzáférés, hanem mert
a hozzáféréshez vezető kauzális lánc első eleme hiányzik.

```
INERT: ¬∃ valid CausalToken → resource_exists = FALSE
```

---

## 2. Állapotok

```
STATE_INERT  = 0   // alapértelmezett, "kauzális csend"
STATE_ACTIVE = 1   // aktív kauzális lánc, erőforrások láthatók
```

### Állapotátmenet

```
INERT ──[fizikai IRQ, isTrusted=true]──→ ACTIVE
ACTIVE ──[token lejár (200ms) / apoptózis]──→ INERT
```

Az `INERT → ACTIVE` váltás **atomi művelet** — nem lehet részlegesen aktív.

---

## 3. A Kauzális Lánc

```
[1] Fizikai esemény     → isTrusted = true (böngésző/kernel garantálja)
[2] CausalToken         → {timestamp, pid, op_class, consumed: false}
[3] Causality Window    → 200ms (lejárat után: INERT visszaállás)
[4] Erőforrás-hozzáférés → Z3Gatekeeper ellenőriz
[5] SAT                 → commit, STATE_ACTIVE
    UNSAT               → apoptózis, STATE_INERT
```

Ha a lánc bármelyik eleme hiányzik → az erőforrás nem létezik.

---

## 4. Z3 Döntési Mátrix

Minden erőforrás-hozzáférési kísérletet három változó alapján ítél meg:

| Változó | Kérdés | Típus |
|---------|--------|-------|
| **Intent** | Van érvényes CausalToken? (isTrusted + időablak) | Bool |
| **Scope** | A művelet megfelel a program pozitív axiómáinak? | Bool |
| **Integrity** | A művelet nem módosít védett memóriaterületet? | Bool |

```
SAT  ← Intent ∧ Scope ∧ Integrity
UNSAT ← ¬Intent ∨ ¬Scope ∨ ¬Integrity
```

**Timeout = UNSAT** (fail-safe: bizonytalanság esetén mindig tagad)

---

## 5. Erőforrás-megtagadás kódok

| Erőforrás | INERT visszatérés | Szemantika |
|-----------|------------------|------------|
| Fájl / eszköz | `ENODEV` (19) | "No such device" |
| Hálózat | `ECONNREFUSED` (111) | "Connection refused" |
| Exec | `ENODEV` (19) | "No such device" |

**Nem `EPERM`** — a tilalom helyett a nem-létezés szemantikája.

---

## 6. Apoptózis

Ha `UNSAT`, a StateManager:
1. Elveti az állapot-jelöltet (State Candidate)
2. Visszaállítja az utolsó érvényes snapshotot
3. Visszaállítja `STATE_INERT`-et
4. Loggol: `"Apoptosis: state rolled back [reason]"`

```javascript
// Pseudo-kód
if (gatekeeper.verify(candidate) === UNSAT) {
  stateManager.rollback(snapshot);
  stateManager.setState(STATE_INERT);
  auditLog.denied("No Causal Chain Found", pid);
}
```

---

## 7. Invariánsok (Z3-verifikált)

```
I1: STATE_INERT → ∀ resource: exists(resource) = false
I2: token.isTrusted = false → STATE_INERT (változatlan)
I3: token.age > CAUSALITY_WINDOW → token.valid = false
I4: UNSAT → STATE_INERT (visszaállás, nem marad ACTIVE)
I5: TX_STAGED ∧ ¬same_inode → ROLLBACK (TOCTOU zárás)
I6: ∀ transition: atomi (nincs részleges ACTIVE állapot)
```

Lásd: `tests/verify_isomorphism.py` — Z3 bizonyítás mind a 6 invariánsra.
