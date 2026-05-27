/**
 * BioWallet — Bio Capture (Phase 2: FaceNet)
 *
 * face-api.js TinyFaceDetector + FaceRecognitionNet
 * Output: 128-dim L2-normalized Float32Array (stabil munkamenetek között)
 * Várható bit-hiba: 5–15/256 (vs. Phase 1: 30–50/256)
 *
 * Phase 6: face-api.js + modell súlyok lokálisan (CDN-mentes, CSP 'self')
 */

const MODELS_URL = '/models';   // lokális: /var/www/biowallet/models/

const ENROLL_SCANS = 5;
const AUTH_SCANS   = 3;
export const EMBED_DIM = 128;  // FaceRecognitionNet output dim

// ── Library + model loading ────────────────────────────────────────────────

let _fa           = null;   // window.faceapi handle
let _modelPromise = null;   // singleton load promise

async function getFaceApi() {
  if (_fa) return _fa;
  if (!window.faceapi)
    throw new Error('face-api.js nincs betöltve (vendor/face-api.min.js hiányzik)');
  _fa = window.faceapi;
  return _fa;
}

function loadModels() {
  if (_modelPromise) return _modelPromise;
  _modelPromise = getFaceApi().then(fa => Promise.all([
    fa.nets.tinyFaceDetector.loadFromUri(MODELS_URL),
    fa.nets.faceLandmark68Net.loadFromUri(MODELS_URL),   // arc-alignment → stabil descriptor
    fa.nets.faceRecognitionNet.loadFromUri(MODELS_URL),
  ]));
  return _modelPromise;
}

// ── Kamera ────────────────────────────────────────────────────────────────

export async function openCamera(videoEl, onStatus) {
  // Régi stream leállítása — Firefox néha bent tartja a kamerát újratöltéskor
  if (videoEl.srcObject) {
    videoEl.srcObject.getTracks().forEach(t => t.stop());
    videoEl.srcObject = null;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' },
    audio: false,
  });
  videoEl.srcObject = stream;

  // loadedmetadata + 2s fallback timeout (Firefox race condition)
  await new Promise(r => {
    if (videoEl.readyState >= 1) { r(); return; }
    videoEl.onloadedmetadata = r;
    setTimeout(r, 2000);
  });

  try {
    await videoEl.play();
  } catch {
    // Firefox: "play() interrupted" — 200ms késleltetés után retry
    await delay(200);
    await videoEl.play();
  }

  onStatus?.('FaceNet modellek betöltése (~8 MB)…');
  loadModels().catch(e => onStatus?.(`Model hiba: ${e.message}`));

  return stream;
}

export function closeCamera(stream) {
  stream?.getTracks().forEach(t => t.stop());
}

// ── Embedding ─────────────────────────────────────────────────────────────

async function extractEmbedding(videoEl) {
  if (videoEl.readyState < 2) return null;
  await loadModels();

  const fa  = await getFaceApi();
  const opt = new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
  const res = await fa.detectSingleFace(videoEl, opt)
    .withFaceLandmarks()    // 68-pont arc-alignment → lényegesen stabilabb descriptor
    .withFaceDescriptor();

  if (!res) return null;
  return res.descriptor;   // Float32Array(128), FaceRecognitionNet L2-normalized
}

// ── Enrollment (5 frame) ──────────────────────────────────────────────────

export async function enrollEmbedding(videoEl, onProgress) {
  const scans = [];
  let   tries = 0;

  while (scans.length < ENROLL_SCANS) {
    if (++tries > 40)
      throw new Error('Nem sikerült 5 arc-képet rögzíteni — ellenőrizze a megvilágítást!');
    await delay(600);
    const emb = await extractEmbedding(videoEl);
    if (!emb) continue;
    scans.push(emb);
    onProgress?.(scans.length);
  }

  return averageEmbeddings(scans);
}

// ── Authentikáció (3 frame átlag) ─────────────────────────────────────────

export async function captureEmbedding(videoEl) {
  const scans = [];
  let   tries = 0;

  while (scans.length < AUTH_SCANS) {
    if (++tries > 25)
      throw new Error('Nem sikerült arcot detektálni — nézzen egyenesen a kamerába!');
    await delay(350);
    const emb = await extractEmbedding(videoEl);
    if (emb) scans.push(emb);
  }

  return averageEmbeddings(scans);
}

// ── Utils ─────────────────────────────────────────────────────────────────

function averageEmbeddings(scans) {
  const avg = new Float32Array(EMBED_DIM);
  for (const s of scans) s.forEach((v, i) => { avg[i] += v; });
  avg.forEach((_, i) => { avg[i] /= scans.length; });
  return l2Normalize(avg);
}

function l2Normalize(v) {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map(x => x / norm);
}

const delay = ms => new Promise(r => setTimeout(r, ms));
