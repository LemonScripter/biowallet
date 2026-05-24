"""
T04 — Op-class Mismatch (Invariant I4)
Attack: file_axiom_map[fname]=OP_NET(0x02), token op_class=OP_WRITE(0x01) → mismatch.
Oracle: (file_axiom & op_class)==0 → I4 → AXIOM_MISMATCH, never SAT.
"""

from attacks.base import AttackBase, AttackResult, AttackOutcome
from oracle.bio_semantics import VERDICT_AXIOM_MISMATCH, VERDICT_SAT, OP_NET, OP_WRITE


NET_FILE = "net_target.tx"   # 14 chars, fits 16-byte key


class T04_OpClassMismatch(AttackBase):
    ATTACK_ID   = "T04"
    ATTACK_NAME = "Op-class mismatch write (I4: op_class_match_required)"

    def _run(self) -> AttackResult:
        self.oracle.reset()
        self.oracle.set_file_axiom(NET_FILE, OP_NET)   # file only allows OP_NET

        # IRQ with code=30 → op_class = OP_WRITE|OP_NET|OP_EXEC (keyboard key)
        # But we override op_class to OP_WRITE only (simulating a write-only token)
        # Simplification: inject low-code IRQ, then oracle sees token.op_class
        # In practice IRQ code<256 → OP_WRITE|OP_NET|OP_EXEC which DOES match OP_NET.
        # For I4 isolation we need a token with op_class=OP_WRITE ONLY.
        # Simulate that by directly inserting a token:
        from oracle.bio_semantics import CausalToken, TxState, TX_LOCKED
        import time
        now = time.monotonic_ns()
        tok = CausalToken(timestamp_ns=now, pid=9004, consumed=False,
                          comm="dcc_attacker", generation=0, op_class=OP_WRITE)
        self.oracle.token_map[9004] = tok
        self.oracle.tx_map[9004]    = TxState(state=TX_LOCKED, lock_time_ns=now)

        result = self.oracle.on_write(pid=9004, filename=NET_FILE,
                                      inode=11111, comm="dcc_attacker")
        oracle_blocks = result.verdict != VERDICT_SAT

        # Kernel: insert token with op_class=OP_WRITE via bpftool, then write to
        # a file with OP_NET axiom
        key_hex   = self._filename_to_hex(NET_FILE)
        value_hex = self._u32_to_hex(OP_NET)
        map_ok = self._bpftool_map_update("file_axiom_map", key_hex, value_hex)
        if not map_ok:
            return self._oracle_result(
                outcome=AttackOutcome.SKIPPED,
                detail="bpftool unavailable",
            )

        # Inject IRQ with high keycode (>=256) to get OP_ANY token, then expect
        # the axiom check to use the file axiom only (OP_NET & OP_WRITE = 0)
        # NOTE: keyboard code<256 gives OP_WRITE|OP_NET|OP_EXEC which matches OP_NET.
        # To properly test I4 isolation we use the injector's --op-class override.
        proc = self._run_injector("--mode", "irq-then-write",
                                  "--op-class", "1",    # force OP_WRITE only
                                  "--file", f"/tmp/{NET_FILE}",
                                  "--comm", "dcc_attacker")
        kernel_blocked = (proc.returncode == 1)

        self._bpftool_map_delete("file_axiom_map", key_hex)

        if not oracle_blocks:
            return self._oracle_result(
                outcome=AttackOutcome.ERROR,
                oracle_verdict=result.verdict,
                detail="Oracle returned SAT for op_class mismatch — oracle bug",
                invariants_violated=["I4"],
            )

        if not kernel_blocked:
            return self._oracle_result(
                outcome=AttackOutcome.BYPASSED,
                oracle_verdict=result.verdict,
                kernel_verdict=0,
                detail="Kernel allowed write with op_class mismatch — I4 bypass",
                invariants_violated=["I4"],
            )

        return self._oracle_result(
            outcome=AttackOutcome.BLOCKED,
            oracle_verdict=result.verdict,
            kernel_verdict=1,
            detail="oracle=AXIOM_MISMATCH, kernel blocked op_class mismatch",
        )
