"""
T08 — Whitelist Comm Spoof via prctl(PR_SET_NAME)
Attack: attacker calls prctl(PR_SET_NAME, "bash") to adopt a whitelisted name.
Expected (known weakness): kernel WILL whitelist it — this test documents the behavior.
Oracle: comm="bash" in whitelist → WHITELISTED (allowed by design).
Purpose: regression test — if behavior changes, the test detects it.
"""

from attacks.base import AttackBase, AttackResult, AttackOutcome
from oracle.bio_semantics import VERDICT_WHITELISTED, VERDICT_SAT


class T08_CommSpoof(AttackBase):
    ATTACK_ID   = "T08"
    ATTACK_NAME = "prctl comm spoof (whitelist bypass — known weakness)"

    def _run(self) -> AttackResult:
        self.oracle.reset()
        self.oracle.add_whitelist("bash")

        # Attacker adopts "bash" comm name → oracle says WHITELISTED (allowed)
        self.oracle.on_irq(pid=9007, code=30, comm="bash")
        result = self.oracle.on_write(pid=9007, filename="etc_passwd",
                                      inode=1, comm="bash")

        oracle_allows = (result.verdict == VERDICT_WHITELISTED)

        proc = self._run_injector("--mode", "comm-spoof",
                                  "--comm", "bash",
                                  "--file", "/tmp/dcc_comm_spoof.txt")
        # exit 0 = write allowed (expected for this known weakness)
        kernel_allows = (proc.returncode == 0)

        if oracle_allows and kernel_allows:
            return self._oracle_result(
                outcome=AttackOutcome.BYPASSED,
                oracle_verdict=result.verdict,
                kernel_verdict=0,
                detail="comm-spoof succeeds as designed — known weakness, documented",
                invariants_violated=[],
            )

        if oracle_allows and not kernel_allows:
            return self._oracle_result(
                outcome=AttackOutcome.ORACLE_MISMATCH,
                oracle_verdict=result.verdict,
                kernel_verdict=1,
                detail="Oracle says WHITELISTED but kernel blocks — unexpected tightening",
            )

        return self._oracle_result(
            outcome=AttackOutcome.BLOCKED,
            oracle_verdict=result.verdict,
            kernel_verdict=1 if not kernel_allows else 0,
            detail="comm-spoof blocked unexpectedly — whitelist behavior changed",
        )
