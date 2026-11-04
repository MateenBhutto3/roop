// Loads the on-device body tracker (MediaPipe Pose Landmarker with person segmentation).
// preloadEngine() is called as soon as a product page opens, so by the time the shopper
// taps "Try it on" everything is usually already downloaded. A service worker (sw.js)
// keeps the files cached, so the second visit starts instantly.

const MP_VERSION = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
// "full" is more accurate on arms; "lite" is faster on phones
const MODEL_URL = `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${isMobile ? 'lite' : 'full'}/float16/1/pose_landmarker_${isMobile ? 'lite' : 'full'}.task`;

let promise = null;
const listeners = new Set();
let progress = 0;
const emit = (p) => { progress = p; listeners.forEach((f) => f(p)); };
export const onProgress = (f) => { listeners.add(f); f(progress); return () => listeners.delete(f); };

async function fetchWithProgress(url, from, to) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('download failed ' + res.status);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !total) { const b = new Uint8Array(await res.arrayBuffer()); emit(to); return b; }
  const reader = res.body.getReader(); const chunks = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    chunks.push(value); got += value.length; emit(from + (to - from) * Math.min(1, got / total));
  }
  const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function preloadEngine() {
  if (!promise) {
    promise = (async () => {
      emit(0.02);
      const [mod, model] = await Promise.all([
        import(/* @vite-ignore */ `${MP_URL}/vision_bundle.mjs`).catch(() => import(/* @vite-ignore */ `${MP_URL}/+esm`)),
        fetchWithProgress(MODEL_URL, 0.05, 0.8),
      ]);
      const { FilesetResolver, PoseLandmarker } = mod;
      const files = await FilesetResolver.forVisionTasks(`${MP_URL}/wasm`);
      emit(0.9);
      const make = (delegate) => PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetBuffer: model, delegate },
        runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: true,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      let lm;
      try { lm = await make('GPU'); } catch (e) { console.warn('GPU delegate failed, using CPU', e); lm = await make('CPU'); }
      emit(1);
      return lm;
    })();
    promise.catch((e) => { console.error(e); promise = null; emit(0); });
  }
  return promise;
}

// start quietly in the background once the page is idle
export function preloadWhenIdle() {
  const go = () => preloadEngine().catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 2500 }); else setTimeout(go, 1200);
}
