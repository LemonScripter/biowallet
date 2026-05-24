"""
T13 — Axiom Map Tampering via bpftool
Attack: attacker with root tries to modify file_axiom_map to remove a BLOCK entry
        for bio_memory.json, then writes to it.
Expected: bpftool map update succeeds (root can modify maps) → demonstrates that
          the DCC model's security root-of-trust assumption requires preventing
          root map tampering (out of scope for Ring 0, documented).
Purpose: demonstrates where the trust boundary ends (software-only scope).
"""

from attacks.base import AttackBase, AttackResult, AttackOutcome
from oracle.bio_semantics import VERDICT_SAT, VERDICT_AXIOM_MISMATCH, OP_BLOCK, OP_WRITE


PROTECTED_FILE = "bio_memory.jso"  # 15 chars


class T13_AxiomMapTamper(AttackBase):
    ATTACK_ID   = "T13"
    ATTACK_NAME = "Axiom map tampering via bpftool (trust boundary test)"

    def _run(self) -> AttackResult:
        self.oracle.reset()
        self.oracle.set_file_axiom(PROTECTED_FILE, OP_BLOCK)

        # Oracle: verify block is in place
        self.oracle.on_irq(pid=9013, code=30, comm="dcc_attacker")
        r_before = self.oracle.on_write(pid=9013, filename=PROTECTED_FILE,
                                        inode=9, comm="dcc_attacker")
        if r_before.verdict != VERDICT_AXIOM_MISMATCH:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                oracle_verdict=r_before.verdict,
                detail="Oracle should block PROTECTED_FILE with OP_BLOCK before tamper",
            )

        # Tamper: update axiom to OP_WRITE
        key_hex   = self._filename_to_hex(PROTECTED_FILE)
        value_hex = self._u32_to_hex(OP_WRITE)
        if not self.kernel_enabled:
            return self._oracle_result(
                outcome=AttackOutcome.ORACLE_ONLY,
                oracle_verdict=r_before.verdict,
                detail="oracle: OP_BLOCK blocks (I3). Kernel map tamper requires root+bpftool (trust boundary test).",
            )

        tamper_ok = self._bpftool_map_update("file_axiom_map", key_hex, value_hex)

        if not tamper_ok:
            return self._oracle_result(
                outcome=AttackOutcome.SKIPPED,
                detail="bpftool unavailable — cannot test axiom map tamper",
            )

        # After tamper: oracle reflects new axiom
        self.oracle.set_file_axiom(PROTECTED_FILE, OP_WRITE)
        self.oracle.reset()
        self.oracle.on_irq(pid=9013, code=30, comm="dcc_attacker")
        r_after = self.oracle.on_write(pid=9013, filename=PROTECTED_FILE,
                                       inode=9, comm="dcc_attacker")
        oracle_tamper_succeeds = (r_after.verdict == VERDICT_SAT)

        # Kernel write after tamper
        proc = self._run_injector("--mode", "irq-then-write",
                                  "--file", f"/tmp/{PROTECTED_FILE}",
                                  "--comm", "dcc_attacker")
        kernel_tamper_succeeds = (proc.returncode == 0)

        # Restore OP_BLOCK
        self._bpftool_map_update("file_axiom_map", key_hex, self._u32_to_hex(OP_BLOCK))

        if oracle_tamper_succeeds and kernel_tamper_succeeds:
            return self._oracle_result(
                outcome=AttackOutcome.BYPASSED,
                oracle_verdict=r_after.verdict,
                kernel_verdict=0,
                detail="Root axiom tamper bypasses protection — trust boundary limit (expected, out-of-scope)",
                invariants_violated=[],
            )

        return self._oracle_result(
            outcome=AttackOutcome.BLOCKED,
            oracle_verdict=r_after.verdict,
            kernel_verdict=1 if not kernel_tamper_succeeds else 0,
            detail="Axiom map tamper did not succeed or write was still blocked",
        )
