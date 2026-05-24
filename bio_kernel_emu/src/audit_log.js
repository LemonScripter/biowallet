// bio_kernel_emu — AuditLog
// Real-time kernel audit feed
// Izomorf: dcc_core.bpf.c :: emit() + bpf_printk("DCC: Denied: No Causal Chain Found")

const MAX_EVENTS = 200;

class AuditEvent {
    constructor(type, message, pid) {
        this.timestamp = Date.now();
        this.type      = type;      // 'denied' | 'active' | 'expired' | 'apoptosis' | 'sat'
        this.message   = message;
        this.pid       = pid ?? '—';
    }

    // Izomorf: bpf_printk log formátum
    toString() {
        const t = new Date(this.timestamp).toISOString().slice(11, 23);
        return `[${t}] DCC ${this.type.toUpperCase()}: ${this.message} [pid=${this.pid}]`;
    }
}

class AuditLog {
    constructor() {
        this._events    = [];
        this._listeners = [];
    }

    // "Denied: No Causal Chain Found" — a spec kulcs-üzenete
    // Izomorf: bpf_printk("DCC: Denied: No Causal Chain Found [pid=%d]\n", pid)
    denied(reason, pid) {
        this._emit('denied', `Denied: No Causal Chain Found — ${reason}`, pid);
    }

    // INERT → ACTIVE váltás
    // Izomorf: bpf_printk("DCC: ACTIVE [pid=%d] Causal chain established\n", pid)
    active(pid, eventType) {
        this._emit('active', `Causal chain established [${eventType}]`, pid);
    }

    // Token lejárat
    // Izomorf: VERDICT_EXPIRED emit
    expired(pid) {
        this._emit('expired', 'Causal chain expired — INERT restored', pid);
    }

    // Apoptózis — rollback
    // Izomorf: VERDICT_TX_ROLLBACK + tx_map reset
    apoptosis(reason) {
        this._emit('apoptosis', `Apoptosis: state rolled back — ${reason}`, null);
    }

    // SAT — engedélyezett hozzáférés
    // Izomorf: VERDICT_SAT emit
    sat(pid, resource) {
        this._emit('sat', `SAT — resource granted [${resource}]`, pid);
    }

    getEvents()  { return [...this._events]; }
    getRecent(n) { return this._events.slice(-n); }

    // Figyelő regisztrálása (UI real-time feed)
    onEvent(fn) { this._listeners.push(fn); }

    _emit(type, message, pid) {
        const ev = new AuditEvent(type, message, pid);
        this._events.push(ev);
        if (this._events.length > MAX_EVENTS) this._events.shift();
        for (const fn of this._listeners) fn(ev);
    }
}

if (typeof module !== 'undefined') {
    module.exports = { AuditLog, AuditEvent };
}
