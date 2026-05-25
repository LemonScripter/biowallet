#!/usr/bin/env python3
"""
dcc_rat_daemon — DCC Remote Attested Token Daemon (Phase 12c)

Listens on a Unix socket for attestation requests from authenticated SSH sessions.
Verifies the physical origin of the request (FIDO2/TPM assertion) and issues a
REMOTE_ATTESTED causal token for the session PID via the remote_token_map BPF map.

Current state: PHASE 12b PENDING (TPM-bound SSH key not yet configured).
The daemon is fully implemented; the FIDO2 verification path is a stub
that will be activated when Phase 12b is complete.

Architecture:
    [Admin device]  →  FIDO2 tap  →  SSH session  →  dcc_rat_daemon
                                                           ↓
                                                   verify assertion
                                                           ↓
                                               remote_token_map[ssh_pid]
                                                           ↓
                                              DCC LSM hooks accept token

Usage (Phase 12b+):
    sudo python3 dcc_rat_daemon.py --owner-pubkey /etc/dcc/owner_fido2.pub
"""

import os
import sys
import json
import socket
import struct
import logging
import argparse
import subprocess
import time
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Optional

# ── Constants (mirror dcc_core.bpf.c) ─────────────────────────────────────────

TOKEN_LOCAL_IRQ       = 0x01
TOKEN_REMOTE_ATTESTED = 0x02

ASSURANCE_NONE      = 0
ASSURANCE_PASSWORD  = 1
ASSURANCE_OTP       = 2
ASSURANCE_HW_KEY    = 3   # minimum for privileged ops
ASSURANCE_BIOMETRIC = 4
ASSURANCE_LOCAL_IRQ = 5

CAUSALITY_WINDOW_NS = 500_000_000  # 500ms — same as kernel

SOCKET_PATH     = "/run/dcc_rat_daemon.sock"
REMOTE_MAP_NAME = "remote_token_map"       # Phase 12c: new BPF map (not yet in dcc_core.bpf.c)
LOADER_PID_MAP  = "loader_pid_map"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [DCC-RAT] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("dcc_rat")


# ── Token issuance ─────────────────────────────────────────────────────────────

@dataclass
class AttestedTokenRequest:
    ssh_pid:        int
    ssh_comm:       str
    assurance_level: int
    attestation_id: int   # FIDO2 assertion hash (0 = not yet verified)
    server_id:      str   # rpId — must match configured server identity


@dataclass
class AttestedTokenResponse:
    success:    bool
    verdict:    str
    message:    str
    token_pid:  int = 0


def _get_map_id(map_name: str) -> Optional[int]:
    """Resolve BPF map name to numeric ID via bpftool."""
    try:
        out = subprocess.check_output(
            ["bpftool", "map", "list", "--json"], stderr=subprocess.DEVNULL
        )
        maps = json.loads(out)
        for m in maps:
            if m.get("name") == map_name:
                return m["id"]
    except Exception as e:
        log.warning("bpftool map list failed: %s", e)
    return None


def _write_token_to_map(map_id: int, pid: int, assurance_level: int,
                         attestation_id: int) -> bool:
    """
    Write a REMOTE_ATTESTED causal token to remote_token_map via bpftool.

    Key:   PID (u32, 4 bytes, little-endian)
    Value: struct causal_token (36 bytes):
        u64 timestamp_ns  (8)
        u32 pid           (4)
        u32 consumed      (4)
        char comm[16]     (16)
        u8 generation     (1)
        u8 op_class       (1)
        u8 token_type     (1)
        u8 assurance_level(1)
    Total: 36 bytes
    """
    now_ns = time.monotonic_ns()
    comm = b"dcc_rat\x00" + b"\x00" * 8  # 16 bytes

    # Pack struct causal_token
    token = struct.pack(
        "<QII16sBBBB",
        now_ns,           # timestamp_ns
        pid,              # pid
        0,                # consumed = false
        comm,             # comm[16]
        0,                # generation
        0x07,             # op_class = WRITE|NET|EXEC
        TOKEN_REMOTE_ATTESTED,
        assurance_level,
    )
    # attestation_id not in BPF struct yet (Phase 12c+) — stored in daemon only

    key_bytes   = " ".join(str(b) for b in struct.pack("<I", pid))
    value_bytes = " ".join(str(b) for b in token)

    try:
        subprocess.check_call(
            ["bpftool", "map", "update", "id", str(map_id),
             "key", *key_bytes.split(),
             "value", *value_bytes.split()],
            stderr=subprocess.DEVNULL,
        )
        return True
    except subprocess.CalledProcessError as e:
        log.error("bpftool map update failed: %s", e)
        return False


# ── FIDO2 / TPM attestation verification ──────────────────────────────────────

def verify_fido2_assertion(assertion_b64: str, owner_pubkey_path: str,
                            server_id: str, expected_counter: int) -> tuple[bool, int]:
    """
    Verify a FIDO2 WebAuthn assertion against the registered owner public key.

    Returns (verified: bool, new_counter: int).

    STATUS: STUB — Phase 12b pending (TPM-bound SSH key not yet configured).
    Full implementation requires: python-fido2 library + registered owner credential.

    When Phase 12b is complete, replace the stub with:
        from fido2.webauthn import PublicKeyCredentialDescriptor
        from fido2.server import Fido2Server
        # ... full FIDO2 verification
    """
    log.warning("FIDO2 verification STUB — Phase 12b pending. Returning UNVERIFIED.")
    return False, 0


def verify_tpm_assertion(tpm_quote_b64: str, owner_pubkey_path: str,
                          server_id: str) -> bool:
    """
    Verify a TPM 2.0 quote against the registered owner EK/AK certificate.

    STATUS: STUB — Phase 12b pending.
    Full implementation requires: tpm2-tools or python-tpm2 library.
    """
    log.warning("TPM verification STUB — Phase 12b pending. Returning UNVERIFIED.")
    return False


# ── Request handler ───────────────────────────────────────────────────────────

class RatDaemon:
    def __init__(self, owner_pubkey: Optional[str], server_id: str,
                 allow_stub: bool = False):
        self.owner_pubkey = owner_pubkey
        self.server_id    = server_id
        self.allow_stub   = allow_stub  # True only for Phase 12b testing without real FIDO2
        self._assertion_counter = 0     # monotonic counter for replay protection

    def handle_request(self, req: AttestedTokenRequest) -> AttestedTokenResponse:
        log.info("Token request: pid=%d comm=%r assurance=%d server_id=%r",
                 req.ssh_pid, req.ssh_comm, req.assurance_level, req.server_id)

        # 1. Server ID check — prevents cross-machine token reuse
        if req.server_id != self.server_id:
            log.warning("server_id mismatch: got %r expected %r",
                        req.server_id, self.server_id)
            return AttestedTokenResponse(
                success=False, verdict="ORIGIN_MISMATCH",
                message=f"server_id mismatch: {req.server_id!r} != {self.server_id!r}",
            )

        # 2. Assurance level check
        if req.assurance_level < ASSURANCE_HW_KEY:
            return AttestedTokenResponse(
                success=False, verdict="INSUFFICIENT_ASSURANCE",
                message=f"assurance_level {req.assurance_level} < {ASSURANCE_HW_KEY} (HW_KEY required)",
            )

        # 3. FIDO2/TPM verification (stub until Phase 12b)
        if not self.allow_stub:
            verified, new_counter = verify_fido2_assertion(
                assertion_b64="",          # Phase 12b: pass real assertion
                owner_pubkey_path=self.owner_pubkey or "",
                server_id=self.server_id,
                expected_counter=self._assertion_counter,
            )
            if not verified:
                return AttestedTokenResponse(
                    success=False, verdict="ATTESTATION_FAILED",
                    message="FIDO2 assertion verification failed (Phase 12b pending)",
                )
            self._assertion_counter = new_counter
        else:
            log.warning("STUB MODE: skipping FIDO2 verification (Phase 12b pending)")

        # 4. Issue token via remote_token_map
        map_id = _get_map_id(REMOTE_MAP_NAME)
        if map_id is None:
            return AttestedTokenResponse(
                success=False, verdict="MAP_NOT_FOUND",
                message=f"BPF map '{REMOTE_MAP_NAME}' not found — Phase 12c map not yet in kernel",
            )

        ok = _write_token_to_map(
            map_id=map_id,
            pid=req.ssh_pid,
            assurance_level=req.assurance_level,
            attestation_id=req.attestation_id,
        )
        if not ok:
            return AttestedTokenResponse(
                success=False, verdict="MAP_WRITE_FAILED",
                message="Failed to write token to remote_token_map",
            )

        log.info("REMOTE_ATTESTED token issued: pid=%d assurance=%d",
                 req.ssh_pid, req.assurance_level)
        return AttestedTokenResponse(
            success=True, verdict="SAT",
            message="REMOTE_ATTESTED token issued",
            token_pid=req.ssh_pid,
        )

    def run(self):
        if os.path.exists(SOCKET_PATH):
            os.unlink(SOCKET_PATH)

        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.bind(SOCKET_PATH)
        os.chmod(SOCKET_PATH, 0o600)
        sock.listen(4)
        log.info("dcc_rat_daemon listening on %s (server_id=%r)", SOCKET_PATH, self.server_id)
        log.info("Phase 12b status: %s",
                 "PENDING — FIDO2 verification is a stub" if not self.allow_stub
                 else "STUB MODE active")

        while True:
            try:
                conn, _ = sock.accept()
                with conn:
                    raw = conn.recv(4096)
                    if not raw:
                        continue
                    try:
                        data = json.loads(raw.decode())
                        req  = AttestedTokenRequest(**data)
                        resp = self.handle_request(req)
                        conn.sendall(json.dumps(asdict(resp)).encode())
                    except Exception as e:
                        log.error("Request error: %s", e)
                        conn.sendall(json.dumps({"success": False,
                                                  "verdict": "ERROR",
                                                  "message": str(e)}).encode())
            except KeyboardInterrupt:
                break
            except Exception as e:
                log.error("Socket error: %s", e)

        sock.close()
        if os.path.exists(SOCKET_PATH):
            os.unlink(SOCKET_PATH)
        log.info("dcc_rat_daemon stopped.")


# ── CLI client helper (for testing) ───────────────────────────────────────────

def request_token(pid: int, server_id: str,
                  assurance_level: int = ASSURANCE_HW_KEY) -> AttestedTokenResponse:
    """Send a token request to the running daemon (for testing / SSH wrapper use)."""
    req = AttestedTokenRequest(
        ssh_pid=pid,
        ssh_comm="ssh_session",
        assurance_level=assurance_level,
        attestation_id=0,
        server_id=server_id,
    )
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.connect(SOCKET_PATH)
    sock.sendall(json.dumps(asdict(req)).encode())
    raw = sock.recv(4096)
    sock.close()
    data = json.loads(raw.decode())
    return AttestedTokenResponse(**data)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description="DCC Remote Attested Token Daemon")
    ap.add_argument("--owner-pubkey", help="Path to owner FIDO2/TPM public key file")
    ap.add_argument("--server-id", default="bioos.metaspace.bio",
                    help="Server identity (rpId) for origin binding")
    ap.add_argument("--allow-stub", action="store_true",
                    help="Allow token issuance without real FIDO2 (Phase 12b testing)")
    ap.add_argument("--request-token", type=int, metavar="PID",
                    help="Client mode: request a token for PID and exit")
    args = ap.parse_args()

    if args.request_token:
        resp = request_token(args.request_token, args.server_id)
        print(json.dumps(asdict(resp), indent=2))
        sys.exit(0 if resp.success else 1)

    if os.geteuid() != 0:
        print("ERROR: dcc_rat_daemon must run as root (needs bpftool map access)")
        sys.exit(1)

    daemon = RatDaemon(
        owner_pubkey=args.owner_pubkey,
        server_id=args.server_id,
        allow_stub=args.allow_stub,
    )
    daemon.run()


if __name__ == "__main__":
    main()
