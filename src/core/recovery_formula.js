/**
 * BioWallet — Paper Recovery Formula (Phase 9)
 *
 * Cél: a 24 szavas BIP39 seed SOHA nem jelenik meg digitális formában.
 * A felhasználó kap két számlistát (Paper A: c_j, Paper B: r_j)
 * és egy fejben tartott személyes számot (P).
 *
 * Matematika:
 *   c_j = (i_j  −  r_j  −  hash(P)[j])  mod 2048
 *   i_j = (c_j  +  r_j  +  hash(P)[j])  mod 2048
 *
 * Ahol:
 *   i_j      = BIP39 szóindex (0..2047) a j-edik szóra (j=1..24)
 *   r_j      = random eltolás (Paper B, külön papíron)
 *   hash(P)  = SHA-256(P || "|" || j) első 2 bájtja uint16-ként, mod 2048
 *   c_j      = obfuszkált kód (Paper A)
 *
 * Recovery (offline, papíron): a felhasználó hozzáadja a két listát és
 * a fejből kiszámolt hash(P)[j]-t, mod 2048, majd a BIP39 szólistából
 * kikeresi a szót. 24 szó → MetaMask import.
 *
 * Phase 9.0: r_j a böngészőben generálódik (crypto.getRandomValues).
 * Phase 9.1: r_j a Tokyo szerveren generálódik Ring 0 BPF védelemmel
 *            (path-binding Phase 11 + ptrace-block Phase 12d után).
 */

// ── Helpers ──────────────────────────────────────────────────────────────

/** Korrekt modulo negatív számokra is. */
function mod(n, m) {
  return ((n % m) + m) % m;
}

// ── SHA-256 alapú P-hash ─────────────────────────────────────────────────

/**
 * Személyes szám → 24 darab 0..2047 közötti eltolás.
 * Külön hash j-enként, hogy az indexek függetlenek legyenek egymástól.
 *
 * @param {string} personalNumber — bármilyen string (P)
 * @param {number} n              — eltolások száma (alapért. 24)
 * @returns {Promise<number[]>}
 */
export async function personalHashOffsets(personalNumber, n = 24) {
  const enc = new TextEncoder();
  const offsets = new Array(n);
  for (let j = 1; j <= n; j++) {
    const input = enc.encode(`${personalNumber}|${j}`);
    const hashBuf = await crypto.subtle.digest('SHA-256', input);
    const view = new DataView(hashBuf);
    const u16  = view.getUint16(0, false);     // első 2 bájt big-endian
    offsets[j - 1] = u16 % 2048;
  }
  return offsets;
}

// ── r_j forrás (Phase 9.0: browser, Phase 9.1: server) ──────────────────

/**
 * Random eltolások generálása.
 * @param {number}  n           — eltolások száma (alapért. 24)
 * @param {boolean} useServer   — Phase 9.1: szerver oldalt használ
 * @returns {Promise<number[]>}
 */
export async function fetchRandomOffsets(n = 24, useServer = false) {
  if (useServer) {
    // Phase 9.1 stub — itt fog a /api/recovery/offsets endpoint hívódni
    // a Tokyo szerveren, Ring 0 BPF védelemmel
    throw new Error('Phase 9.1 nincs implementálva (Ring 0 path-binding + ptrace-block szükséges)');
  }
  const buf = crypto.getRandomValues(new Uint16Array(n));
  return Array.from(buf, x => x % 2048);
}

// ── Kódszámítás ──────────────────────────────────────────────────────────

/**
 * raw_A_j = (i_j - r_j) mod 2048
 * Phase 9.1b: P NEM kerül az app-ba. Az offline ENCODE lépés alkalmazza P-t.
 * @param {number[]} indices  — i_j tömb
 * @param {number[]} rOffsets — r_j tömb
 * @returns {number[]}
 */
export function computeRawPaper(indices, rOffsets) {
  if (indices.length !== rOffsets.length)
    throw new Error('Hossz-eltérés: indices és rOffsets ugyanolyan hosszú kell legyen');
  return indices.map((i, j) => mod(i - rOffsets[j], 2048));
}

/**
 * c_j = (i_j - r_j - p_j) mod 2048
 * Csak recovery_tool.html ENCODE módban használt (offline, P-vel).
 * @param {number[]} indices  — i_j tömb
 * @param {number[]} rOffsets — r_j tömb
 * @param {number[]} pOffsets — hash(P)[j] tömb
 * @returns {number[]}
 */
export function computeCodes(indices, rOffsets, pOffsets) {
  if (indices.length !== rOffsets.length || indices.length !== pOffsets.length) {
    throw new Error('Hossz-eltérés: indices, r, p ugyanolyan hosszú kell legyen');
  }
  return indices.map((i, j) => mod(i - rOffsets[j] - pOffsets[j], 2048));
}

/**
 * Visszafejtés (papíron is végrehajtható ellenőrzéshez):
 * i_j = (c_j + r_j + p_j) mod 2048
 */
export function reconstructIndices(codes, rOffsets, pOffsets) {
  return codes.map((c, j) => mod(c + rOffsets[j] + pOffsets[j], 2048));
}

// ── BIP39 entropy → 24 szóindex (wordlist-mentes) ───────────────────────

/**
 * 32 bájt BIP39 entropy → 24 darab 11-bites szóindex (0..2047).
 * A BIP39 spec szerint:
 *   - 256 bit entropy + 8 bit checksum (SHA-256(entropy) első 8 bitje)
 *   - összesen 264 bit → 24 darab 11-bites darab
 *
 * Nem kell wordlist a kódoláshoz — a számítás tisztán bitekkel megy.
 * A wordlist csak akkor kell, amikor a felhasználó papíron visszafejt.
 *
 * @param {Uint8Array} entropyBytes — 32 bájt
 * @returns {Promise<number[]>} 24 elemű tömb, mindegyik 0..2047
 */
export async function entropyToIndices(entropyBytes) {
  if (entropyBytes.length !== 32) {
    throw new Error(`Csak 32 bájt entropy támogatott (24 szó), kapott: ${entropyBytes.length}`);
  }

  const hashBuf   = await crypto.subtle.digest('SHA-256', entropyBytes);
  const hashBytes = new Uint8Array(hashBuf);

  // bits = entropy (32 B) || checksum_byte (1 B, csak első 8 bitje használt)
  const bits = new Uint8Array(33);
  bits.set(entropyBytes, 0);
  bits[32] = hashBytes[0];

  // 24 darab 11-bites darab kinyerése
  const indices = new Array(24);
  for (let i = 0; i < 24; i++) {
    const bitOffset = i * 11;
    const byteOff   = bitOffset >> 3;
    const bitInByte = bitOffset & 7;

    // 24 bites ablak (3 bájt), majd shift+mask
    const combined =
      (bits[byteOff]     << 16) |
      (bits[byteOff + 1] <<  8) |
       bits[byteOff + 2];

    const shift = 24 - bitInByte - 11;
    indices[i] = (combined >> shift) & 0x7FF;     // 0x7FF = 2047
  }

  return indices;
}
