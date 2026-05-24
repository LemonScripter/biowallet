// bio_kernel_emu — StateManager
// INERT/ACTIVE állapot, snapshot/rollback, apoptózis
// Izomorf: dcc_core.bpf.c :: global_state_map + tx_map

const STATE_INERT  = 0;
const STATE_ACTIVE = 1;

const ENODEV       = 19;
const ECONNREFUSED = 111;

class StateManager {
    constructor(auditLog) {
        this._state    = STATE_INERT;
        this._snapshot = null;
        this._auditLog = auditLog;
        this._listeners = [];
    }

    get state() { return this._state; }
    get isActive() { return this._state === STATE_ACTIVE; }
    get isInert()  { return this._state === STATE_INERT;  }

    // Atomi állapotváltás — nincs részleges ACTIVE állapot
    // Izomorf: bpf_map_update_elem(&global_state_map, ..., BPF_ANY)
    setState(newState) {
        const prev = this._state;
        this._state = newState;
        this._notify(prev, newState);
    }

    // Snapshot mentése az aktuális "egészséges" állapotról
    // Izomorf: tx_map TX_LOCKED fázis
    takeSnapshot() {
        this._snapshot = {
            state:     this._state,
            timestamp: Date.now(),
        };
    }

    // Rollback az utolsó érvényes snapshotra — Apoptózis
    // Izomorf: VERDICT_TX_ROLLBACK → tx_map reset
    rollback(reason) {
        if (this._snapshot) {
            this._state = this._snapshot.state;
        } else {
            this._state = STATE_INERT;
        }
        this._snapshot = null;
        this._auditLog?.apoptosis(reason);
        this._notify(STATE_ACTIVE, this._state);
    }

    // Erőforrás-hozzáférés INERT állapotban: az eszköz "nem létezik"
    // Izomorf: blocking ? -ENODEV : 0
    getResource(resourceType) {
        if (this.isInert) {
            const code = (resourceType === 'network') ? ECONNREFUSED : ENODEV;
            return { exists: false, errno: code };
        }
        return { exists: true, errno: 0 };
    }

    // Állapotfigyelők regisztrációja (UI frissítéshez)
    onChange(fn) { this._listeners.push(fn); }

    _notify(from, to) {
        for (const fn of this._listeners) fn(from, to);
    }
}

// Csak Node.js / bundler környezetben
if (typeof module !== 'undefined') {
    module.exports = { StateManager, STATE_INERT, STATE_ACTIVE, ENODEV, ECONNREFUSED };
} else {
    window.StateManager = StateManager;
    window.STATE_INERT  = STATE_INERT;
    window.STATE_ACTIVE = STATE_ACTIVE;
}
