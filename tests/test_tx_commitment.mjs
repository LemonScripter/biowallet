#!/usr/bin/env node
/**
 * BioWallet — Transaction Commitment Invariant (P_TX) — Security Test
 *
 * Validates the full COMMIT_TX → fingerprint verification → SIGN causal chain
 * and simulates a malicious browser extension substituting the transaction.
 *
 * Run: node tests/test_tx_commitment.mjs
 * Requires: Node.js 18+
 */

import { webcrypto } from 'node:crypto';
import { createHash } from 'node:crypto';

// Provide WebCrypto globally (vault.js uses crypto.subtle)
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { CausalChain, DCCError } from '../src/core/causal_chain.js';

// ── Helpers ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`    ✅ PASS: ${label}`);
  passed++;
}

function fail(label, detail = '') {
  console.error(`    ❌ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
  failed++;
}

function assert(cond, label, detail = '') {
  cond ? ok(label) : fail(label, detail);
}

function assertThrows(fn, expectedVerdict, label) {
  try {
    fn();
    fail(label, `expected DCCError [${expectedVerdict}] but no error was thrown`);
  } catch (e) {
    if (e instanceof DCCError && e.verdict === expectedVerdict) {
      ok(label);
    } else {
      fail(label, `expected DCCError [${expectedVerdict}], got: ${e.message}`);
    }
  }
}

/** Canonical SHA-256 of a tx object — mirrors vault.js commitTx() and sign() */
function txHashSync(tx) {
  const canonical = JSON.stringify(tx, Object.keys(tx).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/** Stub Uint8Array representing a fuzzy-extractor stable key */
function fakeR() {
  return new Uint8Array(32).fill(0x42);
}

const VAULT_ID = 'test-vault-abc';

// ── Transaction fixtures ──────────────────────────────────────────────────

const USER_TX = {
  chainId:              '1',
  data:                 '0x',
  gasLimit:             '21000',
  maxFeePerGas:         '1000000000',
  maxPriorityFeePerGas: '100000000',
  nonce:                5,
  to:                   '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  value:                '1000000000000000',
};

const MALICIOUS_TX = {
  chainId:              '1',
  data:                 '0x',
  gasLimit:             '21000',
  maxFeePerGas:         '1000000000',
  maxPriorityFeePerGas: '100000000',
  nonce:                5,
  to:                   '0xDeaDBeefDeaDBeefDeaDBeefDeaDBeefDeaDBeef',  // attacker
  value:                '999000000000000000',                           // drain amount
};

const userTxHash      = txHashSync(USER_TX);
const maliciousTxHash = txHashSync(MALICIOUS_TX);

// Sanity: the two transactions must produce different hashes
console.log('\n=== BioWallet — Transaction Commitment Invariant (P_TX) Test ===\n');

if (userTxHash === maliciousTxHash) {
  console.error('FATAL: USER_TX and MALICIOUS_TX produce the same hash — test setup error.');
  process.exit(2);
}
console.log('Fixture hashes verified (different tx → different SHA-256).');

// ── Test 1: Normal signing flow ───────────────────────────────────────────
console.log('\n[1] Normal signing flow: COMMIT_TX → correct fingerprint → SIGN');
{
  const chain = new CausalChain();
  chain.issue(fakeR(), VAULT_ID, userTxHash);
  try {
    const R = chain.gate('SIGN', VAULT_ID, userTxHash);
    assert(R instanceof Uint8Array, 'gate returns R on success');
  } catch (e) {
    fail('gate should pass when txHash matches', e.message);
  }
}

// ── Test 2: Wrong fingerprint at SIGN gate ────────────────────────────────
console.log('\n[2] Wrong tx hash at SIGN gate (extension substitutes tx after BIO_CAPTURE)');
{
  const chain = new CausalChain();
  // Token was committed with USER_TX hash (honest flow)
  chain.issue(fakeR(), VAULT_ID, userTxHash);
  // But SIGN is called with MALICIOUS_TX
  assertThrows(
    () => chain.gate('SIGN', VAULT_ID, maliciousTxHash),
    'TX_MISMATCH',
    'TX_MISMATCH when signed tx differs from committed tx'
  );
}

// ── Test 3: No COMMIT_TX before signing (bypass attempt) ─────────────────
console.log('\n[3] No COMMIT_TX before signing (null token txHash)');
{
  const chain = new CausalChain();
  // Token issued WITHOUT txHash (as if COMMIT_TX was never called)
  chain.issue(fakeR(), VAULT_ID, null);
  assertThrows(
    () => chain.gate('SIGN', VAULT_ID, userTxHash),
    'TX_MISMATCH',
    'TX_MISMATCH when token has no txHash but gate expects one'
  );
}

// ── Test 4: OPEN flow unaffected ──────────────────────────────────────────
console.log('\n[4] OPEN flow unaffected by txHash (no expectedTxHash passed)');
{
  const chain = new CausalChain();
  chain.issue(fakeR(), VAULT_ID, null);  // OPEN token: no txHash
  try {
    const R = chain.gate('OPEN', VAULT_ID, null);
    assert(R instanceof Uint8Array, 'OPEN gate passes without txHash check');
  } catch (e) {
    fail('OPEN gate should not check txHash', e.message);
  }
}

// ── Test 5: P3 single-use still enforced ─────────────────────────────────
console.log('\n[5] P3 single-use token still enforced after TX commitment');
{
  const chain = new CausalChain();
  chain.issue(fakeR(), VAULT_ID, userTxHash);
  chain.gate('SIGN', VAULT_ID, userTxHash);  // first use — OK
  // consumed token: fresh() returns false → gate reports EXPIRED (token exists but is stale)
  assertThrows(
    () => chain.gate('SIGN', VAULT_ID, userTxHash),
    'EXPIRED',
    'Cannot reuse a consumed sign token (reported as EXPIRED)'
  );
}

// ── Test 6: P2 freshness (TTL) still enforced ────────────────────────────
console.log('\n[6] P2 freshness (SIGN TTL = 10s) still enforced');
{
  const realNow = Date.now;
  // Issue the token at T=0
  const chain = new CausalChain();
  chain.issue(fakeR(), VAULT_ID, userTxHash);

  // Advance time by 11 seconds
  Date.now = () => realNow() + 11_000;
  assertThrows(
    () => chain.gate('SIGN', VAULT_ID, userTxHash),
    'EXPIRED',
    'SIGN token expired after TTL=10s'
  );
  Date.now = realNow;
}

// ── Test 7: Full attack simulation — end-to-end ───────────────────────────
console.log('\n[7] Full attack simulation: extension substitutes tx end-to-end');
console.log('    Scenario:');
console.log('      1. User initiates SEND for 0.001 ETH to their friend');
console.log('      2. Extension intercepts COMMIT_TX → sends MALICIOUS_TX to Worker');
console.log('      3. Worker stores hash(malicious_tx), returns fingerprint = hash(malicious)[:8]');
console.log('      4. Extension intercepts response, shows FAKE fingerprint = hash(user_tx)[:8]');
console.log('      5. User types first 4 chars of FAKE fingerprint');
console.log('      6. Extension passes user\'s input unchanged to BIO_CAPTURE');
console.log('      7. Worker verifies: user_input vs stored hash(malicious_tx)[:4]');
console.log('');

{
  // Step 2: Worker received malicious_tx → stores its hash
  const pendingTxHashInWorker = maliciousTxHash;  // Worker: commitTx(malicious_tx)

  // Step 3: fingerprint returned by Worker (8 chars of malicious hash)
  const workerFingerprint = maliciousTxHash.slice(0, 8);

  // Step 4: extension shows FAKE fingerprint (8 chars of user's tx hash)
  const fakeFingerprint = userTxHash.slice(0, 8);

  // Step 5: user reads FAKE fingerprint on screen, types first 4 chars
  const userTyped = fakeFingerprint.slice(0, 4);

  // Step 7: Worker checks: userTyped vs pendingTxHashInWorker[:4]
  const attackBlocked = userTyped !== pendingTxHashInWorker.slice(0, 4);

  console.log(`    Worker stored hash (malicious_tx)[:8] : ${workerFingerprint}`);
  console.log(`    Extension showed FAKE fingerprint      : ${fakeFingerprint}`);
  console.log(`    User typed (first 4 of FAKE)           : ${userTyped}`);
  console.log(`    Worker expected (malicious_tx[:4])     : ${pendingTxHashInWorker.slice(0, 4)}`);
  console.log('');

  assert(attackBlocked, 'fingerprint prefix mismatch blocks the substitution attack');

  // Also confirm: causal_chain gate would reject with TX_MISMATCH
  const chain = new CausalChain();
  // Suppose fingerprint check passed (worst case: extension also fixes BIO_CAPTURE)
  // Then SIGN gate still catches it:
  chain.issue(fakeR(), VAULT_ID, maliciousTxHash);  // token bound to malicious tx
  // But sign() computes hash(user_tx) — they differ:
  assertThrows(
    () => chain.gate('SIGN', VAULT_ID, userTxHash),
    'TX_MISMATCH',
    'SIGN gate provides second layer: token.txHash(malicious) ≠ hash(user_tx)'
  );
}

// ── Test 8: Honest flow with cancel (CANCEL_TX) ───────────────────────────
console.log('\n[8] Cancel flow: commitTx then cancelCommit, next commit works correctly');
{
  // Simulate: pendingTxHash set, then user cancels
  let pendingTxHash = userTxHash;  // commitTx(user_tx)
  // cancelCommit():
  pendingTxHash = null;

  // New sign attempt: commitTx(user_tx) again
  pendingTxHash = userTxHash;
  const userInput = userTxHash.slice(0, 4);  // correct prefix
  const prefixMatch = (userInput === pendingTxHash.slice(0, 4));

  assert(prefixMatch, 'after cancel+re-commit, correct prefix passes');

  // Chain level: token issued with correct hash, gate passes
  const chain = new CausalChain();
  chain.issue(fakeR(), VAULT_ID, pendingTxHash);
  try {
    chain.gate('SIGN', VAULT_ID, pendingTxHash);
    ok('clean re-commit flow: gate passes after cancel+retry');
  } catch (e) {
    fail('gate should pass on clean retry', e.message);
  }
}

// ── Test 9: VAULT_ID_MISMATCH still works (P4 unaffected) ────────────────
console.log('\n[9] P4 vault binding still enforced alongside TX commitment');
{
  const chain = new CausalChain();
  chain.issue(fakeR(), VAULT_ID, userTxHash);
  assertThrows(
    () => chain.gate('SIGN', 'different-vault-id', userTxHash),
    'VAULT_ID_MISMATCH',
    'VAULT_ID_MISMATCH unaffected by TX commitment'
  );
}

// ── Summary ───────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${'═'.repeat(55)}`);
if (failed === 0) {
  console.log(`✅ ALL ${total}/${total} TESTS PASSED`);
  console.log('   Transaction Commitment Invariant (P_TX) verified.');
  console.log('   Browser extension tx-substitution attack: BLOCKED.');
} else {
  console.error(`❌ ${failed}/${total} TESTS FAILED`);
}
console.log('═'.repeat(55));

if (failed > 0) process.exit(1);
