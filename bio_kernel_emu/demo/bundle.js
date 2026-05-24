// bio_kernel_emu — bundle.js (auto-generated, ne szerkeszd kézzel)
// Forrás: src/ + demo/demo.js | Generálva: build.js
// SES/LavaMoat kompatibilis — egyetlen scope, nincs cross-script global

(function (global) {
'use strict';


// ─── src/audit_log.js ───
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
;
} else {
    window.AuditLog = AuditLog;
}

// ─── src/state_manager.js ───
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

// Csak Node.js / bundler környezetben;
} else {
    window.StateManager = StateManager;
    window.STATE_INERT  = STATE_INERT;
    window.STATE_ACTIVE = STATE_ACTIVE;
}

// ─── src/causal_irq_bridge.js ───
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
;
} else {
    window.CausalIRQBridge    = CausalIRQBridge;
    window.CausalToken        = CausalToken;
    window.CAUSALITY_WINDOW_MS = CAUSALITY_WINDOW_MS;
}

// ─── src/z3_gatekeeper.js ───
// bio_kernel_emu — Z3Gatekeeper
// SAT/UNSAT döntési mátrix: Intent × Scope × Integrity
// Izomorf: dcc_core.bpf.c :: check_dcc_chain_tx + check_file_axiom
// Z3 invariánsok: spec/causal_constitution.md I1-I6

const VERDICT_SAT              = 1;
const VERDICT_NO_TOKEN         = 2;
const VERDICT_EXPIRED          = 3;
const VERDICT_CONSUMED         = 4;
const VERDICT_AXIOM_MISMATCH   = 12;
const VERDICT_NET_BLOCKED      = 9;
const VERDICT_READ_BLOCKED     = 8;
const VERDICT_EXEC_BLOCKED     = 10;

const TIMEOUT_MS = 50;  // verifikáció timeout → automatikusan UNSAT (fail-safe)

class GatekeeperResult {
    constructor(verdict, allowed, errno = 0) {
        this.verdict = verdict;
        this.allowed = allowed;
        this.errno   = errno;
    }
    get isSAT()   { return this.allowed; }
    get isUNSAT() { return !this.allowed; }
}

class Z3Gatekeeper {
    constructor(auditLog) {
        this._auditLog = auditLog;
        // Pozitív axiómák: fájlnév → engedélyezett op_class
        // Izomorf: file_axiom_map (BPF_MAP_TYPE_HASH)
        this._axioms = new Map();
    }

    // Fájlszintű axióma regisztrálása
    // Izomorf: --protect <file>:<write|any|block> loader CLI
    setAxiom(resource, allowedOpClass) {
        this._axioms.set(resource, allowedOpClass);
    }

    // Fő verifikáció — a három változó döntési mátrixa
    // Izomorf: check_dcc_chain_tx() + check_file_axiom()
    async verify(token, operation) {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                // Timeout = UNSAT (fail-safe)
                // Izomorf: Z3 specifikáció: "Timeout → UNSAT"
                this._auditLog?.denied('Gatekeeper timeout — fail-safe UNSAT', operation?.pid);
                resolve(new GatekeeperResult(VERDICT_NO_TOKEN, false, 19));
            }, TIMEOUT_MS);

            const result = this._decide(token, operation);
            clearTimeout(timer);
            resolve(result);
        });
    }

    // Szinkron döntés a három invariáns alapján
    _decide(token, operation) {
        const pid      = operation?.pid ?? 'unknown';
        const resType  = operation?.resourceType ?? 'file';
        const opClass  = operation?.opClass ?? 0;
        const resource = operation?.resource ?? '';

        // ── 1. Intent: van-e érvényes CausalToken? ──
        // Izomorf: tok == NULL → VERDICT_NO_TOKEN; age > window → VERDICT_EXPIRED
        if (!token) {
            const errno = resType === 'network' ? 111 : 19;
            const verdict = resType === 'network' ? VERDICT_NET_BLOCKED : VERDICT_NO_TOKEN;
            this._auditLog?.denied('No Causal Chain Found', pid);
            return new GatekeeperResult(verdict, false, errno);
        }

        if (!token.isValid) {
            const errno = resType === 'network' ? 111 : 19;
            const verdict = token.consumed ? VERDICT_CONSUMED : VERDICT_EXPIRED;
            this._auditLog?.denied('No Causal Chain Found', pid);
            return new GatekeeperResult(verdict, false, errno);
        }

        // ── 2. Scope: megfelel-e a pozitív axiómáknak? ──
        // Izomorf: check_file_axiom() — file_axiom_map lookup
        if (this._axioms.has(resource)) {
            const allowed = this._axioms.get(resource);
            if (allowed === 0x00) {
                // OP_BLOCK — izomorf: *allowed == OP_BLOCK → return -1
                this._auditLog?.denied('Axiom BLOCK on resource', pid);
                return new GatekeeperResult(VERDICT_AXIOM_MISMATCH, false, 19);
            }
            if (!(allowed & opClass)) {
                // op_class mismatch — izomorf: !(*allowed & op_class) → -2
                this._auditLog?.denied('Axiom op_class mismatch', pid);
                return new GatekeeperResult(VERDICT_AXIOM_MISMATCH, false, 19);
            }
        }

        // ── 3. Integrity: nem módosít védett memóriát? ──
        // Izomorf: TX_STAGED + ino != bound_ino → TOCTOU → return -1
        if (operation?.toctouAttempt) {
            this._auditLog?.denied('TOCTOU detected — integrity violation', pid);
            return new GatekeeperResult(VERDICT_AXIOM_MISMATCH, false, 1);  // EPERM
        }

        // ── SAT: minden invariáns teljesül ──
        // Izomorf: VERDICT_SAT, tok->consumed = 1
        token.consume();
        return new GatekeeperResult(VERDICT_SAT, true, 0);
    }
}
;
} else {
    window.Z3Gatekeeper = Z3Gatekeeper;
}

// ─── src/index.js ───
// bio_kernel_emu — BioKernelEmu
// Kernel entry point: komponensek összekapcsolása
// Izomorf: dcc_core.bpf.c — a 6 BPF program együttese

// Node.js: require; böngésző: window.X globálisok (script tag-enként beállítva)

class BioKernelEmu {
    constructor() {
        // Rétegek inicializálása — izomorf: BPF map inicializálás a loaderben
        this.auditLog    = new AuditLog();
        this.stateManager = new StateManager(this.auditLog);
        this.irqBridge   = new CausalIRQBridge(this.stateManager, this.auditLog);
        this.gatekeeper  = new Z3Gatekeeper(this.auditLog);
    }

    // Kernel indítása — izomorf: dcc_loader betölti a BPF objektet
    start(rootElement) {
        if (rootElement) {
            this.irqBridge.bindTo(rootElement);
        }
        this.auditLog._emit('active', 'BioKernelEmu started — STATE_INERT', 'kernel');
        return this;
    }

    // Erőforrás-hozzáférési kísérlet
    // Izomorf: lsm/file_permission + lsm/socket_connect + lsm/bprm_check_security
    async requestResource(resourceType, resource, opClass) {
        const resourceCheck = this.stateManager.getResource(resourceType);

        if (!resourceCheck.exists) {
            // INERT állapot — az erőforrás "nem létezik"
            this.auditLog.denied(`${resourceType}/${resource} — STATE_INERT`, 'kernel');
            return { granted: false, errno: resourceCheck.errno };
        }

        const token = this.irqBridge.getToken();
        const operation = { resourceType, resource, opClass, pid: token?.pid ?? 'anon' };

        const result = await this.gatekeeper.verify(token, operation);

        if (result.isSAT) {
            this.auditLog.sat(operation.pid, resource);
        }

        return { granted: result.isSAT, errno: result.errno, verdict: result.verdict };
    }

    // Axióma beállítás — izomorf: --protect CLI a loaderben
    protect(resource, opClass) {
        this.gatekeeper.setAxiom(resource, opClass);
        return this;
    }

    // Eseményfigyelők regisztrálása
    onStateChange(fn) { this.stateManager.onChange(fn); return this; }
    onAuditEvent(fn)  { this.auditLog.onEvent(fn); return this; }
    onToken(fn)       { this.irqBridge.onToken(fn); return this; }
}

// Böngészőben globálisan elérhető
if (typeof window !== 'undefined') {
    window.BioKernelEmu  = BioKernelEmu;
    window.AuditLog      = AuditLog;
    window.StateManager  = StateManager;
    window.CausalIRQBridge = CausalIRQBridge;
    window.Z3Gatekeeper  = Z3Gatekeeper;
}
;
}

// ─── demo/demo.js ───
// bio_kernel_emu — Demo logika
// INERT/ACTIVE vizuális váltás, kamera szimuláció, audit feed

(function () {
    // ── Kernel inicializálás ──
    const kernel = new BioKernelEmu();
    kernel.start(document.body);

    // ── DOM elemek ──
    const body        = document.body;
    const stateBadge  = document.getElementById('state-badge');
    const stateLabel  = document.getElementById('state-label');
    const triggerBtn  = document.getElementById('trigger-btn');
    const auditLogEl  = document.getElementById('audit-log');
    const eventCount  = document.getElementById('event-count');
    const cameraStatus= document.getElementById('camera-status');
    const netStatus   = document.getElementById('net-status');
    const browserUrl  = document.getElementById('browser-url');
    const canvas      = document.getElementById('camera-canvas');
    const ctx         = canvas.getContext('2d');

    let eventTotal = 0;
    let animFrame  = null;
    let isActive   = false;

    // ── Kamera canvas méretezés ──
    function resizeCanvas() {
        canvas.width  = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // ── INERT kamera: fekete ──
    function drawInert() {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // ENODEV felirat
        ctx.fillStyle = 'rgba(192,57,43,0.3)';
        ctx.font = '12px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText('ENODEV', canvas.width / 2, canvas.height / 2);
    }

    // ── ACTIVE kamera: élő feed szimuláció ──
    let t = 0;
    function drawActive() {
        t += 0.02;
        const w = canvas.width, h = canvas.height;

        // Alap gradient — zöld tónus (aktív állapot szimbolikája)
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0,   `hsl(${140 + Math.sin(t) * 10}, 50%, 8%)`);
        grad.addColorStop(0.5, `hsl(${150 + Math.cos(t * 0.7) * 8}, 40%, 12%)`);
        grad.addColorStop(1,   `hsl(${130 + Math.sin(t * 1.3) * 12}, 45%, 6%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // Scan-line effekt — CRT / kamera monitor feeling
        ctx.strokeStyle = 'rgba(39,174,96,0.04)';
        ctx.lineWidth = 1;
        for (let y = 0; y < h; y += 3) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }

        // Mozgó "signal" pont — él a feed
        const sx = w * 0.5 + Math.sin(t * 1.2) * w * 0.3;
        const sy = h * 0.5 + Math.cos(t * 0.8) * h * 0.25;
        const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 60);
        glow.addColorStop(0, 'rgba(39,174,96,0.5)');
        glow.addColorStop(1, 'rgba(39,174,96,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);

        // "LIVE" felirat
        ctx.fillStyle = 'rgba(39,174,96,0.8)';
        ctx.font = '11px Courier New';
        ctx.textAlign = 'left';
        ctx.fillText('● LIVE', 12, 20);

        // Timestamp
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(39,174,96,0.5)';
        ctx.fillText(new Date().toISOString().slice(11, 23), w - 12, 20);

        animFrame = requestAnimationFrame(drawActive);
    }

    // ── Állapotváltás kezelése ──
    kernel.onStateChange((from, to) => {
        isActive = (to === 1);

        if (isActive) {
            // INERT → ACTIVE
            body.className = 'active';
            stateBadge.className = 'state-badge active';
            stateLabel.textContent = 'STATE_ACTIVE';
            cameraStatus.style.color = 'var(--active-color)';
            cameraStatus.textContent = 'LIVE';
            netStatus.style.color = 'var(--active-color)';
            netStatus.textContent = 'CONNECTED';
            browserUrl.textContent = 'https://metaspace.bio/';
            triggerBtn.textContent = '✓ AKTÍV — érintés az újraindításhoz';

            if (animFrame) cancelAnimationFrame(animFrame);
            drawActive();

        } else {
            // ACTIVE → INERT
            body.className = 'inert';
            stateBadge.className = 'state-badge inert';
            stateLabel.textContent = 'STATE_INERT';
            cameraStatus.style.color = 'var(--inert-color)';
            cameraStatus.textContent = 'ENODEV';
            netStatus.style.color = 'var(--inert-color)';
            netStatus.textContent = 'ECONNREFUSED';
            browserUrl.textContent = 'about:blank — No Causal Chain';
            triggerBtn.textContent = '⚡ FIZIKAI ÉRINTÉS — KAUZÁLIS LÁNC AKTIVÁLÁSA';

            if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
            drawInert();
        }
    });

    // ── Audit log megjelenítés ──
    kernel.onAuditEvent((ev) => {
        eventTotal++;
        eventCount.textContent = `${eventTotal} esemény`;

        const el = document.createElement('div');
        el.className = `audit-event ${ev.type}`;

        const time = new Date(ev.timestamp).toISOString().slice(11, 23);
        el.innerHTML = `<div class="audit-time">${time}</div>${ev.message}`;

        auditLogEl.appendChild(el);
        auditLogEl.scrollTop = auditLogEl.scrollHeight;

        // Max 60 esemény a DOM-ban
        while (auditLogEl.children.length > 60) {
            auditLogEl.removeChild(auditLogEl.firstChild);
        }
    });

    // ── Trigger gomb ──
    // A valódi kattintás isTrusted=true → ez a kauzális lánc első eleme
    triggerBtn.addEventListener('mousedown', async (e) => {
        // A gomb kattintása MAGA az IRQ — nem szimuláljuk, ez valódi fizikai esemény
        // A CausalIRQBridge a body-ra van kötve, ez a mousedown oda is felbuborékol

        // Resource-request demonstráció (a gomb megnyomása után)
        setTimeout(async () => {
            if (isActive) {
                await kernel.requestResource('file', 'camera_feed', 0x01);
                await kernel.requestResource('network', 'metaspace.bio', 0x02);
            }
        }, 50);
    });

    // ── Autonóm bot demonstráció ──
    // Szoftveres kísérlet erőforrás-hozzáférésre IRQ nélkül → mindig INERT marad
    setInterval(async () => {
        if (!isActive) {
            // Izomorf: headless szerver autonóm folyamata (nincs IRQ)
            const result = await kernel.requestResource('network', 'external-api', 0x02);
            // result.granted === false, result.errno === 111 (ECONNREFUSED)
        }
    }, 3000);

    // ── Kezdeti állapot ──
    drawInert();

})();

})(typeof window !== 'undefined' ? window : globalThis);
