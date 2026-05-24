"""
T10 — token_map Flood (max_entries=4096)
Attack: flood token_map with 4096 entries → subsequent IRQ cannot insert new token
        → legitimate process's token is dropped → effective DoS on causal chain.
Oracle: map overflow → no SAT possible for new PIDs.
Kernel: BPF_MAP_TYPE_HASH silently fails bpf_map_update_elem when full.
"""

from attacks.base import AttackBase, AttackResult, AttackOutcome
from oracle.bio_semantics import VERDICT_SAT, VERDICT_NO_TOKEN


TOKEN_MAP_MAX = 4096


class T10_MapFlood(AttackBase):
    ATTACK_ID   = "T10"
    ATTACK_NAME = "token_map flood DoS (max_entries=4096)"

    def _run(self) -> AttackResult:
        self.oracle.reset()

        # Oracle: flood 4096 fake tokens (pid 1..4096)
        import time
        now = time.monotonic_ns()
        from oracle.bio_semantics import CausalToken, TxState, TX_LOCKED
        for pid in range(1, TOKEN_MAP_MAX + 1):
            self.oracle.token_map[pid] = CausalToken(
                timestamp_ns=now, pid=pid, consumed=False,
                comm=f"flood{pid}", generation=0, op_class=0x07,
            )

        # Now pid=99999 tries IRQ → oracle dict has no limit (Python), but kernel map does
        victim_pid = 99999
        self.oracle.on_irq(pid=victim_pid, code=30, comm="dcc_victim")
        result = self.oracle.on_write(pid=victim_pid, filename="victim.txt",
                                      inode=88888, comm="dcc_victim")
        # In oracle (no limit): this will SAT. In kernel (4096 cap): may fail.
        oracle_vulnerable = (result.verdict == VERDICT_SAT)

        # Kernel: use bpftool to bulk-insert 4096 entries, then test legitimate IRQ
        proc = self._run_injector("--mode", "map-flood",
                                  "--map-name", "token_map",
                                  "--count", str(TOKEN_MAP_MAX),
                                  "--file", "/tmp/dcc_victim.txt",
                                  "--comm", "dcc_victim",
                                  timeout=30.0)
        kernel_victim_blocked = (proc.returncode == 1)

        if oracle_vulnerable and kernel_victim_blocked:
            return self._oracle_result(
                outcome=AttackOutcome.BYPASSED,
                oracle_verdict=result.verdict,
                kernel_verdict=1,
                detail=f"Map flood ({TOKEN_MAP_MAX} entries) causes token drop for victim",
                invariants_violated=["I6"],
            )

        return self._oracle_result(
            outcome=AttackOutcome.BLOCKED,
            oracle_verdict=result.verdict,
            kernel_verdict=0,
            detail="Map flood did not cause victim token loss (or bpftool unavailable)",
        )
