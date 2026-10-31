/**
 * 1D barcode encoders. Output is a list of modules (1 = bar) without quiet zones, so the
 * renderer can scale each module to a whole number of printer dots; fractional bar widths
 * are what make cheap thermal barcodes unscannable.
 */

export class BarcodeError extends Error {}

// Each symbology's name, what it's for, and the blank it needs either side, in modules.
export const SYMBOLOGIES = {
	CODE128: {
		name: "Code 128",
		hint: "Any letters, digits and punctuation. The narrowest for most text.",
		quiet: 10,
	},
	CODE39: {
		name: "Code 39",
		hint: "Capitals, digits, spaces and - . $ / + %. Wider, but almost any scanner reads it.",
		quiet: 10,
	},
	EAN13: {
		name: "EAN-13",
		hint: "13-digit product code, as on shop goods. The check digit is added for you.",
		quiet: 11,
	},
	EAN8: {
		name: "EAN-8",
		hint: "8-digit product code for small packets. The check digit is added for you.",
		quiet: 7,
	},
	UPCA: {
		name: "UPC-A",
		hint: "12-digit product code, as in North American shops. The check digit is added for you.",
		quiet: 9,
	},
	UPCE: {
		name: "UPC-E",
		hint: "Short UPC for small packets: 6 digits, or a UPC-A with enough zeros to shorten.",
		quiet: 9,
	},
	ITF14: {
		name: "ITF-14",
		hint: "14-digit code for shipping cartons. The check digit is added for you.",
		quiet: 10,
	},
	CODABAR: {
		name: "Codabar",
		hint: "Digits and - $ : / . +, as on library books. Starts and ends with A unless you give A–D.",
		quiet: 10,
	},
	DATAMATRIX: {
		name: "Data Matrix",
		hint: "A 2D code that suits a narrow label: it picks the square or rectangle that fits best.",
		quiet: 1,
		matrix: true,
	},
};

// Code 39 and ITF draw each element narrow or wide. Scanners accept a wide one 2 to 3 times
// a narrow one; 3 is the most forgiving, and whole modules keep every bar a whole dot count.
const WIDE = 3;
/** Bars and spaces alternating, from "n" (narrow) and "w" (wide), starting with a bar. */
const narrowWide = (pattern, out, bar = true) => {
	for (const c of pattern) {
		for (let i = 0; i < (c === "w" ? WIDE : 1); i++) out.push(bar ? 1 : 0);
		bar = !bar;
	}
};

// Code 128 bar/space widths for values 0–106 (106 = stop, which has a 7th element).
const C128 = (
	"212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 " +
	"122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 " +
	"322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 " +
	"112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 " +
	"331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 " +
	"112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 " +
	"124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 " +
	"411311 113141 114131 311141 411131 211412 211214 211232 2331112"
).split(" ");
export const CODE128_PATTERNS = C128;

const START_B = 104;
const START_C = 105;
const TO_C = 99;
const TO_B = 100;
const STOP = 106;

const widthsToModules = (widths, out) => {
	let bar = true;
	for (const w of widths) {
		for (let i = 0; i < Number(w); i++) out.push(bar ? 1 : 0);
		bar = !bar;
	}
};

const digitRun = (s, i) => {
	let n = 0;
	while (i + n < s.length && s[i + n] >= "0" && s[i + n] <= "9") n++;
	return n;
};

/**
 * Code 128 values for `s`, using set B for text and set C (two digits per symbol) for runs
 * of four or more digits, which roughly halves the width of numeric data.
 */
export const code128Values = (s) => {
	if (!s.length) throw new BarcodeError("Enter something to encode.");
	for (const ch of s) {
		const c = ch.codePointAt(0);
		if (c < 32 || c > 126)
			throw new BarcodeError(
				`Code 128 can't encode “${ch}”. Use plain letters, digits and punctuation.`,
			);
	}
	const values = [];
	let i = 0;
	const lead = digitRun(s, 0);
	let set = lead >= 4 || (lead === s.length && lead % 2 === 0) ? "C" : "B";
	values.push(set === "C" ? START_C : START_B);

	while (i < s.length) {
		if (set === "C") {
			if (digitRun(s, i) >= 2) {
				values.push(Number(s.slice(i, i + 2)));
				i += 2;
				continue;
			}
			values.push(TO_B);
			set = "B";
			continue;
		}
		const run = digitRun(s, i);
		// Only worth switching for 4+ digits (or digits that finish the data evenly).
		if (run >= 4 || (run >= 2 && i + run === s.length && run % 2 === 0)) {
			if (run % 2 === 1) {
				values.push(s.charCodeAt(i) - 32);
				i++;
			}
			values.push(TO_C);
			set = "C";
			continue;
		}
		values.push(s.charCodeAt(i) - 32);
		i++;
	}
	const check = values.reduce((sum, v, idx) => sum + v * (idx === 0 ? 1 : idx), 0) % 103;
	values.push(check, STOP);
	return values;
};

const encodeCode128 = (data) => {
	const modules = [];
	for (const v of code128Values(data)) widthsToModules(C128[v], modules);
	// Termination bar: the stop pattern's 7 elements already end on a bar.
	return { modules, text: data };
};

// EAN-13: L/G/R digit patterns and the parity of the first six digits by leading digit.
const EAN_L = [
	"0001101",
	"0011001",
	"0010011",
	"0111101",
	"0100011",
	"0110001",
	"0101111",
	"0111011",
	"0110111",
	"0001011",
];
const EAN_R = EAN_L.map((p) => [...p].map((b) => (b === "1" ? "0" : "1")).join(""));
const EAN_G = EAN_R.map((p) => [...p].reverse().join(""));
const EAN_PARITY = [
	"LLLLLL",
	"LLGLGG",
	"LLGGLG",
	"LLGGGL",
	"LGLLGG",
	"LGGLLG",
	"LGGGLL",
	"LGLGLG",
	"LGLGGL",
	"LGGLGL",
];

export const eanCheckDigit = (twelve) => {
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (i % 2 ? 3 : 1);
	return (10 - (sum % 10)) % 10;
};

const encodeEan13 = (data, { name = "EAN-13", digits = 13 } = {}) => {
	const raw = data.replace(/\s+/g, "");
	if (!/^\d+$/.test(raw)) throw new BarcodeError(`${name} uses digits only.`);
	if (raw.length !== digits - 1 && raw.length !== digits) {
		throw new BarcodeError(
			`${name} needs ${digits - 1} digits (the check digit is added for you) or all ${digits}.`,
		);
	}
	// UPC-A is EAN-13 with a leading zero.
	const padded = (digits === 12 ? "0" : "") + raw;
	const body = padded.slice(0, 12);
	const check = eanCheckDigit(body);
	if (padded.length === 13 && Number(padded[12]) !== check) {
		throw new BarcodeError(
			`The last digit should be ${check} (check digit). Leave it off and it's added for you.`,
		);
	}
	const full = body + check;
	const parity = EAN_PARITY[Number(full[0])];
	let bits = "101";
	for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? EAN_L : EAN_G)[Number(full[i])];
	bits += "01010";
	for (let i = 7; i <= 12; i++) bits += EAN_R[Number(full[i])];
	bits += "101";
	return { modules: [...bits].map(Number), text: digits === 12 ? full.slice(1) : full };
};

const encodeEan8 = (data) => {
	const raw = data.replace(/\s+/g, "");
	if (!/^\d+$/.test(raw)) throw new BarcodeError("EAN-8 uses digits only.");
	if (raw.length !== 7 && raw.length !== 8)
		throw new BarcodeError("EAN-8 needs 7 digits (the check digit is added for you) or all 8.");
	const check = gtinCheckDigit(raw.slice(0, 7));
	if (raw.length === 8 && Number(raw[7]) !== check)
		throw new BarcodeError(
			`The last digit should be ${check} (check digit). Leave it off and it's added for you.`,
		);
	const full = raw.slice(0, 7) + check;
	let bits = "101";
	for (let i = 0; i < 4; i++) bits += EAN_L[Number(full[i])];
	bits += "01010";
	for (let i = 4; i < 8; i++) bits += EAN_R[Number(full[i])];
	bits += "101";
	return { modules: [...bits].map(Number), text: full };
};

/** The GS1 check digit for any length: weights 3 and 1, from the rightmost digit leftwards. */
const gtinCheckDigit = (digits) => {
	let sum = 0;
	for (let i = 0; i < digits.length; i++)
		sum += Number(digits[digits.length - 1 - i]) * (i % 2 ? 1 : 3);
	return (10 - (sum % 10)) % 10;
};

// Code 39: nine elements a character, three of them wide; * starts and stops every code.
const C39_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%*";
export const CODE39_PATTERNS = (
	"nnnwwnwnn wnnwnnnnw nnwwnnnnw wnwwnnnnn nnnwwnnnw wnnwwnnnn nnwwwnnnn nnnwnnwnw wnnwnnwnn " +
	"nnwwnnwnn wnnnnwnnw nnwnnwnnw wnwnnwnnn nnnnwwnnw wnnnwwnnn nnwnwwnnn nnnnnwwnw wnnnnwwnn " +
	"nnwnnwwnn nnnnwwwnn wnnnnnnww nnwnnnnww wnwnnnnwn nnnnwnnww wnnnwnnwn nnwnwnnwn nnnnnnwww " +
	"wnnnnnwwn nnwnnnwwn nnnnwnwwn wwnnnnnnw nwwnnnnnw wwwnnnnnn nwnnwnnnw wwnnwnnnn nwwnwnnnn " +
	"nwnnnnwnw wwnnnnwnn nwwnnnwnn nwnwnwnnn nwnwnnnwn nwnnnwnwn nnnwnwnwn nwnnwnwnn"
).split(" ");

const encodeCode39 = (data) => {
	// Code 39 has no lower case; scanners read the capitals either way.
	const text = data.toUpperCase();
	if (!text) throw new BarcodeError("Enter something to encode.");
	for (const ch of text)
		if (ch === "*" || !C39_CHARS.includes(ch))
			throw new BarcodeError(
				`Code 39 can't encode “${ch}”. Use letters, digits, spaces and - . $ / + %.`,
			);
	const modules = [];
	[...("*" + text + "*")].forEach((ch, i) => {
		if (i) modules.push(0); // the narrow gap between characters
		narrowWide(CODE39_PATTERNS[C39_CHARS.indexOf(ch)], modules);
	});
	return { modules, text };
};

// Interleaved 2 of 5: five elements a digit, two of them wide. Digits go in pairs, the first
// drawn in the bars and the second in the spaces between them.
export const ITF_PATTERNS = "nnwwn wnnnw nwnnw wwnnn nnwnw wnwnn nwwnn nnnww wnnwn nwnwn".split(
	" ",
);

const encodeItf14 = (data) => {
	const raw = data.replace(/\s+/g, "");
	if (!/^\d+$/.test(raw)) throw new BarcodeError("ITF-14 uses digits only.");
	if (raw.length !== 13 && raw.length !== 14)
		throw new BarcodeError("ITF-14 needs 13 digits (the check digit is added for you) or all 14.");
	const check = gtinCheckDigit(raw.slice(0, 13));
	if (raw.length === 14 && Number(raw[13]) !== check)
		throw new BarcodeError(
			`The last digit should be ${check} (check digit). Leave it off and it's added for you.`,
		);
	const full = raw.slice(0, 13) + check;
	const modules = [1, 0, 1, 0];
	for (let i = 0; i < full.length; i += 2) {
		const bars = ITF_PATTERNS[Number(full[i])];
		const spaces = ITF_PATTERNS[Number(full[i + 1])];
		for (let k = 0; k < 5; k++) {
			narrowWide(bars[k], modules, true);
			narrowWide(spaces[k], modules, false);
		}
	}
	narrowWide("wnn", modules);
	return { modules, text: full };
};

// UPC-E: a UPC-A whose zeros can be left out, in six digits. The number system (0 or 1) and the
// check digit aren't drawn as digits: they choose each digit's parity.
const UPCE_PARITY = [
	"EEEOOO",
	"EEOEOO",
	"EEOOEO",
	"EEOOOE",
	"EOEEOO",
	"EOOEEO",
	"EOOOEE",
	"EOEOEO",
	"EOEOOE",
	"EOOEOE",
];

/** The UPC-A (without its check digit) that a number system and six UPC-E digits stand for. */
const expandUpce = (ns, d) => {
	const last = Number(d[5]);
	if (last <= 2) return ns + d[0] + d[1] + d[5] + "0000" + d[2] + d[3] + d[4];
	if (last === 3) return ns + d[0] + d[1] + d[2] + "00000" + d[3] + d[4];
	if (last === 4) return ns + d[0] + d[1] + d[2] + d[3] + "00000" + d[4];
	return ns + d.slice(0, 5) + "0000" + d[5];
};

/** The six UPC-E digits for an 11-digit UPC-A body, if it has the zeros to shorten. */
const compressUpca = (a) => {
	const candidates = [
		a.slice(1, 3) + a.slice(8, 11) + a[3],
		a.slice(1, 4) + a.slice(9, 11) + "3",
		a.slice(1, 5) + a[10] + "4",
		a.slice(1, 6) + a[10],
	];
	return candidates.find((d) => expandUpce(a[0], d) === a) ?? null;
};

const encodeUpce = (data) => {
	const raw = data.replace(/\s+/g, "");
	if (!/^\d+$/.test(raw)) throw new BarcodeError("UPC-E uses digits only.");
	let ns;
	let six;
	let given = null;
	if (raw.length === 6) [ns, six] = ["0", raw];
	else if (raw.length === 7 || raw.length === 8) {
		[ns, six] = [raw[0], raw.slice(1, 7)];
		if (raw.length === 8) given = Number(raw[7]);
	} else if (raw.length === 11 || raw.length === 12) {
		six = compressUpca(raw.slice(0, 11));
		if (!six)
			throw new BarcodeError(
				"That UPC-A doesn't shorten to UPC-E: it needs more zeros. Use UPC-A.",
			);
		ns = raw[0];
		if (raw.length === 12) given = Number(raw[11]);
	} else
		throw new BarcodeError(
			"UPC-E needs 6 digits (or 7 with the number system), or a UPC-A to shorten.",
		);
	if (ns !== "0" && ns !== "1") throw new BarcodeError("UPC-E's number system is 0 or 1.");
	const check = gtinCheckDigit(expandUpce(ns, six));
	if (given !== null && given !== check)
		throw new BarcodeError(
			`The last digit should be ${check} (check digit). Leave it off and it's added for you.`,
		);
	const parity = UPCE_PARITY[check];
	let bits = "101";
	for (let i = 0; i < 6; i++) {
		// Number system 1 swaps odd and even.
		const even = (parity[i] === "E") === (ns === "0");
		bits += (even ? EAN_G : EAN_L)[Number(six[i])];
	}
	bits += "010101";
	return { modules: [...bits].map(Number), text: ns + six + check };
};

// Codabar: seven elements a character, two or three of them wide; A, B, C or D start and stop it.
const CODABAR_CHARS = "0123456789-$:/.+ABCD";
export const CODABAR_PATTERNS = (
	"nnnnnww nnnnwwn nnnwnnw wwnnnnn nnwnnwn wnnnnwn nwnnnnw nwnnwnn nwwnnnn wnnwnnn " +
	"nnnwwnn nnwwnnn wnnnwnw wnwnnnw wnwnwnn nnwnwnw nnwwnwn nwnwnnw nnnwnww nnnwwwn"
).split(" ");

const encodeCodabar = (data) => {
	const upper = data.toUpperCase().replace(/\s+/g, "");
	// Given start and stop letters are kept (they can mean something to the system reading
	// it); otherwise it's A to A, the usual.
	const framed = /^[A-D].*[A-D]$/.test(upper) && upper.length > 1 ? upper : `A${upper}A`;
	const body = framed.slice(1, -1);
	if (!body) throw new BarcodeError("Enter something to encode.");
	for (const ch of body)
		if (!"0123456789-$:/.+".includes(ch))
			throw new BarcodeError(`Codabar can't encode “${ch}”. Use digits and - $ : / . +.`);
	const modules = [];
	[...framed].forEach((ch, i) => {
		if (i) modules.push(0);
		narrowWide(CODABAR_PATTERNS[CODABAR_CHARS.indexOf(ch)], modules);
	});
	return { modules, text: body };
};

/**
 * @returns {{modules: number[], text: string, quiet: number}} text is the human-readable line
 * (with the computed check digit for EAN/UPC)
 */
export const encodeBarcode = (symbology, data) => {
	const spec = SYMBOLOGIES[symbology];
	if (!spec) throw new BarcodeError(`Unknown barcode type ${symbology}.`);
	const encode = {
		CODE128: encodeCode128,
		CODE39: encodeCode39,
		EAN13: encodeEan13,
		EAN8: encodeEan8,
		UPCA: (d) => encodeEan13(d, { name: "UPC-A", digits: 12 }),
		ITF14: encodeItf14,
		UPCE: encodeUpce,
		CODABAR: encodeCodabar,
	}[symbology];
	// Data Matrix is 2D: its painter draws it with encodeDataMatrix, sized to its box.
	if (!encode) throw new BarcodeError(`${spec.name} isn't a row of bars.`);
	const result = encode(data);
	return { ...result, quiet: spec.quiet };
};
