/**
 * BioWallet — DCC Causal Chain
 *
 * Prerequisite for every sensitive operation: a valid causal_token.
 * Token only exists after a physical biometric event.
 * Token is single-use (TOCTOU lock).
 * Token is vault-bound (cannot be transferred to another wallet).
 *
 * Satisfies: biowallet.bio invariants P1–P7
 */

const TTL = {
  OPEN:   30_000,
  SIGN:   10_000,
  EXPORT:  5_000,
};

class DCCError extends Error {
  constructor(verdict, operation) {
    super(`DCC_UNSAT [${verdict}] op=${operation}`);
    this.verdict   = verdict;
    this.operation = operation;
  }
}

class CausalToken {
  #R;           // Uint8Array — fuzzy extractor stable output
  #vaultId;
  #issuedAt;
  #consumed;
  #txHash;      // string | null — SHA-256 of committed tx (SIGN only)

  constructor(R, vaultId, txHash = null) {
    this.#R        = R;
    this.#vaultId  = vaultId;
    this.#issuedAt = Date.now();
    this.#consumed = false;
    this.#txHash   = txHash;
  }

  age()            { return Date.now() - this.#issuedAt; }
  fresh(ttl)       { return !this.#consumed && this.age() < ttl; }
  R()              { return this.#R; }
  boundTo(vaultId) { return this.#vaultId === vaultId; }
  txHash()         { return this.#txHash; }

  consume() {
    if (this.#consumed) throw new DCCError('ALREADY_CONSUMED', 'consume');
    this.#consumed = true;
  }
}

class CausalChain {
  #token = null;

  /**
   * Called after a physical biometric event.
   * @param {Uint8Array}  R        — fuzzy extractor stable key
   * @param {string}      vaultId  — unique vault identifier
   * @param {string|null} txHash   — SHA-256 of committed tx (SIGN flow only)
   */
  issue(R, vaultId, txHash = null) {
    this.#token = new CausalToken(R, vaultId, txHash);
  }

  /**
   * Causal gate — verifies and consumes the token.
   * If any condition fails → DCCError (UNSAT).
   *
   * @param {string}      operation       — 'OPEN' | 'SIGN' | 'EXPORT'
   * @param {string}      vaultId         — the affected vault ID
   * @param {string|null} expectedTxHash  — for SIGN: SHA-256 of the tx being signed
   * @returns {Uint8Array} R              — on success (vault KDF input)
   */
  gate(operation, vaultId, expectedTxHash = null) {
    const ttl = TTL[operation];
    if (!ttl) throw new DCCError('UNKNOWN_OP', operation);

    // P1+P2: token exists and is fresh
    if (!this.#token || !this.#token.fresh(ttl)) {
      throw new DCCError(
        !this.#token ? 'NO_TOKEN' : 'EXPIRED',
        operation
      );
    }

    // P4: vault binding
    if (!this.#token.boundTo(vaultId)) {
      throw new DCCError('VAULT_ID_MISMATCH', operation);
    }

    // TX commitment check: if expectedTxHash provided, the token must be bound to the same tx.
    // null token.txHash() means commitTx() was never called → also fails (mismatch).
    if (expectedTxHash !== null && this.#token.txHash() !== expectedTxHash) {
      throw new DCCError('TX_MISMATCH', operation);
    }

    // P3: single-use (token inactive after consume)
    this.#token.consume();

    return this.#token.R();
  }

  /**
   * Immediate revocation — called after auto-lock (P7).
   */
  revoke() {
    this.#token = null;
  }

  /** State query (UI feedback, not security-critical) */
  status() {
    if (!this.#token) return { state: 'NO_TOKEN' };
    return {
      state: 'ACTIVE',
      age:   this.#token.age(),
      fresh: {
        OPEN:   this.#token.fresh(TTL.OPEN),
        SIGN:   this.#token.fresh(TTL.SIGN),
        EXPORT: this.#token.fresh(TTL.EXPORT),
      },
    };
  }
}

export { CausalChain, DCCError, TTL };
