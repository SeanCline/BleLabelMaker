import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrintJob, rasterCommand, PACKET_SIZE } from "../src/printers/phomemo/protocol.js";
import { packetize } from "../src/bytes.js";
import { printerById } from "../src/printers/index.js";
import { toPrinterRaster, rasterToReadingBits, flipped } from "../src/raster.js";
import { PrinterDecoder, DecodeError } from "../src/printers/phomemo/decoder.js";

const D30 = printerById("d30");
import { makeImage, noise } from "./helpers.js";

test("raster header is the GS v 0 layout", () => {
	const cmd = rasterCommand({ bytesPerRow: 12, rows: 320, data: new Uint8Array(12 * 320) });
	assert.deepEqual([...cmd.subarray(0, 8)], [0x1d, 0x76, 0x30, 0x00, 12, 0, 320 & 0xff, 320 >> 8]);
	assert.equal(cmd.length, 8 + 12 * 320);
});

test("gap labels: paper type, offset, init, copy count, one image and no feed", () => {
	const raster = { bytesPerRow: 12, rows: 1, data: new Uint8Array(12).fill(0xff) };
	const image = [0x1d, 0x76, 0x30, 0x00, 12, 0, 1, 0, ...raster.data];
	assert.deepEqual(
		[...buildPrintJob(raster, { printer: D30, copies: 3 })],
		[0x1f, 0x11, 0x0a, 0x1f, 0x11, 0x24, 0, 0x1b, 0x40, 0x1f, 0x11, 0x21, 3, ...image],
	);
	// A trailing ESC d makes a real D30 on gapped labels keep feeding blank ones.
	assert.ok(
		!buildPrintJob(raster, { printer: D30 }).some((b, i, a) => b === 0x1b && a[i + 1] === 0x64),
	);
	// Narrower than the 12-byte head: the offset makes up the difference.
	const narrow = { bytesPerRow: 10, rows: 1, data: new Uint8Array(10) };
	assert.deepEqual(
		[...buildPrintJob(narrow, { printer: D30 }).subarray(3, 7)],
		[0x1f, 0x11, 0x24, 2],
	);
});

test("continuous paper: paper type, init, then image + feed per copy", () => {
	const raster = { bytesPerRow: 1, rows: 2, data: Uint8Array.of(0xff, 0x01) };
	const job = buildPrintJob(raster, { printer: D30, copies: 2, paper: "continuous" });
	const image = [0x1d, 0x76, 0x30, 0x00, 1, 0, 2, 0, 0xff, 0x01];
	assert.deepEqual(
		[...job],
		[0x1f, 0x11, 0x0b, 0x1b, 0x40, ...image, 0x1b, 0x64, 23, ...image, 0x1b, 0x64, 23],
	);
});

test("rejects bad copies and mismatched data", () => {
	const raster = { bytesPerRow: 1, rows: 1, data: new Uint8Array(1) };
	assert.throws(() => buildPrintJob(raster, { printer: D30, copies: 0 }));
	assert.throws(() => buildPrintJob(raster, { printer: D30, copies: 1.5 }));
	assert.throws(() => buildPrintJob(raster, { printer: D30, paper: "marks" }));
	assert.throws(() => rasterCommand({ bytesPerRow: 2, rows: 2, data: new Uint8Array(3) }));
});

test("packetize covers every byte exactly once, with no empty packets", () => {
	for (const len of [0, 1, 127, 128, 129, 3848]) {
		const bytes = Uint8Array.from({ length: len }, (_, i) => i & 0xff);
		const packets = packetize(bytes, PACKET_SIZE);
		assert.ok(packets.every((p) => p.length > 0 && p.length <= PACKET_SIZE));
		assert.equal(
			packets.reduce((n, p) => n + p.length, 0),
			len,
		);
		assert.deepEqual([...packets.flatMap((p) => [...p])], [...bytes]);
	}
});

test("rotation: label top-left pixel lands at end of first printer row", () => {
	// 40x12mm label at 8 dots/mm.
	const img = makeImage(320, 96, (x, y) => x === 0 && y === 0);
	const r = toPrinterRaster(img);
	assert.equal(r.bytesPerRow, 12);
	assert.equal(r.rows, 320);
	assert.equal(r.data[11], 0x01); // last bit of row 0
	assert.equal(
		r.data.reduce((n, b) => n + b, 0),
		1,
	);
});

test("matches the encoding of a canvas drawn pre-rotated", () => {
	const W = 320;
	const H = 96;
	const img = makeImage(W, H, noise(7));
	// The reference renders into a portrait canvas (H wide, W tall) rotated 90° CW, then
	// encodes canvas rows MSB-first with black = 1.
	const portrait = (cx, cy) => {
		const lx = cy;
		const ly = H - 1 - cx;
		return img.data[(ly * W + lx) * 4] === 0;
	};
	const expected = new Uint8Array((H / 8) * W);
	for (let row = 0; row < W; row++) {
		for (let k = 0; k < H / 8; k++) {
			let byte = 0;
			for (let bit = 0; bit < 8; bit++) byte = (byte << 1) | (portrait(k * 8 + bit, row) ? 1 : 0);
			expected[row * (H / 8) + k] = byte;
		}
	}
	assert.deepEqual(toPrinterRaster(img).data, expected);
});

test("non-multiple-of-8 heights pad with white bits", () => {
	const img = makeImage(4, 10, () => true);
	const r = toPrinterRaster(img);
	assert.equal(r.bytesPerRow, 2);
	// Columns 0..9 black (rotated from y = 9..0), 10..15 padding.
	assert.deepEqual([...r.data.subarray(0, 2)], [0xff, 0xc0]);
});

test("every turn comes back as the same label through the virtual printer", () => {
	const img = makeImage(240, 96, noise(3));
	for (const turn of /** @type {const} */ ([0, 90, 180, 270])) {
		const raster = toPrinterRaster(img, { turn });
		assert.equal(raster.rows, turn % 180 ? 240 : 96, `rows for ${turn}`);
		const back = rasterToReadingBits(raster, { turn });
		for (let i = 0; i < 240 * 96; i++) assert.equal(back.bits[i], img.data[i * 4] === 0 ? 1 : 0);
	}
});

test("a flip is the label turned upside down before it goes through", () => {
	const img = makeImage(24, 16, noise(4));
	const upsideDown = makeImage(24, 16, (x, y) => img.data[((15 - y) * 24 + (23 - x)) * 4] === 0);
	for (const turn of /** @type {const} */ ([0, 90])) {
		assert.deepEqual(
			toPrinterRaster(img, { turn: flipped(turn, true) }).data,
			toPrinterRaster(upsideDown, { turn }).data,
			`flipped ${turn}`,
		);
	}
});

test("end to end: image → job → 128-byte packets → decoder → same image", () => {
	const img = makeImage(320, 96, noise(11));
	const raster = toPrinterRaster(img);
	const expected = {
		gaps: ["paperType", "offset", "init", "copies", "raster"],
		continuous: ["paperType", "init", "raster", "feed", "raster", "feed", "raster", "feed"],
	};
	for (const paper of ["gaps", "continuous"]) {
		const events = [];
		const decoder = new PrinterDecoder({ onEvent: (e) => events.push(e.type) });
		for (const p of packetize(
			buildPrintJob(raster, { printer: D30, copies: 3, paper }),
			PACKET_SIZE,
		))
			decoder.feed(p);

		assert.equal(decoder.leftover, 0);
		assert.deepEqual(events, expected[paper]);
		assert.equal(decoder.labels.length, 3, `${paper}: three labels come out`);
		for (const label of decoder.labels) assert.deepEqual(label, raster);
	}
});

test("decoder handles commands split at every possible boundary", () => {
	const raster = toPrinterRaster(makeImage(16, 16, noise(5)));
	for (const paper of ["gaps", "continuous"]) {
		const job = buildPrintJob(raster, { printer: D30, copies: 2, paper });
		for (let cut = 1; cut < job.length; cut++) {
			const d = new PrinterDecoder();
			d.feed(job.subarray(0, cut));
			d.feed(job.subarray(cut));
			assert.equal(d.labels.length, 2, `${paper}: cut at ${cut}`);
			assert.equal(d.leftover, 0);
		}
	}
});

test("decoder rejects garbage instead of silently mis-printing", () => {
	assert.throws(() => new PrinterDecoder().feed(Uint8Array.of(0x42)), DecodeError);
});
