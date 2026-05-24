"""
T02 — Expired Token (Invariant I2)
Attack: inject IRQ, wait >500ms, then attempt write.
Oracle: token_age_ms >= 500 → I2 fires → EXPIRED, not SAT.
"""

import time
from attacks.base import AttackBase, AttackResult, AttackOutcome
from oracle.bio_semantics import VERDICT_EXPIRED, VERDICT_SAT


class T02_ExpiredToken(AttackBase):
    ATTACK_ID   = "T02"
    ATTACK_NAME = "Expired token write (I2: causality_window)"

    def _run(self) -> AttackResult:
        self.oracle.reset()

        BASE_NS = 1_000_000_000
        OLD_TS  = BASE_NS - 600_000_000  # 600ms before base → already expired

        self.oracle.on_irq(pid=9002, code=30, comm="dcc_attacker",
                           now_ns=OLD_TS)

        result = self.oracle.on_write(pid=9002, filename="target.txt",
                                      inode=12345, comm="dcc_attacker",
                                      now_ns=BASE_NS)

        oracle_blocks = result.verdict != VERDICT_SAT

        # Kernel: inject IRQ, sleep 550ms, try write
        proc = self._run_injector("--mode", "irq-then-wait-write",
                                  "--wait-ms", "550",
                                  "--file", "/tmp/dcc_test_target.txt",
                                  "--comm", "dcc_attacker")
        kernel_blocked = (proc.returncode == 1)

        if not oracle_blocks:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                oracle_verdict=result.verdict,
                detail=f"Oracle returned {result.verdict_name()} — expected EXPIRED",
            )

        if not kernel_blocked:
            return self._oracle_result(
                outcome=AttackOutcome.BYPASSED,
                oracle_verdict=result.verdict,
                kernel_verdict=0,
                detail="Kernel allowed write after 550ms token age — I2 bypass",
                invariants_violated=["I2"],
            )

        return self._oracle_result(
            outcome=AttackOutcome.BLOCKED,
            oracle_verdict=result.verdict,
            kernel_verdict=1,
            detail=f"oracle=EXPIRED, kernel blocked after 550ms",
        )
