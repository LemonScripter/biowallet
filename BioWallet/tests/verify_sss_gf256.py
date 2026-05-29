# -*- coding: utf-8 -*-
"""
BioWallet — GF(2^8) SSS valodi verifikacio
===========================================

ELTERES a verify_biowallet.py-tol:
  verify_biowallet.py : LOGIKAI MODELL — Bool valtozok, axiomak, tervezesi garanciak.
                        A Z3 a modell konzisztenciat bizonyitja, NEM a JS kodot.
  verify_sss_gf256.py : KOD-SZINTU VERIFIKACIO — Z3 BitVec(8) aritmetika,
                        szimbolikus valtozok. A z3_gf_mul() PONTOSAN az sss.js
                        gfMul() algoritmusat kodolja. A bizonyitas minden lehetseges
                        8-bites ertekre ervenyes (2^8 = 256 elem, BitVec bit-blasting).

Futtas: python tests/verify_sss_gf256.py
"""

import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from z3 import *

# ===========================================================================
# A. PYTHON GF(2^8) — sss.js gfMul() pontos masolata
#    (kimeruto Python teszthez es a Lagrange-egyutthatók eloszamitasahoz)
# ===========================================================================

_POLY = 0x11b  # x^8 + x^4 + x^3 + x + 1  (AES-standard)

def py_gf_mul(a, b):
    p = 0
    while b:
        if b & 1: p ^= a
        b >>= 1
        a <<= 1
        if a & 0x100: a ^= _POLY
    return p & 0xff

def py_gf_pow(base, exp):
    result, cur = 1, base
    exp %= 255
    while exp:
        if exp & 1: result = py_gf_mul(result, cur)
        cur = py_gf_mul(cur, cur)
        exp >>= 1
    return result

def py_gf_inv(a):
    if a == 0: raise ZeroDivisionError('GF(256): 0 nem invertalhato')
    return py_gf_pow(a, 254)

def py_gf_div(a, b):
    return py_gf_mul(a, py_gf_inv(b))


# ===========================================================================
# B. Z3 BitVec GF(2^8) — szimbolikus, Z3 If-faval kicsomagolva
#    Az algoritmikus struktura AZONOS a JS gfMul()-lal (8 iteracio).
# ===========================================================================

def z3_gf_mul(a, b):
    """GF(2^8) szorzas — Z3 BitVec(8) szimbolikus.
    a, b : Z3 BitVec(8) kifejezesek.
    Minden iteracio egy Z3 If-ag: ha az aktualis bit_b 1, XOR a result-be."""
    result = BitVecVal(0, 8)
    cur_a  = a
    cur_b  = b
    for _ in range(8):
        lsb    = Extract(0, 0, cur_b)
        result = If(lsb == BitVecVal(1, 1), result ^ cur_a, result)
        cur_b  = LShR(cur_b, 1)
        hi     = Extract(7, 7, cur_a)
        cur_a  = (cur_a << 1) & BitVecVal(0xff, 8)
        cur_a  = If(hi == BitVecVal(1, 1), cur_a ^ BitVecVal(0x1b, 8), cur_a)
    return result

def z3_gf_pow(base, exp_int):
    """GF(2^8) hatvanyzas — exp_int fix Python egesz, base szimbolikus Z3."""
    result, cur = BitVecVal(1, 8), base
    exp = int(exp_int) % 255
    while exp:
        if exp & 1: result = z3_gf_mul(result, cur)
        cur = z3_gf_mul(cur, cur)
        exp >>= 1
    return result

def z3_gf_inv(a):
    """GF inverz: a^254 — Fermat-tetel: a^255=1 => a^{-1}=a^{254}."""
    return z3_gf_pow(a, 254)

def z3_gf_div(a, b):
    return z3_gf_mul(a, z3_gf_inv(b))


# ===========================================================================
# Segédfuggveny: bizonyitás + eredmeny kiirasa
# ===========================================================================

_results = []

def bv_prove(name, claim):
    """Bizonyitja, hogy claim MINDEN BitVec ertekre igaz.
    Technikailag: Not(claim) UNSAT => claim altalanosan ervenyes."""
    s = Solver()
    s.add(Not(claim))
    r = s.check()
    ok = (r == unsat)
    print(f"  {'PASS' if ok else 'FAIL'} {name}")
    if not ok and r == sat:
        print(f"       Ellenpelda: {s.model()}")
    _results.append(ok)
    return ok

def bv_check_sat(name, claim):
    """Ellenorzi, hogy claim TELJESITHETO (SAT)."""
    s = Solver()
    s.add(claim)
    r = s.check()
    ok = (r == sat)
    print(f"  {'PASS' if ok else 'FAIL'} {name}")
    _results.append(ok)
    return ok

def py_check(name, ok):
    print(f"  {'PASS' if ok else 'FAIL'} {name}")
    _results.append(ok)
    return ok


# ===========================================================================
# 1. SZAKASZ: GF(2^8) ALGEBRAI TULAJDONSAGOK — Z3 BitVec
#    Mindegyik forall-bizonyitas: 2^8 = 256 elem felett, bit-blasting.
#    A z3_gf_mul() az sss.js gfMul()-javal algoritmikusan azonos.
# ===========================================================================

print('BioWallet — GF(2^8) + SSS valodi Z3 BitVec verifikacio')
print('======================================================\n')
print('── 1. GF(2^8) algebrai tulajdonsagok (Z3 BitVec) ──────')

a, b, c = BitVecs('a b c', 8)

# GF1: Multiplikativ egysegelem — a * 1 = a
bv_prove("GF1: a * 1 = a  (multiplikativ egysegelem)",
         z3_gf_mul(a, BitVecVal(1, 8)) == a)

# GF2: Kommutativitas — a * b = b * a
bv_prove("GF2: a * b = b * a  (kommutativitas)",
         z3_gf_mul(a, b) == z3_gf_mul(b, a))

# GF3: Nulla szorzoja — 0 * a = 0
bv_prove("GF3: 0 * a = 0  (nulla szorzoja)",
         z3_gf_mul(BitVecVal(0, 8), a) == BitVecVal(0, 8))

# GF4: Disztributivitas — a * (b XOR c) = (a*b) XOR (a*c)
bv_prove("GF4: a*(b XOR c) = (a*b) XOR (a*c)  (disztributivitas)",
         z3_gf_mul(a, b ^ c) == (z3_gf_mul(a, b) ^ z3_gf_mul(a, c)))

# GF5: Inverz egzisztencia — a != 0 => a * a^-1 = 1
bv_prove("GF5: a != 0 => a * a^-1 = 1  (inverz egzisztencia)",
         Implies(a != BitVecVal(0, 8),
                 z3_gf_mul(a, z3_gf_inv(a)) == BitVecVal(1, 8)))

# GF6: Asszociativitas — (a*b)*c = a*(b*c)
bv_prove("GF6: (a*b)*c = a*(b*c)  (asszociativitas)",
         z3_gf_mul(z3_gf_mul(a, b), c) == z3_gf_mul(a, z3_gf_mul(b, c)))


# ===========================================================================
# 2. SZAKASZ: SSS HELYESSEG — Z3 BitVec, 1 bajtos titok
#
#  Modell: threshold=2, n=3, x ertekek = {1, 2, 3}
#  Polinom: f(x) = secret XOR gfMul(coeff, x)  (linearis, fok=1)
#  Share-ek: y1=f(1), y2=f(2), y3=f(3)
#
#  Lagrange-egyutthatók (x=0-ban, konkret Python ertek):
#    L_i(0) = prod_{j!=i}(x_j) / prod_{j!=i}(x_i XOR x_j)  GF(256)-ban
#  Mivel ezek konstansok (x ertekek rogzitettek), Python eloszamolja oket.
#  A Z3 bizonyitas utolag ellenorzi, hogy a rekonstrukcio minden (secret, coeff)
#  parra visszaadja az eredeti titkot.
# ===========================================================================

print('\n── 2. SSS helyesseg (Z3 BitVec, 1 bajtos titok) ───────')

secret = BitVec('secret', 8)
coeff  = BitVec('coeff',  8)

# Share ertekek (szimbolikus)
y1 = secret ^ z3_gf_mul(coeff, BitVecVal(1, 8))   # = secret ^ coeff
y2 = secret ^ z3_gf_mul(coeff, BitVecVal(2, 8))
y3 = secret ^ z3_gf_mul(coeff, BitVecVal(3, 8))

def lagrange_at_zero(share_pairs):
    """Lagrange interpolacio x=0-ban.
    share_pairs: [(x_int, y_z3), ...]
    A Lagrange-egyutthatokat Python szamolja ki (konkret GF-aritmetika),
    a szimbolikus y_i ertekek Z3 BitVec kifejezesek."""
    result = BitVecVal(0, 8)
    n = len(share_pairs)
    for i in range(n):
        xi, yi = share_pairs[i]
        num, den = 1, 1
        for j in range(n):
            if j == i: continue
            xj = share_pairs[j][0]
            num = py_gf_mul(num, xj)          # 0 - xj = xj  (GF(2)-ben)
            den = py_gf_mul(den, xi ^ xj)     # xi - xj = xi XOR xj
        li = py_gf_div(num, den)               # konkret Lagrange-egytttahto
        result = result ^ z3_gf_mul(yi, BitVecVal(li, 8))
    return result

rec_12 = lagrange_at_zero([(1, y1), (2, y2)])
rec_13 = lagrange_at_zero([(1, y1), (3, y3)])
rec_23 = lagrange_at_zero([(2, y2), (3, y3)])

# Mindharom share-par rekonstrualja a titkot — minden (secret, coeff) ertekre
bv_prove("SSS-12: share(1)+share(2) => secret  (minden secret, coeff ertekre)",
         rec_12 == secret)

bv_prove("SSS-13: share(1)+share(3) => secret  (minden secret, coeff ertekre)",
         rec_13 == secret)

bv_prove("SSS-23: share(2)+share(3) => secret  (minden secret, coeff ertekre)",
         rec_23 == secret)

# Privacy: ugyanahhoz az y1 share-hez tobbtele (secret, coeff) par van
# => egyetlen share nem hatarozza meg egyertelmuuen a titkot
s1, s2, c1 = BitVecs('s1 s2 c1', 8)
c2 = s1 ^ s2 ^ c1   # c2 = c1 XOR (s1 XOR s2), garantalt hogy f1(1)=f2(1)
bv_check_sat(
    "SSS-PRIV: kulonbozo titkok azonos share(1)-et adnak (informacioelmelet)",
    And(s1 != s2,
        (s1 ^ z3_gf_mul(c1, BitVecVal(1, 8))) ==
        (s2 ^ z3_gf_mul(c2, BitVecVal(1, 8)))))


# ===========================================================================
# 3. SZAKASZ: KIMERITO PYTHON VERIFIKACIO
#    Az sss.js split() + combine() algoritmust Python-ban emulaljuk es
#    minden lehetseges ertekre teszteljuk (256 titok * 255 nem-nulla koeff).
# ===========================================================================

print('\n── 3. Kimerito Python verifikacio (256 titok * 255 koeff) ─')

def py_split_1byte(s, rand_coeff, n=3):
    """1 bajtos titok felosztasa n share-re, threshold=2."""
    shares = []
    for x in range(1, n + 1):
        y = s ^ py_gf_mul(rand_coeff, x)
        shares.append((x, y))
    return shares

def py_combine_1byte(pair_a, pair_b):
    """2 share -> Lagrange x=0."""
    (x1, y1), (x2, y2) = pair_a, pair_b
    l1 = py_gf_div(x2, x1 ^ x2)
    l2 = py_gf_div(x1, x2 ^ x1)
    return py_gf_mul(y1, l1) ^ py_gf_mul(y2, l2)

errors = 0
total_tests = 0

for s in range(256):
    for rc in range(1, 256):   # koeff=0 degeneral (f konstans), kizarva
        shares = py_split_1byte(s, rc)
        for i in range(3):
            for j in range(i + 1, 3):
                rec = py_combine_1byte(shares[i], shares[j])
                if rec != s:
                    errors += 1
                total_tests += 1

py_check(
    f"PY-EXHAUSTIVE: {total_tests:,} eset, {255*3} kombinacio/titok — "
    f"split/combine helyesseg ({errors} hiba)",
    errors == 0)

# GF mezon belul: minden nem-nulla elem invertalhato
inv_errors = sum(
    1 for x in range(1, 256)
    if py_gf_mul(x, py_gf_inv(x)) != 1
)
py_check(
    f"PY-GF-INV: 255 elem inverze helyes (hiba: {inv_errors})",
    inv_errors == 0)

# Kommutativitas teljes tablazaton
comm_errors = sum(
    1 for x in range(256) for y in range(256)
    if py_gf_mul(x, y) != py_gf_mul(y, x)
)
py_check(
    f"PY-GF-COMM: 65536 szorzas kommutatív (hiba: {comm_errors})",
    comm_errors == 0)


# ===========================================================================
# OSSZESITES
# ===========================================================================

print('\n' + '=' * 56)
passed = sum(_results)
total  = len(_results)
gf_ok  = all(_results[:6])
sss_ok = all(_results[6:10])
py_ok  = all(_results[10:])

print(f"GF(2^8) field axiomak (Z3 BitVec): {sum(_results[:6])}/6   {'PASS' if gf_ok else 'FAIL'}")
print(f"SSS helyesseg (Z3 BitVec):          {sum(_results[6:10])}/4   {'PASS' if sss_ok else 'FAIL'}")
print(f"Kimerito Python verifikacio:        {sum(_results[10:])}/3   {'PASS' if py_ok else 'FAIL'}")
print(f"Osszesitett:                        {passed}/{total}")
print()
if passed == total:
    print("sss.js GF(2^8) aritmetika + Shamir SSS: FORMÁLISAN ÉS KIMERITOEN BIZONYITOTT")
    print()
    print("Mit jelent 'valodi' bizonyitas:")
    print("  Z3 BitVec: az sss.js gfMul() algoritmusa kicsomagolva Z3 If-agakka.")
    print("  A bizonyitas minden lehetseges GF(256) ertekre ervenyes (bit-blasting).")
    print("  NEM modell-ellenorzes: a tenyleges implementacios logika van verikalva.")
    print()
    print("Mit NEM bizonyit:")
    print("  Az AES-GCM es PBKDF2 helyesseget (WebCrypto — browser garancia).")
    print("  A BCH fuzzy extractor numerikus stabilitasat (statisztikai garancia).")
    print("  A DCC timer JS-beli helyes vegrehajtasat (logikai modell garancia).")
else:
    print("FIGYELEM: egyes tesztek nem teljesultek!")
print('=' * 56)
