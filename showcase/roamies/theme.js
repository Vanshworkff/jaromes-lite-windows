// Colour themes (Jaromes Lite, by Vansh Bohra). Loaded first on every page (desktop, panel, setup guide). The app is
// drawn in one palette (BASE); a theme maps every colour of that palette to its own hues, everywhere at once: style
// sheets (and ones added later), inline styles, canvas drawing (fills, strokes, glows, gradients) and the characters'
// LED palettes. Changing theme recolours live, with no reload. The pick is shared by all pages through localStorage
// (same origin) and kept by the app in its settings (RoamieTheme.set from the app's state).
(() => {
  const BASE = 'pink';
  // dark: hue for the deep tones (backgrounds, lines); bright: hue for the glowing ones (text accents, LEDs).
  // sat scales saturation (mono is nearly grey). swatch: what the pickers show.
  const THEMES = {
    pink: { label: 'Pink & purple', dark: 282, bright: 318, swatch: ['#ff78d6', '#470e60'] },
    teal: { label: 'Teal', dark: 184, bright: 166, swatch: ['#78ffe2', '#0e5c60'] },
    blue: { label: 'Ocean blue', dark: 222, bright: 204, swatch: ['#78c8ff', '#0e2e60'] },
    purple: { label: 'Violet', dark: 262, bright: 272, swatch: ['#b78cff', '#2e0e60'] },
    green: { label: 'Matrix green', dark: 140, bright: 122, swatch: ['#8cff78', '#0e6018'] },
    orange: { label: 'Sunset orange', dark: 16, bright: 30, swatch: ['#ffb078', '#60200e'] },
    red: { label: 'Iron red', dark: 352, bright: 4, swatch: ['#ff7a78', '#600e14'] },
    gold: { label: 'Gold', dark: 38, bright: 46, swatch: ['#ffd978', '#604a0e'] },
    mono: { label: 'Mono', dark: 0, bright: 0, sat: 0, swatch: ['#ececec', '#333333'] },
  };
  const KEY = 'jaromes-theme';
  let cur = BASE;
  try { const t = new URLSearchParams(location.search).get('theme') || localStorage.getItem(KEY); if (THEMES[t]) cur = t; } catch {}

  // ---------- colour maths ----------
  function toHls(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, l, 0];
    const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, l, s];
  }
  function fromHls(h, l, s) {
    if (!s) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, k = (t) => {
      t = ((t % 1) + 1) % 1;
      return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    };
    const hh = h / 360;
    return [k(hh + 1 / 3), k(hh), k(hh - 1 / 3)].map((v) => Math.round(v * 255));
  }
  /** One colour of the app's palette in the current theme ([r, g, b]), or null when it isn't a theme colour. */
  function mapRgb(r, g, b) {
    if (cur === BASE) return null;
    const [h, l, s] = toHls(r, g, b);
    // Theme colours: clearly coloured, and in the cool-to-pink band (the app's reds, ambers and whites are left alone).
    if (s < 0.15 || h < 140 || h > 345) return null;
    const t = THEMES[cur];
    return fromHls(l < 0.45 ? t.dark : t.bright, l, Math.min(1, s * (t.sat ?? 1)));
  }
  const hex2 = (n) => n.toString(16).padStart(2, '0');
  const cache = new Map();
  /** Every colour inside a CSS value or colour string, in the current theme. */
  function css(str) {
    if (cur === BASE || typeof str !== 'string' || (!str.includes('#') && !str.includes('rgb'))) return str;
    let out = cache.get(str);
    if (out !== undefined) return out;
    out = str.replace(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g, (m, x) => {
      const full = x.length === 3 ? x.split('').map((c) => c + c).join('') : x;
      const n = parseInt(full.slice(0, 6), 16), c = mapRgb(n >> 16, (n >> 8) & 255, n & 255);
      return c ? `#${c.map(hex2).join('')}${full.length === 8 ? full.slice(6) : ''}` : m;
    }).replace(/rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(\s*[,/][^)]*)?\)/g, (m, r, g, b, rest) => {
      const c = mapRgb(+r, +g, +b);
      return c ? `${rest ? 'rgba' : 'rgb'}(${c[0]}, ${c[1]}, ${c[2]}${rest ? `, ${rest.replace(/^[\s,/]+/, '')}` : ''})` : m;
    });
    if (cache.size > 20000) cache.clear();
    cache.set(str, out);
    return out;
  }

  // ---------- style sheets ----------
  // Only the declarations that hold a colour are touched, one by one, so shorthands with var() (fonts, borders) stay intact.
  const ruleOrig = new WeakMap(); // rule → [[property, original value, priority], …]
  const hasColour = (v) => v.includes('#') || v.includes('rgb');
  function doRules(list) {
    if (!list) return;
    for (const rule of list) {
      if (rule.cssRules) doRules(rule.cssRules);
      const st = rule.style;
      if (!st) continue;
      let o = ruleOrig.get(rule);
      if (o === undefined) {
        o = [];
        for (let i = 0; i < st.length; i++) { const p = st[i], v = st.getPropertyValue(p); if (v && hasColour(v)) o.push([p, v, st.getPropertyPriority(p)]); }
        ruleOrig.set(rule, o);
      }
      for (const [p, v, pr] of o) { const n = css(v); if (st.getPropertyValue(p) !== n) st.setProperty(p, n, pr); }
    }
  }
  function doSheet(sheet) { try { doRules(sheet.cssRules); } catch { /* another origin's sheet */ } }
  const doSheets = () => { for (const s of document.styleSheets) doSheet(s); };

  // ---------- inline styles and SVG colours ----------
  const ATTRS = ['style', 'fill', 'stroke', 'stop-color'];
  const attrOrig = new WeakMap(); // element → { attr: [original, last written] }
  function doAttr(el, a) {
    if (el.dataset?.raw) return;
    const v = el.getAttribute(a);
    if (v == null) return;
    let rec = attrOrig.get(el);
    if (!rec) { rec = {}; attrOrig.set(el, rec); }
    const seen = rec[a];
    if (!seen || v !== seen[1]) rec[a] = [v, v]; // a new value written by the app: that's the original now
    const n = css(rec[a][0]);
    rec[a][1] = n;
    if (n !== v) el.setAttribute(a, n);
  }
  function doTree(root) {
    if (root.nodeType !== 1) return;
    for (const a of ATTRS) if (root.hasAttribute(a)) doAttr(root, a);
    for (const el of root.querySelectorAll('[style],[fill],[stroke],[stop-color]')) for (const a of ATTRS) if (el.hasAttribute(a)) doAttr(el, a);
    if (root.tagName === 'STYLE' && root.sheet) doSheet(root.sheet);
    for (const st of root.querySelectorAll?.('style') ?? []) if (st.sheet) doSheet(st.sheet);
  }
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'attributes') doAttr(m.target, m.attributeName);
      else for (const n of m.addedNodes) {
        if (n.nodeType !== 1) { if (n.parentNode?.tagName === 'STYLE' && n.parentNode.sheet) doSheet(n.parentNode.sheet); continue; }
        if (n.tagName === 'LINK') n.addEventListener('load', () => doSheet(n.sheet), { once: true });
        doTree(n);
      }
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: false, attributes: true, attributeFilter: ATTRS });

  // ---------- canvas ----------
  for (const proto of [window.CanvasRenderingContext2D?.prototype, window.OffscreenCanvasRenderingContext2D?.prototype].filter(Boolean)) {
    for (const prop of ['fillStyle', 'strokeStyle', 'shadowColor']) {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      if (!d?.set) continue;
      Object.defineProperty(proto, prop, { configurable: true, enumerable: d.enumerable, get: d.get, set(v) { d.set.call(this, typeof v === 'string' ? css(v) : v); } });
    }
  }
  if (window.CanvasGradient) {
    const add = CanvasGradient.prototype.addColorStop;
    CanvasGradient.prototype.addColorStop = function (o, c) { return add.call(this, o, css(c)); };
  }

  // ---------- LED palettes ([[r, g, b], …]) for pixel drawing that bypasses the canvas colours ----------
  const pals = new Set(); // [live array, original copy]
  function mapPal(orig) { return orig.map((c) => { const m = mapRgb(c[0], c[1], c[2]); return m ? [...m, ...c.slice(3)] : c.slice(); }); }
  /** A palette that follows the theme: the same array, its entries swapped in place when the theme changes. */
  function livePal(p) {
    if (!Array.isArray(p) || !Array.isArray(p[0])) return p;
    const orig = p.map((c) => c.slice()), live = mapPal(orig);
    pals.add([live, orig]);
    return live;
  }

  // ---------- switching ----------
  function set(name) {
    if (!THEMES[name] || name === cur) return false;
    cur = name;
    try { localStorage.setItem(KEY, name); } catch {}
    cache.clear();
    doSheets();
    doTree(document.documentElement);
    for (const [live, orig] of pals) mapPal(orig).forEach((c, i) => { live[i] = c; });
    document.documentElement.dataset.theme = name;
    window.dispatchEvent(new CustomEvent('roamie-theme', { detail: name }));
    return true;
  }
  // Another page (the panel, the setup guide) picked a theme: follow it.
  addEventListener('storage', (e) => { if (e.key === KEY && e.newValue && THEMES[e.newValue]) set(e.newValue); });

  window.RoamieTheme = { BASE, THEMES, get current() { return cur; }, set, css, rgb: mapRgb, livePal };
  document.documentElement.dataset.theme = cur;
  // Sheets in the page are processed as soon as they exist, then again once everything has loaded.
  doSheets();
  document.addEventListener('DOMContentLoaded', () => { doSheets(); doTree(document.documentElement); });
  addEventListener('load', doSheets);
})();
