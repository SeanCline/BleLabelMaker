import { test } from "node:test";
import assert from "node:assert/strict";
import zxing from "@zxing/library";
import {
	encodeBarcode,
	code128Values,
	CODE128_PATTERNS,
	gtinCheckDigit,
	BarcodeError,
	CODE39_PATTERNS,
	ITF_PATTERNS,
	CODABAR_PATTERNS,
} from "../src/codes/barcode.js";
import { encodeQr, QrError } from "../src/codes/qr.js";
import { encodeDataMatrix } from "../src/codes/datamatrix.js";

const {
	MultiFormatReader,
	BarcodeFormat,
	DecodeHintType,
	RGBLuminanceSource,
	BinaryBitmap,
	HybridBinarizer,
	CodaBarReader,
} = zxing;

/**
 * A code as a luminance image (0 = black): `cols` × `rows` modules, `dark(x, y)` each, drawn
 * `scale` pixels a module inside a blank border `quiet` modules wide.
 * @param {{cols: number, rows: number, dark: (x: number, y: number) => boolean}} code
 */
const picture = ({ cols, rows, dark }, scale, quiet) => {
	const width = (cols + quiet * 2) * scale;
	const height = (rows + quiet * 2) * scale;
	const lum = new Uint8ClampedArray(width * height).fill(255);
	for (let y = 0; y < rows * scale; y++)
		for (let x = 0; x < cols * scale; x++)
			if (dark(Math.floor(x / scale), Math.floor(y / scale)))
				lum[(y + quiet * scale) * width + x + quiet * scale] = 0;
	return { lum, width, height };
};

/** A 1D code's bars, `rows` modules tall, with its own quiet zone. */
const bars = ({ modules, quiet }, scale = 2, rows = 20) =>
	picture({ cols: modules.length, rows, dark: (x) => modules[x] === 1 }, scale, quiet);

/** Decodes a picture with zxing, the same library many phone apps use. */
const scan = ({ lum, width, height }, formats) => {
	const hints = new Map([
		[DecodeHintType.POSSIBLE_FORMATS, formats],
		[DecodeHintType.TRY_HARDER, true],
	]);
	const reader = new MultiFormatReader();
	reader.setHints(hints);
	const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, width, height)));
	const r = reader.decode(bitmap);
	return { text: r.getText(), format: BarcodeFormat[r.getBarcodeFormat()] };
};

const scan1d = (code) =>
	scan(bars(code), [
		BarcodeFormat.CODE_128,
		BarcodeFormat.CODE_39,
		BarcodeFormat.EAN_13,
		BarcodeFormat.EAN_8,
		BarcodeFormat.UPC_A,
		BarcodeFormat.ITF,
	]);

const scanQr = ({ size, dark }) =>
	scan(picture({ cols: size, rows: size, dark }, 3, 2), [BarcodeFormat.QR_CODE]);

/** A Data Matrix's text, read from a picture of it. */
const scanMatrix = (m) => scan(picture(m, 4, 2), [BarcodeFormat.DATA_MATRIX]).text;

test("Code 128 pattern table is well-formed", () => {
	assert.equal(CODE128_PATTERNS.length, 107);
	CODE128_PATTERNS.forEach((p, i) => {
		const sum = [...p].reduce((n, d) => n + Number(d), 0);
		assert.equal(sum, i === 106 ? 13 : 11, `pattern ${i}`);
	});
	assert.equal(new Set(CODE128_PATTERNS).size, 107, "patterns are unique");
});

test("Code 128 scans back for text, numbers and mixes", () => {
	for (const data of [
		"Hello, World!",
		"1234567890",
		"12345",
		"A1234567B",
		"PART-0042 rev 7",
		"~{}|`",
		"9",
	]) {
		const r = scan1d(encodeBarcode("CODE128", data));
		assert.equal(r.text, data);
		assert.equal(r.format, "CODE_128");
	}
});

test("Code 128 uses digit pairs for long numbers (shorter barcode)", () => {
	const digits = code128Values("12345678");
	const text = code128Values("ABCDEFGH");
	assert.ok(digits.length < text.length, `${digits.length} vs ${text.length}`);
	assert.equal(digits[0], 105, "starts in set C");
});

test("Code 128 rejects characters it can't encode", () => {
	assert.throws(() => encodeBarcode("CODE128", "café"), BarcodeError);
	assert.throws(() => encodeBarcode("CODE128", ""), /Enter something/);
});

test("EAN-13 computes and checks the check digit, and scans", () => {
	assert.equal(gtinCheckDigit("400638133393"), 1);
	const r = encodeBarcode("EAN13", "400638133393");
	assert.equal(r.text, "4006381333931");
	assert.equal(r.modules.length, 95);
	assert.deepEqual(scan1d(r), { text: "4006381333931", format: "EAN_13" });
	assert.equal(encodeBarcode("EAN13", "4006381333931").text, "4006381333931");
	assert.throws(() => encodeBarcode("EAN13", "4006381333932"), /should be 1/);
	assert.throws(() => encodeBarcode("EAN13", "12345"), /12 digits/);
	assert.throws(() => encodeBarcode("EAN13", "ABCDEFGHIJKL"), /digits only/);
});

test("UPC-A scans as UPC-A with the right check digit", () => {
	const r = encodeBarcode("UPCA", "03600029145");
	assert.equal(r.text, "036000291452");
	assert.deepEqual(scan1d(r), { text: "036000291452", format: "UPC_A" });
});

test("Code 39 and ITF pattern tables are well-formed: three wide of nine, two of five", () => {
	assert.equal(CODE39_PATTERNS.length, 44);
	for (const p of CODE39_PATTERNS) assert.equal([...p].filter((c) => c === "w").length, 3, p);
	assert.equal(new Set(CODE39_PATTERNS).size, 44);
	assert.equal(ITF_PATTERNS.length, 10);
	for (const p of ITF_PATTERNS) assert.equal([...p].filter((c) => c === "w").length, 2, p);
});

test("Code 39 scans back every character it has, in capitals", () => {
	for (const text of ["ASSET-0042", "0123456789", "ABCDEFGHIJKLM", "NOPQRSTUVWXYZ", "A B-C.$/+%"])
		assert.deepEqual(scan1d(encodeBarcode("CODE39", text)), { text, format: "CODE_39" });
	assert.equal(encodeBarcode("CODE39", "bin 7").text, "BIN 7", "lower case prints as capitals");
	assert.throws(() => encodeBarcode("CODE39", "a_b"), /can't encode “_”/);
	assert.throws(() => encodeBarcode("CODE39", "a*b"), /can't encode “\*”/);
});

test("EAN-8 and ITF-14 add and check their check digits, and scan", () => {
	const ean8 = encodeBarcode("EAN8", "9638507");
	assert.equal(ean8.text, "96385074");
	assert.equal(ean8.modules.length, 67);
	assert.deepEqual(scan1d(ean8), { text: "96385074", format: "EAN_8" });
	assert.throws(() => encodeBarcode("EAN8", "96385075"), /should be 4/);
	assert.throws(() => encodeBarcode("EAN8", "123"), /7 digits/);

	// The carton code for the UPC-A 012345678905: the same check digit, one level up.
	const itf = encodeBarcode("ITF14", "0001234567890");
	assert.equal(itf.text, "00012345678905");
	assert.deepEqual(scan1d(itf), { text: "00012345678905", format: "ITF" });
	assert.throws(() => encodeBarcode("ITF14", "00012345678906"), /should be 5/);
	assert.throws(() => encodeBarcode("ITF14", "12A"), /digits only/);
});

test("UPC-E shortens a UPC-A with enough zeros and adds its check digit", () => {
	// The textbook example: 0 42100 00526 4 is 0 425261 4.
	for (const input of ["425261", "0425261", "04252614", "04210000526", "042100005264"])
		assert.equal(encodeBarcode("UPCE", input).text, "04252614", input);
	// zxing-js can't read UPC-E (its reader drops the digits it decodes), so these are the bars
	// Java ZXing 3.5.3 reads as 04252614 and 14252611.
	assert.equal(
		encodeBarcode("UPCE", "425261").modules.join(""),
		"101001110100100110111001001101101011110011001010101",
	);
	assert.equal(
		encodeBarcode("UPCE", "1425261").modules.join(""),
		"101010001100100110111001001001100001010110011010101",
	);
	// Each way of shortening, by the last digit, with check digits Java ZXing accepted.
	for (const [six, text] of [
		["123450", "01234505"],
		["123453", "01234531"],
		["123454", "01234543"],
		["123459", "01234596"],
	])
		assert.equal(encodeBarcode("UPCE", six).text, text);
	assert.throws(() => encodeBarcode("UPCE", "04252615"), /should be 4/);
	assert.throws(() => encodeBarcode("UPCE", "012345678905"), /doesn't shorten/);
	assert.throws(() => encodeBarcode("UPCE", "2425261"), /number system is 0 or 1/);
});

test("Codabar frames its digits in A…A, or the letters given, and scans", () => {
	assert.equal(CODABAR_PATTERNS.length, 20);
	// The combined reader skips Codabar in zxing-js; its own reader doesn't.
	const read = (code) => {
		const { lum, width, height } = bars(code, 3, 10);
		const bitmap = new BinaryBitmap(
			new HybridBinarizer(new RGBLuminanceSource(lum, width, height)),
		);
		return new CodaBarReader()
			.decode(bitmap, new Map([[DecodeHintType.TRY_HARDER, true]]))
			.getText();
	};
	const r = encodeBarcode("CODABAR", "40156");
	assert.equal(r.text, "40156");
	assert.equal(read(r), "A40156A");
	// Given start and stop letters are kept: B and D here. zxing-js misreads the punctuation;
	// Java ZXing 3.5.3 reads this one as 12-34.5$/+:.
	const framed = encodeBarcode("CODABAR", "b12-34.5$/+:d").modules.join("");
	const ends = encodeBarcode("CODABAR", "b0d").modules.join("");
	// Each letter is 13 modules: four narrow and three wide.
	assert.equal(framed.slice(0, 13), ends.slice(0, 13));
	assert.equal(framed.slice(-13), ends.slice(-13));
	assert.notEqual(framed.slice(0, 13), encodeBarcode("CODABAR", "0").modules.join("").slice(0, 13));
	assert.throws(() => encodeBarcode("CODABAR", "12X4"), /can't encode “X”/);
});

test("Data Matrix scans back in every size, and takes the shape of its room", () => {
	const sizes = new Set();
	for (const n of [1, 3, 6, 10, 16, 25, 40, 60, 90, 120, 170]) {
		const text = "Ab-".repeat(n).slice(0, n);
		const m = encodeDataMatrix(text);
		sizes.add(`${m.rows}x${m.cols}`);
		assert.equal(scanMatrix(m), text, `${m.rows}x${m.cols}`);
	}
	assert.ok(sizes.has("48x48") && sizes.has("10x10"), [...sizes].join(" "));
	// Digits pack two to a codeword; Latin letters shift up; anything else is refused.
	assert.equal(encodeDataMatrix("123456").rows, 10);
	assert.equal(scanMatrix(encodeDataMatrix("Café 12 €".slice(0, 7))), "Café 12");
	assert.throws(() => encodeDataMatrix("€"), /can't encode/);
	assert.throws(() => encodeDataMatrix("x".repeat(200)), /Too much data/);
	// A 12 mm label's long thin box gets a rectangle, with squares bigger than a square's.
	const wide = encodeDataMatrix("ASSET-0042", { width: 320, height: 80 });
	assert.ok(wide.cols > wide.rows, `${wide.rows}x${wide.cols}`);
	assert.equal(scanMatrix(wide), "ASSET-0042");
	for (const [rows, cols] of [
		[8, 18],
		[8, 32],
		[12, 26],
		[12, 36],
		[16, 36],
		[16, 48],
	]) {
		const text = "R".repeat({ 18: 3, 32: 8, 26: 14, 36: rows === 12 ? 20 : 30, 48: 45 }[cols]);
		const m = encodeDataMatrix(text, { width: cols * 10, height: rows * 10 + 15 });
		assert.deepEqual([m.rows, m.cols, scanMatrix(m)], [rows, cols, text]);
	}
});

test("QR codes scan back, including UTF-8 text", () => {
	for (const text of ["https://example.com/pantry?shelf=3", "Café ☕ – 12 €", "x"]) {
		assert.equal(scanQr(encodeQr(text)).text, text);
	}
	const big = encodeQr("A".repeat(200), "H");
	assert.ok(big.size > 40);
	assert.equal(scanQr(big).text, "A".repeat(200));
});

test("QR rejects empty or oversized data with a readable error", () => {
	assert.throws(() => encodeQr(""), QrError);
	assert.throws(() => encodeQr("x".repeat(5000)), /Too much data/);
});
