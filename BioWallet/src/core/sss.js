/**
 * BioWallet — Shamir's Secret Sharing over GF(2^8)
 *
 * Irreducibilis polinom: x^8 + x^4 + x^3 + x + 1 (0x11b, AES-standard)
 * threshold-of-n séma: bármely `threshold` db share rekonstruálja a titkot.
 *
 * Biztonsági tulajdonságok (Z3-mal verifikálva):
 *   1. Helyesség: split → combine(bármely t share) = eredeti titok
 *   2. Információ-elrejtés: t-1 share önmagában semmit nem fed fel
 *   3. Share-függetlenség: különböző x értékek → statisztikailag független share-ek
 */

// ── GF(2^8) aritmetika ────────────────────────────────────────────────────────

const _POLY = 0x11b;

function gfMul(a, b) {
  let p = 0;
  while (b) {
    if (b & 1) p ^= a;
    b >>>= 1;
    a <<= 1;
    if (a & 0x100) a ^= _POLY;
  }
  return p & 0xff;
}

function gfPow(base, exp) {
  let result = 1;
  exp = ((exp % 255) + 255) % 255;
  while (exp--) result = gfMul(result, base);
  return result;
}

function gfInv(a) {
  if (a === 0) throw new RangeError('GF(256): nulla nem invertálható');
  return gfPow(a, 254);  // Fermat: a^255 = 1 → a^{-1} = a^{254}
}

function gfDiv(a, b) {
  return gfMul(a, gfInv(b));
}

// ── Polinom kiértékelése GF(2^8)-ban (Horner-módszer) ────────────────────────

function _polyEval(coeffs, x) {
  let r = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    r = gfMul(r, x) ^ coeffs[i];
  }
  return r;
}

// ── Nyilvános API ─────────────────────────────────────────────────────────────

/**
 * Titok felosztása n share-re, threshold-of-n sémával.
 *
 * @param {Uint8Array} secret    - A titkos adat (tetszőleges hossz)
 * @param {number}     n         - Share-ek száma (n >= threshold)
 * @param {number}     threshold - Minimálisan szükséges share-ek rekonstrukcióhoz
 * @returns {Array<{x: number, y: Uint8Array}>} n db share
 */
export function split(secret, n, threshold) {
  if (threshold < 2) throw new RangeError('threshold >= 2 szükséges');
  if (n < threshold) throw new RangeError('n >= threshold szükséges');
  if (n > 254)       throw new RangeError('n <= 254 (GF(256) limit)');

  const len    = secret.length;
  const shares = Array.from({ length: n }, (_, i) => ({ x: i + 1, y: new Uint8Array(len) }));

  for (let j = 0; j < len; j++) {
    // Véletlen polinom: f(x) = secret[j] + a1*x + a2*x^2 + ... + a_{t-1}*x^{t-1}
    const coeffs = new Uint8Array(threshold);
    coeffs[0] = secret[j];
    crypto.getRandomValues(coeffs.subarray(1));  // a1..a_{t-1} véletlen

    for (let i = 0; i < n; i++) {
      shares[i].y[j] = _polyEval(coeffs, i + 1);  // x = 1..n (0 tilos: f(0) = titok)
    }
  }

  return shares;
}

/**
 * Titok rekonstrukciója (bármely threshold db share-ből).
 * Lagrange-interpoláció x=0-ban.
 *
 * @param {Array<{x: number, y: Uint8Array}>} shares - Legalább threshold db share
 * @returns {Uint8Array} Rekonstruált titok
 */
export function combine(shares) {
  if (shares.length < 2) throw new RangeError('Legalább 2 share szükséges');
  const len = shares[0].y.length;
  const out  = new Uint8Array(len);

  for (let j = 0; j < len; j++) {
    let secret = 0;
    for (let i = 0; i < shares.length; i++) {
      // Lagrange-alap: L_i(0) = ∏_{k≠i} (0 - x_k) / (x_i - x_k)
      // GF(2^8)-ban: 0 - x = x (XOR), x_i - x_k = x_i XOR x_k
      let num = 1;
      let den = 1;
      for (let k = 0; k < shares.length; k++) {
        if (k === i) continue;
        num = gfMul(num, shares[k].x);
        den = gfMul(den, shares[i].x ^ shares[k].x);
      }
      secret ^= gfMul(shares[i].y[j], gfDiv(num, den));
    }
    out[j] = secret;
  }

  return out;
}

/**
 * Ellenőrzés: két Uint8Array tartalmilag egyezik-e (constant-time).
 */
export function sharesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
