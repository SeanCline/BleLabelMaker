import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapText, layoutText, LINE_HEIGHT } from "../src/layout.js";
import { monoMeasure } from "./helpers.js";

// Each char is 5 units wide at size 10.
const m = (s) => monoMeasure(s, 10);

test("wraps on word boundaries", () => {
	assert.deepEqual(wrapText("the quick brown fox", 50, m), ["the quick", "brown fox"]);
});

test("keeps explicit newlines and blank lines", () => {
	assert.deepEqual(wrapText("a\n\nb", 100, m), ["a", "", "b"]);
});

test("hard-breaks words wider than the box", () => {
	assert.deepEqual(wrapText("abcdefghij", 20, m), ["abcd", "efgh", "ij"]);
	assert.deepEqual(wrapText("hi abcdefghij", 20, m), ["hi", "abcd", "efgh", "ij"]);
});

test("does not split multi-codepoint emoji when hard-breaking", () => {
	const lines = wrapText("👩‍🔬👩‍🔬👩‍🔬", 6, (s) => [...new Intl.Segmenter().segment(s)].length * 5);
	assert.deepEqual(lines, ["👩‍🔬", "👩‍🔬", "👩‍🔬"]);
});

test("collapses whitespace at line breaks", () => {
	assert.deepEqual(wrapText("aaaa    bbbb", 20, m), ["aaaa", "bbbb"]);
});

test("every wrapped line fits", () => {
	const text =
		"Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed doeiusmodtemporincididunt";
	for (const w of [5, 13, 37, 80])
		for (const l of wrapText(text, w, m)) assert.ok(m(l) <= w || [...l].length === 1);
});

test("fit picks the largest size that fits", () => {
	const measure = (s, size) => monoMeasure(s, size);
	const r = layoutText({ text: "Hello", width: 100, height: 100, fit: true, measure });
	// Width bound: 5 chars * 0.5 * size <= 100 → size <= 40.
	assert.ok(r.fontSize <= 40 && r.fontSize >= 39.5, `got ${r.fontSize}`);
	assert.deepEqual(r.lines, ["Hello"]);
});

test("fit respects height with multiple lines", () => {
	const measure = (s, size) => monoMeasure(s, size);
	const r = layoutText({ text: "a\nb\nc", width: 1000, height: 60, fit: true, measure });
	const used = r.lines.length * r.fontSize * LINE_HEIGHT;
	assert.ok(used <= 60);
	assert.ok(r.fontSize > 15, `got ${r.fontSize}`);
});

test("without fit the requested size is used", () => {
	const r = layoutText({
		text: "x",
		width: 10,
		height: 10,
		fontSize: 33,
		fit: false,
		measure: monoMeasure,
	});
	assert.equal(r.fontSize, 33);
});

test("a larger first line: its own size, and fit sizes the whole block together", () => {
	const r = layoutText({
		text: "Title\nsmall print",
		width: 200,
		height: 60,
		fit: true,
		firstScale: 2,
		measure: monoMeasure,
	});
	assert.equal(r.sizes[0], r.fontSize * 2);
	assert.ok(r.sizes.slice(1).every((s) => s === r.fontSize));
	assert.ok(r.height <= 60, `block ${r.height} fits`);
	// Same text, same size, without the title: the lines are equal.
	const flat = layoutText({
		text: "Title\nsmall print",
		width: 200,
		height: 60,
		fontSize: 10,
		fit: false,
		measure: monoMeasure,
	});
	assert.deepEqual(flat.sizes, [10, 10]);
	assert.equal(flat.height, 2 * 10 * 1.2);
});
