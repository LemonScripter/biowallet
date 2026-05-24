"""
T05 — TOCTOU Pivot Attack (Invariant I5)
Attack: IRQ → write fileA (consumes token, TX_STAGED, bound_ino=A) →
        immediately write fileB (different inode) → must be TX_ROLLBACK, not SAT.
Oracle: TX_STAGED + same_inode=False → I5 → TX_ROLLBACK, always -1.
This is the hardest guarantee: no config flag can disable it.
"""

from attacks.base import AttackBase, AttackResult, AttackOutcome
from oracle.bio_semantics import VERDICT_TX_ROLLBACK, VERDICT_SAT


class T05_TOCTOU(AttackBase):
    ATTACK_ID   = "T05"
    ATTACK_NAME = "TOCTOU pivot (I5: toctou_rollback)"

    def _run(self) -> AttackResult:
        self.oracle.reset()

        # Step 1: IRQ for pid 9005
        self.oracle.on_irq(pid=9005, code=30, comm="dcc_attacker")

        # Step 2: First write → consumes token, TX_STAGED, bound_ino=11111
        r1 = self.oracle.on_write(pid=9005, filename="fileA.txt",
                                  inode=11111, comm="dcc_attacker")
        if r1.verdict != VERDICT_SAT:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                oracle_verdict=r1.verdict,
                detail=f"First write should be SAT, got {r1.verdict_name()}",
            )

        # Step 3: Second write to DIFFERENT inode → must be TX_ROLLBACK
        r2 = self.oracle.on_write(pid=9005, filename="fileB.txt",
                                  inode=22222, comm="dcc_attacker")
        oracle_blocks = (r2.verdict == VERDICT_TX_ROLLBACK)

        # Kernel: injector performs IRQ → write fileA → write fileB in sequence
        proc = self._run_injector("--mode", "toctou",
                                  "--file-a", "/tmp/dcc_fileA.txt",
                                  "--file-b", "/tmp/dcc_fileB.txt",
                                  "--comm",   "dcc_attacker")
        # exit 0 = second write succeeded (bypass), exit 1 = blocked
        kernel_blocked = (proc.returncode == 1)

        violations = self.oracle.validate_invariants(
            irq_event=True, op_class=0x07, file_axiom=0xFF,
            token_age_ms=1.0, tx_state=2, same_inode=False,
            verdict=VERDICT_SAT,
        )

        if not oracle_blocks:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                oracle_verdict=r2.verdict,
                detail=f"Oracle returned {r2.verdict_name()} — expected TX_ROLLBACK",
                invariants_violated=[v.invariant for v in violations],
            )

        if not kernel_blocked:
            return self._oracle_result(
                outcome=AttackOutcome.BYPASSED,
                oracle_verdict=r2.verdict,
                kernel_verdict=0,
                detail="Kernel allowed TOCTOU pivot — I5 bypass (critical)",
                invariants_violated=["I5"],
            )

        return self._oracle_result(
            outcome=AttackOutcome.BLOCKED,
            oracle_verdict=r2.verdict,
            kernel_verdict=1,
            detail="oracle=TX_ROLLBACK, kernel blocked pivot — I5 holds",
        )
