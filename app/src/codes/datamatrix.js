// Data Matrix (ECC 200): a 2D code that's denser than a QR code for a little data, and comes in
// rectangles that suit narrow labels. The text is encoded as ASCII (digit pairs packed into one
// codeword), padded, given Reed-Solomon error correction, and placed by the standard's
// diagonal pattern into data regions framed by the finder: a solid L along the left and
// bottom, and alternating squares along the top and right.
import { BarcodeError } from "./barcode.js";

/**
 * The single-block symbols: [rows, cols, region rows, region cols, data, error correction]
 * codewords, with regions laid out in a grid that fills the symbol. Bigger symbols (52×52 on)
 * interleave several blocks, and hold more than a label has room for.
 */
const SIZES = [
	[10, 10, 8, 8, 3, 5],
	[12, 12, 10, 10, 5, 7],
	[8, 18, 6, 16, 5, 7],
	[14, 14, 12, 12, 8, 10],
	[8, 32, 6, 14, 10, 11],
	[16, 16, 14, 14, 12, 12],
	[12, 26, 10, 24, 16, 14],
	[18, 18, 16, 16, 18, 14],
	[20, 20, 18, 18, 22, 18],
	[12, 36, 10, 16, 22, 18],
	[22, 22, 20, 20, 30, 20],
	[16, 36, 14, 16, 32, 24],
	[24, 24, 22, 22, 36, 24],
	[26, 26, 24, 24, 44, 28],
	[16, 48, 14, 22, 49, 28],
	[32, 32, 14, 14, 62, 36],
	[36, 36, 16, 16, 86, 42],
	[40, 40, 18, 18, 114, 48],
	[44, 44, 20, 20, 144, 56],
	[48, 48, 22, 22, 174, 68],
].map(([rows, cols, rh, rw, data, ecc]) => ({ rows, cols, rh, rw, data, ecc }));

/** ASCII encodation: two digits in one codeword, other characters one each (Latin-1). */
const codewords = (text) => {
	const out = [];
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		const d = text.charCodeAt(i + 1);
		if (c >= 48 && c <= 57 && d >= 48 && d <= 57) {
			out.push(130 + (c - 48) * 10 + (d - 48));
			i++;
		} else if (c < 128) out.push(c + 1);
		else if (c < 256)
			out.push(235, c - 127); // upper shift, then the character less 128
		else
			throw new BarcodeError(
				`Data Matrix can't encode “${text[i]}”. Use letters, digits and punctuation.`,
			);
	}
	return out;
};

/** Pads to the symbol's capacity: 129 once, then values scrambled by position. */
const pad = (cw, capacity) => {
	const out = [...cw];
	if (out.length < capacity) out.push(129);
	while (out.length < capacity) {
		const r = ((149 * (out.length + 1)) % 253) + 1;
		out.push(129 + r > 254 ? 129 + r - 254 : 129 + r);
	}
	return out;
};

// GF(256) with the Data Matrix polynomial x^8 + x^5 + x^3 + x^2 + 1.
const EXP = new Array(512);
const LOG = new Array(256);
for (let i = 0, x = 1; i < 255; i++) {
	EXP[i] = x;
	LOG[x] = i;
	x <<= 1;
	if (x & 0x100) x ^= 0x12d;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

/** The error correction codewords: the data's remainder by (x − α)(x − α²)…(x − αⁿ). */
const reedSolomon = (data, n) => {
	let gen = [1];
	for (let i = 1; i <= n; i++) {
		const next = new Array(gen.length + 1).fill(0);
		gen.forEach((g, j) => {
			next[j] ^= g;
			next[j + 1] ^= mul(g, EXP[i]);
		});
		gen = next;
	}
	const ecc = new Array(n).fill(0);
	for (const d of data) {
		const m = d ^ ecc[0];
		ecc.shift();
		ecc.push(0);
		for (let i = 0; i < n; i++) ecc[i] ^= mul(gen[i + 1], m);
	}
	return ecc;
};

/** The standard's placement of codewords, eight modules each, into an nrow × ncol grid. */
const place = (cw, nrow, ncol) => {
	const grid = Array.from({ length: nrow }, () => new Array(ncol).fill(-1));
	const module = (r, c, k, bit) => {
		if (r < 0) {
			r += nrow;
			c += 4 - ((nrow + 4) % 8);
		}
		if (c < 0) {
			c += ncol;
			r += 4 - ((ncol + 4) % 8);
		}
		grid[r][c] = (cw[k] >> (8 - bit)) & 1;
	};
	const shape = (k, cells) => cells.forEach(([r, c], i) => module(r, c, k, i + 1));
	const utah = (r, c, k) =>
		shape(k, [
			[r - 2, c - 2],
			[r - 2, c - 1],
			[r - 1, c - 2],
			[r - 1, c - 1],
			[r - 1, c],
			[r, c - 2],
			[r, c - 1],
			[r, c],
		]);
	const corners = [
		[
			[nrow - 1, 0],
			[nrow - 1, 1],
			[nrow - 1, 2],
			[0, ncol - 2],
			[0, ncol - 1],
			[1, ncol - 1],
			[2, ncol - 1],
			[3, ncol - 1],
		],
		[
			[nrow - 3, 0],
			[nrow - 2, 0],
			[nrow - 1, 0],
			[0, ncol - 4],
			[0, ncol - 3],
			[0, ncol - 2],
			[0, ncol - 1],
			[1, ncol - 1],
		],
		[
			[nrow - 3, 0],
			[nrow - 2, 0],
			[nrow - 1, 0],
			[0, ncol - 2],
			[0, ncol - 1],
			[1, ncol - 1],
			[2, ncol - 1],
			[3, ncol - 1],
		],
		[
			[nrow - 1, 0],
			[nrow - 1, ncol - 1],
			[0, ncol - 3],
			[0, ncol - 2],
			[0, ncol - 1],
			[1, ncol - 3],
			[1, ncol - 2],
			[1, ncol - 1],
		],
	];
	let k = 0;
	let row = 4;
	let col = 0;
	do {
		if (row === nrow && col === 0) shape(k++, corners[0]);
		if (row === nrow - 2 && col === 0 && ncol % 4) shape(k++, corners[1]);
		if (row === nrow - 2 && col === 0 && ncol % 8 === 4) shape(k++, corners[2]);
		if (row === nrow + 4 && col === 2 && !(ncol % 8)) shape(k++, corners[3]);
		// Up and to the right, then down and to the left.
		do {
			if (row < nrow && col >= 0 && grid[row][col] === -1) utah(row, col, k++);
			row -= 2;
			col += 2;
		} while (row >= 0 && col < ncol);
		row += 1;
		col += 3;
		do {
			if (row >= 0 && col < ncol && grid[row][col] === -1) utah(row, col, k++);
			row += 2;
			col -= 2;
		} while (row < nrow && col >= 0);
		row += 3;
		col += 1;
	} while (row < nrow || col < ncol);
	// Some sizes leave the bottom right corner's four modules: a fixed checker.
	if (grid[nrow - 1][ncol - 1] === -1) {
		grid[nrow - 1][ncol - 1] = grid[nrow - 2][ncol - 2] = 1;
		grid[nrow - 1][ncol - 2] = grid[nrow - 2][ncol - 1] = 0;
	}
	return grid;
};

/** The symbol's modules, data regions framed by their finders. */
const draw = (size, cw) => {
	const { rows, cols, rh, rw } = size;
	const across = cols / (rw + 2);
	const down = rows / (rh + 2);
	const data = place(cw, down * rh, across * rw);
	const dark = (x, y) => {
		const r = y % (rh + 2);
		const c = x % (rw + 2);
		if (r === 0) return x % 2 === 0; // top: alternating, from dark at the left
		if (r === rh + 1) return true; // bottom: solid
		if (c === 0) return true; // left: solid
		const dataRow = Math.floor(y / (rh + 2)) * rh + r - 1;
		if (c === rw + 1) return dataRow % 2 === 0; // right: alternating
		return data[dataRow][Math.floor(x / (rw + 2)) * rw + c - 1] === 1;
	};
	return { rows, cols, dark };
};

/**
 * The Data Matrix for `text`. With room given (in printer dots), it's the size whose squares
 * come out biggest there, a rectangle on a long thin label, and `unit` is their size in whole
 * dots; otherwise it's the smallest that holds it.
 * @param {string} text
 * @param {{width: number, height: number}} [room]
 * @param {number} [quiet] blank modules around it, which the room has to hold too
 * @returns {{rows: number, cols: number, dark: (x: number, y: number) => boolean, unit: number}}
 */
export const encodeDataMatrix = (text, room, quiet = 1) => {
	if (!text) throw new BarcodeError("Enter something to encode.");
	const cw = codewords(text);
	const fits = SIZES.filter((s) => s.data >= cw.length);
	if (!fits.length) throw new BarcodeError("Too much data for a Data Matrix.");
	const unit = (s) =>
		room
			? Math.floor(Math.min(room.width / (s.cols + quiet * 2), room.height / (s.rows + quiet * 2)))
			: 0;
	// The biggest squares win; fewer of them break a tie.
	const best = fits.reduce((a, b) =>
		unit(b) > unit(a) || (unit(b) === unit(a) && b.rows * b.cols < a.rows * a.cols) ? b : a,
	);
	const data = pad(cw, best.data);
	return { ...draw(best, [...data, ...reedSolomon(data, best.ecc)]), unit: unit(best) };
};
