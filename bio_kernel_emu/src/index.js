// bio_kernel_emu — BioKernelEmu
// Kernel entry point: komponensek összekapcsolása
// Izomorf: dcc_core.bpf.c — a 6 BPF program együttese

// Node.js: require; böngésző: window.X globálisok (script tag-enként beállítva)
if (typeof require !== 'undefined' && typeof module !== 'undefined') {
    var { AuditLog }        = require('./audit_log');
    var { StateManager }    = require('./state_manager');
    var { CausalIRQBridge } = require('./causal_irq_bridge');
    var { Z3Gatekeeper }    = require('./z3_gatekeeper');
}

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

if (typeof module !== 'undefined') {
    module.exports = { BioKernelEmu };
}
