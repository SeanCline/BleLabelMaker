import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup, appState, labelPixels, loaded, openSettings, FIREFOX } from "./harness.js";

let env;
let dir;
// A font we ship (Pacifico's Latin letters), under another name: a file someone downloaded.
let PACIFICO;
before(async () => {
	env = await setup();
	dir = await mkdtemp(join(tmpdir(), "labels-fonts-"));
	const css = await readFile(new URL("../../fonts/fonts.css", import.meta.url), "utf8");
	const latin = /\/\* latin \*\/\s*@font-face\s*\{[^}]*'Pacifico'[^}]*url\(([^)]+)\)/.exec(css)[1];
	PACIFICO = new URL(`../../fonts/${latin}`, import.meta.url);
});
after(async () => {
	await env?.teardown();
	if (dir) await rm(dir, { recursive: true, force: true });
});

const yourFonts = (page) =>
	page.$$eval("#quickbar select.font-select optgroup[label='Your fonts'] option", (all) =>
		all.map((o) => o.value),
	);
const status = (page) => page.$eval("#fontStatus", (s) => s.textContent);
/** Whether text in `family` comes out other than in the fallback face: the font is there. */
const drawsIn = (page, family) =>
	page.evaluate(async (family) => {
		await document.fonts.load(`20px "${family}"`, "Hello");
		const c = document.createElement("canvas").getContext("2d");
		c.font = `40px "${family}", monospace`;
		const width = c.measureText("Hello world").width;
		c.font = "40px monospace";
		return width !== c.measureText("Hello world").width;
	}, family);

test("a font file is added to the list, kept in the browser, drawn, and can be removed", async () => {
	const page = await env.open();
	const file = join(dir, "Shrikhand-BoldItalic.woff2");
	await copyFile(PACIFICO, file);
	const plain = await labelPixels(page);

	await page.select("#quickbar select.font-select", "add-font");
	assert.equal(await page.$eval("#fontDialog", (d) => d.open), true);
	await (await page.$("#fontFile")).uploadFile(file);
	await page.waitForFunction(() => /Added/.test(document.querySelector("#fontStatus").textContent));
	assert.equal(await status(page), "Added Shrikhand.");
	assert.deepEqual(await yourFonts(page), ["Shrikhand"]);
	// The menu it was added from switches to it, at the weight the file's name said.
	const text = (await appState(page)).doc.elements[0];
	assert.equal(text.fontFamily, "Shrikhand");
	await page.click('#fontDialog button[value="close"]');
	assert.ok(await drawsIn(page, "Shrikhand"));
	assert.notEqual((await labelPixels(page)).hash, plain.hash, "the label is drawn in it");

	// Still there after a reload, from IndexedDB.
	await page.reload({ waitUntil: "load" });
	await loaded(page);
	await page.waitForFunction(() =>
		document.querySelector("#quickbar select.font-select optgroup[label='Your fonts']"),
	);
	assert.deepEqual(await yourFonts(page), ["Shrikhand"]);
	assert.ok(await drawsIn(page, "Shrikhand"), "loaded into the page");

	await page.select("#quickbar select.font-select", "add-font");
	await page.click('#customFontList [aria-label="Remove Shrikhand"]');
	// Once it's out of storage.
	await page.waitForFunction(() => !document.querySelector("#customFontList li"));
	assert.deepEqual(await yourFonts(page), []);
	assert.equal(await page.$eval("#noCustomFonts", (p) => p.hidden), false);
	assert.deepEqual(page.errors, []);
});

test("a Google Fonts family is downloaded by its name or link, Latin faces only", async (t) => {
	if (FIREFOX) return t.skip("needs request interception, which Firefox's driver lacks");
	const page = await env.open();
	const woff2 = await readFile(PACIFICO);
	const asked = [];
	await page.setRequestInterception(true);
	page.on("request", (req) => {
		const url = req.url();
		if (url.startsWith("https://fonts.googleapis.com/")) {
			asked.push(url);
			// Google serves the styles a family has: this one has no italic.
			return req.respond({
				status: 200,
				contentType: "text/css",
				headers: { "access-control-allow-origin": "*" },
				body: `/* cyrillic */
@font-face { font-family: 'Fake Serif'; font-style: normal; font-weight: 400;
  src: url(https://fonts.gstatic.com/s/fake/cyr.woff2) format('woff2'); unicode-range: U+0400-045F; }
/* latin */
@font-face { font-family: 'Fake Serif'; font-style: normal; font-weight: 400 700;
  src: url(https://fonts.gstatic.com/s/fake/latin.woff2) format('woff2'); unicode-range: U+0000-00FF; }`,
			});
		}
		if (url.startsWith("https://fonts.gstatic.com/")) {
			asked.push(url);
			return req.respond({
				status: 200,
				contentType: "font/woff2",
				headers: { "access-control-allow-origin": "*" },
				body: woff2,
			});
		}
		return req.continue();
	});
	await openSettings(page);
	await page.select("#quickbar select.font-select", "add-font");
	await page.type("#googleFont", "https://fonts.google.com/specimen/Fake+Serif");
	await page.keyboard.press("Enter");
	await page.waitForFunction(() =>
		/Added|Google/.test(document.querySelector("#fontStatus").textContent),
	);
	assert.equal(await status(page), "Added Fake Serif.");
	assert.equal(await page.$eval("#fontDialog", (d) => d.open), true, "Enter adds, not closes");
	assert.deepEqual(
		asked.map((u) => u.split("/").at(-1)),
		["css2?family=Fake+Serif:ital,wght@0,400;0,700;1,400;1,700&display=block", "latin.woff2"],
		"one stylesheet, and only the Latin file",
	);
	assert.equal((await appState(page)).doc.elements[0].fontFamily, "Fake Serif");
	assert.ok(await drawsIn(page, "Fake Serif"));
	// A variable face's weights are all offered.
	assert.deepEqual(
		await page.$$eval('#textProps [data-prop="fontWeight"] option', (o) => o.map((x) => x.value)),
		["400", "500", "600", "700"],
	);

	await page.$eval("#googleFont", (i) => (i.value = ""));
	await page.type("#googleFont", "Not a font!");
	await page.click("#addGoogleFont");
	assert.match(await status(page), /isn't a Google Fonts name or link/);
	assert.deepEqual(page.errors, []);
});
