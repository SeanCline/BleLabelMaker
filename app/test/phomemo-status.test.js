import { test } from "node:test";
import assert from "node:assert/strict";
import { StatusParser, statusRecord } from "../src/printers/phomemo/status.js";
import {
	buildPrintJob,
	DENSITY,
	QUERY,
	setAutoPowerOff,
	PACKET_SIZE,
} from "../src/printers/phomemo/protocol.js";
import { PrinterDecoder } from "../src/printers/phomemo/decoder.js";
import { packetize } from "../src/bytes.js";
import { printerById } from "../src/printers/index.js";

const D30 = printerById("d30");

const parseAll = (...chunks) => {
	const events = [];
	const p = new StatusParser((e) => events.push(e));
	for (const c of chunks) p.feed(c);
	return events;
};

test("decodes every D30 status record", () => {
	const events = parseAll(
		statusRecord.battery(87),
		statusRecord.charging(true),
		statusRecord.cover(true),
		statusRecord.cover(false),
		statusRecord.paper(false),
		statusRecord.paper(true),
		statusRecord.firmware(1, 4, 2),
		statusRecord.printed(),
	);
	assert.deepEqual(events, [
		{ type: "battery", percent: 87 },
		{ type: "charging", charging: true },
		{ type: "cover", open: true },
		{ type: "cover", open: false },
		{ type: "paper", present: false },
		{ type: "paper", present: true },
		{ type: "firmware", version: "1.4.2" },
		{ type: "printed" },
	]);
});

test("battery codes, unprefixed records, and records split across notifications", () => {
	assert.deepEqual(parseAll(Uint8Array.of(0x1a, 0x04, 0xa2)), [{ type: "battery", percent: 5 }]);
	assert.deepEqual(parseAll(Uint8Array.of(0x1a, 0x04, 0xa4)), [{ type: "battery", percent: null }]);
	const fw = statusRecord.firmware(2, 0, 9);
	assert.deepEqual(parseAll(fw.subarray(0, 2), fw.subarray(2, 4), fw.subarray(4)), [
		{ type: "firmware", version: "2.0.9" },
	]);
	// Records without the 0x1A prefix are accepted too.
	assert.deepEqual(parseAll(Uint8Array.of(0x06, 0x88)), [{ type: "paper", present: false }]);
});

test("density is sent right after init and decodes; omitted when unset", () => {
	const raster = { bytesPerRow: 1, rows: 1, data: Uint8Array.of(0xff) };
	const job = buildPrintJob(raster, { printer: D30, density: DENSITY.dark });
	assert.deepEqual([...job.subarray(4, 10)], [0x1b, 0x40, 0x1f, 0x11, 0x02, 4]);
	const events = [];
	const d = new PrinterDecoder({ onEvent: (e) => events.push(e) });
	for (const p of packetize(job, PACKET_SIZE)) d.feed(p);
	assert.deepEqual(
		events.map((e) => e.type),
		["offset", "init", "density", "copies", "raster"],
	);
	assert.equal(events[2].value, 4);
	assert.deepEqual(
		[...buildPrintJob(raster, { printer: D30 }).subarray(4, 9)],
		[0x1b, 0x40, 0x1f, 0x11, 0x21],
	);
	assert.deepEqual(
		[...buildPrintJob(raster, { printer: D30, paper: "continuous", density: 1 }).subarray(0, 6)],
		[0x1b, 0x40, 0x1f, 0x11, 0x02, 1],
	);
});

test("the decoder understands status queries", () => {
	const events = [];
	const d = new PrinterDecoder({ onEvent: (e) => events.push(e) });
	d.feed(QUERY.battery);
	d.feed(QUERY.paper);
	d.feed(QUERY.firmware);
	assert.deepEqual(
		events.map((e) => e.query),
		["battery", "paper", "firmware"],
	);
});

test("auto power-off: set in 5-minute steps, read back as a status record", () => {
	const events = [];
	const d = new PrinterDecoder({ onEvent: (e) => events.push(e) });
	d.feed(setAutoPowerOff(30));
	d.feed(QUERY.autoPowerOff);
	assert.deepEqual([...setAutoPowerOff(30)], [0x1b, 0x4e, 0x07, 6]);
	assert.deepEqual(events, [
		{ type: "autoPowerOff", minutes: 30 },
		{ type: "query", query: "autoPowerOff" },
	]);
	assert.deepEqual(parseAll(statusRecord.autoPowerOff(0)), [{ type: "autoPowerOff", minutes: 0 }]);
	assert.deepEqual(parseAll(Uint8Array.of(0x1a, 0x09, 120)), [
		{ type: "autoPowerOff", minutes: 600 },
	]);
});
