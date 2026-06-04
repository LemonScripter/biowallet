#!/usr/bin/env python3
"""
BioWallet — RPC & API Health Check
Pings every built-in endpoint: 8 RPC chains + 6 Blockscout + Paraswap + LlamaFi.
Reports: status, response time, chain ID match.
Usage: python tests/rpc_health_check.py
"""
import urllib.request
import urllib.error
import json
import time

TIMEOUT = 12  # seconds — matches RPC_TIMEOUT_MS in rpc.js

# ── RPC endpoints ─────────────────────────────────────────────────────────────
RPC_CHAINS = [
    ("Ethereum",   "https://ethereum.publicnode.com",                1),
    ("BNB Chain",  "https://bsc-dataseed.binance.org/",             56),
    ("Polygon",    "https://polygon-bor-rpc.publicnode.com",       137),
    ("Arbitrum",   "https://arb1.arbitrum.io/rpc",               42161),
    ("Base",       "https://mainnet.base.org",                    8453),
    ("Optimism",   "https://mainnet.optimism.io",                   10),
    ("Avalanche",  "https://api.avax.network/ext/bc/C/rpc",      43114),
    ("Sepolia",    "https://ethereum-sepolia-rpc.publicnode.com", 11155111),
    # Fallback
    ("ETH fallback (llamarpc)", "https://eth.llamarpc.com",          1),
]

# ── Blockscout REST endpoints ──────────────────────────────────────────────────
BLOCKSCOUT = [
    ("Ethereum",  "https://eth.blockscout.com"),
    ("Polygon",   "https://polygon.blockscout.com"),
    ("Arbitrum",  "https://arbitrum.blockscout.com"),
    ("Base",      "https://base.blockscout.com"),
    ("Optimism",  "https://optimism.blockscout.com"),
    ("Sepolia",   "https://eth-sepolia.blockscout.com"),
]

# -- Other APIs --───────────────────────────────────────────────────────────────
OTHER_APIS = [
    ("Paraswap",  "https://apiv5.paraswap.io/prices/?srcToken=0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE&srcDecimals=18&destToken=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48&destDecimals=6&amount=1000000000000000000&network=1&partner=biowallet"),
    ("LlamaFi",   "https://coins.llama.fi/prices/current/ethereum:0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"),
]

# ── Helpers ────────────────────────────────────────────────────────────────────

GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def status_icon(ok):
    return f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"

# Simulate browser Origin — many RPC providers enforce CORS (403 without it)
BROWSER_HEADERS = {
    "Content-Type":  "application/json",
    "Origin":        "https://biowallet.metaspace.bio",
    "Referer":       "https://biowallet.metaspace.bio/",
    "User-Agent":    "Mozilla/5.0 (BioWallet-HealthCheck)",
}

def rpc_call(url, method, params=None):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}).encode()
    req = urllib.request.Request(url, data=payload, headers=BROWSER_HEADERS, method="POST")
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = json.loads(resp.read())
    elapsed = time.time() - t0
    if "error" in data:
        raise ValueError(data["error"].get("message", "RPC error"))
    return data["result"], elapsed

def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": BROWSER_HEADERS["User-Agent"],
                                               "Origin": BROWSER_HEADERS["Origin"]})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        resp.read()
    return time.time() - t0

# ── Checks ─────────────────────────────────────────────────────────────────────

def check_rpc(name, url, expected_chain_id):
    try:
        result, elapsed = rpc_call(url, "eth_chainId")
        actual = int(result, 16)
        chain_ok = (actual == expected_chain_id)
        ms = int(elapsed * 1000)
        speed = f"{GREEN}{ms}ms{RESET}" if ms < 2000 else f"{YELLOW}{ms}ms{RESET}" if ms < 6000 else f"{RED}{ms}ms{RESET}"
        chain_str = f"chainId={actual}" + (f"{GREEN} OK{RESET}" if chain_ok else f"{RED} MISMATCH (expected {expected_chain_id}){RESET}")
        print(f"  {status_icon(chain_ok)}  {name:<30} {speed:<20} {chain_str}")
        return chain_ok
    except Exception as e:
        print(f"  {RED}FAIL{RESET}  {name:<30} {RED}{str(e)[:60]}{RESET}")
        return False

def check_blockscout(name, base_url):
    url = f"{base_url}/api/v2/stats"
    try:
        elapsed = http_get(url)
        ms = int(elapsed * 1000)
        speed = f"{GREEN}{ms}ms{RESET}" if ms < 3000 else f"{YELLOW}{ms}ms{RESET}" if ms < 8000 else f"{RED}{ms}ms{RESET}"
        print(f"  {status_icon(True)}  {name:<30} {speed}")
        return True
    except Exception as e:
        print(f"  {RED}FAIL{RESET}  {name:<30} {RED}{str(e)[:60]}{RESET}")
        return False

def check_api(name, url):
    try:
        elapsed = http_get(url)
        ms = int(elapsed * 1000)
        speed = f"{GREEN}{ms}ms{RESET}" if ms < 3000 else f"{YELLOW}{ms}ms{RESET}" if ms < 8000 else f"{RED}{ms}ms{RESET}"
        print(f"  {status_icon(True)}  {name:<30} {speed}")
        return True
    except Exception as e:
        print(f"  {RED}FAIL{RESET}  {name:<30} {RED}{str(e)[:60]}{RESET}")
        return False

# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    passed = 0
    total  = 0

    print(f"\nBioWallet -- RPC & API Health Check  (timeout={TIMEOUT}s)\n")

    print(f"{BOLD}-- RPC Endpoints ({'%d chains' % len(RPC_CHAINS)}) --{RESET}")
    for name, url, chain_id in RPC_CHAINS:
        ok = check_rpc(name, url, chain_id)
        passed += ok; total += 1

    print(f"\n{BOLD}-- Blockscout APIs ({len(BLOCKSCOUT)} explorers) --{RESET}")
    for name, url in BLOCKSCOUT:
        ok = check_blockscout(name, url)
        passed += ok; total += 1

    print(f"\n{BOLD}-- Other APIs --{RESET}")
    for name, url in OTHER_APIS:
        ok = check_api(name, url)
        passed += ok; total += 1

    failed = total - passed
    color  = GREEN if failed == 0 else YELLOW if failed <= 2 else RED
    print(f"\nResult: {color}{passed}/{total} PASS{RESET}")
    if failed:
        print(f"{YELLOW}  {failed} endpoint(s) failed — check connection or endpoint status{RESET}")
    print()
    return 0 if failed == 0 else 1

if __name__ == "__main__":
    raise SystemExit(main())
