/**
 * BioWallet — Phase 9.0 Recovery Math E2E Test
 *
 * Ellenőrzi, hogy a Papír-képlet matematikai folyamata (indices -> codes -> reconstruction)
 * hiba nélkül és pontosan működik-e.
 */

import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { 
  entropyToIndices, 
  personalHashOffsets, 
  fetchRandomOffsets, 
  computeCodes, 
  reconstructIndices 
} from '../src/core/recovery_formula.js';

async function runTest() {
  console.log('--- BioWallet Phase 9.0 Recovery Math Test ---');

  // 1. Teszt adatok generálása
  const entropy = webcrypto.getRandomValues(new Uint8Array(32));
  const personalNumber = "MySecret1234!";
  
  console.log('1. Entropy generálva (32 bájt)');
  
  // 2. Entropy -> BIP39 Indexek (0..2047)
  const originalIndices = await entropyToIndices(entropy);
  console.log('2. BIP39 Indexek kiszámolva (24 szó)');
  
  // 3. Eltolások generálása
  const rOffsets = await fetchRandomOffsets(24, false); // Phase 9.0: helyi random
  const pOffsets = await personalHashOffsets(personalNumber, 24);
  console.log('3. r_j és hash(P) eltolások legenerálva');

  // 4. Kódok számítása (Paper A)
  const codes = computeCodes(originalIndices, rOffsets, pOffsets);
  console.log('4. c_j kódok (Paper A) kiszámolva');

  // 5. Visszafejtés szimuláció (Offline / Papíron)
  const reconstructedIndices = reconstructIndices(codes, rOffsets, pOffsets);
  console.log('5. Indexek visszafejtve a kódokból és eltolásokból');

  // 6. Ellenőrzés
  let success = true;
  for (let i = 0; i < 24; i++) {
    if (originalIndices[i] !== reconstructedIndices[i]) {
      console.error(`  FAIL: Eltérés a ${i+1}. szónál!`);
      console.error(`        Eredeti: ${originalIndices[i]}, Visszafejtett: ${reconstructedIndices[i]}`);
      success = false;
    }
  }

  if (success) {
    console.log('\n✅ SUCCESS: A visszafejtett indexek tökéletesen egyeznek az eredetivel!');
    console.log('   A matematikai képlet (c + r + p) mod 2048 bizonyítottan helyes.');
  } else {
    console.log('\n❌ FAILED: Matematikai hiba a folyamatban.');
    process.exit(1);
  }
}

runTest().catch(e => {
  console.error('Hiba a teszt futtatása közben:', e);
  process.exit(1);
});
