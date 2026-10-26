/**
 * Minimal ImageData stand-in: RGBA, white by default.
 * @param {number} width
 * @param {number} height
 * @param {(x: number, y: number) => boolean} [isBlack]
 */
export const makeImage = (width, height, isBlack = () => false) => {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const v = isBlack(x, y) ? 0 : 255;
			const i = (y * width + x) * 4;
			data[i] = data[i + 1] = data[i + 2] = v;
			data[i + 3] = 255;
		}
	}
	return { width, height, data };
};

/** Deterministic pseudo-random pattern so failures are reproducible. */
export const noise = (seed) => (x, y) => {
	let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) & 3) === 0;
};

/** Monospace measure: every grapheme is `size * 0.5` wide. */
export const monoMeasure = (s, size = 10) => [...s].length * size * 0.5;

/** monoMeasure by position in `text`, as layout measures. */
export const monoRange = (text) => (from, to, size) => monoMeasure(text.slice(from, to), size);
