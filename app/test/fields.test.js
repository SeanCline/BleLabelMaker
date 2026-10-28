import { test } from "node:test";
import assert from "node:assert/strict";
import { fillFields, fillDocument, fieldsUsed } from "../src/fields.js";
import { parseBatch, parseCsv } from "../src/batch.js";
import { createDocument, createBarcode, createText } from "../src/model.js";

// A fixed local date, so results don't depend on when the tests run.
const now = new Date(2026, 0, 31, 9, 5);
const ctx = (extra = {}) => ({ now, n: 7, row: null, columns: null, ...extra });

test("dates: today, offsets in days, weeks, months and years, and formats", () => {
	assert.equal(fillFields("{date:iso}", ctx()), "2026-01-31");
	assert.equal(fillFields("{date+30d:iso}", ctx()), "2026-03-02");
	assert.equal(fillFields("{date-1w:iso}", ctx()), "2026-01-24");
	// Month arithmetic stays in the month: 31 Jan + 1 month is the end of February.
	assert.equal(fillFields("{date+1m:iso}", ctx()), "2026-02-28");
	assert.equal(fillFields("{date+1y:iso}", ctx()), "2027-01-31");
	assert.equal(
		fillFields("{date}", ctx()),
		now.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }),
	);
	assert.equal(fillFields("{ DATE+2D:ISO }", ctx()), "2026-02-02", "case and spaces don't matter");
});

test("counter, padding, literal braces and unknown fields", () => {
	assert.equal(fillFields("BIN-{n:000}", ctx()), "BIN-007");
	assert.equal(fillFields("#{n}", ctx({ n: 12 })), "#12");
	assert.equal(fillFields("{{n}} is {n}", ctx()), "{n} is 7");
	assert.equal(fillFields("{nope}", ctx()), "{nope}", "left as typed so it shows on the preview");
});

test("batch columns by number or by heading", () => {
	const c = ctx({ row: ["Paprika", "2026-12"], columns: ["Spice", "Best before"] });
	assert.equal(fillFields("{1} ({2})", c), "Paprika (2026-12)");
	assert.equal(fillFields("{spice} – {Best before}", c), "Paprika – 2026-12");
	assert.equal(fillFields("{3}", c), "", "a missing column is empty, not an error");
	assert.equal(fillFields("{1}", ctx()), "{1}", "outside a batch, columns stay as typed");
	assert.equal(fillFields("{0}", ctx({ ...c, line: "Paprika, 2026-12" })), "Paprika, 2026-12");
	assert.equal(fillFields("{0}", c), "Paprika, 2026-12", "without its line, the values joined");
});

test("fillDocument fills text, barcode and QR data, and can skip the element being edited", () => {
	const doc = createDocument();
	doc.elements[0].text = "Lot {n}";
	doc.elements.push(createBarcode(doc, { data: "SKU-{n:00}" }));
	doc.elements.push(createText(doc, { text: "plain" }));
	const filled = fillDocument(doc, ctx());
	assert.deepEqual(
		filled.elements.map((/** @type {any} */ e) => e.text ?? e.data),
		["Lot 7", "SKU-07", "plain"],
	);
	assert.equal(filled.elements[2], doc.elements[2], "untouched elements are reused");
	const editing = fillDocument(doc, ctx(), { except: doc.elements[0].id });
	assert.equal(/** @type {any} */ (editing.elements[0]).text, "Lot {n}");
});

test("fieldsUsed tells counters, dates and columns apart", () => {
	const doc = createDocument();
	doc.elements[0].text = "{{literal}}";
	assert.deepEqual(fieldsUsed(doc), { counter: false, date: false, columns: false, any: false });
	doc.elements[0].text = "{1} {date+3d} {n:00}";
	assert.deepEqual(fieldsUsed(doc), { counter: true, date: true, columns: true, any: true });
});

test("batch rows: lines, spreadsheet tabs, CSV, headings, blank lines", () => {
	assert.deepEqual(parseBatch("Salt, fine\n\nPepper\n"), {
		columns: null,
		rows: [["Salt, fine"], ["Pepper"]],
		lines: ["Salt, fine", "Pepper"],
	});
	assert.deepEqual(parseBatch("Spice\tYear\r\nCumin\t2027\r\n", { headings: true }), {
		columns: ["Spice", "Year"],
		rows: [["Cumin", "2027"]],
		lines: ["Cumin\t2027"],
	});
	assert.deepEqual(
		parseBatch('name,note\n"Salt, fine","say ""hi"""\n', { csv: true, headings: true }),
		{
			columns: ["name", "note"],
			rows: [["Salt, fine", 'say "hi"']],
			lines: ['"Salt, fine","say ""hi"""'],
		},
	);
	// Pasted text with the same number of values on every line is CSV.
	assert.deepEqual(parseBatch("Test1, a\nTest2, b\r\n\nTest3, c\n"), {
		columns: null,
		rows: [
			["Test1", "a"],
			["Test2", "b"],
			["Test3", "c"],
		],
		lines: ["Test1, a", "Test2, b", "Test3, c"],
	});
	assert.deepEqual(parseBatch('Salt, "fine, ground"\nPepper, black').rows, [
		["Salt", "fine, ground"],
		["Pepper", "black"],
	]);
	assert.deepEqual(
		parseBatch("Salt, fine\nPepper, black, cracked").rows,
		[["Salt, fine"], ["Pepper, black, cracked"]],
		"lines that differ stay whole",
	);
	assert.deepEqual(parseBatch("Salt, fine").rows, [["Salt, fine"]], "one line could be anything");
	assert.deepEqual(parseCsv('a,"two\nlines"\nb,c'), [
		["a", "two\nlines"],
		["b", "c"],
	]);
});
