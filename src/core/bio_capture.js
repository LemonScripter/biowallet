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

// Liveness / PAD (presentation attack detection)
// Random challenge from 3 options — unpredictable, hard to fake with static photo.
// Uses faceLandmark68Net (already loaded) — zero additional dependencies.
const LIVENESS_CHALLENGES  = ['blink', 'turn_left', 'turn_right'];
const EAR_BLINK_THRESHOLD  = 0.21;   // Eye Aspect Ratio — eyes closed
const EAR_OPEN_THRESHOLD   = 0.25;   // EAR — eyes open again (hysteresis)
const NOSE_LEFT_THRESHOLD  = 0.40;   // nose/jaw ratio → turned left
const NOSE_RIGHT_THRESHOLD = 0.60;   // nose/jaw ratio → turned right
const LIVENESS_TIMEOUT_MS  = 12_000; // max challenge duration

// Eye Aspect Ratio — standard dlib 68-point landmark indices
// Left eye: 36-41  Right eye: 42-47
function _ear(pts) {
  const d = (a, b) => {
    const dx = pts[a].x - pts[b].x, dy = pts[a].y - pts[b].y;
    return Math.sqrt(dx*dx + dy*dy);
  };
  const earL = (d(37,41) + d(38,40)) / (2 * d(36,39) + 1e-6);
  const earR = (d(43,47) + d(44,46)) / (2 * d(42,45) + 1e-6);
  return (earL + earR) / 2;
}

// Nose position ratio on face width: jaw(0)–nose(30)–jaw(16)
// Straight ≈ 0.5 · left turn < 0.4 · right turn > 0.6
function _noseRatio(pts) {
  const jW = pts[16].x - pts[0].x + 1e-6;
  return (pts[30].x - pts[0].x) / jW;
}

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

// ── Liveness challenge (EAR blink + nose-ratio head turn) ────────────────
//
// Exported — app.js hívja a biztonságkritikus útvonalakon (OPEN, SIGN, PAPER).
// enrollEmbedding() deliberate, lassú folyamat → ott nem szükséges.
//
// @param {HTMLVideoElement} videoEl
// @param {function(string):void} onHint  — challenge szöveg callback (setMsg)
// @returns {Promise<void>}  — sikeres challenge esetén resolve, timeout → throw LIVENESS_TIMEOUT

export async function performLivenessChallenge(videoEl, onHint) {
  await loadModels();
  const fa  = await getFaceApi();
  const opt = new fa.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });

  // Véletlenszerű challenge — előre nem jelezhető videófelvétellel szemben
  const challenge = LIVENESS_CHALLENGES[Math.floor(Math.random() * LIVENESS_CHALLENGES.length)];
  onHint?.(t(`liveness.${challenge}`));

  // 1s előkészülési idő — felhasználó elolvassa az utasítást
  await delay(1000);

  const deadline  = Date.now() + LIVENESS_TIMEOUT_MS;
  let blinkCount  = 0;
  let eyesOpen    = true;  // blink state machine: open → closed → open = 1 blink

  while (Date.now() < deadline) {
    await delay(100);  // ~10 fps — balance between responsiveness and CPU
    if (videoEl.readyState < 2) continue;

    const res = await fa.detectSingleFace(videoEl, opt).withFaceLandmarks();
    if (!res) continue;

    const pts = res.landmarks.positions;

    if (challenge === 'blink') {
      const ear = _ear(pts);
      if (eyesOpen && ear < EAR_BLINK_THRESHOLD) {
        eyesOpen = false;                  // szem csukódik
      } else if (!eyesOpen && ear > EAR_OPEN_THRESHOLD) {
        eyesOpen = true;                   // szem kinyílik → 1 pislogás kész
        if (++blinkCount >= 2) return;     // 2 pislogás → challenge teljesítve
      }
    } else {
      const ratio = _noseRatio(pts);
      if (challenge === 'turn_left'  && ratio < NOSE_LEFT_THRESHOLD)  return;
      if (challenge === 'turn_right' && ratio > NOSE_RIGHT_THRESHOLD) return;
    }
  }

  throw new Error('LIVENESS_TIMEOUT');
}

// ── Authentikáció (3 frame átlag) ─────────────────────────────────────────
//
// livenessHint: ha megadva → liveness challenge fut az embedding előtt.
// enrollEmbedding()-nél nem hívjuk (deliberate enrollment).

export async function captureEmbedding(videoEl, livenessHint = null) {
  if (livenessHint) {
    await performLivenessChallenge(videoEl, livenessHint);
  }

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
