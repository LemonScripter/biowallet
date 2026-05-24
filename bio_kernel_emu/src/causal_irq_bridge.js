// bio_kernel_emu — CausalIRQBridge
// Fizikai IRQ detekció → CausalToken generálás
// Izomorf: dcc_core.bpf.c :: dcc_causality_monitor (raw_tp/input_event)

const CAUSALITY_WINDOW_MS = 200;  // izomorf: CAUSALITY_WINDOW_NS = 500ms

// op_class bitek — izomorf: OP_WRITE | OP_NET | OP_EXEC
const OP_WRITE = 1 << 0;
const OP_NET   = 1 << 1;
const OP_EXEC  = 1 << 2;
const OP_ANY   = 0xFF;

class CausalToken {
    constructor(event) {
        this.timestamp = Date.now();
        this.type      = event.type;
        this.isTrusted = event.isTrusted;
        this.coords    = event.clientX !== undefined
            ? { x: event.clientX, y: event.clientY }
            : null;
        this.opClass   = OP_WRITE | OP_NET | OP_EXEC;  // billentyű/kattintás: teljes szándék
        this.consumed  = false;
        this.pid       = Math.random().toString(36).slice(2, 8);  // demo context ID
    }

    // Token érvényessége — izomorf: age > CAUSALITY_WINDOW_NS
    get isValid() {
        if (this.consumed) return false;
        return (Date.now() - this.timestamp) < CAUSALITY_WINDOW_MS;
    }

    // Token elfogyasztása (első erőforrás-hozzáféréskor)
    // Izomorf: tok->consumed = 1; bpf_map_update_elem BPF_EXIST
    consume() {
        this.consumed = true;
    }
}

class CausalIRQBridge {
    constructor(stateManager, auditLog) {
        this._stateManager = stateManager;
        this._auditLog     = auditLog;
        this._token        = null;
        this._handlers     = [];

        // Izomorf: raw_tp/input_event csak fizikai eseményeket kap
        // A böngésző isTrusted=false szoftveres eseményekre → headless szerver analóg
        this._trustedEvents = ['mousedown', 'touchstart', 'keydown'];
    }

    // Eseményfigyelők bekötése egy DOM elemre
    bindTo(element) {
        for (const evType of this._trustedEvents) {
            element.addEventListener(evType, (e) => this._onEvent(e), { passive: true });
        }
    }

    // Szoftveres trigger (teszteléshez / izomorfizmus demonstrációhoz)
    // Izomorf: headless szerveren ez sosem fut (nincs /dev/input)
    simulateIRQ() {
        const fakeEvent = {
            type: 'synthetic',
            isTrusted: false,  // ← KRITIKUS: szoftveres esemény = nem trusted
            clientX: 0, clientY: 0
        };
        this._onEvent(fakeEvent);
    }

    // Token lekérése az aktuális ablakban
    getToken() {
        if (!this._token || !this._token.isValid) return null;
        return this._token;
    }

    // Fizikai IRQ figyelője
    // Izomorf: BPF_PROG(dcc_causality_monitor, ...) — type=1, value=1 szűrés
    _onEvent(event) {
        if (!event.isTrusted) {
            // Szoftveres esemény — izomorf: headless szerver, nincs IRQ token
            this._auditLog?.denied('Untrusted event: software simulation rejected', 'irq_bridge');
            return;
        }

        this._token = new CausalToken(event);

        // INERT → ACTIVE váltás
        // Izomorf: bpf_map_update_elem(&global_state_map, &key, &STATE_ACTIVE, BPF_ANY)
        this._stateManager.takeSnapshot();
        this._stateManager.setState(1);  // STATE_ACTIVE
        this._auditLog?.active(this._token.pid, event.type);

        // Token lejárat — automata INERT visszaállás
        // Izomorf: age > CAUSALITY_WINDOW_NS → VERDICT_EXPIRED
        setTimeout(() => {
            if (this._token && !this._token.isValid) {
                this._stateManager.setState(0);  // STATE_INERT
                this._auditLog?.expired(this._token.pid);
                this._token = null;
            }
        }, CAUSALITY_WINDOW_MS + 10);

        for (const fn of this._handlers) fn(this._token);
    }

    onToken(fn) { this._handlers.push(fn); }
}

if (typeof module !== 'undefined') {
    module.exports = { CausalIRQBridge, CausalToken, CAUSALITY_WINDOW_MS, OP_WRITE, OP_NET, OP_EXEC, OP_ANY };
} else {
    window.CausalIRQBridge    = CausalIRQBridge;
    window.CausalToken        = CausalToken;
    window.CAUSALITY_WINDOW_MS = CAUSALITY_WINDOW_MS;
}
