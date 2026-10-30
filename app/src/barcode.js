/**
 * 1D barcode encoders. Output is a list of modules (1 = bar) without quiet zones, so the
 * renderer can scale each module to a whole number of printer dots; fractional bar widths
 * are what make cheap thermal barcodes unscannable.
 */

export class BarcodeError extends Error {}

// The blank needed either side, in modules, for each symbology.
const SYMBOLOGIES = {
	CODE128: { quiet: 10 },
	EAN13: { quiet: 11 },
	UPCA: { quiet: 9 },
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

/**
 * @returns {{modules: number[], text: string, quiet: number}} text is the human-readable line
 * (with the computed check digit for EAN/UPC)
 */
export const encodeBarcode = (symbology, data) => {
	const spec = SYMBOLOGIES[symbology];
	if (!spec) throw new BarcodeError(`Unknown barcode type ${symbology}.`);
	const result =
		symbology === "CODE128"
			? encodeCode128(data)
			: symbology === "EAN13"
				? encodeEan13(data)
				: encodeEan13(data, { name: "UPC-A", digits: 12 });
	return { ...result, quiet: spec.quiet };
};
