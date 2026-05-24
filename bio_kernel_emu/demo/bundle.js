// bio_kernel_emu — bundle.js
// SES/LavaMoat kompatibilis, egyetlen scope, kézzel összefűzve
// Forrás: src/audit_log.js + state_manager.js + causal_irq_bridge.js +
//         z3_gatekeeper.js + index.js + demo/demo.js

(function () {
'use strict';

// ─────────────────────────────────────────────
// AuditLog
// ─────────────────────────────────────────────
const MAX_EVENTS = 200;

class AuditEvent {
    constructor(type, message, pid) {
        this.timestamp = Date.now();
        this.type      = type;
        this.message   = message;
        this.pid       = pid != null ? pid : '—';
    }
    toString() {
        const t = new Date(this.timestamp).toISOString().slice(11, 23);
        return '[' + t + '] DCC ' + this.type.toUpperCase() + ': ' + this.message + ' [pid=' + this.pid + ']';
    }
}

class AuditLog {
    constructor() {
        this._events    = [];
        this._listeners = [];
    }
    denied(reason, pid) {
        this._emit('denied', 'Denied: No Causal Chain Found — ' + reason, pid);
    }
    active(pid, eventType) {
        this._emit('active', 'Causal chain established [' + eventType + ']', pid);
    }
    expired(pid) {
        this._emit('expired', 'Causal chain expired — INERT restored', pid);
    }
    apoptosis(reason) {
        this._emit('apoptosis', 'Apoptosis: state rolled back — ' + reason, null);
    }
    sat(pid, resource) {
        this._emit('sat', 'SAT — resource granted [' + resource + ']', pid);
    }
    getEvents()  { return this._events.slice(); }
    getRecent(n) { return this._events.slice(-n); }
    onEvent(fn)  { this._listeners.push(fn); }
    _emit(type, message, pid) {
        const ev = new AuditEvent(type, message, pid);
        this._events.push(ev);
        if (this._events.length > MAX_EVENTS) this._events.shift();
        for (var i = 0; i < this._listeners.length; i++) this._listeners[i](ev);
    }
}

// ─────────────────────────────────────────────
// StateManager
// ─────────────────────────────────────────────
var STATE_INERT  = 0;
var STATE_ACTIVE = 1;
var ENODEV       = 19;
var ECONNREFUSED = 111;

class StateManager {
    constructor(auditLog) {
        this._state     = STATE_INERT;
        this._snapshot  = null;
        this._auditLog  = auditLog;
        this._listeners = [];
    }
    get state()    { return this._state; }
    get isActive() { return this._state === STATE_ACTIVE; }
    get isInert()  { return this._state === STATE_INERT; }

    setState(newState) {
        var prev = this._state;
        this._state = newState;
        for (var i = 0; i < this._listeners.length; i++) this._listeners[i](prev, newState);
    }
    takeSnapshot() {
        this._snapshot = { state: this._state, timestamp: Date.now() };
    }
    rollback(reason) {
        this._state    = this._snapshot ? this._snapshot.state : STATE_INERT;
        this._snapshot = null;
        if (this._auditLog) this._auditLog.apoptosis(reason);
        for (var i = 0; i < this._listeners.length; i++) this._listeners[i](STATE_ACTIVE, this._state);
    }
    getResource(resourceType) {
        if (this.isInert) {
            return { exists: false, errno: resourceType === 'network' ? ECONNREFUSED : ENODEV };
        }
        return { exists: true, errno: 0 };
    }
    onChange(fn) { this._listeners.push(fn); }
}

// ─────────────────────────────────────────────
// CausalIRQBridge
// ─────────────────────────────────────────────
var CAUSALITY_WINDOW_MS = 200;
var OP_WRITE = 1;
var OP_NET   = 2;
var OP_EXEC  = 4;

class CausalToken {
    constructor(event) {
        this.timestamp = Date.now();
        this.type      = event.type;
        this.isTrusted = event.isTrusted;
        this.opClass   = OP_WRITE | OP_NET | OP_EXEC;
        this.consumed  = false;
        this.pid       = Math.random().toString(36).slice(2, 8);
    }
    get isValid() {
        return !this.consumed && (Date.now() - this.timestamp) < CAUSALITY_WINDOW_MS;
    }
    consume() { this.consumed = true; }
}

class CausalIRQBridge {
    constructor(stateManager, auditLog) {
        this._stateManager  = stateManager;
        this._auditLog      = auditLog;
        this._token         = null;
        this._handlers      = [];
        this._trustedEvents = ['mousedown', 'touchstart', 'keydown'];
    }
    bindTo(element) {
        var self = this;
        this._trustedEvents.forEach(function(evType) {
            element.addEventListener(evType, function(e) { self._onEvent(e); }, { passive: true });
        });
    }
    getToken() {
        if (!this._token || !this._token.isValid) return null;
        return this._token;
    }
    _onEvent(event) {
        if (!event.isTrusted) {
            if (this._auditLog) this._auditLog.denied('Untrusted event rejected', 'irq_bridge');
            return;
        }
        this._token = new CausalToken(event);
        this._stateManager.takeSnapshot();
        this._stateManager.setState(STATE_ACTIVE);
        if (this._auditLog) this._auditLog.active(this._token.pid, event.type);

        var self = this;
        var pid  = this._token.pid;
        setTimeout(function() {
            if (self._token && !self._token.isValid) {
                self._stateManager.setState(STATE_INERT);
                if (self._auditLog) self._auditLog.expired(pid);
                self._token = null;
            }
        }, CAUSALITY_WINDOW_MS + 10);

        for (var i = 0; i < this._handlers.length; i++) this._handlers[i](this._token);
    }
    onToken(fn) { this._handlers.push(fn); }
}

// ─────────────────────────────────────────────
// Z3Gatekeeper
// ─────────────────────────────────────────────
var VERDICT_SAT            = 1;
var VERDICT_NO_TOKEN       = 2;
var VERDICT_EXPIRED        = 3;
var VERDICT_CONSUMED       = 4;
var VERDICT_AXIOM_MISMATCH = 12;
var VERDICT_NET_BLOCKED    = 9;
var TIMEOUT_MS             = 50;

class GatekeeperResult {
    constructor(verdict, allowed, errno) {
        this.verdict = verdict;
        this.allowed = allowed;
        this.errno   = errno || 0;
    }
    get isSAT()   { return this.allowed; }
    get isUNSAT() { return !this.allowed; }
}

class Z3Gatekeeper {
    constructor(auditLog) {
        this._auditLog = auditLog;
        this._axioms   = new Map();
    }
    setAxiom(resource, allowedOpClass) {
        this._axioms.set(resource, allowedOpClass);
    }
    verify(token, operation) {
        var self = this;
        return new Promise(function(resolve) {
            var timer = setTimeout(function() {
                if (self._auditLog) self._auditLog.denied('Gatekeeper timeout — UNSAT', operation ? operation.pid : null);
                resolve(new GatekeeperResult(VERDICT_NO_TOKEN, false, ENODEV));
            }, TIMEOUT_MS);
            var result = self._decide(token, operation);
            clearTimeout(timer);
            resolve(result);
        });
    }
    _decide(token, operation) {
        var pid      = operation ? (operation.pid || 'unknown') : 'unknown';
        var resType  = operation ? (operation.resourceType || 'file') : 'file';
        var opClass  = operation ? (operation.opClass || 0) : 0;
        var resource = operation ? (operation.resource || '') : '';

        if (!token) {
            if (this._auditLog) this._auditLog.denied('No Causal Chain Found', pid);
            return new GatekeeperResult(
                resType === 'network' ? VERDICT_NET_BLOCKED : VERDICT_NO_TOKEN,
                false,
                resType === 'network' ? ECONNREFUSED : ENODEV
            );
        }
        if (!token.isValid) {
            if (this._auditLog) this._auditLog.denied('No Causal Chain Found', pid);
            return new GatekeeperResult(
                token.consumed ? VERDICT_CONSUMED : VERDICT_EXPIRED,
                false,
                resType === 'network' ? ECONNREFUSED : ENODEV
            );
        }
        if (this._axioms.has(resource)) {
            var allowed = this._axioms.get(resource);
            if (allowed === 0 || !(allowed & opClass)) {
                if (this._auditLog) this._auditLog.denied('Axiom mismatch', pid);
                return new GatekeeperResult(VERDICT_AXIOM_MISMATCH, false, ENODEV);
            }
        }
        if (operation && operation.toctouAttempt) {
            if (this._auditLog) this._auditLog.denied('TOCTOU — integrity violation', pid);
            return new GatekeeperResult(VERDICT_AXIOM_MISMATCH, false, 1);
        }
        token.consume();
        return new GatekeeperResult(VERDICT_SAT, true, 0);
    }
}

// ─────────────────────────────────────────────
// BioKernelEmu — kernel entry point
// ─────────────────────────────────────────────
class BioKernelEmu {
    constructor() {
        this.auditLog     = new AuditLog();
        this.stateManager = new StateManager(this.auditLog);
        this.irqBridge    = new CausalIRQBridge(this.stateManager, this.auditLog);
        this.gatekeeper   = new Z3Gatekeeper(this.auditLog);
    }
    start(rootElement) {
        if (rootElement) this.irqBridge.bindTo(rootElement);
        this.auditLog._emit('active', 'BioKernelEmu started — STATE_INERT', 'kernel');
        return this;
    }
    requestResource(resourceType, resource, opClass) {
        var self  = this;
        var check = this.stateManager.getResource(resourceType);
        if (!check.exists) {
            this.auditLog.denied(resourceType + '/' + resource + ' — STATE_INERT', 'kernel');
            return Promise.resolve({ granted: false, errno: check.errno });
        }
        var token     = this.irqBridge.getToken();
        var operation = { resourceType: resourceType, resource: resource, opClass: opClass, pid: token ? token.pid : 'anon' };
        return this.gatekeeper.verify(token, operation).then(function(result) {
            if (result.isSAT) self.auditLog.sat(operation.pid, resource);
            return { granted: result.isSAT, errno: result.errno, verdict: result.verdict };
        });
    }
    protect(resource, opClass) {
        this.gatekeeper.setAxiom(resource, opClass);
        return this;
    }
    onStateChange(fn) { this.stateManager.onChange(fn); return this; }
    onAuditEvent(fn)  { this.auditLog.onEvent(fn); return this; }
    onToken(fn)       { this.irqBridge.onToken(fn); return this; }
}

// ─────────────────────────────────────────────
// Demo logika
// ─────────────────────────────────────────────
var kernel     = new BioKernelEmu();
kernel.start(document.body);

var body        = document.body;
var stateBadge  = document.getElementById('state-badge');
var stateLabel  = document.getElementById('state-label');
var triggerBtn  = document.getElementById('trigger-btn');
var auditLogEl  = document.getElementById('audit-log');
var eventCount  = document.getElementById('event-count');
var cameraStatus= document.getElementById('camera-status');
var netStatus   = document.getElementById('net-status');
var browserUrl  = document.getElementById('browser-url');
var canvas      = document.getElementById('camera-canvas');
var ctx         = canvas.getContext('2d');

var eventTotal = 0;
var animFrame  = null;
var isActive   = false;
var t          = 0;

function resizeCanvas() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function drawInert() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(192,57,43,0.3)';
    ctx.font = '12px Courier New';
    ctx.textAlign = 'center';
    ctx.fillText('ENODEV', canvas.width / 2, canvas.height / 2);
}

function drawActive() {
    t += 0.02;
    var w = canvas.width, h = canvas.height;
    var grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0,   'hsl(' + (140 + Math.sin(t) * 10) + ',50%,8%)');
    grad.addColorStop(0.5, 'hsl(' + (150 + Math.cos(t * 0.7) * 8) + ',40%,12%)');
    grad.addColorStop(1,   'hsl(' + (130 + Math.sin(t * 1.3) * 12) + ',45%,6%)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(39,174,96,0.04)';
    ctx.lineWidth = 1;
    for (var y = 0; y < h; y += 3) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    var sx   = w * 0.5 + Math.sin(t * 1.2) * w * 0.3;
    var sy   = h * 0.5 + Math.cos(t * 0.8) * h * 0.25;
    var glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 60);
    glow.addColorStop(0, 'rgba(39,174,96,0.5)');
    glow.addColorStop(1, 'rgba(39,174,96,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = 'rgba(39,174,96,0.8)';
    ctx.font = '11px Courier New';
    ctx.textAlign = 'left';
    ctx.fillText('● LIVE', 12, 20);
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(39,174,96,0.5)';
    ctx.fillText(new Date().toISOString().slice(11, 23), w - 12, 20);

    animFrame = requestAnimationFrame(drawActive);
}

kernel.onStateChange(function(from, to) {
    isActive = (to === STATE_ACTIVE);
    if (isActive) {
        body.className           = 'active';
        stateBadge.className     = 'state-badge active';
        stateLabel.textContent   = 'STATE_ACTIVE';
        cameraStatus.style.color = 'var(--active-color)';
        cameraStatus.textContent = 'LIVE';
        netStatus.style.color    = 'var(--active-color)';
        netStatus.textContent    = 'CONNECTED';
        browserUrl.textContent   = 'https://metaspace.bio/';
        triggerBtn.textContent   = '✓ AKTÍV — érintés az újraindításhoz';
        if (animFrame) cancelAnimationFrame(animFrame);
        drawActive();
    } else {
        body.className           = 'inert';
        stateBadge.className     = 'state-badge inert';
        stateLabel.textContent   = 'STATE_INERT';
        cameraStatus.style.color = 'var(--inert-color)';
        cameraStatus.textContent = 'ENODEV';
        netStatus.style.color    = 'var(--inert-color)';
        netStatus.textContent    = 'ECONNREFUSED';
        browserUrl.textContent   = 'about:blank — No Causal Chain';
        triggerBtn.textContent   = '⚡ FIZIKAI ÉRINTÉS — KAUZÁLIS LÁNC AKTIVÁLÁSA';
        if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
        drawInert();
    }
});

kernel.onAuditEvent(function(ev) {
    eventTotal++;
    eventCount.textContent = eventTotal + ' esemény';
    var el   = document.createElement('div');
    el.className = 'audit-event ' + ev.type;
    var time = new Date(ev.timestamp).toISOString().slice(11, 23);
    el.innerHTML = '<div class="audit-time">' + time + '</div>' + ev.message;
    auditLogEl.appendChild(el);
    auditLogEl.scrollTop = auditLogEl.scrollHeight;
    while (auditLogEl.children.length > 60) auditLogEl.removeChild(auditLogEl.firstChild);
});

triggerBtn.addEventListener('mousedown', function(e) {
    setTimeout(function() {
        if (isActive) {
            kernel.requestResource('file', 'camera_feed', OP_WRITE);
            kernel.requestResource('network', 'metaspace.bio', OP_NET);
        }
    }, 50);
});

// Autonóm bot — 3mp-enként ECONNREFUSED (izomorf: headless szerver)
setInterval(function() {
    if (!isActive) {
        kernel.requestResource('network', 'external-api', OP_NET);
    }
}, 3000);

drawInert();

})();
