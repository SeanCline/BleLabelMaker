/**
 * Printer-oriented 1-bit rows: each row spans the print head, MSB first, 1 = black.
 * @typedef {{bytesPerRow: number, rows: number, data: Uint8Array}} Raster
 */

export const THRESHOLD = 128;

const luminance = (d, i) => (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;

// Transparent pixels count as paper, so composite onto white before judging darkness.
const isBlack = (d, i, threshold) => {
	const a = d[i + 3] / 255;
	return luminance(d, i) * a + 255 * (1 - a) < threshold;
};

/**
 * The rows of a label the print head can reach: a label taller than the head (a 14 mm roll
 * on a 12 mm head) prints its middle, the way the roll sits centred on the head.
 * @template {{width: number, height: number, data: Uint8ClampedArray}} I
 * @param {I} image
 * @param {number} headDots
 * @returns {I}
 */
export const centreOnHead = (image, headDots) => {
	if (image.height <= headDots) return image;
	const top = Math.floor((image.height - headDots) / 2);
	const rowBytes = image.width * 4;
	const data = image.data.slice(top * rowBytes, (top + headDots) * rowBytes);
	return { ...image, height: headDots, data };
};

/**
 * Turns label pixels (in reading orientation, landscape) into the printer's raster.
 * The head spans the label's short side, so the image is rotated 90° clockwise: each
 * printer row is one column of the label, top of the label at the end of the row.
 *
 * @param {{width: number, height: number, data: Uint8ClampedArray}} image RGBA pixels
 * @param {{flip180?: boolean, threshold?: number}} opts
 * @returns {{bytesPerRow: number, rows: number, data: Uint8Array}}
 */
export const toPrinterRaster = (image, { flip180 = false, threshold = THRESHOLD } = {}) => {
	const { width, height, data } = image;
	const bytesPerRow = Math.ceil(height / 8);
	const rows = width;
	const out = new Uint8Array(bytesPerRow * rows);

	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < bytesPerRow * 8; c++) {
			// Clockwise rotation: printer (row r, col c) ← label (x = r, y = height - 1 - c).
			let x = r;
			let y = height - 1 - c;
			if (flip180) {
				x = width - 1 - x;
				y = height - 1 - y;
			}
			if (y < 0 || y >= height) continue; // padding bits to a whole byte stay white
			if (isBlack(data, (y * width + x) * 4, threshold)) {
				out[r * bytesPerRow + (c >> 3)] |= 0x80 >> (c & 7);
			}
		}
	}
	return { bytesPerRow, rows, data: out };
};

/** Inverse of toPrinterRaster's rotation, so the virtual printer can show a readable label. */
export const rasterToReadingBits = ({ bytesPerRow, rows, data }, { flip180 = false } = {}) => {
	const width = rows;
	const height = bytesPerRow * 8;
	const bits = new Uint8Array(width * height);
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < height; c++) {
			if (!(data[r * bytesPerRow + (c >> 3)] & (0x80 >> (c & 7)))) continue;
			let x = r;
			let y = height - 1 - c;
			if (flip180) {
				x = width - 1 - x;
				y = height - 1 - y;
			}
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
 */
export const toOneBit = (image, { mode = "dither", level = THRESHOLD, invert = false } = {}) => {
	const { width, height, data: d } = image;
	const lum = new Float32Array(width * height);
	const bias = mode === "dither" ? THRESHOLD - level : 0;
	const cut = mode === "dither" ? THRESHOLD : level;
	for (let p = 0; p < lum.length; p++) {
		const i = p * 4;
		const a = d[i + 3] / 255;
		lum[p] = luminance(d, i) * a + 255 * (1 - a) + bias;
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const p = y * width + x;
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
