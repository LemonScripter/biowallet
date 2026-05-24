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

if (typeof module !== 'undefined') {
    module.exports = {
        Z3Gatekeeper, GatekeeperResult,
        VERDICT_SAT, VERDICT_NO_TOKEN, VERDICT_EXPIRED,
        VERDICT_CONSUMED, VERDICT_AXIOM_MISMATCH,
        VERDICT_NET_BLOCKED, VERDICT_READ_BLOCKED, VERDICT_EXEC_BLOCKED,
    };
} else {
    window.Z3Gatekeeper = Z3Gatekeeper;
}
