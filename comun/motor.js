/* ════════════════════════════════════════════════════════════════════════════
   Motor de las clases interactivas (compartido por todas las de animaciones/).
   Cada clase pone en el body <svg id="stage">, #hud, #menu > #grilla y #cargando; después carga este
   archivo, registra sus slide(nombre, build), completa TITULOS y llama a arrancar().
   Requiere MathJax (tex-svg) ya cargado.
   ════════════════════════════════════════════════════════════════════════════ */
const NS = 'http://www.w3.org/2000/svg';
const stage = document.getElementById('stage');
function E(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const smooth = v => { v = clamp(v); return v * v * v * (v * (v * 6 - 15) + 10); };
const P = (t, a, d = 1) => d <= 0 ? (t >= a ? 1 : 0) : smooth((t - a) / d);   // progreso suave
const lin = (t, a, d) => clamp((t - a) / d);                                    // progreso lineal
const lerp = (a, b, p) => a + (b - a) * p;
const C = n => `var(--${n})`;
const pathD = pts => 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');
const lerpPts = (A, B, p) => A.map((a, i) => [lerp(a[0], B[i][0], p), lerp(a[1], B[i][1], p)]);
const fmt = (v, d = 0) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

// FFT radix-2 (in place) y módulo de la DFT de una señal real
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], j = i + k + len / 2;
        const vr = re[j] * cr - im[j] * ci, vi = re[j] * ci + im[j] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[j] = ur - vr; im[j] = ui - vi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}
function modDFT(x) { const re = Float64Array.from(x), im = new Float64Array(x.length); fft(re, im); return Array.from({ length: x.length / 2 + 1 }, (_, k) => Math.hypot(re[k], im[k])); }
const hann = M => Array.from({ length: M }, (_, n) => Math.sin(Math.PI * n / M) ** 2);

/* ── mapas de color de los espectrogramas (de fondo a "mucha energía", uno por tema) ── */
const MAPAS = {
  claro: [[0, '#ffffff'], [.35, '#f2b38a'], [.7, '#c4420a'], [1, '#2a0c00']],
  oscuro: [[0, '#121315'], [.35, '#6a2a08'], [.7, '#ff8a3d'], [1, '#fff1dc']],
};
function colorMapa(v, mapa) {
  const st = MAPAS[mapa]; let i = 1; while (i < st.length - 1 && v > st[i][0]) i++;
  const [a, ca] = st[i - 1], [b, cb] = st[i], q = clamp((v - a) / (b - a));
  return [1, 3, 5].map(j => lerp(parseInt(ca.substr(j, 2), 16), parseInt(cb.substr(j, 2), 16), q));
}
// matriz v[fila][col] en [0,1] (fila 0 = frecuencia alta) → dataURL PNG
function pngMapa(v, mapa) {
  const h = v.length, w = v[0].length, cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d'), im = cx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = colorMapa(v[y][x], mapa), o = 4 * (y * w + x);
    im.data[o] = r; im.data[o + 1] = g; im.data[o + 2] = b; im.data[o + 3] = 255;
  }
  cx.putImageData(im, 0, 0);
  return cv.toDataURL();
}

/* ── audio ─────────────────────────────────────────────────────────────────── */
// Sólo suena cuando se avanza a un paso que lo pide: nunca al entrar a una slide.
const AUD = {}, PARLANTES = []; let sonando = null;
function sonar(n) {
  callar();
  if (!window.DATOS || !DATOS.audio[n] || window.__exportando) return;
  AUD[n] ??= new Audio('data:audio/mpeg;base64,' + DATOS.audio[n]);
  sonando = AUD[n]; sonando.currentTime = 0; sonando.play().catch(() => {});
}
function callar() { if (sonando) { sonando.pause(); sonando = null; } }

/* ── objetos ("mobjects") ─────────────────────────────────────────────────── */
class M {
  constructor(parent) { this.g = E('g', {}, parent); this.x = 0; this.y = 0; this.s = 1; }
  at(x, y, s = 1) { this.x = x; this.y = y; this.s = s; this.g.setAttribute('transform', `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${s})`); return this; }
  alpha(a) { this.g.style.opacity = a; this.g.style.visibility = a > 0.001 ? 'visible' : 'hidden'; return this; }
}

// Texto (CMU). write(p): se dibuja el contorno y después se rellena, como Write de Manim.
class Txt extends M {
  constructor(parent, str, o = {}) {
    super(parent);
    this.size = o.size || 40;
    this.t = E('text', { x: 0, y: 0, 'font-size': this.size, 'text-anchor': o.anchor || 'start' }, this.g);
    if (o.italic) this.t.setAttribute('font-style', 'italic');
    if (o.bold) this.t.setAttribute('font-weight', 700);
    this.t.textContent = str;
    const col = C(o.color || 'fg');
    Object.assign(this.t.style, { fill: col, stroke: col, strokeLinejoin: 'round' });
    if (o.x !== undefined) this.at(o.x, o.y);
    this.write(1);
  }
  get width() { return this.t.getComputedTextLength(); }
  write(p) {
    const L = this.size * 3.2, p1 = clamp(p / .6), p2 = clamp((p - .35) / .65);
    const st = this.t.style;
    st.strokeDasharray = `${L} ${L}`; st.strokeDashoffset = L * (1 - p1);
    st.strokeWidth = p >= 1 || p <= 0 ? 0 : this.size * .03 * (1 - p2);
    st.fillOpacity = p2; st.visibility = p > 0 ? 'visible' : 'hidden';
    return this;
  }
}

// Fórmula (MathJax → SVG con los glifos como paths). Origen = línea de base.
class Tex extends M {
  constructor(parent, src, o = {}) {
    super(parent);
    const size = o.size || 44, ex = size * 0.4306;
    const s = MathJax.tex2svg(src, { display: false }).querySelector('svg');
    const w = parseFloat(s.getAttribute('width')) * ex, h = parseFloat(s.getAttribute('height')) * ex;
    const va = parseFloat(((s.getAttribute('style') || '').match(/vertical-align:\s*(-?[\d.]+)ex/) || [0, 0])[1]) * ex;
    const x0 = o.anchor === 'middle' ? -w / 2 : o.anchor === 'end' ? -w : 0;
    s.setAttribute('x', x0); s.setAttribute('y', -h - va); s.setAttribute('width', w); s.setAttribute('height', h);
    s.removeAttribute('style'); s.style.overflow = 'visible';
    this.g.appendChild(s); this.g.style.color = C(o.color || 'fg');
    this.w = w; this.h = h; this.x0 = x0;
    this.parts = [...s.querySelectorAll('path,rect')];
    this.parts.forEach(q => q.tagName === 'path' && q.setAttribute('pathLength', 1));
    if (o.x !== undefined) this.at(o.x, o.y);
    this.write(1);
  }
  write(p) {
    const n = this.parts.length, lag = n > 1 ? .4 : 0;
    this.parts.forEach((q, i) => {
      const lp = clamp((p - (n > 1 ? i / (n - 1) * lag : 0)) / (1 - lag));
      if (q.tagName === 'rect') { q.style.opacity = lp; return; }
      const p1 = clamp(lp / .6), p2 = clamp((lp - .4) / .6), st = q.style;
      st.strokeDasharray = '1 1'; st.strokeDashoffset = 1 - p1;
      st.strokeWidth = lp >= 1 || lp <= 0 ? 0 : 26 * (1 - p2);
      st.fillOpacity = p2; st.visibility = lp > 0 ? 'visible' : 'hidden';
    });
    return this;
  }
}

// Texto con fórmulas intercaladas: 'espacio real · $x$'
class Mix extends M {
  constructor(parent, str, o = {}) {
    super(parent);
    const size = o.size || 40, inner = E('g', {}, this.g);
    this.parts = [];
    str.split('$').forEach((s, i) => {
      if (!s) return;
      let part;
      if (i % 2) { part = new Tex(inner, s, { size: size * 1.04, color: o.color }); part.wd = part.w; }
      else {
        if (!s.trim()) { this.parts.length && (this.parts.at(-1).trail = true); return; }
        part = new Txt(inner, s.trim(), { size, color: o.color, italic: o.italic, bold: o.bold });
        part.wd = part.width; part.lead = /^\s/.test(s); part.trail = /\s$/.test(s);
      }
      this.parts.push(part);
    });
    let x = 0;
    this.parts.forEach((p, i) => {
      if (i && (this.parts[i - 1].trail || p.lead)) x += size * .27;
      p.at(x, 0); x += p.wd;
    });
    this.w = x;
    inner.setAttribute('transform', `translate(${o.anchor === 'middle' ? -x / 2 : o.anchor === 'end' ? -x : 0},0)`);
    if (o.x !== undefined) this.at(o.x, o.y);
  }
  write(p) {
    let acc = 0;
    // cada parte arranca según su posición y la última termina justo en p = 1
    this.parts.forEach(q => { const a = acc / this.w, b = (acc + q.wd) / this.w; acc += q.wd; q.write(clamp((p - .75 * a) / (.25 + .75 * (b - a)))); });
    return this;
  }
}

// Curva (polilínea). create(p) la dibuja de punta a punta.
class Curve extends M {
  constructor(parent, pts, o = {}) {
    super(parent);
    this.p = E('path', { fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round', pathLength: 1 }, this.g);
    Object.assign(this.p.style, { stroke: C(o.color || 'x'), strokeWidth: o.width || 5 });
    if (o.clip) this.g.setAttribute('clip-path', `url(#${o.clip})`);
    this.dash = o.dash;
    if (pts) this.set(pts);
    this.create(1);
  }
  set(pts) { this.pts = pts; this.p.setAttribute('d', pathD(pts)); return this; }
  create(p) {
    if (this.dash) { this.p.removeAttribute('pathLength'); this.p.style.strokeDasharray = this.dash; this.alpha(p); return this; }
    this.p.style.strokeDasharray = '1 1'; this.p.style.strokeDashoffset = 1 - p;
    this.p.style.visibility = p > 0 ? 'visible' : 'hidden';
    return this;
  }
}

// Espectro como "stem plot": un palito por frecuencia, con punto si son pocos.
// set(tops, p, base): tops = [[x, y]]; p = progreso de aparición (de izquierda a derecha).
class Stems extends M {
  constructor(parent, base, o = {}) {
    super(parent);
    this.base = base; this.r = o.r ?? 6;
    const col = C(o.color || 'k');
    this.p = E('path', { fill: 'none' }, this.g);
    Object.assign(this.p.style, { stroke: col, strokeWidth: o.width || 3.5 });
    this.d = E('path', {}, this.g); this.d.style.fill = col;
  }
  set(tops, p = 1, base = this.base) {
    const n = tops.length, r = this.r; let d = '', dd = '';
    tops.forEach(([x, y], i) => {
      const q = smooth(p * 1.6 - i / n * .6); if (q <= 0) return;
      const yt = lerp(base, y, q); if (Math.abs(base - yt) < .8) return;   // también para abajo (valores negativos)
      d += `M${x.toFixed(1)},${base.toFixed(1)}V${yt.toFixed(1)}`;
      if (r > 0 && q > .5) { const rr = r * clamp(q * 2 - 1); dd += `M${(x - rr).toFixed(1)},${yt.toFixed(1)}a${rr},${rr} 0 1,0 ${2 * rr},0a${rr},${rr} 0 1,0 ${-2 * rr},0`; }
    });
    this.p.setAttribute('d', d || 'M0,0'); this.d.setAttribute('d', dd || 'M0,0');
    return this;
  }
}

// Flecha recta. grow(p) la estira desde el origen.
class Arrow extends M {
  constructor(parent, x1, y1, x2, y2, o = {}) {
    super(parent);
    Object.assign(this, { x1, y1, x2, y2, hl: o.head || 22 });
    const col = C(o.color || 'fg');
    this.l = E('line', { 'stroke-linecap': 'butt' }, this.g);
    Object.assign(this.l.style, { stroke: col, strokeWidth: o.width || 4 });
    if (o.dash) this.l.style.strokeDasharray = o.dash;
    this.h = E('path', { d: `M0,0L${-this.hl},${-this.hl * .42}L${-this.hl * .78},0L${-this.hl},${this.hl * .42}Z` }, this.g);
    this.h.style.fill = col;
    this.grow(1);
  }
  grow(p) {
    const { x1, y1, x2, y2, hl } = this, L = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / L, uy = (y2 - y1) / L;
    const x = lerp(x1, x2, p), y = lerp(y1, y2, p), back = Math.min(hl * .8, L * p);
    this.l.setAttribute('x1', x1); this.l.setAttribute('y1', y1);
    this.l.setAttribute('x2', x - ux * back); this.l.setAttribute('y2', y - uy * back);
    this.h.setAttribute('transform', `translate(${x},${y}) rotate(${Math.atan2(uy, ux) * 180 / Math.PI}) scale(${clamp(p * 4)})`);
    this.alpha(p > 0 ? 1 : 0);
    return this;
  }
}

// Ejes cartesianos (y lineal o logarítmica en décadas). xticks/yticks: [[valor, 'tex']].
class Axes extends M {
  constructor(parent, o) {
    super(parent);
    Object.assign(this, o);   // x0 x1 y0 y1 xr yr log base(valor y del eje x) ejeY(valor x del eje y)
    const yb = this.yb = this.Y(o.base ?? o.yr[0]), xa = this.xa = this.X(o.ejeY ?? o.xr[0]);
    this.ax = new Curve(this.g, [[this.x0 - 6, yb], [this.x1 + 26, yb]], { color: 'ax', width: 2.5 });
    this.ay = new Curve(this.g, [[xa, this.y1 + 6], [xa, this.y0 - 26]], { color: 'ax', width: 2.5 });
    const hd = 'M0,0L-14,-6.5L-11,0L-14,6.5Z';
    this.hx = E('path', { d: hd, transform: `translate(${this.x1 + 30},${yb})` }, this.g);
    this.hy = E('path', { d: hd, transform: `translate(${xa},${this.y0 - 30}) rotate(-90)` }, this.g);
    this.hx.style.fill = this.hy.style.fill = C('ax');
    this.extra = [];
    if (o.xlabel) this.extra.push(new Tex(this.g, o.xlabel, { size: 36, x: this.x1 + 30, y: yb + 44, anchor: 'middle', color: 'ax' }));
    let marcas = '';
    for (const [v, s] of o.xticks || []) { marcas += `M${this.X(v)},${yb}v9`; this.extra.push(new Tex(this.g, s, { size: 28, x: this.X(v), y: yb + 38, anchor: 'middle', color: 'dim' })); }
    for (const [v, s] of o.yticks || []) { marcas += `M${xa},${this.Y(v)}h-9`; this.extra.push(new Tex(this.g, s, { size: 28, x: xa - 16, y: this.Y(v) + 10, anchor: 'end', color: 'dim' })); }
    this.marcas = E('path', { d: marcas || 'M0,0' }, this.g);
    Object.assign(this.marcas.style, { stroke: C('ax'), strokeWidth: 2.5 });
  }
  X(u) { return this.x0 + (u - this.xr[0]) / (this.xr[1] - this.xr[0]) * (this.x1 - this.x0); }
  Y(v) {
    if (this.log) v = Math.log10(Math.max(v, 10 ** this.yr[0]));
    return this.y1 - (clamp(v, this.yr[0], Infinity) - this.yr[0]) / (this.yr[1] - this.yr[0]) * (this.y1 - this.y0);
  }
  pts(xs, ys) { return xs.map((u, i) => [this.X(u), this.Y(ys[i])]); }
  create(p) {
    this.ax.create(p); this.ay.create(p);
    this.hx.style.opacity = this.hy.style.opacity = this.marcas.style.opacity = clamp(p * 3 - 2);
    this.extra.forEach(e => e.write(clamp(p * 2 - 1)));
    return this;
  }
}

// Línea punteada que crece (divisor entre los dos mundos).
class DLine extends M {
  constructor(parent, x1, y1, x2, y2, o = {}) {
    super(parent);
    Object.assign(this, { x1, y1, x2, y2 });
    this.l = E('line', { x1, y1, 'stroke-linecap': 'round' }, this.g);
    Object.assign(this.l.style, { stroke: C(o.color || 'tenue'), strokeWidth: o.width || 3.5, strokeDasharray: o.dash || '3 11' });
    this.grow(1);
  }
  grow(p) { this.l.setAttribute('x2', lerp(this.x1, this.x2, p)); this.l.setAttribute('y2', lerp(this.y1, this.y2, p)); this.alpha(p > 0 ? 1 : 0); return this; }
}

// Imagen (dataURL) con una versión por tema; reveal(p) la descubre de izquierda a derecha.
class Img extends M {
  constructor(parent, urls, x, y, w, h) {
    super(parent);
    const id = 'clip' + Math.random().toString(36).slice(2, 8);
    const cp = E('clipPath', { id }, this.g);
    this.r = E('rect', { x, y, width: w, height: h }, cp);
    Object.assign(this, { x0: x, w });
    for (const [tema, url] of Object.entries(urls))
      E('image', { href: url, x, y, width: w, height: h, preserveAspectRatio: 'none', class: 'solo-' + tema, 'clip-path': `url(#${id})` }, this.g);
  }
  reveal(p) { this.r.setAttribute('x', this.x0); this.r.setAttribute('width', Math.max(0, this.w * p)); this.alpha(p > 0 ? 1 : 0); return this; }
  cambiar(urls, x, w) {   // otra imagen (y otro ancho) en el mismo lugar
    this.x0 = x; this.w = w;
    for (const im of this.g.querySelectorAll('image')) {
      const tema = im.getAttribute('class').replace('solo-', '');
      im.setAttribute('href', urls[tema]); im.setAttribute('x', x); im.setAttribute('width', w);
    }
    return this;
  }
  ventana(xa, xb) { this.r.setAttribute('x', xa); this.r.setAttribute('width', Math.max(0, xb - xa)); return this; }
}

// Parlante clickeable: reproduce un audio (o el que devuelva la función).
class Parlante extends M {
  constructor(parent, x, y, nombre, o = {}) {
    super(parent);
    this.g.classList.add('parlante');
    const s = o.size || 1.5, col = 'var(--parl, var(--dim))';
    this.nombre = nombre; PARLANTES.push(this);
    const inner = E('g', { transform: `scale(${s}) translate(-12,-12)` }, this.g);
    E('rect', { x: -4, y: -4, width: 32, height: 32, fill: 'transparent' }, inner);
    const cuerpo = E('path', { d: 'M3,9h4l5,-4.5v15l-5,-4.5h-4z' }, inner); cuerpo.style.fill = col;
    const ondas = E('path', { d: 'M15.5,8.5a5,5 0 0 1 0,7M18.5,5.5a9,9 0 0 1 0,13', fill: 'none', 'stroke-linecap': 'round' }, inner);
    Object.assign(ondas.style, { stroke: col, strokeWidth: 2 });
    this.g.addEventListener('click', e => { e.stopPropagation(); sonar(typeof nombre === 'function' ? nombre() : nombre); });
    this.at(x, y);
  }
}

// Cabezal de reproducción: una barra que recorre la onda mientras suena alguno de sus audios.
// Va sincronizado con el audio real (no con la línea de tiempo), así anda también con el parlante.
const CABEZALES = [];
class Cabezal {
  constructor(parent, nombres, x0, x1, y0, y1, dur) {
    Object.assign(this, { nombres, x0, x1, dur });
    this.g = E('g', {}, parent);
    this.sombra = E('rect', { y: y0, height: y1 - y0, x: x0, width: 0 }, this.g);
    Object.assign(this.sombra.style, { fill: C('h'), opacity: .12 });
    this.l = E('line', { y1: y0, y2: y1, 'stroke-linecap': 'round' }, this.g);
    Object.assign(this.l.style, { stroke: C('h'), strokeWidth: 4 });
    CABEZALES.push(this);
    this.actualizar();
  }
  actualizar() {
    const n = sonando && !sonando.paused && this.nombres.find(k => AUD[k] === sonando);
    this.g.style.display = n ? '' : 'none';
    if (!n) return;
    const x = lerp(this.x0, this.x1, clamp(sonando.currentTime / this.dur));
    this.l.setAttribute('x1', x); this.l.setAttribute('x2', x);
    this.sombra.setAttribute('width', x - this.x0);
  }
}

// Fondo para que una etiqueta tape el divisor punteado
function tapa(g, x, y, w, h) { const r = E('rect', { x: x - w / 2, y: y - h / 2, width: w, height: h }, g); r.style.fill = C('bg'); return r; }
// Rótulo de un panel, arriba a la izquierda
const rotulo = (g, s, b, col, dx = 18) => new Tex(g, s, { size: 38, x: b.x0 + dx, y: b.y0 - 8, color: col });
// Franja inferior: varias leyendas que se reemplazan [texto, desde, hasta]
function leyendas(g, lista, o = {}) {
  const ls = lista.map(([s, a, b]) => ({ m: new Mix(g, s, { size: o.size || 40, x: 960, y: o.y || 1000, anchor: 'middle', italic: o.italic }), a, b: b ?? 1e9 }));
  return t => ls.forEach(l => { l.m.write(P(t, l.a, .9)); l.m.alpha(1 - P(t, l.b, .35)); });
}

/* ── controles: todos cortan la propagación del pointerdown, así tocarlos nunca pasa de slide ── */
// Punto del stage (coordenadas 1920 × 1080) de un evento de puntero
function aStage(e) {
  const pt = stage.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(stage.getScreenCTM().inverse());
}
// Arrastre con mouse o dedo: mover(q) con q en coordenadas del stage, desde el pointerdown hasta soltar.
function arrastrable(el, mover, soltar) {
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault(); el.setPointerCapture(e.pointerId); mover(aStage(e));
    const mv = e2 => mover(aStage(e2));
    const fin = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', fin); el.removeEventListener('pointercancel', fin); soltar?.(); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', fin); el.addEventListener('pointercancel', fin);
  });
}
// Click (o toque) en un control: no pasa de slide.
function clickeable(el, f) {
  el.style.cursor = 'pointer';
  el.addEventListener('pointerdown', e => e.stopPropagation());
  el.addEventListener('click', e => { e.stopPropagation(); f(e); });
}
// Recolorea un Mix (texto + fórmulas)
function colorMix(m, col) {
  m.parts.forEach(q => q instanceof Tex ? q.g.style.color = C(col) : Object.assign(q.t.style, { fill: C(col), stroke: C(col) }));
}
// Punto arrastrable (con halo, para que se note que se puede agarrar). Se ubica con at(x, y).
class Manija extends M {
  constructor(parent, color, mover, o = {}) {
    super(parent);
    const halo = E('circle', { r: o.halo || 24 }, this.g); Object.assign(halo.style, { fill: C(color), opacity: .16 });
    const pto = E('circle', { r: o.r || 9 }, this.g); pto.style.fill = C(color);
    const zona = E('circle', { r: 34, fill: 'transparent' }, this.g); zona.style.cursor = 'grab';
    arrastrable(zona, mover);
  }
}
// Pastillas: botones excluyentes en fila (o en columna, con vertical: true). opciones = [[valor, 'texto con $tex$']].
class Pastillas extends M {
  constructor(parent, x, y, opciones, alCambiar, o = {}) {
    super(parent);
    this.alCambiar = alCambiar; this.valor = o.valor ?? opciones[0][0];
    const size = o.size || 28, h = size * 1.65, gap = size * .45; let xs = 0, ys = 0;
    this.b = opciones.map(([v, s]) => {
      const b = E('g', {}, this.g);
      const r = E('rect', { height: h, rx: h / 2 }, b);
      const t = new Mix(b, s, { size, anchor: 'middle' }), w = t.w + size * 1.6;
      r.setAttribute('x', xs); r.setAttribute('y', ys - h / 2 - size * .34); r.setAttribute('width', w); t.at(xs + w / 2, ys);
      if (o.vertical) ys += h + gap; else xs += w + gap;
      clickeable(b, () => this.elegir(v));
      return { v, r, t, w };
    });
    this.w = o.vertical ? Math.max(...this.b.map(q => q.w)) : xs - gap;
    this.at(o.anchor === 'middle' ? x - this.w / 2 : o.anchor === 'end' ? x - this.w : x, y);
    this.pintar();
  }
  elegir(v, avisar = true) { const cambio = v !== this.valor; this.valor = v; this.pintar(); if (avisar && cambio) this.alCambiar?.(v); return this; }
  pintar() {
    for (const { v, r, t } of this.b) {
      const on = v === this.valor;
      Object.assign(r.style, { fill: on ? C('h') : 'transparent', fillOpacity: on ? .14 : 0, stroke: C(on ? 'h' : 'tenue'), strokeWidth: on ? 3 : 2 });
      colorMix(t, on ? 'h' : 'dim');
    }
  }
}
// Deslizador sobre una lista de valores; texto(v) arma el rótulo que va a la derecha.
class Deslizador extends M {
  constructor(parent, x0, x1, y, valores, alCambiar, o = {}) {
    super(parent);
    Object.assign(this, { x0, x1, valores, alCambiar, i: o.inicial ?? 0, texto: o.texto || String });
    if (o.rotulo) new Mix(this.g, o.rotulo, { size: 28, x: x0, y: y - 30, italic: true, color: 'dim' });
    const pista = E('line', { x1: x0, x2: x1, y1: y, y2: y, 'stroke-linecap': 'round' }, this.g);
    Object.assign(pista.style, { stroke: C('tenue'), strokeWidth: 5 });
    if (valores.length <= 16) valores.forEach((_, i) => { const d = E('circle', { cx: this.X(i), cy: y, r: 4 }, this.g); d.style.fill = C('tenue'); });
    this.perilla = E('circle', { cy: y, r: 13 }, this.g); this.perilla.style.fill = C('h');
    this.rot = new Mix(this.g, '', { size: 34 }); this.yv = y;
    const zona = E('rect', { x: x0 - 20, y: y - 26, width: x1 - x0 + 40, height: 52, fill: 'transparent' }, this.g);
    zona.style.cursor = 'ew-resize';
    arrastrable(zona, q => this.elegir(Math.round(clamp((q.x - x0) / (x1 - x0)) * (valores.length - 1))));
    this.pintar();
  }
  X(i) { return lerp(this.x0, this.x1, i / (this.valores.length - 1)); }
  get v() { return this.valores[this.i]; }
  elegir(i, avisar = true) { const cambio = i !== this.i; this.i = i; this.pintar(); if (avisar && cambio) this.alCambiar?.(this.v); return this; }
  pintar() {
    this.perilla.setAttribute('cx', this.X(this.i));
    const s = this.texto(this.v);
    if (s !== this.sRot) {   // el rótulo puede llevar fórmulas: se rehace sólo si cambia
      this.sRot = s; this.rot.g.remove();
      this.rot = new Mix(this.g, s, { size: 34, x: this.x1 + 36, y: this.yv + 12, color: 'h' });
    }
  }
}
// Fórmula seguida de un número que se actualiza: new Lectura(g, 'c = ', {...}).set(0.5)
class Lectura extends M {
  constructor(parent, tex, o = {}) {
    super(parent);
    this.size = o.size || 38; this.col = o.color;
    this.n = new Txt(this.g, '', { size: this.size, color: o.colorNum || o.color || 'fg' });
    this.formula(tex);
    if (o.x !== undefined) this.at(o.x, o.y);
  }
  formula(tex) {   // cambia la fórmula (el número se corre detrás)
    if (tex === this.src) return this;
    this.src = tex; this.tx?.g.remove();
    this.tx = new Tex(this.g, tex, { size: this.size, color: this.col }); this.n.at(this.tx.w + this.size * .3, 0);
    return this;
  }
  set(v, d = 2) { this.n.t.textContent = typeof v === 'string' ? v : num(v, d); return this; }
  color(col) { Object.assign(this.n.t.style, { fill: C(col), stroke: C(col) }); return this; }
  write(p) { this.tx.write(p); this.n.write(p); return this; }
}
// Fórmula (o texto con fórmulas, con mix: true) que cambia según el estado de la slide: se rehace sólo cuando cambia.
class TexVar extends M {
  constructor(parent, o = {}) { super(parent); this.o = { ...o, x: undefined }; if (o.x !== undefined) this.at(o.x, o.y); }
  set(src) { if (src !== this.src) { this.src = src; this.tx?.g.remove(); this.tx = this.o.mix ? new Mix(this.g, src, this.o) : new Tex(this.g, src, this.o); } return this; }
  get w() { return this.tx?.w ?? 0; }
  write(p) { this.tx?.write(p); return this; }
}
// Número con coma decimal y sin "-0,00"
const num = (v, d = 2) => fmt(Math.abs(v) < .5 * 10 ** -d ? 0 : v, d);

/* ── registro de slides ───────────────────────────────────────────────────── */
const DEF = [];
const slide = (nombre, build) => DEF.push({ nombre, build });
function sinDatos(g) {
  new Txt(g, 'Faltan los datos: correr preparar_datos.py', { size: 44, x: 960, y: 540, anchor: 'middle', color: 'dim' });
  return { steps: [0], render() {} };
}

/* ════════════════════════════════════════════════════════════════════════════
   Navegación
   ════════════════════════════════════════════════════════════════════════════ */
let SL = [], cur = 0, step = 0, anim = null;
const hud = document.getElementById('hud');
function mostrar(i) { SL.forEach((s, j) => s.g.style.display = j === i ? '' : 'none'); hud.textContent = `${i + 1} / ${SL.length}`; }
function pintar(i, t) { SL[i].render(t); }
function tocar(i, k) {
  SL[i].reset?.();
  const b = SL[i].b; anim = { i, from: b[k], to: b[k + 1], t0: performance.now() };
  const a = SL[i].audio?.[k]; if (a) sonar(a);
}
function hash() { history.replaceState(null, '', `#${cur + 1}.${step}`); }
function siguiente() {
  if (anim) { pintar(anim.i, anim.to); anim = null; return; }
  const s = SL[cur];
  if (step < s.steps.length - 1) { step++; tocar(cur, step); }
  else if (cur < SL.length - 1) { callar(); cur++; step = 0; mostrar(cur); pintar(cur, 0); tocar(cur, 0); }
  hash();
}
function anterior() {
  anim = null; callar();
  if (step > 0) step--;
  else if (cur > 0) { cur--; step = SL[cur].steps.length - 1; mostrar(cur); }
  SL[cur].reset?.(); pintar(cur, SL[cur].b[step + 1]); hash();
}
function ir(i, k) { anim = null; callar(); cur = clamp(i, 0, SL.length - 1); step = clamp(k, 0, SL[cur].steps.length - 1); mostrar(cur); SL[cur].reset?.(); pintar(cur, SL[cur].b[step + 1]); hash(); }
// Menú de slides con miniaturas (estado final de cada una). Se arma la primera vez que se abre.
const menu = document.getElementById('menu'), grilla = document.getElementById('grilla');
const TITULOS = {};   // nombre de slide → título en el menú (lo completa cada clase)
let miniaturas = null;
function armarMiniaturas() {
  miniaturas = SL.map((s, i) => {
    s.render(s.b.at(-1));
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 1920 1080');
    const copia = s.g.cloneNode(true); copia.style.display = '';
    copia.querySelectorAll('[id]').forEach(el => {   // ids únicos (clipPath, gradientes) para no pisar a los originales
      const viejo = el.id; el.id = `${viejo}-m${i}`;
      for (const at of ['clip-path', 'fill']) copia.querySelectorAll(`[${at}="url(#${viejo})"]`).forEach(r => r.setAttribute(at, `url(#${el.id})`));
    });
    svg.appendChild(copia);
    const d = document.createElement('div'), rot = document.createElement('div');
    d.className = 'mini'; rot.textContent = `${i + 1}  ·  ${TITULOS[s.nombre] ?? s.nombre}`;
    d.append(svg, rot);
    d.addEventListener('click', e => { e.stopPropagation(); cerrarMenu(); ir(i, 0); });
    grilla.appendChild(d);
    return d;
  });
  pintar(cur, SL[cur].b[step + 1]);
}
function abrirMenu() {
  if (anim) { pintar(anim.i, anim.to); anim = null; }
  if (!miniaturas) armarMiniaturas();
  miniaturas.forEach((d, i) => d.classList.toggle('actual', i === cur));
  menu.hidden = false; miniaturas[cur].scrollIntoView({ block: 'nearest' });
}
function cerrarMenu() { menu.hidden = true; }
hud.addEventListener('click', e => { e.stopPropagation(); menu.hidden ? abrirMenu() : cerrarMenu(); });

function bucle(now) {
  // el parlante del audio que está sonando se pinta de verde
  for (const p of PARLANTES) {
    const n = typeof p.nombre === 'function' ? p.nombre() : p.nombre;
    p.g.style.setProperty('--parl', sonando && !sonando.paused && sonando === AUD[n] ? 'var(--h)' : 'var(--dim)');
  }
  CABEZALES.forEach(c => c.actualizar());
  if (anim) { const t = anim.from + (now - anim.t0) / 1000; if (t >= anim.to) { pintar(anim.i, anim.to); anim = null; } else pintar(anim.i, t); }
  requestAnimationFrame(bucle);
}
addEventListener('keydown', e => {
  if (['ArrowRight', 'ArrowDown', ' ', 'PageDown', 'Enter'].includes(e.key)) { e.preventDefault(); siguiente(); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); anterior(); }
  else if (e.key === 'Home') ir(0, 0);
  else if (e.key === 'End') ir(SL.length - 1, 99);
  else if (e.key === 'Escape') { callar(); cerrarMenu(); }
  else if (e.key === 'm' || e.key === 'M') menu.hidden ? abrirMenu() : cerrarMenu();
  else if (e.key === 't' || e.key === 'T') { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('tema', r.dataset.theme); } catch (_) {} }
  else if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); }
});
// Un click que empezó en un control (slider, botón, punto arrastrable) no pasa de slide, aunque se suelte en otro lado:
// los controles cortan la propagación del pointerdown, así que sólo los clicks "de fondo" llegan a stage.
let desdeControl = false;
addEventListener('pointerdown', () => desdeControl = true, true);
stage.addEventListener('pointerdown', () => desdeControl = false);
stage.addEventListener('click', () => {
  if (desdeControl || trasDeslizar) { desdeControl = trasDeslizar = false; return; }
  menu.hidden ? siguiente() : cerrarMenu();
});
// En el celular, además de tocar: deslizar a la izquierda avanza y a la derecha retrocede. El pointerdown llega
// antes que el touchstart, así que un gesto que empieza en un control (desdeControl) no cuenta.
let toque = null, trasDeslizar = false;
stage.addEventListener('touchstart', e => {
  trasDeslizar = false;
  toque = e.touches.length === 1 && !desdeControl && menu.hidden ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
}, { passive: true });
stage.addEventListener('touchend', e => {
  if (!toque) return;
  const dx = e.changedTouches[0].clientX - toque.x, dy = e.changedTouches[0].clientY - toque.y; toque = null;
  if (Math.abs(dx) < 50 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
  trasDeslizar = true;   // por si el navegador igual dispara el click del toque
  dx < 0 ? siguiente() : anterior();
});

// Para capturas automáticas: renderiza la slide i en el paso k, a una fracción del tramo.
window.__goto = (i, k, frac = 1) => { window.__exportando = true; anim = null; cur = i; step = k; mostrar(i); const b = SL[i].b; pintar(i, lerp(b[k], b[k + 1], frac)); };

// Arranque: lo llama cada clase al final, después de registrar sus slides.
async function arrancar() {
  try { const tm = localStorage.getItem('tema'); if (tm) document.documentElement.dataset.theme = tm; } catch (_) {}
  await MathJax.startup.promise;
  await Promise.all(['40px CMU', 'italic 40px CMU', 'bold 40px CMU'].map(f => document.fonts.load(f)));
  SL = DEF.map(d => {
    const g = E('g', { 'data-slide': d.nombre }, stage);
    const s = d.build(g); s.g = g; s.nombre = d.nombre;
    s.b = [0]; s.steps.forEach(v => s.b.push(s.b.at(-1) + v));
    return s;
  });
  window.__slides = SL.map(s => ({ nombre: s.nombre, pasos: s.steps.length }));
  document.getElementById('cargando').remove();
  const m = location.hash.match(/#(\d+)\.(\d+)/);
  if (m) ir(+m[1] - 1, +m[2]); else { mostrar(0); pintar(0, 0); tocar(0, 0); }
  window.__ready = true;
  requestAnimationFrame(bucle);
}
