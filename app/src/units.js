// Label printer heads are 203 dpi, which their firmware treats as exactly
// 8 dots/mm. A 300 dpi model would need the dot pitch passed through rendering.
export const DOTS_PER_MM = 8;
export const MM_PER_PT = 25.4 / 72;

export const mmToDots = (mm) => mm * DOTS_PER_MM;
export const dotsToMm = (dots) => dots / DOTS_PER_MM;
export const ptToDots = (pt) => pt * MM_PER_PT * DOTS_PER_MM;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, places = 2) => Math.round(v * 10 ** places) / 10 ** places;
