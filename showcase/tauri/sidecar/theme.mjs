// Colour themes on the app's side (the pages recolour themselves with roamies/theme.js). Here: which themes exist, the
// default, and the few colours the native helpers draw with (the listening pill, the pen), worked out the same way.
export const THEME_BASE = 'pink';
export const THEMES = [
  ['pink', 'Pink & purple', 282, 318], ['teal', 'Teal', 184, 166], ['blue', 'Ocean blue', 222, 204], ['purple', 'Violet', 262, 272],
  ['green', 'Matrix green', 140, 122], ['orange', 'Sunset orange', 16, 30], ['red', 'Iron red', 352, 4], ['gold', 'Gold', 38, 46],
  ['mono', 'Mono', 0, 0, 0],
];
export const themeIds = THEMES.map(([id]) => id);
export const themeLabel = (id) => THEMES.find(([t]) => t === id)?.[1] ?? id;

function hls(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, l, 0];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, l, s];
}
function rgb(h, l, s) {
  if (!s) return [l, l, l].map((v) => Math.round(v * 255));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const k = (t) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [k(h / 360 + 1 / 3), k(h / 360), k(h / 360 - 1 / 3)].map((v) => Math.round(v * 255));
}
/** A colour of the app's palette (hex) in a theme (hex), as roamies/theme.js maps it. */
export function themed(hex, id) {
  const t = THEMES.find(([x]) => x === id);
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (!t || id === THEME_BASE) return hex;
  const [h, l, s] = hls(r, g, b);
  if (s < 0.15 || h < 140 || h > 345) return hex;
  return `#${rgb(l < 0.45 ? t[2] : t[3], l, Math.min(1, s * (t[4] ?? 1))).map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
// The base palette's native colours: the glow and bars, the pill's rim, its fill, the pen's dark edge.
const NATIVE = { accent: '#ff78d6', line: '#c42895', bg: '#100514', rim: '#470e60' };
/** {accent, line, bg, rim} in the theme, for the voice helper. */
export const nativeColors = (id) => Object.fromEntries(Object.entries(NATIVE).map(([k, v]) => [k, themed(v, id)]));
