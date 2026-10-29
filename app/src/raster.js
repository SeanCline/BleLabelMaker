/**
 * Printer-oriented 1-bit rows: each row spans the print head, MSB first, 1 = black.
 * @typedef {{bytesPerRow: number, rows: number, data: Uint8Array}} Raster
 */

const THRESHOLD = 128;

const luminance = (d, i) => (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;

// Transparent pixels count as paper, so composite onto white before judging darkness.
const isBlack = (d, i, threshold) => {
	const a = d[i + 3] / 255;
	return luminance(d, i) * a + 255 * (1 - a) < threshold;
};

/**
 * How a label passes under a print head, as a clockwise quarter turn from reading orientation:
 * 90 where the head spans the label's height (tape printers, the D-series), 0 where it spans its
 * width (shipping-label printers). Flipping a print upside down adds 180.
 * @typedef {0 | 90 | 180 | 270} Turn
 */

/**
 * Where printer dot (row r, column c across the head) comes from in a width × height label.
 * @type {Record<Turn, (r: number, c: number, width: number, height: number) => [number, number]>}
 */
const SOURCE = {
	0: (r, c) => [c, r],
	90: (r, c, _w, h) => [r, h - 1 - c],
	180: (r, c, w, h) => [w - 1 - c, h - 1 - r],
	270: (r, c, w) => [w - 1 - r, c],
};

/** Adds a flip to a turn: what upside down means for a printer that turns labels `turn`. */
export const flipped = (turn, flip) => /** @type {Turn} */ ((turn + (flip ? 180 : 0)) % 360);

/** The label's sides along and across the head, for a turn. */
const across = (turn, width, height) => (turn % 180 ? height : width);

/**
 * The part of a label the print head can reach: a label taller than the head (a 14 mm roll
 * on a 12 mm head) prints its middle, the way the roll sits centred on the head.
 * @template {{width: number, height: number, data: Uint8ClampedArray}} I
 * @param {I} image
 * @param {number} headDots
 * @param {Turn} [turn] which of the label's sides spans the head
 * @returns {I}
 */
export const centreOnHead = (image, headDots, turn = 90) => {
	const { width, height } = image;
	if (across(turn, width, height) <= headDots) return image;
	if (turn % 180) {
		const top = Math.floor((height - headDots) / 2);
		const rowBytes = width * 4;
		const data = image.data.slice(top * rowBytes, (top + headDots) * rowBytes);
		return { ...image, height: headDots, data };
	}
	const left = Math.floor((width - headDots) / 2);
	const data = new Uint8ClampedArray(headDots * height * 4);
	for (let y = 0; y < height; y++) {
		const from = (y * width + left) * 4;
		data.set(image.data.subarray(from, from + headDots * 4), y * headDots * 4);
	}
	return { ...image, width: headDots, data };
};

/**
 * Turns label pixels (in reading orientation) into the printer's raster: rows in the order
 * they pass under the head, each one across it.
 *
 * @param {{width: number, height: number, data: Uint8ClampedArray}} image RGBA pixels
 * @param {{turn?: Turn, threshold?: number}} opts
 * @returns {Raster}
 */
export const toPrinterRaster = (image, { turn = 90, threshold = THRESHOLD } = {}) => {
	const { width, height, data } = image;
	const dots = across(turn, width, height);
	const bytesPerRow = Math.ceil(dots / 8);
	const rows = turn % 180 ? width : height;
	const source = SOURCE[turn];
	const out = new Uint8Array(bytesPerRow * rows);
	for (let r = 0; r < rows; r++) {
		// Bits past the label's last dot pad the row to whole bytes, and stay white.
		for (let c = 0; c < dots; c++) {
			const [x, y] = source(r, c, width, height);
			if (isBlack(data, (y * width + x) * 4, threshold)) {
				out[r * bytesPerRow + (c >> 3)] |= 0x80 >> (c & 7);
			}
		}
	}
	return { bytesPerRow, rows, data: out };
};

/**
 * Inverse of toPrinterRaster, so the virtual printer can show a readable label. The raster's
 * padding bits come back as extra white dots on the side that went across the head.
 * @param {Raster} raster
 * @param {{turn?: Turn}} [opts]
 */
export const rasterToReadingBits = ({ bytesPerRow, rows, data }, { turn = 90 } = {}) => {
	const dots = bytesPerRow * 8;
	const width = turn % 180 ? rows : dots;
	const height = turn % 180 ? dots : rows;
	const source = SOURCE[turn];
	const bits = new Uint8Array(width * height);
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < dots; c++) {
			if (!(data[r * bytesPerRow + (c >> 3)] & (0x80 >> (c & 7)))) continue;
			const [x, y] = source(r, c, width, height);
			bits[y * width + x] = 1;
		}
	}
	return { width, height, bits };
};

/** Forces pixels to pure black/white in place; returns the same image. */
export const threshold = (image, t = THRESHOLD) => {
	const d = image.data;
	for (let i = 0; i < d.length; i += 4) {
		const v = isBlack(d, i, t) ? 0 : 255;
		d[i] = d[i + 1] = d[i + 2] = v;
		d[i + 3] = 255;
	}
	return image;
};

/**
 * Reduces an element's pixels to 1-bit in place: black pixels become opaque black, everything
 * else transparent, so the result composites over other content without a white box.
 *
 * - mode "dither": Floyd–Steinberg error diffusion (photos). `level` shifts
 *   brightness: below 128 lightens, above darkens.
 * - mode "threshold": hard cut at `level` (logos, line art).
 * - invert: flips the printed result (a negative). Transparent areas count as paper, so they
 *   turn black too; `level` keeps its meaning either way.
 *
 * Only the picture is darkened or lightened: what's transparent (around a fitted picture, or
 * in a logo) stays blank paper, rather than a light grey that dithers into scattered dots.
 */
export const toOneBit = (image, { mode = "dither", level = THRESHOLD, invert = false } = {}) => {
	const { width, height, data: d } = image;
	const lum = new Float32Array(width * height);
	const bias = mode === "dither" ? THRESHOLD - level : 0;
	const cut = mode === "dither" ? THRESHOLD : level;
	for (let p = 0; p < lum.length; p++) {
		const i = p * 4;
		const a = d[i + 3] / 255;
		lum[p] = (luminance(d, i) + bias) * a + 255 * (1 - a);
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const p = y * width + x;
			// Paper takes no error from the picture beside it, so its edge stays clean.
			if (d[p * 4 + 3] === 0) {
				lum[p] = 255;
				continue;
			}
			const old = lum[p];
			const v = old < cut ? 0 : 255;
			lum[p] = v;
			if (mode !== "dither") continue;
			const err = old - v;
			if (x + 1 < width) lum[p + 1] += (err * 7) / 16;
			if (y + 1 < height) {
				if (x > 0) lum[p + width - 1] += (err * 3) / 16;
				lum[p + width] += (err * 5) / 16;
				if (x + 1 < width) lum[p + width + 1] += err / 16;
			}
		}
	}
	for (let p = 0; p < lum.length; p++) {
		const i = p * 4;
		const black = (lum[p] === 0) !== invert;
		d[i] = d[i + 1] = d[i + 2] = black ? 0 : 255;
		d[i + 3] = black ? 255 : 0;
	}
	return image;
};
