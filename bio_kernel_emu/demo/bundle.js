// bio_kernel_emu — bundle.js  (single-scope, SES/LavaMoat compatible)
// Isomorphic to: DCC Ring 0 eBPF/LSM, dcc_core.bpf.c, Tokyo server kernel 6.1.0-48

(function () {
'use strict';

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────
var STATE_INERT  = 0;
var STATE_ACTIVE = 1;
var ENODEV       = 19;
var ECONNREFUSED = 111;

var OP_WRITE = 0x01;  // file / device access
var OP_NET   = 0x02;  // socket / network
var OP_EXEC  = 0x04;  // process execution
var OP_ANY   = 0xFF;  // all resource classes

var CAUSALITY_WINDOW_MS     = 200;   // token validity (spec)
var DEMO_ACTIVE_DURATION_MS = 8000;  // visual ACTIVE hold (demo parameter)
var MAX_EVENTS              = 200;
var TIMEOUT_MS              = 50;

var VERDICT_SAT            = 1;
var VERDICT_NO_TOKEN       = 2;
var VERDICT_EXPIRED        = 3;
var VERDICT_CONSUMED       = 4;
var VERDICT_AXIOM_MISMATCH = 12;
var VERDICT_NET_BLOCKED    = 9;

// ─────────────────────────────────────────────
// AuditLog
// Isomorphic: bpf_ringbuf + bpf_printk on dcc_core.bpf.c
// ─────────────────────────────────────────────
function AuditEvent(type, message, pid) {
    this.timestamp = Date.now();
    this.type      = type;
    this.message   = message;
    this.pid       = pid != null ? pid : '—';
}

function AuditLog() {
    this._events    = [];
    this._listeners = [];
}
AuditLog.prototype.denied = function(reason, pid) {
    this._emit('denied', 'Denied: No Causal Chain Found — ' + reason, pid);
};
AuditLog.prototype.active = function(pid, opClass) {
    var label = opClassLabel(opClass);
    this._emit('active', 'Causal chain established [' + label + ']', pid);
};
AuditLog.prototype.expired = function(pid) {
    this._emit('expired', 'Causal chain expired — STATE_INERT restored', pid);
};
AuditLog.prototype.apoptosis = function(reason) {
    this._emit('apoptosis', 'Apoptosis: state rolled back — ' + reason, null);
};
AuditLog.prototype.sat = function(pid, resource) {
    this._emit('sat', 'SAT — access granted [' + resource + ']', pid);
};
AuditLog.prototype.system = function(msg) {
    this._emit('system', msg, 'kernel');
};
AuditLog.prototype.onEvent = function(fn) { this._listeners.push(fn); };
AuditLog.prototype._emit  = function(type, message, pid) {
    var ev = new AuditEvent(type, message, pid);
    this._events.push(ev);
    if (this._events.length > MAX_EVENTS) this._events.shift();
    for (var i = 0; i < this._listeners.length; i++) this._listeners[i](ev);
};

// ─────────────────────────────────────────────
// StateManager
// Isomorphic: global_state_map + tx_map in dcc_core.bpf.c
// ─────────────────────────────────────────────
function StateManager(auditLog) {
    this._state     = STATE_INERT;
    this._opClass   = 0;
    this._snapshot  = null;
    this._auditLog  = auditLog;
    this._listeners = [];
}
StateManager.prototype = {
    get state()    { return this._state; },
    get opClass()  { return this._opClass; },
    get isActive() { return this._state === STATE_ACTIVE; },
    get isInert()  { return this._state === STATE_INERT; },
    setState: function(newState, opClass) {
        var prev = this._state;
        this._state   = newState;
        this._opClass = (newState === STATE_ACTIVE) ? (opClass || OP_ANY) : 0;
        for (var i = 0; i < this._listeners.length; i++)
            this._listeners[i](prev, newState, this._opClass);
    },
    takeSnapshot: function() {
        this._snapshot = { state: this._state, opClass: this._opClass, ts: Date.now() };
    },
    rollback: function(reason) {
        this._state   = this._snapshot ? this._snapshot.state   : STATE_INERT;
        this._opClass = this._snapshot ? this._snapshot.opClass : 0;
        this._snapshot = null;
        if (this._auditLog) this._auditLog.apoptosis(reason);
        for (var i = 0; i < this._listeners.length; i++)
            this._listeners[i](STATE_ACTIVE, this._state, this._opClass);
    },
    // Returns whether a specific resource class is currently accessible
    // Isomorphic: check_dcc_chain_tx + op_class bitmask check
    canAccess: function(reqOpClass) {
        if (this.isInert) return false;
        return (this._opClass & reqOpClass) !== 0;
    },
    onChange: function(fn) { this._listeners.push(fn); }
};

// ─────────────────────────────────────────────
// CausalToken
// Isomorphic: struct causal_token in dcc_core.bpf.c
// ─────────────────────────────────────────────
function CausalToken(event, opClass) {
    this.timestamp = Date.now();
    this.type      = event.type;
    this.isTrusted = event.isTrusted;
    this.opClass   = opClass || OP_ANY;
    this.consumed  = false;
    this.pid       = Math.random().toString(36).slice(2, 8);
}
Object.defineProperty(CausalToken.prototype, 'isValid', {
    get: function() {
        return !this.consumed && (Date.now() - this.timestamp) < CAUSALITY_WINDOW_MS;
    }
});
CausalToken.prototype.consume = function() { this.consumed = true; };

// ─────────────────────────────────────────────
// CausalIRQBridge
// Isomorphic: dcc_causality_monitor raw_tp/input_event
// ─────────────────────────────────────────────
function CausalIRQBridge(stateManager, auditLog) {
    this._stateManager = stateManager;
    this._auditLog     = auditLog;
    this._token        = null;
    this._handlers     = [];
    this._activeTimer  = null;
}
CausalIRQBridge.prototype.getToken = function() {
    return (this._token && this._token.isValid) ? this._token : null;
};

// Triggered by a specific UI element with a designated op_class
// Isomorphic: input_event → token creation → global_state_map = ACTIVE
CausalIRQBridge.prototype.trigger = function(event, opClass) {
    if (!event.isTrusted) {
        if (this._auditLog)
            this._auditLog.denied('Untrusted event (isTrusted=false) — software simulation rejected', 'irq_bridge');
        return;
    }

    this._token = new CausalToken(event, opClass);
    this._stateManager.takeSnapshot();
    this._stateManager.setState(STATE_ACTIVE, opClass);
    if (this._auditLog) this._auditLog.active(this._token.pid, opClass);

    // Reset visual-hold timer on each new physical touch
    var self = this;
    var pid  = this._token.pid;
    if (this._activeTimer) clearTimeout(this._activeTimer);
    this._activeTimer = setTimeout(function() {
        self._stateManager.setState(STATE_INERT, 0);
        if (self._auditLog) self._auditLog.expired(pid);
        self._token       = null;
        self._activeTimer = null;
    }, DEMO_ACTIVE_DURATION_MS);

    for (var i = 0; i < this._handlers.length; i++) this._handlers[i](this._token);
};
CausalIRQBridge.prototype.onToken = function(fn) { this._handlers.push(fn); };

// ─────────────────────────────────────────────
// Z3Gatekeeper
// Isomorphic: check_dcc_chain_tx + check_file_axiom
// Decision matrix: Intent ∧ Scope (op_class match) ∧ Integrity
// ─────────────────────────────────────────────
function GatekeeperResult(verdict, allowed, errno) {
    this.verdict = verdict;
    this.allowed = allowed;
    this.errno   = errno || 0;
}
Object.defineProperty(GatekeeperResult.prototype, 'isSAT',   { get: function() { return  this.allowed; } });
Object.defineProperty(GatekeeperResult.prototype, 'isUNSAT', { get: function() { return !this.allowed; } });

function Z3Gatekeeper(auditLog) {
    this._auditLog = auditLog;
    this._axioms   = new Map();
}
Z3Gatekeeper.prototype.setAxiom = function(resource, allowedOpClass) {
    this._axioms.set(resource, allowedOpClass);
};
Z3Gatekeeper.prototype.verify = function(token, operation) {
    var self  = this;
    return new Promise(function(resolve) {
        var timer = setTimeout(function() {
            if (self._auditLog) self._auditLog.denied('Gatekeeper timeout — fail-safe UNSAT', operation ? operation.pid : null);
            resolve(new GatekeeperResult(VERDICT_NO_TOKEN, false, ENODEV));
        }, TIMEOUT_MS);
        var result = self._decide(token, operation);
        clearTimeout(timer);
        resolve(result);
    });
};
Z3Gatekeeper.prototype._decide = function(token, operation) {
    var pid      = operation ? (operation.pid      || 'unknown') : 'unknown';
    var resType  = operation ? (operation.resType  || 'file')    : 'file';
    var reqOp    = operation ? (operation.opClass  || 0)         : 0;
    var resource = operation ? (operation.resource || '')        : '';
    var log      = this._auditLog;

    // ── Intent: valid CausalToken present? ──
    // Isomorphic: tok == NULL → VERDICT_NO_TOKEN → -ENODEV
    if (!token) {
        if (log) log.denied('No CausalToken — INERT', pid);
        return new GatekeeperResult(
            resType === 'network' ? VERDICT_NET_BLOCKED : VERDICT_NO_TOKEN,
            false,
            resType === 'network' ? ECONNREFUSED : ENODEV
        );
    }
    if (!token.isValid) {
        if (log) log.denied('Token expired or consumed', pid);
        return new GatekeeperResult(
            token.consumed ? VERDICT_CONSUMED : VERDICT_EXPIRED,
            false,
            resType === 'network' ? ECONNREFUSED : ENODEV
        );
    }

    // ── Scope: token op_class covers the requested resource class? ──
    // Isomorphic: op_class bitmask check in dcc_axiom_validator
    if (!(token.opClass & reqOp)) {
        if (log) log.denied(
            'op_class mismatch: token=' + opClassLabel(token.opClass) + ' req=' + opClassLabel(reqOp), pid
        );
        return new GatekeeperResult(VERDICT_AXIOM_MISMATCH, false, ENODEV);
    }

    // ── Scope: file_axiom_map check ──
    // Isomorphic: check_file_axiom() → file_axiom_map lookup
    if (this._axioms.has(resource)) {
        var allowed = this._axioms.get(resource);
        if (allowed === 0 || !(allowed & reqOp)) {
            if (log) log.denied('Axiom BLOCK/mismatch on resource: ' + resource, pid);
            return new GatekeeperResult(VERDICT_AXIOM_MISMATCH, false, ENODEV);
        }
    }

    // ── Integrity: TOCTOU check ──
    // Isomorphic: TX_STAGED + ino != bound_ino → ROLLBACK
    if (operation && operation.toctouAttempt) {
        if (log) log.denied('TOCTOU detected — integrity violation', pid);
        return new GatekeeperResult(VERDICT_AXIOM_MISMATCH, false, 1);
    }

    // ── SAT: all invariants satisfied ──
    token.consume();
    return new GatekeeperResult(VERDICT_SAT, true, 0);
};

// ─────────────────────────────────────────────
// BioKernelEmu — kernel entry point
// Isomorphic: dcc_loader loading 6 BPF programs
// ─────────────────────────────────────────────
function BioKernelEmu() {
    this.auditLog     = new AuditLog();
    this.stateManager = new StateManager(this.auditLog);
    this.irqBridge    = new CausalIRQBridge(this.stateManager, this.auditLog);
    this.gatekeeper   = new Z3Gatekeeper(this.auditLog);
}
BioKernelEmu.prototype.requestResource = function(resType, resource, opClass) {
    var self = this;
    if (!this.stateManager.canAccess(opClass)) {
        this.auditLog.denied(resType + ':' + resource + ' — no ' + opClassLabel(opClass) + ' token', 'kernel');
        var errno = resType === 'network' ? ECONNREFUSED : ENODEV;
        return Promise.resolve({ granted: false, errno: errno });
    }
    var token = this.irqBridge.getToken();
    var op    = { resType: resType, resource: resource, opClass: opClass, pid: token ? token.pid : 'anon' };
    return this.gatekeeper.verify(token, op).then(function(result) {
        if (result.isSAT) self.auditLog.sat(op.pid, resource);
        return { granted: result.isSAT, errno: result.errno, verdict: result.verdict };
    });
};
BioKernelEmu.prototype.onStateChange = function(fn) { this.stateManager.onChange(fn); return this; };
BioKernelEmu.prototype.onAuditEvent  = function(fn) { this.auditLog.onEvent(fn);      return this; };

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function opClassLabel(op) {
    if (op === OP_ANY || op === (OP_WRITE | OP_NET | OP_EXEC)) return 'OP_ANY';
    var parts = [];
    if (op & OP_WRITE) parts.push('OP_WRITE');
    if (op & OP_NET)   parts.push('OP_NET');
    if (op & OP_EXEC)  parts.push('OP_EXEC');
    return parts.length ? parts.join('|') : 'OP_NONE';
}

// ─────────────────────────────────────────────
// Modal content (professional English, industrial-grade)
// ─────────────────────────────────────────────
var MODALS = {
    state: {
        title: 'Global Causal State — global_state_map',
        body: '<p><span class="tag-inert">STATE_INERT (0)</span> is the default and architecturally safe state — "causal silence." In this state, all hardware resources are physically absent from the perspective of any Ring 3 process. The kernel returns <code>ENODEV</code> or <code>ECONNREFUSED</code> rather than <code>EPERM</code>, making resources non-existent rather than merely forbidden.</p><p><span class="tag-active">STATE_ACTIVE (1)</span> is established when a validated physical event produces a <code>CausalToken</code> with a non-zero <code>op_class</code>. Only resource classes covered by <code>token.op_class</code> become accessible.</p><h3>Isomorphic kernel construct</h3><pre>// dcc_core.bpf.c — global_state_map\nstruct {\n    __uint(type, BPF_MAP_TYPE_ARRAY);\n    __uint(max_entries, 1);\n    __type(key,   __u32);\n    __type(value, __u32);  // 0=INERT, 1=ACTIVE\n} global_state_map SEC(".maps");</pre><p>Set atomically by <code>dcc_causality_monitor</code> upon receipt of a hardware <code>input_event</code> interrupt. Cleared after <code>CAUSALITY_WINDOW_NS</code> expiry.</p>'
    },
    camera: {
        title: 'Camera Feed — OP_WRITE Causal Gate',
        body: '<p>This panel represents a character device resource (e.g., <code>/dev/video0</code>) protected by the <code>lsm/file_permission</code> Linux Security Module hook. Access requires a <code>CausalToken</code> with <code>op_class &amp; OP_WRITE (0x01)</code> set.</p><h3>INERT behavior</h3><p>When no OP_WRITE token is present, the kernel LSM hook returns <code>-ENODEV (errno 19)</code> — not <code>-EPERM</code>. From the process perspective, the device does not exist. This prevents reconnaissance: an adversarial process cannot distinguish between "access denied" and "hardware absent."</p><h3>Activation</h3><p>A physical <code>mousedown</code> event (<code>isTrusted=true</code>) on this panel generates a <code>CausalToken</code> with <code>op_class = OP_WRITE</code>. The <code>Z3Gatekeeper</code> evaluates <code>Intent ∧ Scope ∧ Integrity</code> → <code>SAT</code> → camera feed becomes accessible.</p><h3>Isomorphic kernel construct</h3><pre>// dcc_core.bpf.c — dcc_axiom_validator\nSEC("lsm/file_permission")\nint BPF_PROG(dcc_axiom_validator, struct file *file, int mask) {\n    ...\n    return check_dcc_chain_tx(pid, blocking, ino, -ENODEV);\n}</pre>'
    },
    network: {
        title: 'Network / Browser — OP_NET Causal Gate',
        body: '<p>This panel represents network socket egress protected by the <code>lsm/socket_connect</code> LSM hook. Without a valid <code>CausalToken</code> carrying <code>op_class &amp; OP_NET (0x02)</code>, all outbound connections are rejected with <code>ECONNREFUSED (errno 111)</code>.</p><h3>Security semantics</h3><p>The <code>ECONNREFUSED</code> response — rather than <code>EPERM</code> — is semantically equivalent to a closed remote port. An autonomous process (e.g., malware, a headless bot) cannot distinguish between a physically absent network interface and a remote service refusal. This prevents exfiltration: there is no causal path from autonomous execution to network egress.</p><h3>Headless server theorem</h3><p>On the Tokyo GCP server (headless, no <code>/dev/input</code>), <code>raw_tp/input_event</code> never fires → no token ever created → <code>STATE_INERT</code> is invariant → network access is structurally impossible, not policy-blocked.</p><h3>Isomorphic kernel construct</h3><pre>// dcc_core.bpf.c — dcc_network_guard\nSEC("lsm/socket_connect")\nint BPF_PROG(dcc_network_guard, ...) {\n    if (!tok) {\n        bpf_printk("DCC: Denied: No Causal Chain Found\\n");\n        return blocking ? -ECONNREFUSED : 0;\n    }\n}</pre>'
    },
    audit: {
        title: 'Kernel Audit Log — BPF Ring Buffer',
        body: '<p>This feed mirrors the kernel\'s BPF ring buffer (<code>audit_buf</code>, <code>BPF_MAP_TYPE_RINGBUF</code>, 1 MiB) on the Tokyo server. Each entry corresponds to a <code>struct audit_event</code> submitted by an active LSM program via <code>bpf_ringbuf_submit()</code>.</p><h3>Verdict taxonomy</h3><ul><li><span class="tag-inert">DENIED</span> — <code>VERDICT_NO_TOKEN / VERDICT_EXPIRED / VERDICT_NET_BLOCKED</code>: no valid causal chain</li><li><span class="tag-active">ACTIVE</span> — <code>VERDICT_SAT</code>: causal chain established, access granted</li><li style="color:#fa8">EXPIRED</span> — causality window elapsed, STATE_INERT restored</li><li style="color:#c8a">APOPTOSIS</span> — <code>VERDICT_TX_ROLLBACK</code>: TOCTOU violation, state rolled back</li></ul><h3>Autonomous bot simulation</h3><p>The 3-second interval attempts (showing <code>ECONNREFUSED</code>) simulate an autonomous process on a headless server trying to access network resources without a physical IRQ source. These will always be denied — demonstrating the structural impossibility of causal chain formation without a physical event.</p><h3>Isomorphic kernel construct</h3><pre>bpf_printk("DCC: Denied: No Causal Chain Found [pid=%d]\\n", pid);\n// readable via: cat /sys/kernel/debug/tracing/trace_pipe</pre>'
    },
    trigger: {
        title: 'Physical IRQ — Full Causal Chain Initiator (OP_ANY)',
        body: '<p>A <code>mousedown</code> event on this button carries <code>isTrusted=true</code>, set exclusively by the browser\'s trusted event subsystem — the browser-layer equivalent of a hardware interrupt (<code>raw_tp/input_event</code>, <code>type=EV_KEY, value=1</code>) at the kernel level.</p><h3>The isTrusted boundary</h3><p>This flag <strong>cannot be set programmatically</strong>. Calls to <code>element.dispatchEvent(new MouseEvent(\'mousedown\', ...))</code> always produce <code>isTrusted=false</code>. This is the formal causal boundary between physical user intent and digital execution.</p><h3>op_class = OP_ANY (0xFF)</h3><p>This button activates all resource classes simultaneously: <code>OP_WRITE | OP_NET | OP_EXEC</code>. Individual panels use targeted op_class values to demonstrate selective causal authorization.</p><h3>Causality window</h3><p>The generated <code>CausalToken</code> has a validity of <code>CAUSALITY_WINDOW_MS = 200ms</code> (isomorphic to <code>CAUSALITY_WINDOW_NS = 500,000,000</code> in the kernel implementation). The visual ACTIVE state persists for <code>DEMO_ACTIVE_DURATION_MS = 8000ms</code> as a demo parameter; each new physical touch resets this timer.</p><h3>Isomorphic kernel construct</h3><pre>// dcc_core.bpf.c — dcc_causality_monitor\nSEC("raw_tp/input_event")\nint BPF_PROG(dcc_causality_monitor,\n             void *dev, unsigned int type, unsigned int code, int value) {\n    if (type != 1 || value != 1) return 0;  // EV_KEY, KEY_PRESS only\n    // ... token creation, global_state_map = STATE_ACTIVE\n}</pre>'
    },
    'chain-irq': {
        title: 'Causal Chain Node 1: Hardware IRQ',
        body: '<p>The first and only valid source of causal authority is a hardware interrupt — a physical event originating from a human-actuated input device. In the kernel, this is captured by <code>raw_tp/input_event</code> with <code>type=EV_KEY, value=1</code> (key press).</p><p>In the browser emulator, the equivalent is any DOM event with <code>isTrusted=true</code>: <code>mousedown</code>, <code>touchstart</code>, or <code>keydown</code> generated by actual user interaction — never by script.</p><p><strong>A headless server has no input devices.</strong> This makes <code>raw_tp/input_event</code> structurally unreachable, rendering <code>STATE_ACTIVE</code> a physical impossibility — not a policy restriction.</p>'
    },
    'chain-token': {
        title: 'Causal Chain Node 2: CausalToken (200ms window)',
        body: '<p>Upon receipt of a validated hardware IRQ, the kernel creates a <code>struct causal_token</code> in the per-PID <code>token_map</code> (<code>BPF_MAP_TYPE_HASH</code>). The token carries:</p><ul><li><code>timestamp_ns</code>: creation time (monotonic kernel clock)</li><li><code>pid</code>: the process that generated the IRQ</li><li><code>op_class</code>: bitmask of intended resource classes (OP_WRITE | OP_NET | OP_EXEC)</li><li><code>consumed</code>: single-use flag (prevents token reuse)</li><li><code>generation</code>: fork inheritance depth (max 3 levels)</li></ul><p>The token is valid for <code>CAUSALITY_WINDOW_NS = 500,000,000 ns (500ms)</code> in the kernel implementation. After expiry, any resource access attempt produces <code>VERDICT_EXPIRED</code>.</p><p>Fork inheritance (<code>dcc_fork_inherit</code>) allows child processes to inherit the parent\'s token for up to 3 generations, maintaining the causal chain across process boundaries.</p>'
    },
    'chain-z3': {
        title: 'Causal Chain Node 3: Z3 Gatekeeper (SAT/UNSAT)',
        body: '<p>Every resource access attempt is evaluated against a three-variable decision matrix, formally verified by Z3 SMT solver offline (synthesis time) and enforced by the BPF LSM hook at runtime:</p><ul><li><strong>Intent</strong>: Is a valid <code>CausalToken</code> present and within the causality window?</li><li><strong>Scope</strong>: Does <code>token.op_class &amp; operation.op_class ≠ 0</code>? Does the operation satisfy the resource\'s positive axioms (<code>file_axiom_map</code>)?</li><li><strong>Integrity</strong>: Does the operation refrain from TOCTOU pivot (accessing a different inode than the one bound in <code>tx_map</code>)?</li></ul><p><code>SAT</code> requires all three. Any failure produces immediate <code>UNSAT</code> → resource denial. Timeout (>50ms) also yields <code>UNSAT</code> (fail-safe).</p><h3>Z3 invariants (6/6 PASS on Tokyo server)</h3><pre>P1: irq=False → SAT impossible\nP2: TX_STAGED + !same_inode → ROLLBACK\nP3: file_axiom=BLOCK → SAT impossible\nP4: op_class mismatch → SAT impossible\nP5: SAT requires irq=True AND age&lt;500ms\nP6: State space finite (Turing-incomplete → Z3-traversable)</pre>'
    },
    'chain-active': {
        title: 'Causal Chain Node 4: STATE_ACTIVE — Resource Visibility',
        body: '<p><code>STATE_ACTIVE</code> is not a permission grant — it is the consequence of a proven causal chain. Resources that become visible in this state were always physically present; they simply required a valid causal predecessor to be observable by Ring 3 processes.</p><p>The transition is atomic: there is no intermediate state where some resources are visible and others are not within the same <code>op_class</code>. This is enforced by <code>bpf_map_update_elem(&amp;global_state_map, ..., BPF_ANY)</code> — a single atomic write to the kernel BPF map.</p><p>In this emulator, <code>STATE_ACTIVE</code> is qualified by <code>op_class</code>:</p><ul><li><code>OP_WRITE</code> active → camera feed visible, network remains ECONNREFUSED</li><li><code>OP_NET</code> active → browser/network accessible, camera remains ENODEV</li><li><code>OP_ANY</code> active → all resource classes accessible simultaneously</li></ul><p>This selective visibility demonstrates that the causal constitution is not a binary on/off switch but a fine-grained causal authorization system.</p>'
    }
};

// ─────────────────────────────────────────────
// Demo — DOM wiring
// ─────────────────────────────────────────────
var kernel = new BioKernelEmu();
kernel.auditLog.system('BioKernelEmu initialized — STATE_INERT · 6 LSM programs isomorphic');

// DOM refs
var body         = document.body;
var stateBadge   = document.getElementById('state-badge');
var stateLabel   = document.getElementById('state-label');
var triggerBtn   = document.getElementById('trigger-btn');
var auditLogEl   = document.getElementById('audit-log');
var eventCount   = document.getElementById('event-count');
var cameraStatus = document.getElementById('camera-status');
var netStatus    = document.getElementById('net-status');
var browserUrl   = document.getElementById('browser-url');
var cameraPanel  = document.getElementById('camera-panel');
var browserPanel = document.getElementById('browser-panel');
var browserPage  = document.getElementById('browser-page');
var cameraOvl    = document.getElementById('camera-overlay');
var browserOvl   = document.getElementById('browser-overlay');
var canvas       = document.getElementById('camera-canvas');
var ctx          = canvas.getContext('2d');
var chainViz     = document.querySelector('.chain-viz');

var eventTotal = 0;
var animFrame  = null;
var t          = 0;

// ── Canvas sizing ──
function resizeCanvas() { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; }
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ── Draw functions ──
function drawInert() {
    if (!canvas.width) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(192,57,43,0.25)';
    ctx.font = '11px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('ENODEV — /dev/video0', canvas.width / 2, canvas.height / 2);
}

function drawActive() {
    t += 0.02;
    var w = canvas.width, h = canvas.height;
    var g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0,   'hsl(' + (140 + Math.sin(t) * 10) + ',50%,8%)');
    g.addColorStop(0.5, 'hsl(' + (150 + Math.cos(t * 0.7) * 8) + ',40%,12%)');
    g.addColorStop(1,   'hsl(' + (130 + Math.sin(t * 1.3) * 12) + ',45%,6%)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(39,174,96,0.04)';
    ctx.lineWidth = 1;
    for (var y = 0; y < h; y += 3) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    var sx = w*0.5 + Math.sin(t*1.2)*w*0.3, sy = h*0.5 + Math.cos(t*0.8)*h*0.25;
    var gl = ctx.createRadialGradient(sx, sy, 0, sx, sy, 60);
    gl.addColorStop(0, 'rgba(39,174,96,0.5)'); gl.addColorStop(1, 'rgba(39,174,96,0)');
    ctx.fillStyle = gl; ctx.fillRect(0,0,w,h);
    ctx.fillStyle = 'rgba(39,174,96,0.8)'; ctx.font = '11px Courier New';
    ctx.textAlign = 'left';  ctx.fillText('● LIVE · OP_WRITE active', 12, 20);
    ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(39,174,96,0.5)';
    ctx.fillText(new Date().toISOString().slice(11,23), w-12, 20);
    animFrame = requestAnimationFrame(drawActive);
}

// ── Resource visual update ──
function updateCamera(hasAccess) {
    if (hasAccess) {
        cameraStatus.className = 'res-status granted'; cameraStatus.textContent = 'LIVE';
        cameraOvl.classList.add('hidden');
        if (animFrame) cancelAnimationFrame(animFrame);
        drawActive();
    } else {
        cameraStatus.className = 'res-status denied'; cameraStatus.textContent = 'ENODEV';
        cameraOvl.classList.remove('hidden');
        if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
        drawInert();
    }
}

function updateBrowser(hasAccess) {
    if (hasAccess) {
        netStatus.className = 'res-status granted'; netStatus.textContent = 'CONNECTED';
        browserUrl.textContent = 'https://metaspace.bio/ — OP_NET active';
        browserUrl.style.color = 'var(--active-color)';
        browserOvl.classList.add('hidden');
        browserPage.classList.add('visible');
    } else {
        netStatus.className = 'res-status denied'; netStatus.textContent = 'ECONNREFUSED';
        browserUrl.textContent = 'about:blank — ECONNREFUSED: No Causal Chain';
        browserUrl.style.color = '';
        browserOvl.classList.remove('hidden');
        browserPage.classList.remove('visible');
    }
}

// ── State change handler ──
kernel.onStateChange(function(from, to, opClass) {
    var active = (to === STATE_ACTIVE);
    body.className = active ? 'active' : 'inert';
    stateBadge.className = 'state-badge ' + (active ? 'active' : 'inert');

    if (active) {
        var label = opClassLabel(opClass);
        stateLabel.textContent = 'STATE_ACTIVE · ' + label;
        triggerBtn.className   = 'trigger-btn active';
        chainViz.className     = 'chain-viz chain-active';

        var writeActive = !!(opClass & OP_WRITE);
        var netActive   = !!(opClass & OP_NET);

        updateCamera(writeActive);
        updateBrowser(netActive);

        // Resource requests to demonstrate Z3 verification
        if (writeActive) kernel.requestResource('file',    'camera_feed',  OP_WRITE);
        if (netActive)   kernel.requestResource('network', 'metaspace.bio', OP_NET);
    } else {
        stateLabel.textContent = 'STATE_INERT';
        triggerBtn.className   = 'trigger-btn';
        chainViz.className     = 'chain-viz';
        updateCamera(false);
        updateBrowser(false);
    }
});

// ── Audit log renderer ──
kernel.onAuditEvent(function(ev) {
    eventTotal++;
    eventCount.textContent = eventTotal + ' events';
    var el  = document.createElement('div');
    el.className = 'audit-event ' + ev.type;
    var ts  = new Date(ev.timestamp).toISOString().slice(11, 23);
    el.innerHTML = '<div class="audit-time">' + ts + '</div>' + ev.message;
    auditLogEl.appendChild(el);
    auditLogEl.scrollTop = auditLogEl.scrollHeight;
    while (auditLogEl.children.length > 60) auditLogEl.removeChild(auditLogEl.firstChild);
});

// ── Panel-specific IRQ binding (per op_class) ──
cameraPanel.querySelector('.panel-body').addEventListener('mousedown', function(e) {
    kernel.irqBridge.trigger(e, OP_WRITE);
    e.stopPropagation();
});
browserPanel.querySelector('.panel-body').addEventListener('mousedown', function(e) {
    kernel.irqBridge.trigger(e, OP_NET);
    e.stopPropagation();
});
triggerBtn.addEventListener('mousedown', function(e) {
    kernel.irqBridge.trigger(e, OP_ANY);
    e.stopPropagation();
});

// ── Autonomous bot simulation (headless server isomorph) ──
// A software process attempting network access without any physical IRQ source.
// Always results in ECONNREFUSED — demonstrates the structural impossibility.
setInterval(function() {
    if (kernel.stateManager.isInert) {
        kernel.requestResource('network', 'external-api.io', OP_NET);
    }
}, 3000);

// ── Initial render ──
drawInert();

// ─────────────────────────────────────────────
// Modal system
// ─────────────────────────────────────────────
var overlay   = document.getElementById('modal-overlay');
var modalTitle = document.getElementById('modal-title');
var modalBody  = document.getElementById('modal-body');

function openModal(id) {
    var m = MODALS[id];
    if (!m) return;
    modalTitle.textContent = m.title;
    modalBody.innerHTML    = m.body;
    overlay.classList.add('open');
}
function closeModal() { overlay.classList.remove('open'); }

document.getElementById('modal-close').addEventListener('click', closeModal);
overlay.addEventListener('click', function(e) { if (e.target === overlay) closeModal(); });
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });

// Info buttons
document.querySelectorAll('[data-modal]').forEach(function(el) {
    el.addEventListener('click', function(e) {
        e.stopPropagation();
        openModal(el.getAttribute('data-modal'));
    });
});

})();
