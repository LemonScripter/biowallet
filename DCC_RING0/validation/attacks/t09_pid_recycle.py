"""
T09 — PID Recycling Attack (token_map has no process-exit cleanup)
Attack: Process A (pid=X) gets token → exits → Process B reuses pid=X within 500ms
        → Process B inherits Process A's token without ever triggering IRQ.
Oracle: confirmed gap — no on_exit() cleanup → stale token persists.
Kernel: no BPF prog on sched_process_exit for token_map → likely real bug.

This test documents the vulnerability and checks whether it's exploitable.
"""

import time
from attacks.base import AttackBase, AttackResult, AttackOutcome
from oracle.bio_semantics import VERDICT_SAT, VERDICT_NO_TOKEN, CausalToken, TxState, TX_LOCKED


class T09_PidRecycle(AttackBase):
    ATTACK_ID   = "T09"
    ATTACK_NAME = "PID recycling token inheritance (known gap, no exit cleanup)"

    def _run(self) -> AttackResult:
        self.oracle.reset()

        RECYCLED_PID = 9009
        now = time.monotonic_ns()

        # Simulate: pid 9009 got IRQ, then "exited" — oracle has no cleanup
        tok = CausalToken(
            timestamp_ns=now, pid=RECYCLED_PID, consumed=False,
            comm="victim_proc", generation=0, op_class=0x07,
        )
        self.oracle.token_map[RECYCLED_PID] = tok
        self.oracle.tx_map[RECYCLED_PID] = TxState(state=TX_LOCKED, lock_time_ns=now)

        # New process "attacker" reuses the same pid without IRQ
        result = self.oracle.on_write(pid=RECYCLED_PID, filename="target.txt",
                                      inode=44444, comm="dcc_attacker",
                                      now_ns=now + 10_000_000)  # 10ms later

        # Oracle expects SAT because there's no cleanup — this is the documented gap
        oracle_vulnerable = (result.verdict == VERDICT_SAT)

        # Kernel: rapid pid recycle test
        # Injector: fork a short-lived process that gets IRQ, kills it,
        # then immediately forks a new process (hoping for same PID), tries write
        proc = self._run_injector("--mode", "pid-recycle",
                                  "--file", "/tmp/dcc_pid_recycle.txt",
                                  "--comm", "dcc_attacker",
                                  timeout=10.0)
        # exit 0 = write succeeded (vulnerability confirmed)
        # exit 1 = write blocked (kernel may have cleaned up or PID wasn't recycled)
        kernel_exploitable = (proc.returncode == 0)

        detail_parts = []
        if oracle_vulnerable:
            detail_parts.append("oracle: stale token persists (no exit cleanup)")
        if kernel_exploitable:
            detail_parts.append("kernel: PID recycle exploit succeeded")
        else:
            detail_parts.append("kernel: PID not recycled in test window (probabilistic)")

        if oracle_vulnerable and kernel_exploitable:
            return self._oracle_result(
                outcome=AttackOutcome.BYPASSED,
                oracle_verdict=result.verdict,
                kernel_verdict=0,
                detail=" | ".join(detail_parts),
                invariants_violated=["I1", "I6"],
            )

        if oracle_vulnerable and not kernel_exploitable:
            # Known weakness but not deterministically triggerable
            return self._oracle_result(
                outcome=AttackOutcome.BLOCKED,
                oracle_verdict=result.verdict,
                kernel_verdict=1,
                detail="PID recycle gap exists in oracle but not triggered in kernel test window",
            )

        return self._oracle_result(
            outcome=AttackOutcome.BLOCKED,
            oracle_verdict=result.verdict,
            kernel_verdict=1,
            detail=" | ".join(detail_parts),
        )
