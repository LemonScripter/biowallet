/**
 * BioWallet — Bio Capture (Phase 2: FaceNet)
 *
 * face-api.js TinyFaceDetector + FaceRecognitionNet
 * Output: 128-dim L2-normalized Float32Array (stabil munkamenetek között)
 * Várható bit-hiba: 5–15/256 (vs. Phase 1: 30–50/256)
 *
 * Phase 6: face-api.js + modell súlyok lokálisan (CDN-mentes, CSP 'self')
 */

import { t } from './i18n.js?v=12';

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

  // Use ideal constraints — exact facingMode causes Samsung Browser to open native camera app
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: 'user' } },
      audio: false,
    });
  } catch {
    // Fallback: accept any camera (handles devices that reject facingMode entirely)
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
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

  onStatus?.(t('msg.model.loading'));
  loadModels().catch(() => onStatus?.(t('msg.model.error')));

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

// ── Liveness / PAD — fejfordítás challenge ────────────────────────────────
//
// Csak withFaceLandmarks() (NEM withFaceDescriptor) → gyorsabb,
// nem érinti a biometrikus pipelinet.
// captureEmbedding / enrollEmbedding SOHA NEM MÓDOSUL.

async function _detectNoseRatio(videoEl, fa, opt) {
  if (videoEl.readyState < 2) return null;
  const res = await fa.detectSingleFace(videoEl, opt).withFaceLandmarks();
  if (!res) return null;
  const pts = res.landmarks.positions;
  const jW  = pts[16].x - pts[0].x + 1e-6;  // jaw szélesség
  return (pts[30].x - pts[0].x) / jW;        // nose[30] pozíció aránya
}

export async function performLivenessChallenge(videoEl, onHint) {
  await loadModels();
  const fa  = await getFaceApi();
  const opt = new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });

  onHint?.(t('liveness.turn'));

  // Baseline: ~1.2s, mérjük az orr kiindulási pozícióját
  // Dinamikus → kezeli a tükrözést, ferde tartást, egyéni eltéréseket
  let sum = 0, n = 0;
  for (let i = 0; i < 8; i++) {
    await delay(150);
    const r = await _detectNoseRatio(videoEl, fa, opt);
    if (r !== null) { sum += r; n++; }
  }
  const baseline = n > 0 ? sum / n : 0.50;

  // Detektálás: max 8s, 150ms polling
  // Siker: orrpont 0.10-el eltér a baseline-tól bármelyik irányba (~20 fok)
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    await delay(150);
    const r = await _detectNoseRatio(videoEl, fa, opt);
    if (r !== null && Math.abs(r - baseline) > 0.10) {
      onHint?.(t('liveness.look_straight'));
      return; // siker
    }
  }
  throw new Error('LIVENESS_TIMEOUT');
}
