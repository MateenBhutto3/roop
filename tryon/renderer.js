// WebGL2 try-on compositor.
//  1. Garment pass: torso + 2 sleeve layers are skinned to the body (torso affine,
//     upper-arm and forearm bones) and drawn into an off-screen buffer.
//  2. Composite pass: camera frame + garment, with
//     - head & hands drawn IN FRONT of the garment (person mask + face/hand shapes)
//     - the room's real light & shadows transferred onto the fabric
//     - colour temperature, softness and sensor grain matched to the camera
//     so the garment looks filmed by the same camera instead of pasted on.

const GARMENT_VS = `#version 300 es
in vec2 aPos; in vec2 aUV; uniform vec2 uRes; out vec2 vUV;
void main(){ vec2 c = aPos / uRes * 2.0 - 1.0; gl_Position = vec4(c.x, -c.y, 0.0, 1.0); vUV = aUV; }`;
const GARMENT_FS = `#version 300 es
precision mediump float; in vec2 vUV; uniform sampler2D uTex; out vec4 o;
void main(){ vec4 t = texture(uTex, vUV); o = vec4(t.rgb * t.a, t.a); }`;

const COMP_VS = `#version 300 es
in vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;
const COMP_FS = `#version 300 es
precision highp float;
uniform sampler2D uVideo, uGarment, uLow, uMask;
uniform vec2 uRes; uniform vec4 uView; uniform float uMirror, uHasMask, uMeanLum, uLight, uTime, uShade;
uniform vec3 uTint;
uniform vec4 uHead; uniform float uHeadAng;          // centre xy, radius xy (px), angle
uniform vec4 uHandA[2]; uniform float uHandR[2];      // capsule a.xy b.xy, radius (px)
out vec4 o;
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float capsule(vec2 p, vec2 a, vec2 b, float r){
  if (r <= 0.0) return 0.0;
  vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-3), 0.0, 1.0);
  float d = length(pa - ba * h); return 1.0 - smoothstep(r * 0.75, r, d);
}
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);          // y-down screen px
  vec2 vuv = (px - uView.xy) / uView.zw; if (uMirror > 0.5) vuv.x = 1.0 - vuv.x;
  vec3 vid = texture(uVideo, vuv).rgb;
  vec4 g = texture(uGarment, gl_FragCoord.xy / uRes);
  if (g.a < 0.002) { o = vec4(vid, 1.0); return; }
  float person = uHasMask > 0.5 ? texture(uMask, vuv).r : 1.0;

  // occluders: head and hands are in front of the garment
  vec2 q = px - uHead.xy; float c = cos(uHeadAng), s = sin(uHeadAng);
  q = vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
  float head = uHead.z > 0.0 ? 1.0 - smoothstep(0.93, 1.0, length(q / uHead.zw)) : 0.0;
  float hand = max(capsule(px, uHandA[0].xy, uHandA[0].zw, uHandR[0]), capsule(px, uHandA[1].xy, uHandA[1].zw, uHandR[1]));
  float occ = max(head, hand) * smoothstep(0.4, 0.6, person);

  // garment colour (un-premultiply), then match the room
  vec3 gc = g.rgb / max(g.a, 1e-3);
  // low-frequency shading of the real body/clothes underneath -> folds & shadows of the room
  float L = lum(texture(uLow, vuv).rgb);
  float sh = clamp(L / max(uMeanLum, 0.05), 0.62, 1.3);
  sh = mix(1.0, sh, uShade * person);
  gc *= sh * uLight * uTint;
  // light wrap: let a little of the background bleed into the garment edges
  gc = mix(gc, texture(uLow, vuv).rgb, 0.12 * (1.0 - smoothstep(0.55, 1.0, g.a)));
  // sensor grain like the camera
  gc += (hash(px + fract(uTime) * 91.7) - 0.5) * 0.014;

  float a = g.a * (1.0 - occ);
  o = vec4(mix(vid, clamp(gc, 0.0, 1.0), a), 1.0);
}`;

function compile(gl, vs, fs) {
  const mk = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
  return { p, u, a: (name) => gl.getAttribLocation(p, name) };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

function affineFrom3(s, d) {
  const [x0, y0] = s[0], [x1, y1] = s[1], [x2, y2] = s[2];
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  const i00 = (y2 - y0) / det, i01 = -(x2 - x0) / det, i10 = -(y1 - y0) / det, i11 = (x1 - x0) / det;
  const du = sub(d[1], d[0]), dv = sub(d[2], d[0]);
  const a = du[0] * i00 + dv[0] * i10, b = du[0] * i01 + dv[0] * i11;
  const c = du[1] * i00 + dv[1] * i10, e = du[1] * i01 + dv[1] * i11;
  return { a, b, c, e, s0: s[0], d0: d[0], det: a * e - b * c };
}
const applyAff = (M, p) => { const q = sub(p, M.s0); return [M.d0[0] + M.a * q[0] + M.b * q[1], M.d0[1] + M.c * q[0] + M.e * q[1]]; };
function boneXf(A, B, A2, B2, widthScale, flip) {
  const v = sub(B, A), L = len(v) || 1, ax = mul(v, 1 / L), px = [-ax[1], ax[0]];
  const v2 = sub(B2, A2), L2 = len(v2) || 1e-3, ax2 = mul(v2, 1 / L2), px2 = mul([-ax2[1], ax2[0]], flip);
  // keep the sleeve from collapsing when the arm points at the camera
  const k = Math.max(L2 / L, 0.35 * widthScale);
  return (p) => { const q = sub(p, A); return add(A2, add(mul(ax2, dot(q, ax) * k), mul(px2, dot(q, px) * widthScale))); };
}

export class TryOnRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false, antialias: false });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    this.gp = compile(gl, GARMENT_VS, GARMENT_FS);
    this.cp = compile(gl, COMP_VS, COMP_FS);
    this.fit = 1.06; this.length = 1; this.garmentScale = 0.75;
    this.tex = { video: this._tex(), low: this._tex(), mask: this._tex() };
    gl.bindTexture(gl.TEXTURE_2D, this.tex.mask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    // buffers
    this.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.posBuf = gl.createBuffer(); this.uvBuf = gl.createBuffer(); this.idxBuf = gl.createBuffer();
    this.fbo = gl.createFramebuffer(); this.fboTex = this._tex(); this.fboSize = [0, 0];
    this.hasMask = false; this.scene = { meanLum: 0.5, tint: [1, 1, 1], light: 1 };
    this.low = document.createElement('canvas'); this.lowCtx = this.low.getContext('2d', { willReadFrequently: true });
    this.frame = 0;
  }

  _tex() {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  setGarment(g) {
    const gl = this.gl, [W, H] = g.size, nx = 28, ny = 36;
    const verts = [], uvs = [], idx = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) { verts.push([i / nx * W, j / ny * H]); uvs.push(i / nx, j / ny); }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i; idx.push(a, a + 1, a + nx + 1, a + 1, a + nx + 2, a + nx + 1); }
    const kp = g.kp;
    const armW = (S, E) => verts.map((p) => {
      const v = sub(E, S), u = dot(sub(p, S), v) / dot(v, v);
      const wT = 1 - smooth(-0.05, 0.32, u), wF = smooth(0.78, 1.12, u), wU = Math.max(0, 1 - wT - wF), s = wT + wU + wF;
      return [wT / s, wU / s, wF / s];
    });
    const texFor = (img) => { const t = this._tex(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); return t; };
    // garment half-width per source row (torso layer), for silhouette fitting
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(g.layers.torso, 0, 0);
    const alpha = cx.getImageData(0, 0, W, H).data;
    const halfAt = (y, centerX) => { y = Math.round(Math.min(H - 1, Math.max(0, y))); let l = centerX, r = centerX;
      for (let x = 0; x < W; x++) if (alpha[(y * W + x) * 4 + 3] > 128) { l = Math.min(l, x); r = Math.max(r, x); }
      return Math.max(centerX - l, r - centerX); };
    // sleeve thickness in the source (outward from the arm bone), per bone
    const sleeveHalf = (img, A, B) => {
      const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; const x2 = c2.getContext('2d', { willReadFrequently: true });
      x2.drawImage(img, 0, 0); const d = x2.getImageData(0, 0, W, H).data;
      const M = lerp2(A, B, 0.5), v = sub(B, A), n0 = mul([-v[1], v[0]], 1 / len(v));
      const centre = lerp2(kp.r_shoulder, kp.l_shoulder, 0.5); const n = dot(n0, sub(M, centre)) >= 0 ? n0 : mul(n0, -1);
      let t = 0; for (; t < 120; t++) { const p = add(M, mul(n, t)), x = Math.round(p[0]), y = Math.round(p[1]);
        if (x < 0 || y < 0 || x >= W || y >= H || d[(y * W + x) * 4 + 3] < 128) break; }
      return Math.max(8, t);
    };
    const sh = {
      r_up: sleeveHalf(g.layers.sleeve_r, kp.r_shoulder, kp.r_elbow), r_fore: sleeveHalf(g.layers.sleeve_r, kp.r_elbow, kp.r_wrist),
      l_up: sleeveHalf(g.layers.sleeve_l, kp.l_shoulder, kp.l_elbow), l_fore: sleeveHalf(g.layers.sleeve_l, kp.l_elbow, kp.l_wrist),
    };
    this.garment = {
      halfAt, sleeveHalf: sh,
      kp, verts, nIdx: idx.length,
      wR: armW(kp.r_shoulder, kp.r_elbow), wL: armW(kp.l_shoulder, kp.l_elbow),
      tex: { torso: texFor(g.layers.torso), sleeve_r: texFor(g.layers.sleeve_r), sleeve_l: texFor(g.layers.sleeve_l) },
      out: new Float32Array(verts.length * 2),
    };
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  }

  resize(w, h) {
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const fw = Math.round(w * this.garmentScale), fh = Math.round(h * this.garmentScale);
    if (this.fboSize[0] !== fw || this.fboSize[1] !== fh) {
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.fboSize = [fw, fh];
    }
  }

  // segmentation mask (Float32Array 0..1, in camera-frame coords)
  setMask(data, w, h) {
    const gl = this.gl, step = w > 400 ? 2 : 1, mw = Math.floor(w / step), mh = Math.floor(h / step);
    if (!this._mbuf || this._mbuf.length !== mw * mh) this._mbuf = new Uint8Array(mw * mh);
    const b = this._mbuf;
    for (let y = 0; y < mh; y++) { const row = y * step * w; for (let x = 0; x < mw; x++) b[y * mw + x] = data[row + x * step] * 255; }
    gl.bindTexture(gl.TEXTURE_2D, this.tex.mask);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, mw, mh, 0, gl.RED, gl.UNSIGNED_BYTE, b);
    this.hasMask = true; this.maskCPU = { data: b, w: mw, h: mh };
  }

  _updateScene(source, sw, sh) {
    const lw = 48, lh = Math.max(16, Math.round(48 * sh / sw));
    if (this.low.width !== lw || this.low.height !== lh) { this.low.width = lw; this.low.height = lh; }
    this.lowCtx.filter = 'blur(2px)';
    this.lowCtx.drawImage(source, 0, 0, lw, lh);
    const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.tex.low);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.low);
    if (this.frame++ % 6) return;
    // average colour of the middle of the frame (where the body usually is)
    const d = this.lowCtx.getImageData(Math.floor(lw * 0.25), Math.floor(lh * 0.3), Math.ceil(lw * 0.5), Math.ceil(lh * 0.5)).data;
    let r = 0, g = 0, b = 0, n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    r /= n * 255; g /= n * 255; b /= n * 255;
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b, m = (r + g + b) / 3 || 1;
    const S = this.scene, k = 0.15;
    S.meanLum += (L - S.meanLum) * k;
    const tint = [r / m, g / m, b / m].map((v) => 1 + (v - 1) * 0.35);
    S.tint = S.tint.map((v, i) => v + (tint[i] - v) * k);
    // whole-frame exposure -> garment brightness (dark room => darker hoodie)
    let all = 0; const dd = this.lowCtx.getImageData(0, 0, lw, lh).data;
    for (let i = 0; i < dd.length; i += 4) all += 0.2126 * dd[i] + 0.7152 * dd[i + 1] + 0.0722 * dd[i + 2];
    all /= (dd.length / 4) * 255;
    const light = Math.min(1.04, Math.max(0.55, 0.5 + all * 0.95));
    S.light += (light - S.light) * k;
  }

  // view: cover-fit rect of the camera frame on the canvas {sx,sy,sw,sh,mirror}
  // pose: screen-px joints; occ: {head:{c,r,ang}|null, hands:[{a,b,r}|null,...]}
  render(source, view, pose, occ) {
    const gl = this.gl, W = this.canvas.width, H = this.canvas.height;
    gl.bindTexture(gl.TEXTURE_2D, this.tex.video);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); } catch (e) { return false; }
    this._updateScene(source, view.srcW, view.srcH);
    this._view = view;

    // ---- garment pass ----
    const [fw, fh] = this.fboSize;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo); gl.viewport(0, 0, fw, fh);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    const placed = pose && this._drawGarment(pose);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);

    // ---- composite ----
    const P = this.cp; gl.useProgram(P.p); gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    const loc = P.a('aPos'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    [[this.tex.video, 'uVideo'], [this.fboTex, 'uGarment'], [this.tex.low, 'uLow'], [this.tex.mask, 'uMask']].forEach(([t, n], i) => {
      gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(P.u[n], i);
    });
    gl.activeTexture(gl.TEXTURE0);
    const S = this.scene;
    gl.uniform2f(P.u.uRes, W, H);
    gl.uniform4f(P.u.uView, view.sx, view.sy, view.sw, view.sh);
    gl.uniform1f(P.u.uMirror, view.mirror ? 1 : 0);
    gl.uniform1f(P.u.uHasMask, this.hasMask ? 1 : 0);
    gl.uniform1f(P.u.uMeanLum, S.meanLum);
    gl.uniform1f(P.u.uLight, S.light);
    gl.uniform3f(P.u.uTint, S.tint[0], S.tint[1], S.tint[2]);
    gl.uniform1f(P.u.uShade, 0.4);
    gl.uniform1f(P.u.uTime, performance.now() / 1000);
    const h = occ && occ.head;
    gl.uniform4f(P.u.uHead, h ? h.c[0] : 0, h ? h.c[1] : 0, h ? h.r[0] : 0, h ? h.r[1] : 0);
    gl.uniform1f(P.u.uHeadAng, h ? h.ang : 0);
    const hands = new Float32Array(8), radii = new Float32Array(2);
    (occ && occ.hands || []).forEach((c, i) => { if (!c || i > 1) return; hands.set([c.a[0], c.a[1], c.b[0], c.b[1]], i * 4); radii[i] = c.r; });
    gl.uniform4fv(P.u.uHandA, hands); gl.uniform1fv(P.u.uHandR, radii);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return !!placed;
  }

  _drawLayer(pos, tex) {
    const gl = this.gl, P = this.gp;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
    const a = P.a('aPos'); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
    const b = P.a('aUV'); gl.enableVertexAttribArray(b); gl.vertexAttribPointer(b, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.drawElements(gl.TRIANGLES, this.garment.nIdx, gl.UNSIGNED_SHORT, 0);
  }

  _drawGarment(pose) {
    const g = this.garment; if (!g || !pose.r_shoulder || !pose.l_shoulder) return false;
    const gl = this.gl, kp = g.kp, P = this.gp;
    gl.useProgram(P.p); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(P.u.uTex, 0);
    // garment drawn in canvas px but into the smaller buffer
    gl.uniform2f(P.u.uRes, this.canvas.width, this.canvas.height);

    const mid = lerp2(pose.r_shoulder, pose.l_shoulder, 0.5);
    const rS = add(mid, mul(sub(pose.r_shoulder, mid), this.fit));
    const lS = add(mid, mul(sub(pose.l_shoulder, mid), this.fit));
    const sMidSrc = lerp2(kp.r_shoulder, kp.l_shoulder, 0.5), hMidSrc = lerp2(kp.r_hip, kp.l_hip, 0.5);
    const shW = len(sub(lS, rS)), shWsrc = len(sub(kp.l_shoulder, kp.r_shoulder));
    const sv = mul(sub(lS, rS), 1 / (shW || 1));
    let down = [-sv[1], sv[0]]; if (down[1] < 0) down = mul(down, -1);
    const ratio = len(sub(hMidSrc, sMidSrc)) / shWsrc;
    let hipMid = add(mid, mul(down, ratio * shW));
    if (pose.r_hip && pose.l_hip) {
      const real = lerp2(pose.r_hip, pose.l_hip, 0.5);
      if (len(sub(real, mid)) > 0.6 * ratio * shW) hipMid = lerp2(hipMid, real, 0.65);
    }
    hipMid = add(mid, mul(sub(hipMid, mid), this.length));
    const T = affineFrom3([kp.r_shoulder, kp.l_shoulder, hMidSrc], [rS, lS, hipMid]);
    const tScale = Math.sqrt(Math.abs(T.det)), flip = T.det < 0 ? -1 : 1;
    // ---- silhouette fit: widen the body of the garment so it covers the shopper's own clothes ----
    const srcC = (v) => lerp2(sMidSrc, hMidSrc, v);
    const fitAt = (v) => {
      const m = this.maskCPU, view = this._view; if (!m || !view) return 1;
      const c0 = srcC(v), c = applyAff(T, c0), e = sub(applyAff(T, [c0[0] + 1, c0[1]]), c), hx = len(e) || 1, dir = mul(e, 1 / hx);
      const sample = (p) => { let u = (p[0] - view.sx) / view.sw; const vv = (p[1] - view.sy) / view.sh; if (view.mirror) u = 1 - u;
        if (u < 0 || u > 1 || vv < 0 || vv > 1) return -1; return m.data[Math.floor(vv * (m.h - 1)) * m.w + Math.floor(u * (m.w - 1))] / 255; };
      if (sample(c) < 0.5) return null;            // row not on the body / out of frame
      const step = Math.max(2, shW / 60), maxD = shW * 1.25, edge = (sgn) => { let d = 0, miss = 0, last = 0;
        while (d < maxD) { d += step; const val = sample(add(c, mul(dir, d * sgn))); if (val < 0) return null; if (val < 0.5) { if (++miss > 2) break; } else { miss = 0; last = d; } }
        return d >= maxD ? null : last; };
      const L = edge(-1), Rr = edge(1); if (L == null || Rr == null) return null;
      const want = Math.max(L, Rr) * 1.05 + step, have = g.halfAt(c0[1], c0[0]) * hx;
      return Math.min(1.45, Math.max(0.95, want / have));
    };
    const prof = this._prof || (this._prof = { chest: 1, waist: 1 });
    const fc = fitAt(0.4), fw = fitAt(0.85);
    if (fc) prof.chest += (fc - prof.chest) * 0.25;
    if (fw) prof.waist += (fw - prof.waist) * 0.25;
    const sAt = (v) => v <= 0 ? 1 : v < 0.4 ? 1 + (prof.chest - 1) * (v / 0.4) : v < 0.85 ? prof.chest + (prof.waist - prof.chest) * ((v - 0.4) / 0.45) : prof.waist;
    const vSpan = hMidSrc[1] - sMidSrc[1];
    const pre = (p) => { const v = (p[1] - sMidSrc[1]) / vSpan, cx = srcC(Math.min(1.3, Math.max(0, v)))[0]; return [cx + (p[0] - cx) * sAt(v), p[1]]; };
    const Tw = (p) => applyAff(T, pre(p));
    // sleeve thickness fit: measure the shopper's arm (incl. their own sleeve) outward from the bone
    const tCenter = lerp2(mid, hipMid, 0.3);
    const armFit = (key, A2, B2) => {
      const m = this.maskCPU, view = this._view, st = this._armProf || (this._armProf = {});
      if (st[key] == null) st[key] = tScale;
      if (m && view) {
        const M = lerp2(A2, B2, 0.5), v = sub(B2, A2), Lv = len(v);
        if (Lv > 4) {
          let n = mul([-v[1], v[0]], 1 / Lv); if (dot(n, sub(M, tCenter)) < 0) n = mul(n, -1);
          const sample = (p) => { let u = (p[0] - view.sx) / view.sw; const vv = (p[1] - view.sy) / view.sh; if (view.mirror) u = 1 - u;
            if (u < 0 || u > 1 || vv < 0 || vv > 1) return -1; return m.data[Math.floor(vv * (m.h - 1)) * m.w + Math.floor(u * (m.w - 1))] / 255; };
          if (sample(M) >= 0.5) {
            const step = Math.max(2, shW / 70); let d = 0, last = 0, miss = 0, ok = true;
            while (d < shW * 0.8) { d += step; const val = sample(add(M, mul(n, d))); if (val < 0) { ok = false; break; } if (val < 0.5) { if (++miss > 1) break; } else { miss = 0; last = d; } }
            if (ok && d < shW * 0.8) {
              const want = Math.min(tScale * 1.7, Math.max(tScale * 0.95, (last * 1.08 + step) / g.sleeveHalf[key]));
              st[key] += (want - st[key]) * 0.25;
            }
          }
        }
      }
      return st[key];
    };
    const arm = (side) => {
      const S = kp[side + '_shoulder'], E = kp[side + '_elbow'], Wr = kp[side + '_wrist'];
      const S2 = side === 'r' ? rS : lS;
      const E2 = pose[side + '_elbow'] || applyAff(T, E);
      const W2 = pose[side + '_wrist'] || (pose[side + '_elbow'] ? add(E2, sub(applyAff(T, Wr), applyAff(T, E))) : applyAff(T, Wr));
      const wu = armFit(side + '_up', S2, E2), wf = armFit(side + '_fore', E2, W2);
      return { up: boneXf(S, E, S2, E2, wu, flip), fore: boneXf(E, Wr, E2, W2, (wu + wf) / 2, flip) };
    };
    const R = arm('r'), Lf = arm('l'), out = g.out, V = g.verts;
    for (let i = 0; i < V.length; i++) { const q = Tw(V[i]); out[2 * i] = q[0]; out[2 * i + 1] = q[1]; }
    this._drawLayer(out, g.tex.torso);
    for (const [w, A, tex] of [[g.wR, R, g.tex.sleeve_r], [g.wL, Lf, g.tex.sleeve_l]]) {
      for (let i = 0; i < V.length; i++) {
        const p = V[i], [wt, wu, wf] = w[i]; let x = 0, y = 0;
        if (wt > 0) { const q = Tw(p); x += q[0] * wt; y += q[1] * wt; }
        if (wu > 0) { const q = A.up(p); x += q[0] * wu; y += q[1] * wu; }
        if (wf > 0) { const q = A.fore(p); x += q[0] * wf; y += q[1] * wf; }
        out[2 * i] = x; out[2 * i + 1] = y;
      }
      this._drawLayer(out, tex);
    }
    gl.disable(gl.BLEND);
    return true;
  }
}
