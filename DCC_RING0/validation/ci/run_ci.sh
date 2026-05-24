#!/bin/bash
# DCC Ring 0 — CI validation entry point
# Runs oracle-only tests (no BPF needed) + property fuzzer.
# Kernel tests require root + loaded BPF + separate invocation.
#
# Usage: bash ci/run_ci.sh [--with-kernel]

set -euo pipefail
cd "$(dirname "$0")/.."   # DCC_RING0/validation/

WITH_KERNEL=0
for arg in "$@"; do
    [[ "$arg" == "--with-kernel" ]] && WITH_KERNEL=1
done

echo "=== DCC Ring 0 CI: Oracle + Fuzzer ==="
echo ""

# 1. Oracle unit tests
echo "[1/3] Oracle unit tests"
python3 -m pytest fuzzer/property_tests.py -v --tb=short -q 2>&1 | tail -20
echo ""

# 2. Oracle-only attack run (no kernel calls)
echo "[2/3] Attack suite (oracle-only)"
python3 runner/run_attacks.py --no-kernel 2>&1
echo ""

# 3. Kernel attack run (optional)
if [[ $WITH_KERNEL -eq 1 ]]; then
    echo "[3/3] Attack suite (kernel — blocking mode required)"
    if [[ $EUID -ne 0 ]]; then
        echo "  SKIP: not root (re-run with sudo)"
    else
        python3 runner/run_attacks.py 2>&1
    fi
else
    echo "[3/3] Kernel tests: skipped (pass --with-kernel to enable)"
fi

echo ""
echo "CI complete."
