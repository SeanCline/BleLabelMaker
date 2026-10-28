export const MM_PER_PT = 25.4 / 72;

// 203 dpi heads, which their firmware treats as exactly 8 dots/mm, are what most label
// printers have; a model with another resolution says so (PrinterModel.dotsPerMm).
export const DEFAULT_DOTS_PER_MM = 8;

/**
 * Converts the document's millimetres and points to a printer's dots.
 * @typedef {{dotsPerMm: number, mm: (mm: number) => number, pt: (pt: number) => number,
 *   toMm: (dots: number) => number}} DotScale
 * @param {number} [dotsPerMm]
 * @returns {DotScale}
 */
export const dotScale = (dotsPerMm = DEFAULT_DOTS_PER_MM) => ({
	dotsPerMm,
	mm: (mm) => mm * dotsPerMm,
	pt: (pt) => pt * MM_PER_PT * dotsPerMm,
	toMm: (dots) => dots / dotsPerMm,
});

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round = (v, places = 2) => Math.round(v * 10 ** places) / 10 ** places;
