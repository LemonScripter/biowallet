#!/usr/bin/env node
/**
 * BCH(255, 55, 25) — algoritmus egységtesztek
 *
 * Futtatás: node tests/test_bch.js
 * Követelmény: Node.js 18+, nincs külső függőség
 *
 * Teszteli:
 *   - GF(2^8) aritmetika helyessége
 *   - Szindróma linearitás: S(a XOR b) = S(a) XOR S(b)
 *   - Dekódolás 0, 1, 5, 10, 20, 25 hibával → helyes helyreállítás
 *   - Dekódolás 26 hibával → hibás vagy exception (BCH kapacitáson túl)
 *   - Teljes kör: szindróma mentés → hiba beleszúrás → visszaállítás
 */

'use strict';

// ── GF(2^8) — azonos implementáció mint fuzzy_extractor.js ───────────────────

const BCH_N  = 255;
const BCH_T  = 25;
const _PRIM  = 0x11D;  // x^8 + x^4 + x^3 + x^2 + 1

const _EXP = new Uint8Array(512);
const _LOG = new Int16Array(256);

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

function _bchSyndrome(bits32) {
  const S = new Uint8Array(2 * BCH_T);
  for (let i = 1; i <= 2 * BCH_T; i++) {
    let s = 0, pow = 1;
    const ai = _EXP[i];
    for (let j = 0; j < 255; j++) {
      if ((bits32[j >> 3] >> (j & 7)) & 1) s ^= pow;
      pow = gfMul(pow, ai);
    }
    S[i - 1] = s;
  }
  return S;
}

function _berlekampMassey(S) {
  let C = [1], B = [1], L = 0, m = 1, b = 1;
  for (let r = 0; r < S.length; r++) {
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

function _chienSearch(sigma) {
  const positions = [];
  for (let j = 0; j < BCH_N; j++) {
    const xinv = j ? _EXP[255 - j] : 1;
    let val = 0, xp = 1;
    for (let k = 0; k < sigma.length; k++) {
      val ^= gfMul(sigma[k] || 0, xp);
      xp = gfMul(xp, xinv);
    }
    if (val === 0) positions.push(j);
  }
  return positions;
}

function bchDecode(bNew32, storedS) {
  const S_new = _bchSyndrome(bNew32);
  const S_err = new Uint8Array(2 * BCH_T);
  for (let i = 0; i < 2 * BCH_T; i++) S_err[i] = S_new[i] ^ storedS[i];
  if (S_err.every(v => v === 0)) return bNew32.slice();
  const sigma  = _berlekampMassey(S_err);
  const numErr = sigma.length - 1;
  if (numErr > BCH_T) throw new Error(`BCH limit: ${numErr} > ${BCH_T}`);
  const errPos = _chienSearch(sigma);
  if (errPos.length !== numErr) throw new Error('szindróma/gyök eltérés');
  const out = bNew32.slice();
  for (const p of errPos) out[p >> 3] ^= 1 << (p & 7);
  return out;
}

// ── Teszt segédek ─────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function assert(name, ok) {
  if (ok) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.error(`  FAIL  ${name}`);
    failed++;
  }
}

function equal(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// Determinisztikus "véletlen" a reprodukálhatóságért (LCG)
let _seed = 0xDEADBEEF;
function rng() {
  _seed = (Math.imul(_seed, 1664525) + 1013904223) >>> 0;
  return _seed;
}

function randomBytes32() {
  const b = new Uint8Array(32);
  for (let i = 0; i < 32; i++) b[i] = rng() & 0xFF;
  b[31] &= 0x7F;  // bit 255 = 0, csak 0..254 a BCH tartomány
  return b;
}

// Beleszúr pontosan `count` bitet a 0..254 tartományba (nincs ismétlés)
function flipBits(b, count) {
  const result = b.slice();
  const chosen = new Set();
  while (chosen.size < count) chosen.add(rng() % 255);
  for (const p of chosen) result[p >> 3] ^= 1 << (p & 7);
  return result;
}

// ═══════════════════════════════════════════════════════════════
console.log('═'.repeat(56));
console.log('BioWallet — BCH(255, 55, 25) Egységtesztek');
console.log('═'.repeat(56));

// ── 1. GF(2^8) aritmetika ─────────────────────────────────────

console.log('\n── GF(2^8) aritmetika ─────────────────────────────────');

assert('alpha^0 = 1',                      _EXP[0] === 1);
assert('alpha^1 = 2',                      _EXP[1] === 2);
assert('alpha^7 = 128',                    _EXP[7] === 128);
assert('alpha^8 = 0x1D = 29  (redukció)', _EXP[8] === 0x1D);
assert('alpha^254 * alpha = 1  (rend)',    gfMul(_EXP[254], _EXP[1]) === 1);
assert('gfMul(a, gfInv(a)) = 1  (inv)',   gfMul(173, gfInv(173)) === 1);
assert('gfMul(0, x) = 0',                 gfMul(0, 255) === 0);
assert('alpha^255 = alpha^0 = 1  (kör)',  _EXP[255] === _EXP[0]);
assert('LOG táblázat inverze EXP-nek',    _EXP[_LOG[200]] === 200);

// Fermat-tétel: a^255 = 1 minden a≠0 esetén
{
  let ok = true;
  for (const a of [1, 17, 83, 127, 200, 254]) {
    let x = 1;
    for (let i = 0; i < 255; i++) x = gfMul(x, a);
    if (x !== 1) { ok = false; break; }
  }
  assert('Fermat: a^255 = 1 minden a≠0 esetén', ok);
}

// ── 2. Szindróma tulajdonságok ────────────────────────────────

console.log('\n── BCH szindróma ───────────────────────────────────────');

const zero32 = new Uint8Array(32);
assert('S(0) = csupa nulla', _bchSyndrome(zero32).every(v => v === 0));

// Linearitás: S(a XOR b) = S(a) XOR S(b)
for (let iter = 0; iter < 5; iter++) {
  const a = randomBytes32(), b = randomBytes32();
  const Sa = _bchSyndrome(a);
  const Sb = _bchSyndrome(b);
  const axb = Uint8Array.from(a.map((v, i) => v ^ b[i]));
  const Sxor   = Uint8Array.from(Sa.map((v, i) => v ^ Sb[i]));
  const Sdirect = _bchSyndrome(axb);
  assert(`Linearitás iter=${iter}: S(a⊕b) = S(a)⊕S(b)`, equal(Sxor, Sdirect));
}

// Két különböző szónak különböző szindróma (nagyon nagy valószínűséggel)
{
  const a = randomBytes32(), b = randomBytes32();
  assert('Különböző szavak szindrómája különbözik', !equal(_bchSyndrome(a), _bchSyndrome(b)));
}

// ── 3. BCH dekódolás — hibajavítás ────────────────────────────

console.log('\n── BCH dekódolás: hibajavítás ──────────────────────────');

const errorTests = [
  [0,  'nulla hiba — azonos szó'],
  [1,  '1 bithiba'],
  [5,  '5 bithiba'],
  [10, '10 bithiba'],
  [20, '20 bithiba'],
  [25, '25 bithiba  (BCH_T határ)'],
];

for (const [errCount, label] of errorTests) {
  let allOk = true;
  for (let iter = 0; iter < 8; iter++) {
    const orig  = randomBytes32();
    const S     = _bchSyndrome(orig);
    const noisy = errCount === 0 ? orig.slice() : flipBits(orig, errCount);
    try {
      const fixed = bchDecode(noisy, S);
      if (!equal(fixed, orig)) { allOk = false; break; }
    } catch {
      allOk = false; break;
    }
  }
  assert(`${label} (8 iteráció)`, allOk);
}

// ── 4. BCH_T + 1 = 26 hiba — korlát bizonyítás ───────────────

console.log('\n── BCH_T+1 = 26 hiba: dekódolás megszakad ──────────────');

{
  let failCount = 0;
  for (let iter = 0; iter < 20; iter++) {
    const orig  = randomBytes32();
    const S     = _bchSyndrome(orig);
    const noisy = flipBits(orig, 26);
    try {
      const fixed = bchDecode(noisy, S);
      if (!equal(fixed, orig)) failCount++;
    } catch {
      failCount++;
    }
  }
  assert(`26 hiba: ${failCount}/20 iterációban hibás vagy exception`, failCount > 0);
  console.log(`       (${failCount}/20 esetben dekódolás meghiúsult — BCH kapacitáson túl)`);
}

// ── 5. Teljes kör teszt ───────────────────────────────────────

console.log('\n── Teljes kör: szindróma → hiba → visszaállítás ────────');

{
  // Szimuláció: 5 különböző vektoron, 15–25 hibával
  let allOk = true;
  for (let iter = 0; iter < 5; iter++) {
    const b_ref = randomBytes32();
    const syndrome = _bchSyndrome(b_ref);

    const errCount = 15 + (iter * 2);  // 15, 17, 19, 21, 23
    const b_new    = flipBits(b_ref, errCount);

    let b_recovered;
    try {
      b_recovered = bchDecode(b_new, syndrome);
    } catch (e) {
      console.error(`    iter=${iter}, ${errCount} hiba: ${e.message}`);
      allOk = false;
      continue;
    }

    if (!equal(b_recovered, b_ref)) {
      console.error(`    iter=${iter}, ${errCount} hiba: helyreállítás HIBÁS`);
      allOk = false;
    } else {
      console.log(`    iter=${iter}: ${errCount} hiba javítva ✓`);
    }
  }
  assert('Teljes kör (15–23 hiba, 5 iteráció) — minden sikeres', allOk);
}

// ── 6. Szindróma méret ────────────────────────────────────────

console.log('\n── Szindróma struktúra ─────────────────────────────────');

{
  const orig = randomBytes32();
  const S = _bchSyndrome(orig);
  assert(`Szindróma mérete = 2·BCH_T = ${2 * BCH_T} bájt`, S.length === 2 * BCH_T);
  assert('Szindróma bájt tartomány [0..255]', S.every(v => v >= 0 && v <= 255));
  // Ha orig = 0, szindróma = 0
  const S0 = _bchSyndrome(new Uint8Array(32));
  assert('Nullvektor szindróma = csupa nulla', S0.every(v => v === 0));
}

// ── Összesítés ────────────────────────────────────────────────

console.log('\n' + '═'.repeat(56));
console.log(`Összesített: ${passed}/${passed + failed} PASS`);
if (failed === 0) {
  console.log('BCH(255, 55, 25) — MINDEN TESZT SIKERES ✓');
  console.log('═'.repeat(56));
} else {
  console.error(`FIGYELEM: ${failed} teszt SIKERTELEN!`);
  console.log('═'.repeat(56));
  process.exit(1);
}
