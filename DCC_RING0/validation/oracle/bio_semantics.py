"""
DCC Ring 0 — Python Oracle
Faithful re-implementation of dcc_core.bpf.c semantics for differential testing.

Ground truth: this oracle, NOT the JS emulator.
Three-way comparison: Oracle vs JS emulator vs kernel (blocking mode).
"""

from __future__ import annotations
import time
from dataclasses import dataclass, field
from typing import Optional

# ── Constants (mirror dcc_core.bpf.c) ────────────────────────────────────────

CAUSALITY_WINDOW_NS = 500_000_000  # 500 ms
MAX_FORK_GENERATION = 3

VERDICT_SAT             = 1
VERDICT_NO_TOKEN        = 2
VERDICT_EXPIRED         = 3
VERDICT_CONSUMED        = 4
VERDICT_AXIOM           = 5
VERDICT_WHITELISTED     = 6
VERDICT_TOKEN_INHERITED = 7
VERDICT_READ_BLOCKED    = 8
VERDICT_NET_BLOCKED     = 9
VERDICT_EXEC_BLOCKED    = 10
VERDICT_TX_ROLLBACK     = 11
VERDICT_AXIOM_MISMATCH  = 12

OP_WRITE = 0x01
OP_NET   = 0x02
OP_EXEC  = 0x04
OP_ANY   = 0xFF
OP_BLOCK = 0x00

TX_IDLE   = 0
TX_LOCKED = 1
TX_STAGED = 2

VERDICT_NAMES = {
    VERDICT_SAT:             "SAT",
    VERDICT_NO_TOKEN:        "NO_TOKEN",
    VERDICT_EXPIRED:         "EXPIRED",
    VERDICT_CONSUMED:        "CONSUMED",
    VERDICT_AXIOM:           "AXIOM",
    VERDICT_WHITELISTED:     "WHITELISTED",
    VERDICT_TOKEN_INHERITED: "TOKEN_INHERITED",
    VERDICT_READ_BLOCKED:    "READ_BLOCKED",
    VERDICT_NET_BLOCKED:     "NET_BLOCKED",
    VERDICT_EXEC_BLOCKED:    "EXEC_BLOCKED",
    VERDICT_TX_ROLLBACK:     "TX_ROLLBACK",
    VERDICT_AXIOM_MISMATCH:  "AXIOM_MISMATCH",
}


# ── Data structures ───────────────────────────────────────────────────────────

@dataclass
class CausalToken:
    timestamp_ns: int
    pid: int
    consumed: bool
    comm: str             # 16-char process name (truncated)
    generation: int
    op_class: int


@dataclass
class TxState:
    state: int = TX_IDLE
    lock_time_ns: int = 0
    bound_ino: int = 0


@dataclass
class AuditEvent:
    timestamp_ns: int
    pid: int
    verdict: int
    comm: str
    extra: int = 0

    def verdict_name(self) -> str:
        return VERDICT_NAMES.get(self.verdict, f"UNKNOWN({self.verdict})")

    def __str__(self) -> str:
        return (f"[{self.timestamp_ns}] pid={self.pid} comm={self.comm!r:16s} "
                f"verdict={self.verdict_name()} extra={self.extra}")


@dataclass
class OracleResult:
    verdict: int
    errno: int        # 0=allow, -1=block (mimics BPF return value)
    events: list[AuditEvent] = field(default_factory=list)

    def verdict_name(self) -> str:
        return VERDICT_NAMES.get(self.verdict, f"UNKNOWN({self.verdict})")


# ── Invariant check result ────────────────────────────────────────────────────

@dataclass
class InvariantViolation:
    invariant: str     # "I1" .. "I6"
    rule_name: str
    description: str

    def __str__(self) -> str:
        return f"INVARIANT VIOLATION {self.invariant} ({self.rule_name}): {self.description}"


# ── Oracle ────────────────────────────────────────────────────────────────────

class BioSemanticsOracle:
    """
    Software model of DCCRing0Guard (.bio spec + dcc_core.bpf.c).

    Maps:
      token_map      : pid -> CausalToken
      tx_map         : pid -> TxState
      file_axiom_map : filename(16) -> op_class_mask
      whitelist      : set of comm strings (16 chars)

    Time source: injectable via `now_ns` parameter on each call (default: real clock).
    """

    def __init__(self):
        self.token_map:      dict[int, CausalToken] = {}
        self.tx_map:         dict[int, TxState]     = {}
        self.file_axiom_map: dict[str, int]         = {}
        self.whitelist:      set[str]               = set()
        self.blocking:       bool                   = True
        self.audit_log:      list[AuditEvent]       = []

    # ── Configuration ─────────────────────────────────────────────────────────

    def set_file_axiom(self, filename: str, op_mask: int) -> None:
        self.file_axiom_map[self._trunc16(filename)] = op_mask

    def add_whitelist(self, comm: str) -> None:
        self.whitelist.add(self._trunc16(comm))

    def set_blocking(self, blocking: bool) -> None:
        self.blocking = blocking

    def reset(self) -> None:
        self.token_map.clear()
        self.tx_map.clear()
        self.audit_log.clear()

    # ── Core events (mirror BPF program entry points) ─────────────────────────

    def on_irq(self, pid: int, code: int, comm: str,
               now_ns: Optional[int] = None) -> OracleResult:
        """Mirror: dcc_causality_monitor (raw_tp/input_event, type=EV_KEY, value=1)."""
        t = now_ns if now_ns is not None else self._now()
        comm16 = self._trunc16(comm)

        op_class = (OP_WRITE | OP_NET | OP_EXEC) if code < 256 else OP_ANY

        tok = CausalToken(
            timestamp_ns=t, pid=pid, consumed=False,
            comm=comm16, generation=0, op_class=op_class,
        )
        self.token_map[pid] = tok

        tx = TxState(state=TX_LOCKED, lock_time_ns=t, bound_ino=0)
        self.tx_map[pid] = tx

        return self._emit(pid, VERDICT_SAT, comm16)

    def on_fork(self, parent_pid: int, child_pid: int,
                now_ns: Optional[int] = None) -> Optional[OracleResult]:
        """Mirror: dcc_fork_inherit (raw_tp/sched_process_fork)."""
        if parent_pid == child_pid:
            return None

        t = now_ns if now_ns is not None else self._now()
        ptok = self.token_map.get(parent_pid)
        if not ptok:
            return None

        age = t - ptok.timestamp_ns
        if age > CAUSALITY_WINDOW_NS:
            return None
        if ptok.consumed:
            return None
        if ptok.generation >= MAX_FORK_GENERATION:
            return None

        child_tok = CausalToken(
            timestamp_ns=ptok.timestamp_ns,
            pid=child_pid,
            consumed=False,
            comm=ptok.comm,
            generation=ptok.generation + 1,
            op_class=ptok.op_class,
        )
        self.token_map[child_pid] = child_tok
        return self._emit_ex(child_pid, VERDICT_TOKEN_INHERITED,
                             ptok.generation + 1, ptok.comm)

    def on_write(self, pid: int, filename: str, inode: int, comm: str,
                 now_ns: Optional[int] = None) -> OracleResult:
        """Mirror: dcc_axiom_validator (lsm/file_permission, mask&2)."""
        t = now_ns if now_ns is not None else self._now()
        comm16 = self._trunc16(comm)
        fname16 = self._trunc16(filename)

        # Step 1: OP_BLOCK check (overrides whitelist — challenge BIO 0xDEAD)
        ax0 = self.file_axiom_map.get(fname16)
        if ax0 is not None and ax0 == OP_BLOCK:
            return self._emit_ex(pid, VERDICT_AXIOM_MISMATCH, 0, comm16, errno=-1)

        # Step 2: Whitelist bypass
        if comm16 in self.whitelist:
            return self._emit(pid, VERDICT_WHITELISTED, comm16, errno=0)

        # Step 3: TOCTOU — TX_STAGED + different inode → always -1, no config bypass
        tx = self.tx_map.get(pid)
        if tx and tx.state == TX_STAGED and tx.bound_ino != 0 and tx.bound_ino != inode:
            reset_tx = TxState(state=TX_IDLE)
            self.tx_map[pid] = reset_tx
            return self._emit_ex(pid, VERDICT_TX_ROLLBACK, 0, comm16, errno=-1)

        # Step 4: File axiom check (op_class vs filename)
        tok_for_axiom = self.token_map.get(pid)
        op_class = tok_for_axiom.op_class if tok_for_axiom else 0

        if ax0 is not None:
            if not (ax0 & op_class):
                return self._emit_ex(pid, VERDICT_AXIOM_MISMATCH, 0, comm16,
                                     errno=-1 if self.blocking else 0)

        # Step 5: DCC causal chain + inode binding
        return self._check_dcc_chain_tx(pid, inode, t, comm16)

    def on_read(self, pid: int, filename: str, comm: str,
                now_ns: Optional[int] = None) -> OracleResult:
        """Mirror: dcc_read_guard (lsm/file_open, read-mode)."""
        comm16 = self._trunc16(comm)
        if comm16 in self.whitelist:
            return self._emit(pid, VERDICT_WHITELISTED, comm16, errno=0)
        tok = self.token_map.get(pid)
        if not tok:
            return self._emit(pid, VERDICT_READ_BLOCKED, comm16,
                              errno=-1 if self.blocking else 0)
        return self._emit(pid, VERDICT_SAT, comm16, errno=0)

    def on_exec(self, pid: int, comm: str,
                now_ns: Optional[int] = None) -> OracleResult:
        """Mirror: dcc_exec_guard (lsm/bprm_check_security)."""
        comm16 = self._trunc16(comm)
        if comm16 in self.whitelist:
            return self._emit(pid, VERDICT_WHITELISTED, comm16, errno=0)
        tok = self.token_map.get(pid)
        if not tok:
            return self._emit(pid, VERDICT_EXEC_BLOCKED, comm16,
                              errno=-1 if self.blocking else 0)
        return self._emit(pid, VERDICT_SAT, comm16, errno=0)

    # ── Invariant validation ──────────────────────────────────────────────────

    def validate_invariants(
        self,
        irq_event: bool,
        op_class: int,
        file_axiom: int,
        token_age_ms: float,
        tx_state: int,
        same_inode: bool,
        verdict: int,
    ) -> list[InvariantViolation]:
        """
        Check all 6 .bio invariants against a (inputs, verdict) tuple.
        Used by tests to assert no invariant is violated by a kernel verdict.
        """
        violations: list[InvariantViolation] = []

        # I1: autonomous process never gets SAT
        if not irq_event and verdict == VERDICT_SAT:
            violations.append(InvariantViolation(
                "I1", "no_autonomous_write",
                f"irq=False but verdict=SAT"))

        # I2: causality window
        if token_age_ms >= 500.0 and verdict == VERDICT_SAT:
            violations.append(InvariantViolation(
                "I2", "causality_window",
                f"token_age={token_age_ms}ms >= 500ms but verdict=SAT"))

        # I3: blocked file never gets SAT
        if file_axiom == OP_BLOCK and verdict == VERDICT_SAT:
            violations.append(InvariantViolation(
                "I3", "blocked_file_immutable",
                f"file_axiom=BLOCK but verdict=SAT"))

        # I4: op_class mismatch never gets SAT
        if file_axiom != OP_ANY and (file_axiom & op_class) == 0 and verdict == VERDICT_SAT:
            violations.append(InvariantViolation(
                "I4", "op_class_match_required",
                f"file_axiom=0x{file_axiom:02x} op_class=0x{op_class:02x} no overlap, verdict=SAT"))

        # I5: TOCTOU always TX_ROLLBACK
        if tx_state == TX_STAGED and not same_inode and verdict != VERDICT_TX_ROLLBACK:
            violations.append(InvariantViolation(
                "I5", "toctou_rollback",
                f"TX_STAGED + different inode but verdict={VERDICT_NAMES.get(verdict, verdict)}"))

        # I6: SAT requires causal chain
        if verdict == VERDICT_SAT and (not irq_event or token_age_ms >= 500.0):
            violations.append(InvariantViolation(
                "I6", "sat_requires_causal_chain",
                f"SAT without valid causal chain (irq={irq_event}, age={token_age_ms}ms)"))

        return violations

    # ── MC/DC coverage helper ─────────────────────────────────────────────────

    def get_blocking_invariant(
        self,
        irq_event: bool,
        op_class: int,
        file_axiom: int,
        token_age_ms: float,
        tx_state: int,
        same_inode: bool,
    ) -> Optional[str]:
        """Return which single invariant (I1-I5) blocks SAT, or None if SAT is allowed."""
        if not irq_event:
            return "I1"
        if token_age_ms >= 500.0:
            return "I2"
        if file_axiom == OP_BLOCK:
            return "I3"
        if file_axiom != OP_ANY and (file_axiom & op_class) == 0:
            return "I4"
        if tx_state == TX_STAGED and not same_inode:
            return "I5"
        return None

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _check_dcc_chain_tx(
        self, pid: int, inode: int, now_ns: int, comm: str
    ) -> OracleResult:
        """Mirror check_dcc_chain_tx() from dcc_core.bpf.c."""
        tok = self.token_map.get(pid)
        if not tok:
            return self._emit(pid, VERDICT_NO_TOKEN, comm,
                              errno=-1 if self.blocking else 0)

        age = now_ns - tok.timestamp_ns
        if age > CAUSALITY_WINDOW_NS:
            self.tx_map.pop(pid, None)
            return self._emit(pid, VERDICT_EXPIRED, comm,
                              errno=-1 if self.blocking else 0)

        if tok.consumed:
            tx = self.tx_map.get(pid)
            if (tx and tx.state == TX_STAGED
                    and tx.bound_ino != 0 and tx.bound_ino == inode):
                return self._emit(pid, VERDICT_SAT, comm, errno=0)
            return self._emit(pid, VERDICT_CONSUMED, comm,
                              errno=-1 if self.blocking else 0)

        # First write: consume token + bind inode
        tok.consumed = True
        tx_new = TxState(state=TX_STAGED, lock_time_ns=tok.timestamp_ns, bound_ino=inode)
        self.tx_map[pid] = tx_new

        return self._emit(pid, VERDICT_SAT, comm, errno=0)

    def _emit(self, pid: int, verdict: int, comm: str,
              errno: int = 0) -> OracleResult:
        ev = AuditEvent(
            timestamp_ns=self._now(), pid=pid, verdict=verdict, comm=comm
        )
        self.audit_log.append(ev)
        return OracleResult(verdict=verdict, errno=errno, events=[ev])

    def _emit_ex(self, pid: int, verdict: int, extra: int, comm: str,
                 errno: int = 0) -> OracleResult:
        ev = AuditEvent(
            timestamp_ns=self._now(), pid=pid, verdict=verdict,
            comm=comm, extra=extra
        )
        self.audit_log.append(ev)
        return OracleResult(verdict=verdict, errno=errno, events=[ev])

    @staticmethod
    def _trunc16(s: str) -> str:
        return s[:15]

    @staticmethod
    def _now() -> int:
        return time.monotonic_ns()
