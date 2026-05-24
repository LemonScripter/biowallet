"""
T03 — Blocked File Write (Invariant I3)
Attack: file_axiom_map[fname] = OP_BLOCK (0x00) → write must be blocked
        even if the process has a valid, fresh token.
Oracle: file_axiom=0 → I3 → AXIOM_MISMATCH, never SAT.

BPF note: OP_BLOCK check runs BEFORE whitelist, so even a whitelisted comm
is blocked if the file has OP_BLOCK (confirmed in dcc_axiom_validator).
"""

from attacks.base import AttackBase, AttackResult, AttackOutcome
from oracle.bio_semantics import VERDICT_AXIOM_MISMATCH, VERDICT_SAT, OP_BLOCK


BLOCKED_FILE = "bio_memory.jso"   # 15 chars (dentry key, truncated from bio_memory.json)


class T03_BlockedFile(AttackBase):
    ATTACK_ID   = "T03"
    ATTACK_NAME = "Blocked file write (I3: blocked_file_immutable)"

    def _run(self) -> AttackResult:
        self.oracle.reset()
        self.oracle.set_file_axiom(BLOCKED_FILE, OP_BLOCK)

        self.oracle.on_irq(pid=9003, code=30, comm="dcc_attacker")
        result = self.oracle.on_write(pid=9003, filename=BLOCKED_FILE,
                                      inode=99999, comm="dcc_attacker")

        oracle_blocks = result.verdict != VERDICT_SAT

        # Set OP_BLOCK in kernel map via bpftool
        key_hex   = self._filename_to_hex(BLOCKED_FILE)
        value_hex = self._u32_to_hex(OP_BLOCK)
        if not oracle_blocks:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                oracle_verdict=result.verdict,
                detail="Oracle returned SAT for OP_BLOCK file — oracle bug",
                invariants_violated=["I3"],
            )

        map_ok = self._bpftool_map_update("file_axiom_map", key_hex, value_hex)
        if not map_ok and self.kernel_enabled:
            return self._oracle_result(
                outcome=AttackOutcome.SKIPPED,
                detail="bpftool map update failed — not running as root or BPF not loaded",
            )

        if not self.kernel_enabled:
            return self._oracle_result(
                outcome=AttackOutcome.ORACLE_ONLY,
                oracle_verdict=result.verdict,
                detail=f"oracle=AXIOM_MISMATCH (I3 holds: OP_BLOCK file never SAT)",
            )

        proc = self._run_injector("--mode", "irq-then-write",
                                  "--file", f"/tmp/{BLOCKED_FILE}",
                                  "--comm", "dcc_attacker")
        kernel_blocked = self._kernel_blocked(proc)
        self._bpftool_map_delete("file_axiom_map", key_hex)

        if not kernel_blocked:
            return self._oracle_result(
                outcome=AttackOutcome.BYPASSED,
                oracle_verdict=result.verdict,
                kernel_verdict=0,
                detail=f"Kernel allowed write to {BLOCKED_FILE} with OP_BLOCK — I3 bypass",
                invariants_violated=["I3"],
            )

        return self._oracle_result(
            outcome=AttackOutcome.BLOCKED,
            oracle_verdict=result.verdict,
            kernel_verdict=1,
            detail=f"oracle=AXIOM_MISMATCH, kernel blocked {BLOCKED_FILE}",
        )
