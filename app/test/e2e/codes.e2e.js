import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import zxing from "@zxing/library";
import { setup, typeInto, appState, printVirtual } from "./harness.js";

const {
	MultiFormatReader,
	BarcodeFormat,
	DecodeHintType,
	RGBLuminanceSource,
	BinaryBitmap,
	HybridBinarizer,
} = zxing;

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

/** Prints to the virtual printer and returns the decoded print as a luminance image. */
const printAndCapture = async (page) => {
	await printVirtual(page);
	return page.evaluate(() => {
		const c = document.querySelector("#tape .printed canvas");
		const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
		const lum = [];
		for (let i = 0; i < d.length; i += 4) lum.push(d[i]);
		return { width: c.width, height: c.height, lum };
	});
};

const scan = ({ width, height, lum }, formats) => {
	// Add a white border, as the label's surroundings would in a photo.
	const pad = 16;
	const w = width + pad * 2;
	const h = height + pad * 2;
	const out = new Uint8ClampedArray(w * h).fill(255);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) out[(y + pad) * w + x + pad] = lum[y * width + x];
	const reader = new MultiFormatReader();
	reader.setHints(
		new Map([
			[DecodeHintType.POSSIBLE_FORMATS, formats],
			[DecodeHintType.TRY_HARDER, true],
		]),
	);
	return reader
		.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(out, w, h))))
		.getText();
};

const clearLabel = async (page) => {
	await page.click("#layers li");
	await page.keyboard.press("Delete");
	assert.equal((await appState(page)).doc.elements.length, 0);
};

test("a Code 128 barcode made in the UI scans from the printed bytes", async () => {
	const page = await env.open();
	await clearLabel(page);
	await page.click("#addBarcode");
	await typeInto(page, '#quickbar [data-qb="barcode"] [data-prop="data"]', "SHELF-3");
	const printed = await printAndCapture(page);
	assert.equal(scan(printed, [BarcodeFormat.CODE_128]), "SHELF-3");
	assert.equal(
		await page.$eval("#elementWarning", (e) => e.hidden),
		true,
		"no scan warning at this size",
	);

	// Longer data in the same box drops to 1-dot bars: still drawn, but flagged.
	await typeInto(page, '#quickbar [data-qb="barcode"] [data-prop="data"]', "PANTRY-SHELF-0042");
	await page.evaluate(() => window.labelApp.drawCanvas());
	assert.match(await page.$eval("#elementWarning", (e) => e.textContent), /one printer dot/);
	assert.deepEqual(page.errors, []);
});

test("EAN-13 gets its check digit and scans; bad input shows a warning, not a fake code", async () => {
	const page = await env.open();
	await clearLabel(page);
	await page.click("#addBarcode");
	await page.select('#quickbar [data-prop="symbology"]', "EAN13");
	await typeInto(page, '#quickbar [data-qb="barcode"] [data-prop="data"]', "400638133393");
	assert.equal(scan(await printAndCapture(page), [BarcodeFormat.EAN_13]), "4006381333931");

	await typeInto(page, '#quickbar [data-qb="barcode"] [data-prop="data"]', "40063813");
	await page.evaluate(() => window.labelApp.drawCanvas());
	assert.match(await page.$eval("#elementWarning", (e) => e.textContent), /12 digits/);
	assert.ok(await page.$(".box.warn"), "the box is flagged on the label");
});

test("a QR code made in the UI scans from the printed bytes, even rotated", async () => {
	const page = await env.open();
	await clearLabel(page);
	await page.click("#addQr");
	await typeInto(page, '#qrProps [data-prop="data"]', "https://example.com/shelf/3");
	assert.equal(
		scan(await printAndCapture(page), [BarcodeFormat.QR_CODE]),
		"https://example.com/shelf/3",
	);
	await page.keyboard.press("r");
	assert.equal((await appState(page)).doc.elements[0].rotation, 90);
	assert.equal(
		scan(await printAndCapture(page), [BarcodeFormat.QR_CODE]),
		"https://example.com/shelf/3",
	);
	assert.deepEqual(page.errors, []);
});
