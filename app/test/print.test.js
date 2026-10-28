import { test } from "node:test";
import assert from "node:assert/strict";
import { printDocument, describeStatus } from "../src/print.js";
import { createDocument } from "../src/model.js";
import { printerById } from "../src/printers/index.js";
import { SendError, VirtualPrinter } from "../src/transport.js";
import { makeImage, noise } from "./helpers.js";

const printer = printerById("d30");
const settings = { density: "normal", flip180: false, feedLines: 23, showAllDevices: false };
// Without a browser to draw labels, every label is the same picture.
const render = async () => makeImage(40, 96, noise(1));
const batch = { columns: null, rows: [["a"], ["b"]], lines: ["a", "b"] };
const options = (more) => ({
	printer,
	copies: 1,
	batch,
	counterStart: 1,
	settings,
	render,
	...more,
});

/**
 * A real printer's connection that's connected, with what it's said, and how sends go.
 * @param {{status?: object, send?: (bytes: Uint8Array) => Promise<void>}} [options]
 * @returns {any}
 */
const fakePrinter = ({ status = {}, send = async () => {} } = {}) => ({
	name: "D30",
	connected: true,
	status: { battery: 80, paper: true, coverOpen: false, ...status },
	connect: async () => assert.fail("already connected"),
	refreshStatus: async () => {},
	send,
});

test("a print to the virtual printer decodes a label per batch row", async () => {
	const connection = new VirtualPrinter();
	connection.model = printer;
	const doc = createDocument();
	doc.elements[0].text = "{1} #{n}";
	const outcome = await printDocument(doc, options({ connection }));
	assert.equal(outcome.result, "printed");
	assert.equal(outcome.labels, 2);
	assert.equal(outcome.decoded.labels.length, 2);
	assert.equal(outcome.nextCounter, 3, "{n} moves past the two labels");
	assert.ok(outcome.image, "the first label's picture, for the history");
});

test("a reported problem or a long batch asks first, and no stops the print", async () => {
	const asked = [];
	const no = (q) => (asked.push(q), false);
	let sent = false;
	const coverOpen = fakePrinter({
		status: { coverOpen: true },
		send: async () => void (sent = true),
	});
	const outcome = await printDocument(
		createDocument(),
		options({ connection: coverOpen, confirm: no }),
	);
	assert.equal(outcome.result, "declined");
	assert.match(asked[0], /cover open/);
	const long = await printDocument(
		createDocument(),
		options({ connection: fakePrinter(), copies: 11, confirm: no }),
	);
	assert.equal(long.result, "declined");
	assert.equal(asked[1], "Print 22 labels?");
	assert.equal(sent, false);
});

test("a send that breaks off says which labels got out and where the batch stops", async () => {
	const connection = fakePrinter({
		// The two labels' jobs are the same size: the first gets out, the second doesn't.
		send: async (bytes) => {
			throw new SendError(new Error("GATT disconnected"), bytes.length / 2);
		},
	});
	const outcome = await printDocument(createDocument(), options({ connection }));
	assert.equal(outcome.result, "partial");
	assert.equal(outcome.labels, 1);
	assert.equal(outcome.firstUnsentRow, 1);
	assert.equal(outcome.error.message, "GATT disconnected");
});

test("describeStatus names problems first, and a battery only when asked", () => {
	const st = { coverOpen: true, paper: false, battery: 40, charging: true };
	assert.equal(describeStatus(st), "cover open · out of labels · battery 40% (charging)");
	assert.equal(describeStatus(st, { battery: false }), "cover open · out of labels");
	assert.equal(describeStatus({ paper: true }), "");
});
