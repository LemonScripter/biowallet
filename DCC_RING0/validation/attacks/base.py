"""
DCC Ring 0 — Attack Base Classes
Each attack class is self-contained: knows how to set up, execute, and verify.
"""

from __future__ import annotations
import subprocess
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from oracle.bio_semantics import (
    BioSemanticsOracle, OracleResult,
    VERDICT_SAT, VERDICT_TX_ROLLBACK, VERDICT_AXIOM_MISMATCH,
    VERDICT_NO_TOKEN, OP_BLOCK, OP_WRITE,
)


class AttackOutcome(Enum):
    BLOCKED         = "BLOCKED"          # kernel blocked as expected
    BYPASSED        = "BYPASSED"         # attack succeeded — real bug
    ORACLE_MISMATCH = "ORACLE_MISMATCH"  # kernel disagrees with oracle
    ORACLE_ONLY     = "ORACLE_ONLY"      # --no-kernel: oracle says blocked
    ORACLE_BYPASS   = "ORACLE_BYPASS"    # --no-kernel: oracle says bypassed
    ERROR           = "ERROR"            # test infra error (not a bug)
    SKIPPED         = "SKIPPED"          # prereq missing (bpftool not found, etc.)


@dataclass
class AttackResult:
    attack_id:    str
    attack_name:  str
    outcome:      AttackOutcome
    oracle_verdict:  Optional[int] = None
    kernel_verdict:  Optional[int] = None  # actual errno from kernel (0=allow, -1=block)
    detail:       str = ""
    duration_ms:  float = 0.0
    invariants_violated: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return self.outcome in (AttackOutcome.BLOCKED, AttackOutcome.ORACLE_ONLY)

    def summary_line(self) -> str:
        icon = "+" if self.passed else "-"
        return (f"{icon} [{self.attack_id}] {self.attack_name}: "
                f"{self.outcome.value}  ({self.duration_ms:.1f}ms)  {self.detail}")


KERNEL_DISABLED_RC = 127   # sentinel: kernel tests not run


class AttackBase(ABC):
    """Base class for all DCC Ring 0 attack test cases."""

    ATTACK_ID:   str = ""   # e.g. "T01"
    ATTACK_NAME: str = ""   # human-readable

    def __init__(self, oracle: BioSemanticsOracle,
                 injector_bin: str = "/tmp/dcc_inject",
                 bpftool: str = "bpftool",
                 kernel_enabled: bool = True):
        self.oracle         = oracle
        self.injector_bin   = injector_bin
        self.bpftool        = bpftool
        self.kernel_enabled = kernel_enabled

    def run(self) -> AttackResult:
        t0 = time.monotonic()
        try:
            result = self._run()
        except FileNotFoundError as e:
            result = AttackResult(
                attack_id=self.ATTACK_ID, attack_name=self.ATTACK_NAME,
                outcome=AttackOutcome.SKIPPED,
                detail=f"prereq missing: {e}",
            )
        except Exception as e:
            result = AttackResult(
                attack_id=self.ATTACK_ID, attack_name=self.ATTACK_NAME,
                outcome=AttackOutcome.ERROR,
                detail=str(e),
            )
        result.duration_ms = (time.monotonic() - t0) * 1000
        return result

    @abstractmethod
    def _run(self) -> AttackResult:
        ...

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _run_injector(self, *args: str, timeout: float = 5.0) -> subprocess.CompletedProcess:
        if not self.kernel_enabled:
            return subprocess.CompletedProcess(args=[], returncode=KERNEL_DISABLED_RC,
                                               stdout="", stderr="")
        cmd = [self.injector_bin, *args]
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)

    def _kernel_blocked(self, proc: subprocess.CompletedProcess) -> Optional[bool]:
        """True=blocked, False=allowed, None=kernel not tested."""
        if proc.returncode == KERNEL_DISABLED_RC:
            return None
        return proc.returncode == 1

    def _bpftool_map_update(self, map_name: str, key_hex: str, value_hex: str) -> bool:
        if not self.kernel_enabled:
            return False
        cmd = [self.bpftool, "map", "update", "name", map_name,
               "key", *key_hex.split(), "value", *value_hex.split()]
        r = subprocess.run(cmd, capture_output=True, text=True)
        return r.returncode == 0

    def _bpftool_map_update(self, map_name: str, key_hex: str, value_hex: str) -> bool:
        """Update a BPF map entry. key_hex/value_hex are space-separated bytes."""
        cmd = [self.bpftool, "map", "update", "name", map_name,
               "key", *key_hex.split(), "value", *value_hex.split()]
        r = subprocess.run(cmd, capture_output=True, text=True)
        return r.returncode == 0

    def _bpftool_map_delete(self, map_name: str, key_hex: str) -> bool:
        cmd = [self.bpftool, "map", "delete", "name", map_name,
               "key", *key_hex.split()]
        r = subprocess.run(cmd, capture_output=True, text=True)
        return r.returncode == 0

    def _filename_to_hex(self, filename: str) -> str:
        """Encode filename to 16-byte zero-padded hex for bpftool key."""
        b = filename.encode()[:15] + b'\x00' * (16 - min(len(filename), 15))
        return " ".join(f"{x:02x}" for x in b)

    def _u32_to_hex(self, value: int) -> str:
        """Little-endian u32 → hex bytes for bpftool value."""
        import struct
        return " ".join(f"{x:02x}" for x in struct.pack("<I", value & 0xFFFFFFFF))

    def _oracle_result(self, **kwargs) -> AttackResult:
        return AttackResult(
            attack_id=self.ATTACK_ID,
            attack_name=self.ATTACK_NAME,
            **kwargs,
        )
