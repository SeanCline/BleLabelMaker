import { test } from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES, fromTemplate } from "../src/templates.js";
import { printableArea } from "../src/model.js";
import { PRINTERS } from "../src/printers/index.js";
import { parse, serialize } from "../src/fileformat.js";

// Every label any printer offers, pre-cut and continuous, and a custom one narrower than it's
// tall, which leaves a code beside words little room.
const labels = [
	{ widthMm: 10, heightMm: 15, continuous: false },
	...new Map(
		PRINTERS.flatMap((p) => [
			...p.presets.map((l) => ({ ...l, continuous: false })),
			{ widthMm: 60, heightMm: p.continuousHeightMm, continuous: true },
		]).map((l) => [JSON.stringify(l), l]),
	).values(),
];

test("every template fits in the printable area of every label, and saves as a valid file", () => {
	for (const template of TEMPLATES) {
		for (const label of labels) {
			const doc = fromTemplate(template, label);
			const where = `${template.id} on ${label.widthMm}×${label.heightMm}`;
			const area = printableArea(label);
			assert.ok(doc.elements.length > 0, where);
			assert.equal(new Set(doc.elements.map((e) => e.id)).size, doc.elements.length, where);
			for (const e of doc.elements) {
				assert.ok(e.w > 0 && e.h > 0, `${where}: ${e.id} has a size`);
				assert.ok(e.x >= area.x - 1e-9 && e.y >= area.y - 1e-9, `${where}: ${e.id} top left`);
				assert.ok(e.x + e.w <= area.x + area.w + 1e-9, `${where}: ${e.id} right edge`);
				assert.ok(e.y + e.h <= area.y + area.h + 1e-9, `${where}: ${e.id} bottom edge`);
			}
			const reloaded = parse(serialize(doc));
			assert.deepEqual(reloaded.doc, doc, where);
		}
	}
});
