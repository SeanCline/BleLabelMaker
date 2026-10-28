import { test } from "node:test";
import assert from "node:assert/strict";
import {
	PRINTERS,
	printerById,
	printerForName,
	bluetoothPrefixes,
	bluetoothServices,
} from "../src/printers/index.js";
import { buildPrintJob } from "../src/printers/phomemo/protocol.js";
import { centreOnHead } from "../src/raster.js";
import { makeImage } from "./helpers.js";

test("models are recognised from their Bluetooth names, longest prefix first", () => {
	assert.equal(printerForName("D30")?.id, "d30");
	assert.equal(printerForName("D30-FAKE")?.id, "d30");
	assert.equal(printerForName("d30 pro 1A2B")?.id, "d30-pro");
	assert.equal(printerForName("Q30_77")?.id, "q30");
	assert.equal(printerForName("M110"), null);
	assert.equal(printerById("nope").id, "d30", "unknown ids fall back to the D30");
	assert.ok(bluetoothPrefixes().includes("D30"));
	assert.deepEqual(bluetoothServices(), ["0000ff00-0000-1000-8000-00805f9b34fb"]);
});

test("every model is complete and only the D30 claims to be tested", () => {
	assert.equal(new Set(PRINTERS.map((p) => p.id)).size, PRINTERS.length);
	for (const p of PRINTERS) {
		assert.ok(p.presets.length && p.headDots % 8 === 0 && p.prefixes.length, p.id);
		assert.ok(["each", "last"].includes(p.feedAfter), p.id);
		assert.ok(Number.isInteger(p.feedLines) && p.feedLines >= 0 && p.feedLines <= 255, p.id);
	}
	assert.deepEqual(
		PRINTERS.filter((p) => p.tested).map((p) => p.id),
		["d30"],
	);
});

test("continuous feeds follow each model's sequence", () => {
	const raster = { bytesPerRow: 12, rows: 1, data: new Uint8Array(12) };
	const feeds = (id) => {
		const job = buildPrintJob(raster, { copies: 3, paper: "continuous", printer: printerById(id) });
		const found = [];
		for (let i = 0; i < job.length - 2; i++) {
			if (job[i] === 0x1b && job[i + 1] === 0x64) found.push(job[i + 2]);
		}
		return found;
	};
	assert.deepEqual(feeds("d30"), [23, 23, 23], "after every copy");
	assert.deepEqual(feeds("a30"), [12], "after the last copy only");
	assert.deepEqual(feeds("p15"), [], "never");
});

test("the feed setting overrides the model's, and 0 sends none", () => {
	const raster = { bytesPerRow: 12, rows: 1, data: new Uint8Array(12) };
	const job = (feedLines) =>
		buildPrintJob(raster, {
			copies: 2,
			paper: "continuous",
			printer: printerById("a30"),
			feedLines,
		});
	assert.deepEqual([...job(40).slice(-3)], [0x1b, 0x64, 40], "A30 still feeds after the last only");
	assert.equal(job(40).length, job(undefined).length, "one feed either way");
	assert.ok(job(0).length < job(40).length);
	assert.throws(() => job(256), /0–255/);
	assert.throws(() => job(1.5), /0–255/);
});

test("a label taller than the head prints its middle", () => {
	// 15 mm label (120 dots) on a 12 mm head (96 dots): 12 rows trimmed top and bottom.
	const img = makeImage(4, 120, (x, y) => y === 12 || y === 107);
	const on = centreOnHead(img, 96);
	assert.equal(on.height, 96);
	assert.equal(on.data[0], 0, "first head row is label row 12");
	assert.equal(on.data[95 * 4 * 4], 0, "last head row is label row 107");
	assert.equal(centreOnHead(makeImage(4, 96), 96).height, 96, "a fitting label is untouched");
	// A head across the label's width takes the middle of its width instead.
	const wide = centreOnHead(
		makeImage(120, 2, (x) => x === 12 || x === 107),
		96,
		0,
	);
	assert.deepEqual([wide.width, wide.height], [96, 2]);
	assert.deepEqual([wide.data[0], wide.data[95 * 4], wide.data[96 * 4]], [0, 0, 0], "both rows");
});
