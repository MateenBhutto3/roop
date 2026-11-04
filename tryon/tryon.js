// Live AR try-on widget — runs fully on the shopper's device (no server, no API).
//   import { openTryOn } from './tryon/tryon.js';
//   openTryOn({ name, rig: 'assets/hoodie/rig/', size: [w,h], kp: {...} });
import { TryOnRenderer } from './renderer.js';
import { preloadEngine, onProgress } from './engine.js';

// MediaPipe pose landmark indices
const I = { nose: 0, l_eye: 2, r_eye: 5, l_ear: 7, r_ear: 8, mouth_l: 9, mouth_r: 10,
  l_shoulder: 11, r_shoulder: 12, l_elbow: 13, r_elbow: 14, l_wrist: 15, r_wrist: 16,
  l_pinky: 17, r_pinky: 18, l_index: 19, r_index: 20, l_thumb: 21, r_thumb: 22, l_hip: 23, r_hip: 24 };
const BODY = ['l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist', 'l_hip', 'r_hip'];

// One Euro filter: removes jitter when still, stays responsive when moving
class OneEuro {
  constructor(minCutoff = 1.0, beta = 4.0, dCutoff = 1.0) { Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 }); }
  static a(cut, dt) { const r = 2 * Math.PI * cut * dt; return r / (r + 1); }
  filter(v, t) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
    const d = (v - this.x) / dt; this.dx += OneEuro.a(this.dCutoff, dt) * (d - this.dx);
    const cut = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.a(cut, dt) * (v - this.x); return this.x;
  }
}

const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error(src)); i.src = src; });

const ICON = {
  close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  flip: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3l2-2h6l2 2h3v12H4z"/><path d="M9.5 12.5a2.5 2.5 0 0 1 4.6-1.4M14.5 13.5a2.5 2.5 0 0 1-4.6 1.4"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
};

export async function openTryOn(product, opts = {}) {
  if (document.querySelector('.vto')) return;
  const engineP = opts.testPose ? null : preloadEngine();   // usually already loaded in background
  const root = document.createElement('div');
  root.className = 'vto';
  root.innerHTML = `
    <video class="vto-video" playsinline muted autoplay></video>
    <canvas class="vto-canvas"></canvas>
    <div class="vto-top">
      <div class="vto-title"><span class="vto-live">Live</span><span>${product.name}</span></div>
      <button class="vto-icon vto-close" aria-label="Close">${ICON.close}</button>
    </div>
    <div class="vto-hint" hidden></div>
    <div class="vto-loading"><div class="vto-ring"><svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="19"/><circle class="vto-ring-p" cx="22" cy="22" r="19"/></svg><b>0%</b></div><p class="vto-loading-text">Starting camera…</p></div>
    <div class="vto-panel" hidden>
      <label>Fit <input type="range" class="vto-fit" min="0.9" max="1.35" step="0.01" value="1.08"></label>
      <label>Length <input type="range" class="vto-len" min="0.8" max="1.25" step="0.01" value="1"></label>
    </div>
    <div class="vto-bottom">
      <button class="vto-icon vto-adjust" aria-label="Adjust fit">${ICON.sliders}</button>
      <button class="vto-shutter" aria-label="Take photo"><span></span></button>
      <button class="vto-icon vto-flip" aria-label="Switch camera">${ICON.flip}</button>
    </div>
    <div class="vto-shot" hidden>
      <img alt="Your try-on photo">
      <div class="vto-shot-actions"><button class="vto-btn ghost vto-retake">Back</button><a class="vto-btn vto-save" download="try-on.jpg">Save photo</a></div>
    </div>`;
  document.body.appendChild(root);
  document.documentElement.classList.add('vto-open');
  const $ = (s) => root.querySelector(s);
  const video = $('.vto-video'), canvas = $('.vto-canvas'), hint = $('.vto-hint');
  const loading = $('.vto-loading'), loadingText = $('.vto-loading-text');
  const ring = $('.vto-ring-p'), ringTxt = $('.vto-ring b');

  let alive = true, stream = null, facing = 'user', raf = 0;
  const filters = {}; let pose = null, occ = null, lastSeen = 0, lastVideoTime = -1;

  const offProgress = onProgress((p) => { ring.style.strokeDashoffset = String(119.4 * (1 - p)); ringTxt.textContent = Math.round(p * 100) + '%'; });
  const close = () => {
    alive = false; cancelAnimationFrame(raf); offProgress();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    root.remove(); document.documentElement.classList.remove('vto-open');
    window.removeEventListener('resize', onResize);
  };
  $('.vto-close').onclick = close;
  const fail = (msg) => { loading.hidden = false; loading.classList.add('error'); loadingText.innerHTML = msg; };

  let R;
  try { R = new TryOnRenderer(canvas); } catch (e) { console.error(e); fail('This browser can’t run live try-on (WebGL2 needed). Please update Chrome or Safari.'); return; }
  try {
    const base = product.rig.replace(/\/?$/, '/');
    const [torso, sleeve_r, sleeve_l] = await Promise.all(['torso.png', 'sleeve_r.png', 'sleeve_l.png'].map((f) => loadImg(base + f)));
    R.setGarment({ size: product.size, kp: product.kp, layers: { torso, sleeve_r, sleeve_l } });
  } catch (e) { fail('Could not load the product.'); return; }

  const fitIn = $('.vto-fit'), lenIn = $('.vto-len');
  fitIn.oninput = lenIn.oninput = () => { R.fit = +fitIn.value; R.length = +lenIn.value; };
  fitIn.oninput();
  $('.vto-adjust').onclick = () => { const p = $('.vto-panel'); p.hidden = !p.hidden; };

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  function onResize() { R.resize(Math.round(root.clientWidth * dpr), Math.round(root.clientHeight * dpr)); }
  window.addEventListener('resize', onResize); onResize();

  const source = opts.testImage ? await loadImg(opts.testImage) : video;
  if (opts.testMask) {
    const mi = await loadImg(opts.testMask), c = document.createElement('canvas'); c.width = mi.naturalWidth; c.height = mi.naturalHeight;
    const cx = c.getContext('2d'); cx.drawImage(mi, 0, 0); const d = cx.getImageData(0, 0, c.width, c.height).data;
    const f = new Float32Array(c.width * c.height); for (let i = 0; i < f.length; i++) f[i] = d[i * 4] / 255;
    R.setMask(f, c.width, c.height);
  }
  const srcSize = () => (source === video ? [video.videoWidth, video.videoHeight] : [source.naturalWidth, source.naturalHeight]);

  async function startCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (!navigator.mediaDevices?.getUserMedia) { fail('Camera not available. Open the site over <b>https</b> in Chrome or Safari.'); return false; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
    } catch (e) {
      fail(e.name === 'NotAllowedError' ? 'Camera permission was blocked. Allow camera access and try again.' : 'Could not open the camera (' + e.name + ').');
      return false;
    }
    video.srcObject = stream; await video.play().catch(() => {});
    await new Promise((r) => (video.readyState >= 2 ? r() : (video.onloadeddata = r)));
    return true;
  }
  $('.vto-flip').onclick = async () => { facing = facing === 'user' ? 'environment' : 'user'; pose = null; for (const k in filters) delete filters[k]; await startCamera(); };

  // camera + model load in parallel
  if (source === video) {
    loadingText.textContent = 'Starting camera…';
    if (!(await startCamera()) || !alive) return;
  }
  let landmarker = null;
  if (engineP) {
    loadingText.textContent = 'Loading body tracking…';
    try { landmarker = await engineP; } catch (e) { fail('Body tracking failed to load. Check your internet and try again.'); return; }
  }
  if (!alive) return;
  loading.hidden = true;

  function coverRect() {
    const [vw, vh] = srcSize(), cw = canvas.width, ch = canvas.height;
    const s = Math.max(cw / vw, ch / vh), sw = vw * s, sh = vh * s;
    return { sx: (cw - sw) / 2, sy: (ch - sh) / 2, sw, sh, srcW: vw, srcH: vh, mirror: source === video && facing === 'user' };
  }

  // landmarks (normalised) -> smoothed screen px
  function update(lms, view, t) {
    const P = {};
    const get = (name, need = 0.5) => {
      const l = lms[I[name]];
      const ok = l && (l.visibility ?? 1) >= need && l.x > -0.05 && l.x < 1.05 && l.y > -0.05 && l.y < 1.03;
      if (!ok) { delete filters[name]; return null; }
      const f = filters[name] || (filters[name] = [new OneEuro(), new OneEuro()]);
      const x = f[0].filter(l.x, t), y = f[1].filter(l.y, t);
      return [view.sx + (view.mirror ? 1 - x : x) * view.sw, view.sy + y * view.sh];
    };
    for (const k of BODY) P[k] = get(k, k.includes('shoulder') ? 0.5 : 0.6);
    // occluders
    const o = { head: null, hands: [null, null] };
    const le = get('l_eye', 0.5), re = get('r_eye', 0.5), ml = get('mouth_l', 0.5), mr = get('mouth_r', 0.5);
    if (le && re && ml && mr) {
      const eyes = [(le[0] + re[0]) / 2, (le[1] + re[1]) / 2], mouth = [(ml[0] + mr[0]) / 2, (ml[1] + mr[1]) / 2];
      const d = [mouth[0] - eyes[0], mouth[1] - eyes[1]], fd = Math.hypot(d[0], d[1]) || 1, u = [d[0] / fd, d[1] / fd];
      const chin = [mouth[0] + d[0] * 1.15, mouth[1] + d[1] * 1.15];
      const top = [eyes[0] - d[0] * 2.3, eyes[1] - d[1] * 2.3];
      const lr = get('l_ear', 0.3), rr = get('r_ear', 0.3);
      const eyeD = Math.hypot(le[0] - re[0], le[1] - re[1]);
      const width = lr && rr ? Math.hypot(lr[0] - rr[0], lr[1] - rr[1]) : eyeD * 2.5;
      const ry = Math.hypot(chin[0] - top[0], chin[1] - top[1]) / 2;
      o.head = { c: [(chin[0] + top[0]) / 2, (chin[1] + top[1]) / 2], r: [Math.max(width * 0.75, ry * 0.7), ry * 1.05], ang: Math.atan2(-u[0], u[1]) };
    }
    const sw = P.l_shoulder && P.r_shoulder ? Math.hypot(P.l_shoulder[0] - P.r_shoulder[0], P.l_shoulder[1] - P.r_shoulder[1]) : 0;
    ['r', 'l'].forEach((s, i) => {
      const w = P[s + '_wrist'], ix = get(s + '_index', 0.4), pk = get(s + '_pinky', 0.4);
      if (!w || !(ix || pk)) return;
      const tip = ix && pk ? [(ix[0] + pk[0]) / 2, (ix[1] + pk[1]) / 2] : (ix || pk);
      const d = [tip[0] - w[0], tip[1] - w[1]], L = Math.hypot(d[0], d[1]);
      o.hands[i] = { a: [w[0] + d[0] * 0.3, w[1] + d[1] * 0.3], b: [w[0] + d[0] * 2.0, w[1] + d[1] * 2.0], r: Math.max(L * 0.95, sw * 0.075) };
    });
    pose = P; occ = o;
  }

  function hintFor() {
    if (!pose) return 'Step into the frame';
    if (!pose.r_shoulder || !pose.l_shoulder) return 'Show both shoulders';
    const w = Math.hypot(pose.r_shoulder[0] - pose.l_shoulder[0], pose.r_shoulder[1] - pose.l_shoulder[1]);
    if (w > canvas.width * 0.8) return 'Move back a little';
    if (!pose.r_hip && !pose.l_hip && w < canvas.width * 0.6) return '';
    return '';
  }

  function loop() {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    if (source === video && video.readyState < 2) return;
    const view = coverRect(), now = performance.now();
    if (opts.testPose) { update(opts.testPose, view, now); lastSeen = now; }
    else if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      landmarker.detectForVideo(video, now, (res) => {
        const lms = res.landmarks && res.landmarks[0];
        if (lms) {
          update(lms, view, now); lastSeen = now;
          const m = res.segmentationMasks && res.segmentationMasks[0];
          if (m) { try { R.setMask(m.getAsFloat32Array(), m.width, m.height); } catch (e) {} }
        } else if (now - lastSeen > 350) { pose = null; occ = null; }
      });
    }
    const ok = R.render(source, view, pose, occ);
    const h = ok ? hintFor() : (pose ? hintFor() || 'Step back a little' : 'Step into the frame');
    if (h) { hint.textContent = h; hint.hidden = false; } else hint.hidden = true;
  }
  loop();

  const shot = $('.vto-shot');
  $('.vto-shutter').onclick = () => canvas.toBlob((b) => {
    if (!b) return; const u = URL.createObjectURL(b);
    shot.querySelector('img').src = u; $('.vto-save').href = u; shot.hidden = false;
  }, 'image/jpeg', 0.92);
  $('.vto-retake').onclick = () => { shot.hidden = true; };
  return { close, root };
}
