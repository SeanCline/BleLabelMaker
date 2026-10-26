import { test } from "node:test";
import assert from "node:assert/strict";
import {
	applyEdit,
	clearStyle,
	diffText,
	normalize,
	retext,
	setStyle,
	stylesBetween,
	textOf,
	typingStyle,
} from "../src/richtext.js";
import { createText, normalizeText } from "../src/model.js";
import { fillDocument, fieldsUsed } from "../src/fields.js";
import { layoutText } from "../src/layout.js";
import { monoMeasure } from "./helpers.js";

/** @typedef {import("../src/richtext.js").RichText} RichText */

const BOLD = { fontWeight: 700 };
const base = { fontWeight: 400, italic: false, underline: false };

test("normalize has one way of writing each text", () => {
	assert.equal(normalize("plain"), "plain");
	assert.equal(normalize(["Te", "xt"]), "Text", "no formatting is a plain string");
	assert.equal(normalize([]), "");
	assert.deepEqual(normalize(["Te", [BOLD, "x"], [BOLD, "y"], "", "t"]), ["Te", [BOLD, "xy"], "t"]);
	assert.equal(normalize([[{ fontWeight: 400 }, "a"], "b"], { base }), "ab", "the box's own style");
	assert.deepEqual(
		normalize([[{ underline: true, fontWeight: 700 }, "a"]], { base }),
		[[{ fontWeight: 700, underline: true }, "a"]],
		"keys in file order",
	);
});

test("a run never starts inside a grapheme or a field", () => {
	// 👍🏽 is two code points; the skin tone can't be styled apart from the hand.
	assert.deepEqual(normalize(["👍", [BOLD, "🏽x"]]), ["👍🏽", [BOLD, "x"]]);
	const field = /\{[^{}]+\}/g;
	assert.deepEqual(normalize([[BOLD, "{da"], "te} now"], { together: field }), [
		[BOLD, "{date}"],
		" now",
	]);
});

test("typing takes the style of the letter before it", () => {
	/** @type {RichText} */
	const text = ["a", [BOLD, "bc"], "d"];
	assert.deepEqual(typingStyle(text, 3), BOLD, "at the end of the bold word");
	assert.deepEqual(typingStyle(text, 1), {}, "just before it");
	assert.deepEqual(typingStyle([[BOLD, "x"], "y"], 0), BOLD, "at the start, the first letter's");
	assert.deepEqual(typingStyle(text, 1, 1), BOLD, "replacing a selection, what it replaces");
	assert.deepEqual(normalize(applyEdit(text, { at: 3, removed: 0, inserted: "!" })), [
		"a",
		[BOLD, "bc!"],
		"d",
	]);
	assert.equal(
		normalize(applyEdit(text, { at: 0, removed: 4, inserted: "new" })),
		"new",
		"replacing it all with plain text that was plain at the start",
	);
});

test("deleting across runs keeps what's either side", () => {
	/** @type {RichText} */
	const text = ["ab", [BOLD, "cd"], "ef"];
	assert.deepEqual(normalize(applyEdit(text, { at: 1, removed: 2, inserted: "" })), [
		"a",
		[BOLD, "d"],
		"ef",
	]);
	assert.equal(normalize(applyEdit(text, { at: 2, removed: 2, inserted: "" })), "abef");
});

test("a style chosen for what's typed next applies to it", () => {
	assert.deepEqual(normalize(applyEdit("ab", { at: 1, removed: 0, inserted: "X" }, BOLD)), [
		"a",
		[BOLD, "X"],
		"b",
	]);
});

test("diffText finds the edit, with the caret settling ambiguity", () => {
	assert.deepEqual(diffText("hello", "help me"), { at: 3, removed: 2, inserted: "p me" });
	assert.deepEqual(diffText("aa", "aaa", 1), { at: 0, removed: 0, inserted: "a" });
	assert.deepEqual(diffText("aa", "aaa", 3), { at: 2, removed: 0, inserted: "a" });
	assert.deepEqual(diffText("aaa", "aa", 1), { at: 1, removed: 1, inserted: "" });
	// Typing "b" after the bold "b" in "abb": the caret says it went after it, so it's bold.
	/** @type {RichText} */
	const text = ["a", [BOLD, "b"], "b"];
	assert.deepEqual(normalize(retext(text, "abbb", { caret: 3 })), ["a", [BOLD, "bb"], "b"]);
	assert.equal(retext("plain", "plainer"), "plainer");
});

test("setStyle and clearStyle format a range, and the whole box", () => {
	const bold = normalize(setStyle("Text", 2, 3, "fontWeight", 700), { base });
	assert.deepEqual(bold, ["Te", [BOLD, "x"], "t"]);
	assert.equal(textOf(bold), "Text");
	const both = normalize(setStyle(bold, 0, 4, "underline", true), { base });
	assert.deepEqual(both, [
		[{ underline: true }, "Te"],
		[{ fontWeight: 700, underline: true }, "x"],
		[{ underline: true }, "t"],
	]);
	assert.deepEqual(normalize(clearStyle(both, "underline"), { base }), bold);
});

test("stylesBetween fills in the box's style, for toggling", () => {
	/** @type {RichText} */
	const text = ["a", [BOLD, "b"]];
	assert.deepEqual(
		stylesBetween(text, 0, 2, base).map((s) => s.fontWeight),
		[400, 700],
	);
	assert.deepEqual(stylesBetween(text, 2, 2, base), [{ ...base, ...BOLD }]);
});

test("text elements keep their text normalized against their own style", () => {
	const e = createText(null, { fontWeight: 700, text: [[BOLD, "all"], " bold"] });
	assert.equal(e.text, "all bold");
	assert.equal(normalizeText({ ...base, text: ["❄️", [BOLD, "x"]] })[0], "❄", "no selectors");
});

test("fields fill in run by run, keeping their formatting", () => {
	const e = createText(null, { text: ["Use by ", [BOLD, "{date+3d:iso}"], " ({n})"] });
	const ctx = { now: new Date(2026, 9, 26), n: 7, row: null, columns: null };
	const [filled] = fillDocument({ label: null, elements: [e] }, ctx).elements;
	assert.deepEqual(/** @type {any} */ (filled).text, ["Use by ", [BOLD, "2026-10-29"], " (7)"]);
	assert.deepEqual(fieldsUsed({ label: null, elements: [e] }), {
		counter: true,
		date: true,
		columns: false,
		any: true,
	});
});

test("layout measures each run in its own width", () => {
	// Bold letters twice as wide: "ab" and the bold "CD" make 6 units at size 1.
	const text = "abCD ef";
	const measure = (from, to, size) => {
		let w = 0;
		for (let i = from; i < to; i++) w += monoMeasure(text[i], size) * (i >= 2 && i < 4 ? 2 : 1);
		return w;
	};
	const r = layoutText({ text, width: 30, height: 100, fontSize: 10, fit: false, measure });
	assert.deepEqual(r.lines, ["abCD", "ef"], "6 × 5 fills the 30 wide line");
	// Without the bold, "abCD" would fit at 15 (4 letters of 7.5).
	const fitted = layoutText({ text, width: 30, height: 100, fit: true, measure });
	assert.ok(fitted.fontSize <= 10, `fit allows for the wider letters (got ${fitted.fontSize})`);
});
