import { test } from "node:test";
import assert from "node:assert/strict";
import { EMOJI, searchEmoji } from "../src/text/emoji.js";
import { hasIcon, iconsFromTable, searchIcons } from "../src/text/icons.js";

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

test("icon search: every word of the query, names before other words, plainest first", () => {
	const icons = iconsFromTable([
		[0xf0001, "carrot off", "food"],
		[0xf0002, "carrot", "agriculture food drink"],
		[0xf0003, "food apple", ""],
		[0xf0004, "delete", "trash bin"],
	]);
	const names = (q) => searchIcons(icons, q).map((i) => i.name);
	assert.deepEqual(names("carrot"), ["carrot", "carrot off"]);
	assert.deepEqual(names("food"), ["food apple", "carrot", "carrot off"]);
	assert.deepEqual(names("FOOD car"), ["carrot", "carrot off"]);
	assert.deepEqual(names("tra"), ["delete"]);
	assert.deepEqual(names("  "), [], "a blank search shows no icons: there are thousands");
	assert.equal(icons[1].char, "\u{F0002}");
	assert.ok(hasIcon(`Tea ${icons[1].char}`) && !hasIcon("Tea ☕"));
});

test("the bundled icon table: brand logos left out, every icon in the font's range", async () => {
	const { readFile } = await import("node:fs/promises");
	const table = JSON.parse(await readFile(new URL("../fonts/mdi.json", import.meta.url), "utf8"));
	assert.ok(table.length > 7000);
	for (const [cp, name] of table) assert.ok(hasIcon(String.fromCodePoint(cp)) && name, name);
	assert.ok(!table.some(([, name]) => name === "github"), "no brands");
	assert.equal(new Set(table.map(([cp]) => cp)).size, table.length);
});

test("icon search ranks names that start with the word, then what it names, then styles", () => {
	const icons = iconsFromTable([
		[0xf0001, "account box", ""],
		[0xf0002, "package", "box parcel"],
		[0xf0003, "box cutter", ""],
		[0xf0004, "carrot outline", ""],
		[0xf0005, "carrot off", ""],
	]);
	const names = (q) => searchIcons(icons, q).map((i) => i.name);
	assert.deepEqual(names("box"), ["box cutter", "package", "account box"]);
	assert.deepEqual(names("carrot"), ["carrot off", "carrot outline"], "outlines last");
	assert.deepEqual(names("carrot out"), ["carrot outline"]);
});

test("icon search finds plurals in the singular, as MDI names things", () => {
	const icons = iconsFromTable([
		[0xf0001, "tree", ""],
		[0xf0002, "treasure chest", ""],
		[0xf0003, "box", ""],
		[0xf0004, "battery", ""],
		[0xf0005, "cookie", ""],
		[0xf0006, "glass mug", ""],
		[0xf0007, "glasses", ""],
	]);
	const names = (q) => searchIcons(icons, q).map((i) => i.name);
	assert.deepEqual(names("trees"), ["tree"]);
	assert.deepEqual(names("boxes"), ["box"]);
	assert.deepEqual(names("batteries"), ["battery"]);
	assert.deepEqual(names("cookies"), ["cookie"]);
	assert.deepEqual(names("glasses"), ["glasses", "glass mug"]);
});
