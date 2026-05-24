"""
T12 — Multi-IRQ Token Overwrite Race
Attack: two rapid IRQs from the same PID — second IRQ overwrites the token
        (BPF_ANY update). Tests that a rapid double-IRQ doesn't break invariants.
Oracle: second IRQ resets token (fresh timestamp, consumed=False) → still safe.
"""

import time
from attacks.base import AttackBase, AttackResult, AttackOutcome
from oracle.bio_semantics import VERDICT_SAT


class T12_MultiIrqRace(AttackBase):
    ATTACK_ID   = "T12"
    ATTACK_NAME = "Double-IRQ token overwrite race"

    def _run(self) -> AttackResult:
        self.oracle.reset()

        now = time.monotonic_ns()

        # First IRQ
        self.oracle.on_irq(pid=9012, code=30, comm="dcc_attacker", now_ns=now)
        tok1 = self.oracle.token_map.get(9012)

        # Second IRQ 50ms later — overwrites token
        self.oracle.on_irq(pid=9012, code=31, comm="dcc_attacker",
                           now_ns=now + 50_000_000)
        tok2 = self.oracle.token_map.get(9012)

        # Token should be fresh (consumed=False, new timestamp)
        oracle_ok = (tok2 is not None and not tok2.consumed
                     and tok2.timestamp_ns > tok1.timestamp_ns)

        # Write should succeed with fresh token
        result = self.oracle.on_write(pid=9012, filename="target.txt",
                                      inode=12345, comm="dcc_attacker",
                                      now_ns=now + 100_000_000)
        oracle_write_ok = (result.verdict == VERDICT_SAT)

        if not oracle_ok or not oracle_write_ok:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                oracle_verdict=result.verdict,
                detail=f"Oracle double-IRQ state broken: ok={oracle_ok} write={oracle_write_ok}",
            )

        proc = self._run_injector("--mode", "double-irq",
                                  "--file", "/tmp/dcc_double_irq.txt",
                                  "--comm", "dcc_attacker")
        kb = self._kernel_blocked(proc)

        if kb is None:
            return self._oracle_result(
                outcome=AttackOutcome.ORACLE_ONLY,
                oracle_verdict=result.verdict,
                detail="oracle: double-IRQ overwrites token safely, write valid",
            )

        kernel_ok = (kb is False)  # False=allowed=correct

        if oracle_ok and kernel_ok:
            return self._oracle_result(
                outcome=AttackOutcome.BLOCKED,
                oracle_verdict=result.verdict,
                kernel_verdict=0,
                detail="Double-IRQ: second token overwrites first, write still valid — correct",
            )

        return self._oracle_result(
            outcome=AttackOutcome.ORACLE_MISMATCH,
            oracle_verdict=result.verdict,
            kernel_verdict=1,
            detail=f"Oracle says write valid but kernel blocked",
        )
