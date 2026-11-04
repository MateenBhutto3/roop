import { products, formatPKR } from './products.js';
import { openTryOn } from '../tryon/tryon.js';
import { preloadWhenIdle } from '../tryon/engine.js';

const CAM = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

// ---------- bag (demo only, saved in this browser) ----------
const getBag = () => { try { return JSON.parse(localStorage.getItem('roop-bag') || '[]'); } catch (e) { return []; } };
const setBag = (b) => { try { localStorage.setItem('roop-bag', JSON.stringify(b)); } catch (e) {} renderBagCount(); };
function renderBagCount() { document.querySelectorAll('.bag-count').forEach((n) => (n.textContent = getBag().length)); }

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- try-on (loaded only when someone taps the button) ----------
async function tryOn(p) {
  if (!p.tryon) return;
  openTryOn({ name: p.name, ...p.tryon });
}

// ---------- home ----------
function renderHome() {
  const grid = document.querySelector('#grid'); if (!grid) return;
  grid.innerHTML = products.map((p) => `
    <div>
      <a class="card" href="product.html?id=${p.id}">
        <div class="card-img">${p.badge ? `<span class="badge"><i></i>${p.badge}</span>` : ''}<img src="${p.images[0]}" alt="${p.name}" loading="lazy"></div>
        <div class="card-body"><div><h3>${p.name}</h3><div class="sub">${p.colour}</div></div>
          <div class="price">${formatPKR(p.price)}</div></div>
      </a>
      ${p.tryon ? `<button class="btn outline card-try" data-try="${p.id}">${CAM} Try it on</button>` : ''}
    </div>`).join('') + `
    <div class="ghost-card">More drops landing soon —<br>shirts, jackets &amp; tees.</div>`;
  grid.addEventListener('click', (e) => {
    const b = e.target.closest('[data-try]'); if (!b) return;
    tryOn(products.find((p) => p.id === b.dataset.try));
  });
  document.querySelectorAll('[data-hero-try]').forEach((b) => (b.onclick = () => tryOn(products[0])));
}

// ---------- product page ----------
function renderProduct() {
  const root = document.querySelector('#pdp'); if (!root) return;
  const id = new URLSearchParams(location.search).get('id');
  const p = products.find((x) => x.id === id) || products[0];
  document.title = `${p.name} — ROOP`;
  const off = p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) : 0;
  root.innerHTML = `
    <div class="gallery">
      <div class="thumbs">${p.images.map((src, i) => `<button class="thumb${i ? '' : ' on'}" data-i="${i}" aria-label="Image ${i + 1}"><img src="${src}" alt=""></button>`).join('')}</div>
      <div class="main-img"><img id="mainImg" src="${p.images[0]}" alt="${p.name}"></div>
    </div>
    <div class="info">
      <div class="sub" style="color:var(--muted)">${p.category}</div>
      <h1>${p.name}</h1>
      <div class="price">${formatPKR(p.price)}${p.compareAt ? `<s>${formatPKR(p.compareAt)}</s><span class="save">−${off}%</span>` : ''}</div>
      <div class="opt"><div class="opt-label">Colour <span>${p.colour}</span></div><div class="swatch" title="${p.colour}"></div></div>
      <div class="opt"><div class="opt-label">Size <span id="sizeLbl">Select a size</span></div>
        <div class="sizes">${p.sizes.map((s) => `<button class="size" data-s="${s}">${s}</button>`).join('')}</div></div>
      <div class="buy">
        ${p.tryon ? `<div class="try-box">
          <div class="try-head"><i></i>Live try-on</div>
          <p>Open your camera and see this hoodie on you in real time. Runs on your phone — no video is uploaded.</p>
          <button class="btn block" id="tryBtn">${CAM} Try it on</button>
        </div>` : ''}
        <button class="btn outline block" id="addBtn">Add to bag — ${formatPKR(p.price)}</button>
      </div>
      <p class="desc">${p.description}</p>
      <details open><summary>Details</summary><ul>${p.details.map((d) => `<li>${d}</li>`).join('')}</ul></details>
      <details><summary>Delivery &amp; returns</summary><ul><li>Free delivery across Pakistan over Rs 3,000</li><li>Cash on delivery available</li><li>7-day exchange</li></ul></details>
    </div>`;
  const main = root.querySelector('#mainImg');
  root.querySelectorAll('.thumb').forEach((t) => (t.onclick = () => {
    root.querySelectorAll('.thumb').forEach((x) => x.classList.remove('on')); t.classList.add('on'); main.src = p.images[+t.dataset.i];
  }));
  let size = null;
  root.querySelectorAll('.size').forEach((b) => (b.onclick = () => {
    root.querySelectorAll('.size').forEach((x) => x.classList.remove('on')); b.classList.add('on'); size = b.dataset.s;
    root.querySelector('#sizeLbl').textContent = size;
  }));
  root.querySelector('#addBtn').onclick = () => {
    if (!size) { toast('Pick a size first'); return; }
    setBag([...getBag(), { id: p.id, size }]); toast(`Added — size ${size}`);
  };
  const tb = root.querySelector('#tryBtn'); if (tb) tb.onclick = () => tryOn(p);
  if (new URLSearchParams(location.search).has('try')) tryOn(p);
}

renderBagCount();
renderHome();
renderProduct();
// get the body tracker ready in the background so "Try it on" opens fast
if (products.some((p) => p.tryon)) preloadWhenIdle();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
