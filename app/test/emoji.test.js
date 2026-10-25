import { test } from "node:test";
import assert from "node:assert/strict";
import { EMOJI, searchEmoji } from "../src/emoji.js";

test("every picker emoji has a name and appears once", () => {
	assert.ok(EMOJI.length > 150);
	for (const e of EMOJI) assert.ok(e.char && e.words, JSON.stringify(e));
	assert.equal(new Set(EMOJI.map((e) => e.char)).size, EMOJI.length);
});

test("search matches word starts, every word of the query, any case", () => {
	assert.deepEqual(
		searchEmoji("frozen").map((e) => e.char),
		["🧊", "❄️"],
	);
	assert.equal(searchEmoji("box")[0].char, "📦", "name matches first");
	assert.deepEqual(
		searchEmoji("FRU CIT").map((e) => e.char),
		["🍊", "🍋"],
	);
	assert.ok(searchEmoji("warn").some((e) => e.char === "⚠️"));
	assert.deepEqual(searchEmoji("zzz"), []);
	assert.equal(searchEmoji("  ").length, EMOJI.length, "blank shows everything");
});
