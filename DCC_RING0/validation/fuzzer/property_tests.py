"""
DCC Ring 0 — Property-Based Fuzzing (Hypothesis)
Fuzz the Oracle with random inputs, verify all 6 invariants hold on every output.

Install: pip install hypothesis
Run: python3 -m pytest fuzzer/property_tests.py -v
"""

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from oracle.bio_semantics import (
    BioSemanticsOracle,
    VERDICT_SAT, VERDICT_TX_ROLLBACK,
    OP_BLOCK, OP_WRITE, OP_NET, OP_EXEC, OP_ANY,
    TX_IDLE, TX_LOCKED, TX_STAGED,
)

# ── Strategies ────────────────────────────────────────────────────────────────

pids      = st.integers(min_value=1, max_value=65535)
inodes    = st.integers(min_value=1, max_value=999999)
irq_codes = st.integers(min_value=0, max_value=511)
op_masks  = st.sampled_from([OP_WRITE, OP_NET, OP_EXEC, OP_ANY, OP_BLOCK,
                              OP_WRITE | OP_NET, OP_WRITE | OP_EXEC,
                              OP_NET | OP_EXEC])
comms     = st.text(alphabet="abcdefghijklmnopqrstuvwxyz_", min_size=1, max_size=15)
filenames = st.text(alphabet="abcdefghijklmnopqrstuvwxyz_.", min_size=1, max_size=14)

# Timestamps spread across a 2-second window
timestamps = st.integers(min_value=0, max_value=2_000_000_000)


# ── Helpers ───────────────────────────────────────────────────────────────────

def fresh_oracle() -> BioSemanticsOracle:
    o = BioSemanticsOracle()
    o.set_blocking(True)
    return o


# ── Properties ────────────────────────────────────────────────────────────────

@given(pid=pids, filename=filenames, inode=inodes, comm=comms,
       write_ts=timestamps)
@settings(max_examples=2000, deadline=5000)
def test_no_irq_never_sat(pid, filename, inode, comm, write_ts):
    """I1: any write without prior IRQ must not produce SAT."""
    o = fresh_oracle()
    result = o.on_write(pid=pid, filename=filename, inode=inode, comm=comm,
                        now_ns=write_ts)
    assert result.verdict != VERDICT_SAT, \
        f"I1 VIOLATED: no-IRQ write got SAT (pid={pid}, comm={comm!r})"


@given(pid=pids, filename=filenames, inode=inodes, comm=comms,
       irq_ts=timestamps, write_delay=st.integers(min_value=500_000_001,
                                                   max_value=2_000_000_000))
@settings(max_examples=1000, deadline=5000)
def test_expired_token_never_sat(pid, filename, inode, comm, irq_ts, write_delay):
    """I2: write after token expiry (>500ms) must not produce SAT."""
    o = fresh_oracle()
    o.on_irq(pid=pid, code=30, comm=comm, now_ns=irq_ts)
    result = o.on_write(pid=pid, filename=filename, inode=inode, comm=comm,
                        now_ns=irq_ts + write_delay)
    assert result.verdict != VERDICT_SAT, \
        f"I2 VIOLATED: expired token got SAT (age={write_delay/1e6:.0f}ms)"


@given(pid=pids, filename=filenames, inode=inodes, comm=comms,
       irq_ts=timestamps)
@settings(max_examples=1000, deadline=5000)
def test_blocked_file_never_sat(pid, filename, inode, comm, irq_ts):
    """I3: OP_BLOCK file must never get SAT regardless of token state."""
    o = fresh_oracle()
    o.set_file_axiom(filename, OP_BLOCK)
    o.on_irq(pid=pid, code=30, comm=comm, now_ns=irq_ts)
    result = o.on_write(pid=pid, filename=filename, inode=inode, comm=comm,
                        now_ns=irq_ts + 1_000_000)
    assert result.verdict != VERDICT_SAT, \
        f"I3 VIOLATED: OP_BLOCK file got SAT (file={filename!r})"


@given(pid=pids, inode_a=inodes, inode_b=inodes, comm=comms,
       irq_ts=timestamps)
@settings(max_examples=1000, deadline=5000)
def test_toctou_always_rollback(pid, inode_a, inode_b, comm, irq_ts):
    """I5: TX_STAGED + different inode must always produce TX_ROLLBACK."""
    assume(inode_a != inode_b)
    o = fresh_oracle()
    o.on_irq(pid=pid, code=30, comm=comm, now_ns=irq_ts)
    r1 = o.on_write(pid=pid, filename="fileA", inode=inode_a, comm=comm,
                    now_ns=irq_ts + 1_000_000)
    assume(r1.verdict == VERDICT_SAT)   # skip if first write failed (edge case)
    r2 = o.on_write(pid=pid, filename="fileB", inode=inode_b, comm=comm,
                    now_ns=irq_ts + 2_000_000)
    assert r2.verdict == VERDICT_TX_ROLLBACK, \
        f"I5 VIOLATED: TOCTOU pivot got {r2.verdict_name()} (inodes {inode_a}→{inode_b})"


@given(pid=pids, inode=inodes, comm=comms, irq_ts=timestamps,
       n_writes=st.integers(min_value=2, max_value=10))
@settings(max_examples=500, deadline=5000)
def test_multi_write_same_inode_always_sat(pid, inode, comm, irq_ts, n_writes):
    """SAT must be stable for repeated writes to the same inode within window."""
    o = fresh_oracle()
    o.on_irq(pid=pid, code=30, comm=comm, now_ns=irq_ts)
    for i in range(n_writes):
        ts = irq_ts + (i + 1) * 1_000_000
        r = o.on_write(pid=pid, filename="same.dat", inode=inode, comm=comm,
                       now_ns=ts)
        assert r.verdict == VERDICT_SAT, \
            f"Multi-write same inode: write {i+1} got {r.verdict_name()}"


@given(pid=pids, irq_ts=timestamps,
       file_axiom=op_masks, op_class=op_masks, inode=inodes, comm=comms)
@settings(max_examples=2000, deadline=5000)
def test_invariants_never_violated_random(pid, irq_ts, file_axiom, op_class,
                                          inode, comm):
    """General fuzz: oracle output never violates its own invariants.

    The oracle is configured with the SAME file_axiom and op_class that are
    passed to validate_invariants — so the checker sees a consistent picture.
    Hypothesis found an earlier version where these were decoupled, causing
    spurious I4 flags (file_axiom set in checker but not in oracle).
    """
    assume(file_axiom != OP_BLOCK)   # OP_BLOCK tested by test_blocked_file_never_sat

    o = fresh_oracle()
    # Register the file axiom so the oracle actually enforces it
    o.set_file_axiom("rand.dat", file_axiom)

    o.on_irq(pid=pid, code=30, comm=comm, now_ns=irq_ts)

    # Override the token's op_class to the fuzzed value (IRQ normally sets OP_WRITE|NET|EXEC)
    if pid in o.token_map:
        o.token_map[pid].op_class = op_class

    result = o.on_write(pid=pid, filename="rand.dat", inode=inode, comm=comm,
                        now_ns=irq_ts + 1_000_000)

    token_age_ms = 1.0
    tx = o.tx_map.get(pid)
    tx_state_val = tx.state if tx else 0

    # Now validate_invariants sees exactly the same axiom/op_class the oracle used
    violations = o.validate_invariants(
        irq_event=True,
        op_class=op_class,
        file_axiom=file_axiom,
        token_age_ms=token_age_ms,
        tx_state=tx_state_val,
        same_inode=True,
        verdict=result.verdict,
    )

    assert not violations, \
        f"Invariant violations on oracle output: {[str(v) for v in violations]}"
