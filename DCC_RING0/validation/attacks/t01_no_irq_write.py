"""
T01 — No-IRQ Write (Invariant I1)
Attack: write() without any preceding IRQ → must be blocked (NO_TOKEN).
Oracle: irq_event=False → I1 fires → verdict != SAT.
"""

from attacks.base import AttackBase, AttackResult, AttackOutcome
from oracle.bio_semantics import VERDICT_NO_TOKEN, VERDICT_SAT


class T01_NoIrqWrite(AttackBase):
    ATTACK_ID   = "T01"
    ATTACK_NAME = "No-IRQ write (I1: no_autonomous_write)"

    def _run(self) -> AttackResult:
        self.oracle.reset()

        # Oracle: pid 9001 has no token → on_write must return NO_TOKEN, not SAT
        result = self.oracle.on_write(pid=9001, filename="target.txt",
                                      inode=12345, comm="dcc_attacker")

        oracle_blocks = result.verdict != VERDICT_SAT

        # Kernel check: run injector in write-only mode (no IRQ first)
        proc = self._run_injector("--mode", "write-only",
                                  "--file", "/tmp/dcc_test_target.txt",
                                  "--comm", "dcc_attacker")
        kernel_blocked = self._kernel_blocked(proc)

        violations = self.oracle.validate_invariants(
            irq_event=False, op_class=0x01, file_axiom=0xFF,
            token_age_ms=0.0, tx_state=0, same_inode=True,
            verdict=VERDICT_SAT,  # what the *attack* hopes for
        )

        if not oracle_blocks:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                oracle_verdict=result.verdict,
                detail="Oracle itself returned SAT for no-IRQ — oracle bug",
                invariants_violated=[v.invariant for v in violations],
            )

        if kernel_blocked is None:
            return self._oracle_result(
                outcome=AttackOutcome.ORACLE_ONLY,
                oracle_verdict=result.verdict,
                detail=f"oracle={result.verdict_name()} (I1 holds: no-IRQ never SAT)",
            )

        if not kernel_blocked:
            return self._oracle_result(
                outcome=AttackOutcome.BYPASSED,
                oracle_verdict=result.verdict,
                kernel_verdict=0,
                detail="Kernel allowed write without IRQ — I1 bypass",
                invariants_violated=["I1"],
            )

        return self._oracle_result(
            outcome=AttackOutcome.BLOCKED,
            oracle_verdict=result.verdict,
            kernel_verdict=1,
            detail=f"oracle={result.verdict_name()}, kernel blocked errno=-1",
        )
