import { test } from "node:test";
import assert from "node:assert/strict";
import zxing from "@zxing/library";
import {
	encodeBarcode,
	code128Values,
	CODE128_PATTERNS,
	eanCheckDigit,
	BarcodeError,
} from "../src/barcode.js";
import { encodeQr, QrError } from "../src/qr.js";

const {
	MultiFormatReader,
	BarcodeFormat,
	DecodeHintType,
	RGBLuminanceSource,
	BinaryBitmap,
	HybridBinarizer,
} = zxing;

/** Decodes a luminance image (0 = black) with zxing, the same library many phone apps use. */
const scan = (lum, width, height, formats) => {
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

const scan1d = ({ modules, quiet }, { scale = 2, height = 40 } = {}) => {
	const total = modules.length + quiet * 2;
	const w = total * scale;
	const lum = new Uint8ClampedArray(w * height).fill(255);
	modules.forEach((m, i) => {
		if (!m) return;
		for (let y = 0; y < height; y++)
			for (let s = 0; s < scale; s++) lum[y * w + (quiet + i) * scale + s] = 0;
	});
	return scan(lum, w, height, [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.UPC_A]);
};

const scanQr = ({ size, dark }, { scale = 3, quiet = 2 } = {}) => {
	const w = (size + quiet * 2) * scale;
	const lum = new Uint8ClampedArray(w * w).fill(255);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++)
			if (dark(x, y))
				for (let dy = 0; dy < scale; dy++)
					for (let dx = 0; dx < scale; dx++)
						lum[((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx] = 0;
	return scan(lum, w, w, [BarcodeFormat.QR_CODE]);
};

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
	assert.equal(eanCheckDigit("400638133393"), 1);
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
