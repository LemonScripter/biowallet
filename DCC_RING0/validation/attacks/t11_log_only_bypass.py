"""
T11 — Log-only Mode Bypass
Attack: if guard is running in log_only=1 mode, all blocks are advisory only.
Expected: in log-only mode, attacker write SUCCEEDS even without token.
This tests that blocking mode (log_only=0) is actually enforcing and log_only=1 is not.
"""

from attacks.base import AttackBase, AttackResult, AttackOutcome
from oracle.bio_semantics import VERDICT_NO_TOKEN, VERDICT_SAT


class T11_LogOnlyBypass(AttackBase):
    ATTACK_ID   = "T11"
    ATTACK_NAME = "Log-only mode non-enforcement (expected bypass)"

    def _run(self) -> AttackResult:
        self.oracle.reset()
        self.oracle.set_blocking(False)   # log-only mode

        result = self.oracle.on_write(pid=9011, filename="target.txt",
                                      inode=11111, comm="dcc_attacker")

        # In log-only mode: oracle verdict is still NO_TOKEN but errno=0 (allow)
        oracle_allows = (result.errno == 0)

        # Kernel: set config to log_only=1 via bpftool, then try write without IRQ
        key_hex   = "00 00 00 00"  # config_map key=0
        # struct config_t: log_only=1, rest=0 (little-endian u32 each)
        value_hex = "01 00 00 00  00 00 00 00  00 00 00 00  00 00 00 00"
        if not oracle_allows:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                oracle_verdict=result.verdict,
                detail="Oracle should allow in log-only mode (errno=0)",
            )

        if not self.kernel_enabled:
            return self._oracle_result(
                outcome=AttackOutcome.ORACLE_BYPASS,
                oracle_verdict=result.verdict,
                detail="oracle: log-only mode allows writes (errno=0) — intended non-enforcement",
            )

        map_ok = self._bpftool_map_update("config_map", key_hex, value_hex)
        if not map_ok:
            return self._oracle_result(
                outcome=AttackOutcome.SKIPPED,
                detail="bpftool unavailable",
            )

        proc = self._run_injector("--mode", "write-only",
                                  "--file", "/tmp/dcc_logonly_test.txt",
                                  "--comm", "dcc_attacker")
        kb = self._kernel_blocked(proc)
        kernel_allows = (kb is False)

        value_blocking = "00 00 00 00  00 00 00 00  00 00 00 00  00 00 00 00"
        self._bpftool_map_update("config_map", key_hex, value_blocking)

        if oracle_allows and kernel_allows:
            return self._oracle_result(
                outcome=AttackOutcome.BYPASSED,
                oracle_verdict=result.verdict,
                kernel_verdict=0,
                detail="Log-only mode confirmed non-enforcing (expected behavior)",
            )

        if oracle_allows != kernel_allows:
            return self._oracle_result(
                outcome=AttackOutcome.ORACLE_MISMATCH,
                oracle_verdict=result.verdict,
                kernel_verdict=0 if kernel_allows else 1,
                detail=f"oracle_allows={oracle_allows} kernel_allows={kernel_allows}",
            )

        return self._oracle_result(
            outcome=AttackOutcome.BLOCKED,
            oracle_verdict=result.verdict,
            kernel_verdict=1,
            detail="Unexpected: kernel blocks in log-only mode",
        )
