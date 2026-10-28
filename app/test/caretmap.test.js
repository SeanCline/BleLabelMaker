import { test } from "node:test";
import assert from "node:assert/strict";
import { wrapLines, layoutText, stackLetters, LINE_HEIGHT } from "../src/layout.js";
import {
	caretMap,
	caretAt,
	indexAt,
	lineOf,
	nearestStop,
	selectionRects,
} from "../src/caretmap.js";
import { monoMeasure, monoRange } from "./helpers.js";

// Each char is 5 units wide at size 10.
const m = (s) => monoMeasure(s, 10);

test("every wrapped line is the slice of the text it says it starts at", () => {
	/** @type {[string, number][]} */
	const cases = [
		["the quick brown fox", 50],
		["  leading and   inner   spaces  ", 40],
		["a\n\nb\n  c", 100],
		["hi abcdefghij", 20],
		["aaaa    bbbb", 20],
	];
	for (const [text, w] of cases) {
		for (const { text: line, start } of wrapLines(text, w, (a, b) => m(text.slice(a, b)))) {
			assert.equal(text.slice(start, start + line.length), line, JSON.stringify(text));
		}
	}
	assert.deepEqual(
		wrapLines("the quick brown fox", 50, (a, b) => m("the quick brown fox".slice(a, b))).map(
			(l) => l.start,
		),
		[0, 10],
	);
});

test("layoutText says where each line starts, across paragraphs", () => {
	const text = "Title\nsmall print here";
	const r = layoutText({
		text,
		width: 60,
		height: 100,
		fontSize: 10,
		fit: false,
		measure: monoRange(text),
	});
	assert.deepEqual(r.lines, ["Title", "small print", "here"]);
	assert.deepEqual(r.starts, [0, 6, 18]);
});

test("stacked letters remember where each came from", () => {
	const { text, source } = stackLetters("AB C👍🏽");
	assert.equal(text, "A\nB\nC\n👍🏽");
	assert.deepEqual(
		text.split("\n").reduce((acc, _, i, all) => {
			const at = all.slice(0, i).join("\n").length + (i ? 1 : 0);
			return [...acc, source[at]];
		}, []),
		[0, 1, 3, 4],
	);
});

/**
 * A caret map for monospaced text, as the editor builds one.
 * @param {string} text
 * @param {{width?: number, align?: "left"|"center"|"right", firstScale?: number}} [options]
 */
const mapOf = (text, { width = 60, align = "left", firstScale = 1 } = {}) => {
	const layout = layoutText({
		text,
		width,
		height: 100,
		fontSize: 10,
		fit: false,
		measure: monoRange(text),
		firstScale,
	});
	return caretMap({ layout: { ...layout, top: 0, text }, width, align, measure: monoRange(text) });
};

test("spaces after the last word move the caret on, though the label doesn't draw them", () => {
	const map = mapOf("ab  \ncd");
	assert.deepEqual(
		[2, 3, 4].map((i) => caretAt(map, i).x),
		[10, 15, 20],
	);
	assert.equal(map[0].end, 4, "End goes after them");
	assert.equal(lineOf(map, 5), 1);
	// Centred, the text stays where it was; the caret runs on to its right.
	const centred = mapOf("ab ", { align: "center" });
	assert.deepEqual(
		[2, 3].map((i) => caretAt(centred, i).x),
		[35, 40],
	);
	// Never past the box's edge, and the spaces at a wrap stay on the line before it.
	const right = mapOf("ab  ", { align: "right" });
	assert.equal(caretAt(right, 4).x, 60);
	const wrap = mapOf("small print   here");
	assert.deepEqual(
		[12, 13].map((i) => caretAt(wrap, i)),
		[
			{ x: 60, top: 0, height: 10 * LINE_HEIGHT },
			{ x: 60, top: 0, height: 10 * LINE_HEIGHT },
		],
	);
	assert.equal(caretAt(wrap, 14).top, 10 * LINE_HEIGHT, "where the next line starts");
});

test("the caret follows the label's line breaks, not the text's", () => {
	const map = mapOf("small print here");
	assert.equal(map.length, 2);
	// After "print", the dropped space and the start of "here".
	assert.deepEqual(caretAt(map, 11), { x: 55, top: 0, height: 10 * LINE_HEIGHT });
	assert.equal(caretAt(map, 12).top, 10 * LINE_HEIGHT);
	assert.equal(caretAt(map, 12).x, 0);
	assert.equal(lineOf(map, 16), 1);
});

test("alignment and line sizes move the caret as the label draws them", () => {
	const centred = mapOf("ab", { align: "center" });
	assert.equal(caretAt(centred, 0).x, 25);
	const right = mapOf("ab", { align: "right" });
	assert.equal(caretAt(right, 2).x, 60);
	const title = mapOf("T\nsmall", { firstScale: 2 });
	assert.equal(title[0].height, 20 * LINE_HEIGHT);
	assert.equal(title[1].top, 20 * LINE_HEIGHT);
	assert.equal(caretAt(title, 1).x, 10, "the first line's letters are twice as wide");
});

test("a click lands on the nearest caret position of the line under it", () => {
	const map = mapOf("small print here");
	assert.equal(indexAt(map, 12, 3), 2);
	assert.equal(indexAt(map, 13, 3), 3);
	assert.equal(indexAt(map, 2, 15), 12);
	assert.equal(indexAt(map, 500, 500), 16, "below and right of everything: the end");
	assert.equal(nearestStop(map[1], 11).index, 14);
});

test("the selection is drawn per line, marking a selected line break", () => {
	const map = mapOf("ab\ncd");
	assert.deepEqual(selectionRects(map, 1, 4), [
		{ x: 5, top: 0, width: 5 + 3, height: 12 },
		{ x: 0, top: 12, width: 5, height: 12 },
	]);
	assert.deepEqual(selectionRects(map, 2, 2), []);
	// Stacked letters sit on lines with nothing between them, so nothing extra is marked.
	const stacked = stackLetters("AB");
	const layout = layoutText({
		text: stacked.text,
		width: 60,
		height: 100,
		fontSize: 10,
		fit: false,
		measure: monoRange(stacked.text),
	});
	const starts = layout.starts.map((i) => stacked.source[i]);
	const smap = caretMap({
		layout: { ...layout, starts, top: 0 },
		width: 60,
		align: "left",
		measure: monoRange(stacked.text),
	});
	assert.deepEqual(selectionRects(smap, 1, 2), [{ x: 0, top: 12, width: 5, height: 12 }]);
});
