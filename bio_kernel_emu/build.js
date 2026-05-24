// bio_kernel_emu — build.js
// Összefűzi a src/ fájlokat egyetlen demo/bundle.js-be (SES-kompatibilis)
const fs   = require('fs');
const path = require('path');

const root = __dirname;

// Sorrend fontos: függőségek előre
const srcFiles = [
    'src/audit_log.js',
    'src/state_manager.js',
    'src/causal_irq_bridge.js',
    'src/z3_gatekeeper.js',
    'src/index.js',
    'demo/demo.js',
];

// Node.js-specifikus blokkokat kihagyja a bundleből
function stripNodeBlocks(code) {
    // module.exports blokk eltávolítása
    code = code.replace(/\n?if\s*\(typeof module !== 'undefined'\)\s*\{[^}]*\}/gs, '');
    // require blokk eltávolítása
    code = code.replace(/\n?if\s*\(typeof require !== 'undefined'[\s\S]*?\n\}/gm, '');
    // window.X = X duplikát eltávolítása (az else ágak megmaradnak, de a window blokk is)
    return code.trim();
}

let bundle = `// bio_kernel_emu — bundle.js (auto-generated, ne szerkeszd kézzel)
// Forrás: src/ + demo/demo.js | Generálva: build.js
// SES/LavaMoat kompatibilis — egyetlen scope, nincs cross-script global

(function (global) {
'use strict';

`;

for (const rel of srcFiles) {
    const fullPath = path.join(root, rel);
    let code = fs.readFileSync(fullPath, 'utf8');
    code = stripNodeBlocks(code);
    bundle += `\n// ─── ${rel} ───\n${code}\n`;
}

bundle += `\n})(typeof window !== 'undefined' ? window : globalThis);\n`;

const outPath = path.join(root, 'demo', 'bundle.js');
fs.writeFileSync(outPath, bundle, 'utf8');
console.log(`✓ bundle.js elkészült (${Math.round(bundle.length / 1024)} KB)`);
