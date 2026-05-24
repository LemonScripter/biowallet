"""
T06 — Double-Consume (Invariant I6 + consumed flag)
Attack: IRQ → write fileA (consumes token) → write fileA AGAIN with same inode.
Expected: second write is SAT (multi-write allowed on same inode per TX_STAGED).
Then: write fileC (different inode) → TX_ROLLBACK.

This tests the legitimate multi-write path AND ensures no token reuse across inodes.
"""

from attacks.base import AttackBase, AttackResult, AttackOutcome
from oracle.bio_semantics import VERDICT_TX_ROLLBACK, VERDICT_SAT, VERDICT_CONSUMED


class T06_DoubleConsume(AttackBase):
    ATTACK_ID   = "T06"
    ATTACK_NAME = "Double-consume / multi-write same inode (I6 boundary)"

    def _run(self) -> AttackResult:
        self.oracle.reset()

        self.oracle.on_irq(pid=9006, code=30, comm="dcc_attacker")

        r1 = self.oracle.on_write(pid=9006, filename="shared.dat",
                                  inode=55555, comm="dcc_attacker")
        if r1.verdict != VERDICT_SAT:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                oracle_verdict=r1.verdict,
                detail=f"First write must be SAT, got {r1.verdict_name()}",
            )

        # Second write, SAME inode → must still be SAT (multi-write)
        r2 = self.oracle.on_write(pid=9006, filename="shared.dat",
                                  inode=55555, comm="dcc_attacker")
        if r2.verdict != VERDICT_SAT:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                oracle_verdict=r2.verdict,
                detail=f"Second write same inode must be SAT, got {r2.verdict_name()}",
            )

        # Third write, DIFFERENT inode → must be TX_ROLLBACK
        r3 = self.oracle.on_write(pid=9006, filename="pivot.dat",
                                  inode=77777, comm="dcc_attacker")
        oracle_final_blocked = (r3.verdict == VERDICT_TX_ROLLBACK)

        proc = self._run_injector("--mode", "multi-write",
                                  "--file", "/tmp/dcc_shared.dat",
                                  "--pivot", "/tmp/dcc_pivot.dat",
                                  "--comm",  "dcc_attacker")
        kernel_pivot_blocked = (proc.returncode == 1)

        if not oracle_final_blocked:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                oracle_verdict=r3.verdict,
                detail=f"Oracle should TX_ROLLBACK on pivot, got {r3.verdict_name()}",
            )

        if not kernel_pivot_blocked:
            return self._oracle_result(
                outcome=AttackOutcome.BYPASSED,
                oracle_verdict=r3.verdict,
                kernel_verdict=0,
                detail="Kernel allowed cross-inode write after multi-write — pivot bypass",
                invariants_violated=["I5"],
            )

        return self._oracle_result(
            outcome=AttackOutcome.BLOCKED,
            oracle_verdict=r3.verdict,
            kernel_verdict=1,
            detail="Multi-write same-inode=SAT, pivot=TX_ROLLBACK — correct",
        )
