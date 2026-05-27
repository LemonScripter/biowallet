/**
 * BioWallet — DCC Kauzális Lánc
 *
 * Minden érzékeny művelet előfeltétele: érvényes causal_token.
 * Token csak fizikai biometriai esemény után létezik.
 * Token egyszeri felhasználású (TOCTOU zárás).
 * Token vault-kötött (nem vihető át másik wallethez).
 *
 * Megfelel: biowallet.bio invariánsai P1–P7
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
  #R;           // Uint8Array — fuzzy extractor stabil kimenete
  #vaultId;
  #issuedAt;
  #consumed;

  constructor(R, vaultId) {
    this.#R        = R;
    this.#vaultId  = vaultId;
    this.#issuedAt = Date.now();
    this.#consumed = false;
  }

  age()            { return Date.now() - this.#issuedAt; }
  fresh(ttl)       { return !this.#consumed && this.age() < ttl; }
  R()              { return this.#R; }
  boundTo(vaultId) { return this.#vaultId === vaultId; }

  consume() {
    if (this.#consumed) throw new DCCError('ALREADY_CONSUMED', 'consume');
    this.#consumed = true;
  }
}

class CausalChain {
  #token = null;

  /**
   * Fizikai biometriai esemény után hívódik.
   * @param {Uint8Array} R        — fuzzy extractor stabil kulcsa
   * @param {string}     vaultId  — vault egyedi azonosítója
   */
  issue(R, vaultId) {
    this.#token = new CausalToken(R, vaultId);
  }

  /**
   * Kauzális kapu — ellenőrzi és felhasználja a tokent.
   * Ha bármely feltétel nem teljesül → DCCError (UNSAT).
   *
   * @param {string} operation  — 'OPEN' | 'SIGN' | 'EXPORT'
   * @param {string} vaultId    — az érintett vault ID-ja
   * @returns {Uint8Array} R    — sikeres ellenőrzés esetén (vault KDF inputja)
   */
  gate(operation, vaultId) {
    const ttl = TTL[operation];
    if (!ttl) throw new DCCError('UNKNOWN_OP', operation);

    // P1+P2: token létezik és friss
    if (!this.#token || !this.#token.fresh(ttl)) {
      throw new DCCError(
        !this.#token ? 'NO_TOKEN' : 'EXPIRED',
        operation
      );
    }

    // P4: vault-kötöttség
    if (!this.#token.boundTo(vaultId)) {
      throw new DCCError('VAULT_ID_MISMATCH', operation);
    }

    // P3: egyszeri felhasználás (consume után token inaktív)
    this.#token.consume();

    return this.#token.R();
  }

  /**
   * Azonnali revokálás — auto-lock után hívódik (P7).
   */
  revoke() {
    this.#token = null;
  }

  /** Állapot-lekérdezés (UI feedback, nem biztonság-kritikus) */
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
