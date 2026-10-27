import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, typeInto, appState, labelPixels, openSettings, openBatchList } from "./harness.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

const setText = (page, text) => typeInto(page, "#designText", text);
const printAndWait = async (page, count) => {
	await page.click("#btnPrint");
	await page.waitForFunction(
		(n) => document.querySelectorAll("#tape .printed").length >= n,
		{},
		count,
	);
};
/** Pictures in the newest virtual print: one per different label. */
const pictures = (page) => page.$$eval("#tape .printed:first-child canvas", (c) => c.length);
const canvasHash = async (page) => (await labelPixels(page)).hash;

test("a counter makes every copy different and carries on from the last print", async () => {
	const page = await env.open();
	assert.equal(await page.$eval("#counterRow", (r) => r.hidden), true, "hidden until used");
	await setText(page, "BIN-{n:000}");
	assert.equal(await page.$eval("#counterRow", (r) => r.hidden), false);
	await typeInto(page, "#copies", "3");
	await printAndWait(page, 1);
	assert.equal(await pictures(page), 3, "three different labels");
	assert.match(await page.$eval("#tape .printed .hint", (h) => h.textContent), /^3 of 3 copies/);
	assert.equal(await page.$eval("#counterStart", (i) => i.value), "4");

	// The next print starts at 4 and so looks different from the first one.
	const before = await canvasHash(page);
	await typeInto(page, "#counterStart", "1");
	await page.evaluate(() => window.labelApp.drawCanvas());
	assert.notEqual(await canvasHash(page), before, "the preview shows the next number");
	assert.equal((await appState(page)).doc.elements[0].text, "BIN-{n:000}", "template kept");
	assert.deepEqual(page.errors, []);
});

test("a batch list prints one label per line, with a preview of each", async () => {
	const page = await env.open();
	await openBatchList(page);
	await typeInto(page, "#batchData", "Paprika\nCumin\n\nOregano\n");
	assert.equal(await page.$eval("#batchUnused", (w) => w.hidden), false, "warns: list unused");
	await setText(page, "{1}");
	assert.equal(await page.$eval("#batchUnused", (w) => w.hidden), true);
	assert.equal(await page.$eval("#btnPrint", (b) => b.textContent.trim()), "Print 3 labels");
	assert.equal(await page.$eval("#batchPos", (p) => p.textContent), "Row 1 of 3");

	const first = await canvasHash(page);
	await page.click("#batchNext");
	await page.evaluate(() => window.labelApp.drawCanvas());
	assert.notEqual(await canvasHash(page), first, "previewing the second line");
	assert.equal(await page.$eval("#batchPos", (p) => p.textContent), "Row 2 of 3");

	await printAndWait(page, 1);
	assert.equal(await pictures(page), 3);
	const history = await page.evaluate(() => window.labelApp.historyEntries());
	assert.equal(history.length, 1, "one history entry for the batch");
	assert.equal(history[0].copies, 3);

	// The list survives a reload, and shows on the label area so a batch is never a surprise.
	await page.reload({ waitUntil: "networkidle0" });
	await page.evaluate(() => window.labelApp.ready);
	assert.equal(await page.$eval("#batchNav", (n) => n.hidden), false);
	assert.equal(await page.$eval("#batchPos", (p) => p.textContent), "Row 1 of 3");
	assert.equal(await page.$eval("#btnPrint", (b) => b.textContent.trim()), "Print 3 labels");
	await page.click("#batchEdit");
	await page.click("#batchClear");
	assert.equal(await page.$eval("#batchNav", (n) => n.hidden), true);
	assert.equal(await page.$eval("#btnPrint", (b) => b.textContent.trim()), "Print");
	assert.deepEqual(page.errors, []);
});

test("spreadsheet columns by heading, and the field menu inserts at the cursor", async () => {
	const page = await env.open();
	await openBatchList(page);
	await typeInto(page, "#batchData", "Spice\tJar\nCumin\tA3\nSage\tB1");
	await page.click("#batchHeadings");
	assert.match(await page.$eval("#batchHint", (h) => h.textContent), /\{Spice\} \{Jar\}/);

	await setText(page, "Jar ");
	await openSettings(page);
	await page.$eval("#designText", (t) => {
		t.focus();
		t.setSelectionRange(4, 4);
	});
	await page.select("#textProps .insert-field", "{2}");
	assert.equal((await appState(page)).doc.elements[0].text, "Jar {2}");
	assert.equal(await page.evaluate(() => document.activeElement.id), "designText");
	assert.equal(await page.$eval("#textProps .insert-field", (s) => s.value), "", "menu resets");
	assert.equal(await page.$eval("#btnPrint", (b) => b.textContent.trim()), "Print 2 labels");
	assert.deepEqual(page.errors, []);
});
