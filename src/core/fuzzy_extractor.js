/**
 * BioWallet — Fuzzy Extractor (Phase 3)
 *
 * Phase 3: BCH szindróma kódolás — b_ref NEM tárolódik nyíltan P-ben
 *
 * Enrollment (fuzzyCommit):
 *   1. Projekció: b = sign(W·e), W = 256×128, AES-CTR seed-ből
 *   2. Szindróma: S = BCH_syndrome(b[0..254])  [50 bájt, 2·25 GF(2^8) elem]
 *   3. Kulcs: R = SHA-256(b)
 *   4. P = { W_seed, syndrome, extra_bit, salt, version: 'p3' }
 *
 * Recovery (fuzzyExtract):
 *   1. b_new = project(embedding_new, W)
 *   2. S_new = BCH_syndrome(b_new[0..254])
 *   3. S_err = S_new XOR S  (hibavektor szindróma)
 *   4. e = Chien(BM(S_err))  [hibahelyek, max BCH_T = 25 bit]
 *   5. b_ref = flip(b_new, e) ; b_ref[31] bit7 = extra_bit
 *   6. R = SHA-256(b_ref)
 *
 * BCH(255, 55, 25): 255-bites blokk, ≤25 bithiba javítható
 * extra_bit: bit 255 (BCH hatókörén kívüli utolsó bit) tárolt értéke
 *
 * Phase 2 → Phase 3 migráció: p2 vaultok a régi b_ref-alapú úton működnek.
 */

const PROJ_DIM  = 256;
const EMBED_DIM = 128;

// ── GF(2^8) ──────────────────────────────────────────────────────────────────
// Primitív polinom: x^8 + x^4 + x^3 + x^2 + 1 = 0x11D

const BCH_N  = 255;
const BCH_T  = 25;
const _PRIM  = 0x11D;

const _EXP = new Uint8Array(512);
const _LOG = new Int16Array(256);   // Int16: _LOG[0] = -1

(function _gfInit() {
  _LOG[0] = -1;
  let x = 1;
  for (let i = 0; i < 255; i++) {
    _EXP[i] = x;  _LOG[x] = i;
    x = ((x << 1) ^ (x & 0x80 ? _PRIM : 0)) & 0xFF;
  }
  for (let i = 255; i < 512; i++) _EXP[i] = _EXP[i - 255];
})();

const gfMul = (a, b) => (a && b) ? _EXP[_LOG[a] + _LOG[b]] : 0;
const gfInv = (a)    => _EXP[255 - _LOG[a]];

// ── BCH szindróma ─────────────────────────────────────────────────────────────

/**
 * Kiszámolja S_1..S_{2t} szindrómákat a 32 bájtos szó első 255 bitjéből.
 * S_i = Σ_{j=0}^{254} bit_j · α^{i·j}   (GF(2^8)-ban)
 */
function _bchSyndrome(bits32) {
  const S = new Uint8Array(2 * BCH_T);
  for (let i = 1; i <= 2 * BCH_T; i++) {
    let s = 0, pow = 1;
    const ai = _EXP[i];    // α^i  (i ≤ 50 < 255, mindig érvényes)
    for (let j = 0; j < 255; j++) {
      if ((bits32[j >> 3] >> (j & 7)) & 1) s ^= pow;
      pow = gfMul(pow, ai);
    }
    S[i - 1] = s;
  }
  return S;
}

// ── Berlekamp–Massey ──────────────────────────────────────────────────────────

/**
 * Szindrómák → hibalokalátor polinom σ(x).
 * Visszatér: C tömbként, C[0]=1, C[1..L]=σ_1..σ_L
 */
function _berlekampMassey(S) {
  let C = [1], B = [1], L = 0, m = 1, b = 1;

  for (let r = 0; r < S.length; r++) {
    // Eltérés: δ = S_r + Σ_{i=1}^{L} C_i · S_{r-i}
    let d = S[r];
    for (let i = 1; i < C.length && i <= r; i++) d ^= gfMul(C[i], S[r - i]);

    if (d === 0) { m++; continue; }

    const T  = C.slice();
    const co = gfMul(d, gfInv(b));
    while (C.length < B.length + m) C.push(0);
    for (let i = 0; i < B.length; i++) C[i + m] ^= gfMul(co, B[i]);

    if (2 * L <= r) { L = r + 1 - L; B = T; b = d; m = 1; }
    else m++;
  }
  return C;
}

// ── Chien keresés ─────────────────────────────────────────────────────────────

/**
 * Megkeresi σ(x) gyökeit: σ(α^{-j}) = 0 → j pozíción bithiba.
 */
function _chienSearch(sigma) {
  const positions = [];
  for (let j = 0; j < BCH_N; j++) {
    const xinv = j ? _EXP[255 - j] : 1;   // α^{-j}
    let val = 0, xp = 1;
    for (let k = 0; k < sigma.length; k++) {
      val ^= gfMul(sigma[k] || 0, xp);
      xp = gfMul(xp, xinv);
    }
    if (val === 0) positions.push(j);
  }
  return positions;
}

// ── BCH dekódolás ─────────────────────────────────────────────────────────────

/**
 * BCH dekódolás: b_new + tárolt szindróma → javított b_ref (32 bájt).
 * @throws ha a hibák száma meghaladja BCH_T-t
 */
function _bchDecode(bNew32, storedS) {
  const S_new = _bchSyndrome(bNew32);
  const S_err = new Uint8Array(2 * BCH_T);
  for (let i = 0; i < 2 * BCH_T; i++) S_err[i] = S_new[i] ^ storedS[i];

  // Ha szindróma nulla: nincs hiba, az első 255 bit tökéletes egyezés
  if (S_err.every(v => v === 0)) return bNew32.slice();

  const sigma  = _berlekampMassey(S_err);
  const numErr = sigma.length - 1;
  if (numErr > BCH_T) {
    throw new Error(`${numErr} bithiba > ${BCH_T} javítható limit`);
  }

  const errPos = _chienSearch(sigma);
  if (errPos.length !== numErr) {
    throw new Error('szindróma/gyök eltérés — valószínűleg több hiba mint BCH_T');
  }

  const out = bNew32.slice();
  for (const p of errPos) out[p >> 3] ^= 1 << (p & 7);
  return out;
}

// ── Projekció ─────────────────────────────────────────────────────────────────

async function buildProjection(seed) {
  const hkdfKey = await crypto.subtle.importKey('raw', seed, 'HKDF', false, ['deriveBits']);
  const rawKey  = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new Uint8Array(0) },
    hkdfKey, 256
  );
  const aesKey   = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-CTR' }, false, ['encrypt']);
  const byteCount = PROJ_DIM * EMBED_DIM;
  const ks = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-CTR', counter: new Uint8Array(16), length: 64 },
    aesKey, new Uint8Array(byteCount)
  ));
  const W = new Float32Array(byteCount);
  for (let i = 0; i < byteCount; i++) W[i] = (ks[i] - 127.5) / 127.5;
  return W;
}

function project(embedding, W) {
  const bits = new Uint8Array(Math.ceil(PROJ_DIM / 8));
  for (let i = 0; i < PROJ_DIM; i++) {
    let dot = 0;
    for (let j = 0; j < EMBED_DIM; j++) dot += W[i * EMBED_DIM + j] * embedding[j];
    if (dot >= 0) bits[i >> 3] |= 1 << (i & 7);
  }
  return bits;
}

// ── Hamming (Phase 2 kompatibilitás) ─────────────────────────────────────────

function hammingDistance(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    let x = a[i] ^ b[i];
    while (x) { n += x & 1; x >>>= 1; }
  }
  return n;
}

// ── Utils ─────────────────────────────────────────────────────────────────────

const toHex   = b => Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
const fromHex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));

// ── Publikus API ──────────────────────────────────────────────────────────────

/**
 * Enrollment: face embedding → (R, P)
 * @param {Float32Array} embedding  — 5 scan átlaga (128-dim FaceNet)
 * @returns {{ R: Uint8Array, P: object }}
 */
export async function fuzzyCommit(embedding) {
  const W_seed = crypto.getRandomValues(new Uint8Array(32));
  const W      = await buildProjection(W_seed);
  const b      = project(embedding, W);           // 32 bájt, 256 bit
  const R      = new Uint8Array(await crypto.subtle.digest('SHA-256', b));

  // BCH szindróma: 50 bájt (S_1..S_{50}), NEM tárolja b-t nyíltan
  const syndrome  = _bchSyndrome(b);
  // Bit 255 a BCH hatókörén (0..254) kívül esik — külön tároljuk (1 bit szivárgás, Z3-ban jelölve)
  const extra_bit = (b[31] >> 7) & 1;

  return {
    R,
    P: {
      W_seed:    toHex(W_seed),
      syndrome:  toHex(syndrome),
      extra_bit,
      version:   'p3',
    },
  };
}

/**
 * Recovery: friss embedding + P → R
 * @param {Float32Array} embedding
 * @param {object}       P  — { W_seed, syndrome, extra_bit, salt, version }
 * @returns {Uint8Array} R
 */
export async function fuzzyExtract(embedding, P) {
  if (P.version === 'p1') {
    throw new Error('Régi (p1) vault formátum — hozzon létre új walletot a jobb biztonsági szinthez.');
  }
  if (P.version === 'p2') {
    return _extractV2(embedding, P);
  }

  const W_seed  = fromHex(P.W_seed);
  const storedS = fromHex(P.syndrome);
  const W       = await buildProjection(W_seed);
  const b_new   = project(embedding, W);

  let b_ref;
  try {
    b_ref = _bchDecode(b_new, storedS);
  } catch (e) {
    throw new Error(
      `FE_DECODE_FAIL: BCH ${e.message} — próbáljon jobb megvilágításban, egyenes tartásban`
    );
  }

  // Bit 255 visszaállítása a tárolt értékből (BCH csak 0..254-et fed le)
  b_ref[31] = (b_ref[31] & 0x7F) | (P.extra_bit << 7);

  return new Uint8Array(await crypto.subtle.digest('SHA-256', b_ref));
}

// ── Determinisztikus genesis extractor (fixed W_seed = 0x00…00) ─────────────
// R_genesis = SHA-256(project(embedding, fixed_W)) — determinisztikus, ha az arc azonos.
// genesisS + genesisExtraBit a P fájlban tárolódik (nem a vault JSON-ban).
// Lehetővé teszi: arc + P fájl → 24 szó (vault fájl nélkül is, ha genesis_backup jelen van).

const GENESIS_W_SEED = new Uint8Array(32); // all-zeros; nyilvános konstans, nem titok
let _genesisW = null;

async function _getGenesisW() {
  if (!_genesisW) _genesisW = await buildProjection(GENESIS_W_SEED);
  return _genesisW;
}

export async function fuzzyCommitDeterministic(embedding) {
  const W         = await _getGenesisW();
  const b         = project(embedding, W);
  const R         = new Uint8Array(await crypto.subtle.digest('SHA-256', b));
  const syndrome  = _bchSyndrome(b);
  const extra_bit = (b[31] >> 7) & 1;
  return { R, genesisS: toHex(syndrome), genesisExtraBit: extra_bit };
}

export async function fuzzyExtractDeterministic(embedding, genesisS, genesisExtraBit) {
  const W     = await _getGenesisW();
  const b_new = project(embedding, W);
  let b_ref;
  try {
    b_ref = _bchDecode(b_new, fromHex(genesisS));
  } catch (e) {
    throw new Error(`GENESIS_DECODE_FAIL: ${e.message}`);
  }
  b_ref[31] = (b_ref[31] & 0x7F) | (genesisExtraBit << 7);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', b_ref));
}

// ── Phase 2 kompatibilitás ────────────────────────────────────────────────────

async function _extractV2(embedding, P) {
  const W_seed = fromHex(P.W_seed);
  const b_ref  = fromHex(P.b_ref);
  const W      = await buildProjection(W_seed);
  const b_new  = project(embedding, W);

  const errors = hammingDistance(b_ref, b_new);
  if (errors > 30) {
    throw new Error(
      `FE_DECODE_FAIL: ${errors}/256 bit hiba (limit: 30) — próbáljon jobb megvilágításban, egyenes tartásban`
    );
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', b_ref));
}
