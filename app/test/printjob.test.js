import { test } from "node:test";
import assert from "node:assert/strict";
import { planLabels, rasterize, sentPart } from "../src/printjob.js";
import { SendError, PartialPrintError } from "../src/transport.js";
import { createDocument } from "../src/model.js";
import { printerById } from "../src/printers/index.js";
import { PrinterDecoder } from "../src/printers/phomemo/decoder.js";
import { makeImage } from "./helpers.js";

const now = new Date(2026, 9, 25);
const docWith = (text) => {
	const d = createDocument();
	d.elements[0].text = text;
	return d;
};
const text = (label) => label.doc.elements[0].text;

test("identical copies stay one label with a count", () => {
	const plan = planLabels(docWith("Salt"), { copies: 3, batch: null, counterStart: 1, now });
	assert.equal(plan.labels.length, 1);
	assert.equal(plan.labels[0].copies, 3);
	assert.equal(plan.total, 3);
	assert.equal(plan.nextCounter, 1, "no counter, nothing to move on");
});

test("a counter makes each copy its own label and says where to carry on", () => {
	const plan = planLabels(docWith("#{n}"), { copies: 3, batch: null, counterStart: 7, now });
	assert.deepEqual(plan.labels.map(text), ["#7", "#8", "#9"]);
	assert.equal(plan.nextCounter, 10);
});

test("a batch makes a label per row, times copies, counting across rows", () => {
	const batch = { columns: null, rows: [["Cumin"], ["Sage"]] };
	const plan = planLabels(docWith("{1} {n}"), { copies: 2, batch, counterStart: 1, now });
	assert.deepEqual(plan.labels.map(text), ["Cumin 1", "Cumin 2", "Sage 3", "Sage 4"]);
	assert.equal(plan.total, 4);
});

test("{0} is each batch row's line as it was typed", () => {
	const batch = { columns: null, rows: [["Test1", "a"]], lines: ["Test1,  a"] };
	const plan = planLabels(docWith("{0}|{2}"), { copies: 1, batch, counterStart: 1, now });
	assert.deepEqual(plan.labels.map(text), ["Test1,  a|a"]);
});

/** A link that keeps what it's sent, and breaks off after `limit` bytes if given. */
const recordingLink = (limit = Infinity) => {
	const parts = [];
	return {
		parts,
		async send(bytes) {
			if (bytes.length > limit) throw new SendError(new Error("link lost"), limit);
			parts.push(bytes);
		},
	};
};

test("labels print as jobs that decode back to one label per copy, centred on the head", async () => {
	const plan = planLabels(docWith("x"), {
		copies: 2,
		batch: { columns: null, rows: [["a"], ["b"]] },
		counterStart: 1,
		now,
	});
	// A 15 mm tall label (120 dots) for a 12 mm head: each job is 96 dots across.
	const render = async () => makeImage(40, 120, (x) => x === 0);
	const printer = printerById("a30");
	const { labels, firstImage } = await rasterize(plan, { render, printer, flip180: false });
	assert.equal(firstImage.height, 120);
	const link = recordingLink();
	await printer.driver.print(link, labels, { printer, paper: "gaps", density: 2 });
	assert.equal(link.parts.length, 1, "a batch goes out in one send");
	const d = new PrinterDecoder();
	d.feed(link.parts[0]);
	assert.equal(d.labels.length, 4);
	assert.ok(d.labels.every((l) => l.bytesPerRow === 12 && l.rows === 40));
});

test("a print that broke off counts only the labels whose bytes all went out", async () => {
	const batch = { columns: null, rows: [["A"], ["B"], ["C"]] };
	const plan = planLabels(docWith("{1}-{n}"), { copies: 1, batch, counterStart: 5, now });
	const printer = printerById("d30");
	const { labels } = await rasterize(plan, {
		render: async () => makeImage(8, 96),
		printer,
		flip180: false,
	});
	const opts = { printer, paper: /** @type {const} */ ("gaps"), density: null };
	const whole = recordingLink();
	await printer.driver.print(whole, labels, opts);
	const oneJob = whole.parts[0].length / 3;
	const brokenAt = async (limit) => {
		const err = await printer.driver.print(recordingLink(limit), labels, opts).catch((e) => e);
		assert.ok(err instanceof PartialPrintError);
		assert.equal(err.message, "link lost");
		return err.labelsSent;
	};
	assert.equal(await brokenAt(Math.round(oneJob * 1.5)), 1);
	assert.equal(await brokenAt(10), 0);
	assert.equal(await brokenAt(oneJob * 3 - 1), 2);
	assert.deepEqual(sentPart(plan, 1, 5), { labels: 1, nextCounter: 6, firstUnsentRow: 1 });
	assert.deepEqual(sentPart(plan, 0, 5), { labels: 0, nextCounter: 5, firstUnsentRow: 0 });
	assert.equal(sentPart(plan, 3, 5).labels, 3);
});
