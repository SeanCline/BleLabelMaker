import { test } from "node:test";
import assert from "node:assert/strict";
import {
	recordPrint,
	removeEntry,
	exportHistory,
	importHistory,
	loadStored,
	entryToState,
	matches,
	entryTitle,
	HISTORY_FORMAT,
} from "../src/printhistory.js";
import { createDocument, createText } from "../src/model.js";
import { LabelFileError } from "../src/fileformat.js";

const docWith = (text) => {
	const d = createDocument();
	d.elements[0].text = text;
	return d;
};
const at = (s) => ({ now: new Date(`2026-10-${s}T12:00:00Z`) });
const print = (entries, doc, opts, extra = {}) =>
	recordPrint(entries, { doc, copies: 1, target: "bluetooth", ...extra }, opts);

test("records prints newest first and merges reprints of the same design", () => {
	const a = docWith("Flour");
	const b = docWith("Sugar");
	let h = print([], a, at("01"));
	h = print(h, b, at("02"));
	h = print(h, a, at("03"), { copies: 3 });
	assert.equal(h.length, 2);
	assert.equal(entryTitle(h[0]), "Flour");
	assert.equal(h[0].prints, 2);
	assert.equal(h[0].copies, 4);
	assert.equal(h[0].firstPrintedAt, "2026-10-01T12:00:00.000Z");
	assert.equal(h[0].lastPrintedAt, "2026-10-03T12:00:00.000Z");
});

test("history is capped, dropping the oldest", () => {
	let h = [];
	for (let i = 0; i < 12; i++) h = print(h, docWith(`L${i}`), {}, {});
	h = recordPrint(h, { doc: docWith("last"), copies: 1, target: "virtual" }, { limit: 10 });
	assert.equal(h.length, 10);
	assert.equal(entryTitle(h[0]), "last");
});

test("an entry reopens as the exact design", () => {
	const d = docWith("Rice");
	d.elements.push(createText(d, { text: "🍚" }));
	const [entry] = print([], d);
	const { doc } = entryToState(entry);
	assert.deepEqual(doc, d);
});

test("export → import into an empty history round-trips", () => {
	let h = print([], docWith("A"), at("01"));
	h = print(h, docWith("B"), at("02"));
	const { entries, added, merged } = importHistory(exportHistory(h), []);
	assert.equal(added, 2);
	assert.equal(merged, 0);
	assert.deepEqual(entries, h);
});

test("import merges overlapping designs and keeps order by last print", () => {
	const mine = print(print([], docWith("A"), at("01")), docWith("B"), at("05"));
	const theirs = print(print([], docWith("A"), at("09")), docWith("C"), at("03"));
	const { entries, added, merged } = importHistory(exportHistory(theirs), mine);
	assert.equal(added, 1);
	assert.equal(merged, 1);
	assert.deepEqual(entries.map(entryTitle), ["A", "B", "C"]);
	assert.equal(entries[0].prints, 2);
	assert.equal(entries[0].firstPrintedAt, "2026-10-01T12:00:00.000Z");
});

test("import rejects non-history files and invalid designs without partial changes", () => {
	assert.throws(() => importHistory("nope", []), LabelFileError);
	assert.throws(
		() => importHistory('{"format":"labelmaker-label","version":1}', []),
		/isn't a print history/,
	);
	assert.throws(
		() => importHistory(JSON.stringify({ format: HISTORY_FORMAT, version: 99, entries: [] }), []),
		/newer/,
	);
	const h = print([], docWith("A"));
	const bad = JSON.parse(exportHistory(h));
	bad.entries[0].file.elements[0].fontWeight = 450;
	assert.throws(() => importHistory(JSON.stringify(bad), []), /Entry 1: .*weight/);
});

test("loading from storage skips bad entries instead of losing everything", () => {
	const h = print(print([], docWith("A")), docWith("B"));
	const stored = JSON.parse(JSON.stringify(h));
	stored[1].file = { garbage: true };
	assert.deepEqual(loadStored(stored).map(entryTitle), ["B"]);
	assert.deepEqual(loadStored(null), []);
});

test("search matches text and emoji, case-insensitively", () => {
	const d = docWith("Chili Flakes");
	d.elements.push(createText(d, { text: "🌶️" }));
	const [e] = print([], d);
	assert.ok(matches(e, "chili"));
	assert.ok(matches(e, "🌶️"));
	assert.ok(matches(e, ""));
	assert.ok(!matches(e, "cumin"));
});

test("removeEntry", () => {
	const h = print(print([], docWith("A")), docWith("B"));
	assert.deepEqual(removeEntry(h, h[0].id).map(entryTitle), ["A"]);
});
