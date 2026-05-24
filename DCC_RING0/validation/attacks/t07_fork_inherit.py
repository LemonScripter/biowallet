"""
T07 — Fork Inherit Depth Limit (MAX_FORK_GENERATION=3)
Attack: chain-fork 4 levels deep; generation 4 child must NOT inherit the token.
Oracle: generation >= MAX_FORK_GENERATION → no inheritance → child has no token.
"""

from attacks.base import AttackBase, AttackResult, AttackOutcome
from oracle.bio_semantics import VERDICT_SAT, VERDICT_NO_TOKEN, MAX_FORK_GENERATION


class T07_ForkInheritLimit(AttackBase):
    ATTACK_ID   = "T07"
    ATTACK_NAME = f"Fork inherit depth limit (MAX_FORK_GENERATION={MAX_FORK_GENERATION})"

    def _run(self) -> AttackResult:
        self.oracle.reset()

        # pid chain: 9100 → 9101 → 9102 → 9103 → 9104
        pids = list(range(9100, 9105))

        self.oracle.on_irq(pid=pids[0], code=30, comm="dcc_attacker")

        for i in range(len(pids) - 1):
            self.oracle.on_fork(parent_pid=pids[i], child_pid=pids[i + 1])

        # pids[3] is generation 3 → should still have a token
        # pids[4] is generation 4 → should NOT have a token (MAX_FORK_GENERATION=3)
        gen3_has_token = pids[3] in self.oracle.token_map
        gen4_has_token = pids[4] in self.oracle.token_map

        if not gen3_has_token:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                detail=f"pid {pids[3]} (gen3) should have token but doesn't — oracle bug",
            )

        oracle_blocks_gen4 = not gen4_has_token

        # Gen4 write attempt → oracle says NO_TOKEN
        result = self.oracle.on_write(pid=pids[4], filename="owned.txt",
                                      inode=33333, comm="dcc_attacker")
        oracle_gen4_blocked = (result.verdict != VERDICT_SAT)

        # Kernel: injector forks 4 deep, gen4 tries write
        proc = self._run_injector("--mode", "fork-depth",
                                  "--depth", "4",
                                  "--file",  "/tmp/dcc_owned.txt",
                                  "--comm",  "dcc_attacker")
        kernel_blocked = (proc.returncode == 1)

        if not oracle_blocks_gen4 or not oracle_gen4_blocked:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                detail=f"Oracle fork-depth check failed: gen4_in_map={gen4_has_token}",
            )

        if not kernel_blocked:
            return self._oracle_result(
                outcome=AttackOutcome.BYPASSED,
                oracle_verdict=result.verdict,
                kernel_verdict=0,
                detail=f"Kernel allowed gen4 fork token inheritance — limit bypass",
                invariants_violated=["I1"],
            )

        return self._oracle_result(
            outcome=AttackOutcome.BLOCKED,
            oracle_verdict=result.verdict,
            kernel_verdict=1,
            detail=f"gen4 fork correctly blocked; gen3 has token, gen4 does not",
        )
