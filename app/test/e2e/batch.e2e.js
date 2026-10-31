import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
	setup,
	typeInto,
	appState,
	labelPixels,
	openSettings,
	openBatchList,
	loaded,
	fromFileMenu,
	printVirtual,
	FIREFOX,
} from "./harness.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

// Firefox hands listeners an empty clipboardData on clipboard events a page fires, so the
// tests that fire them only run in Chrome. Real copy and paste are trusted, and filled in.
const NO_PAGE_CLIPBOARD = FIREFOX && "Firefox empties clipboardData on page-made events";

const setText = (page, text) => typeInto(page, "#designText", text);
/** Pictures in the newest virtual print: one per different label. */
const pictures = (page) => page.$$eval("#tape .printed:first-child canvas", (c) => c.length);
const canvasHash = async (page) => (await labelPixels(page)).hash;

test("a counter makes every copy different and carries on from the last print", async () => {
	const page = await env.open();
	assert.equal(await page.$eval("#counterRow", (r) => r.hidden), true, "hidden until used");
	await setText(page, "BIN-{n:000}");
	assert.equal(await page.$eval("#counterRow", (r) => r.hidden), false);
	await typeInto(page, "#copies", "3");
	await printVirtual(page);
	assert.equal(await pictures(page), 3, "three different labels");
	assert.match(
		await page.$eval("#tape .printed .hint", (h) => h.textContent),
		/^3 of 3 labels decoded/,
	);
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

	// Printing just the row on show, say to redo one label that came out wrong.
	const printedImages = () =>
		page.$$eval("#tape .printed:first-child canvas", (c) => c.map((x) => x.toDataURL()));
	await printVirtual(page, () => page.click("#batchPrintRow"));
	const [onlyRow] = await printedImages();
	assert.equal(await pictures(page), 1);

	await printVirtual(page);
	assert.equal(await pictures(page), 3);
	assert.equal((await printedImages())[1], onlyRow, "the single label was the second row");
	const history = await page.evaluate(() => window.labelApp.historyEntries());
	// The same design printed again is one history entry, its copies added up.
	assert.equal(history.length, 1, "one history entry for the batch");
	assert.equal(history[0].copies, 4);

	// The list survives a reload, and shows on the label area so a batch is never a surprise.
	await page.reload({ waitUntil: "load" });
	await loaded(page);
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
	// The bar's menu, which stays over the settings: picking from it takes the focus.
	await page.focus("#quickbar .insert-field");
	await page.select("#quickbar .insert-field", "{2}");
	assert.equal((await appState(page)).doc.elements[0].text, "Jar {2}");
	assert.equal(await page.evaluate(() => document.activeElement.id), "designText");
	assert.equal(await page.$eval("#quickbar .insert-field", (s) => s.value), "", "menu resets");
	assert.equal(await page.$eval("#btnPrint", (b) => b.textContent.trim()), "Print 2 labels");
	assert.deepEqual(page.errors, []);
});

test("pasted lines with commas in step are CSV: {1}, {2} each value, {0} the whole line", async () => {
	const page = await env.open();
	await openBatchList(page);
	await typeInto(page, "#batchData", "Test1, a\nTest2, b\nTest3, c");
	assert.equal(
		await page.$eval("#batchHint", (h) => h.textContent),
		"Columns: {1} {2}. Put them in your text, barcode or QR code.",
	);
	assert.equal(
		await page.$eval("#batchWhole", (h) => !h.hidden && h.textContent),
		"{0} inserts the whole line.",
	);
	await setText(page, "{2}");
	await page.click("#batchNext");
	const second = await canvasHash(page);
	await setText(page, "b");
	assert.equal(await canvasHash(page), second, "{2} of the second row is b");
	await page.click("#batchPrev");
	await setText(page, "{0}");
	const whole = await canvasHash(page);
	await setText(page, "Test1, a");
	assert.equal(await canvasHash(page), whole);
	assert.deepEqual(page.errors, []);
});

test("Batch sits beside Print and counts its list; the Field menu groups the list's fields", async () => {
	const page = await env.open();
	const count = () => page.$eval("#batchCount", (c) => !c.hidden && c.textContent);
	assert.equal(await count(), false, "no count without a list");
	await openBatchList(page);
	assert.equal(await page.$eval("#batchSheet", (s) => s.hidden), false);
	assert.equal(await page.evaluate(() => document.activeElement.id), "batchData");
	await typeInto(page, "#batchData", "Cumin\nSage\nThyme");
	assert.equal(await count(), "3");
	assert.equal(
		await page.$eval("#btnBatch", (b) => b.getAttribute("aria-label")),
		"Batch: 3 labels from a list",
	);
	// The Field menu inserts fields, the list's among them; opening the list is Batch's job.
	const fields = await page.$$eval("#quickbar .insert-field option:not([hidden])", (o) =>
		o.slice(-3).map((x) => [x.value, x.textContent]),
	);
	assert.deepEqual(fields, [
		["{1}", "Batch column 1"],
		["{2}", "Batch column 2"],
		["{0}", "Batch line"],
	]);
	assert.deepEqual(page.errors, []);
});

test("a list pasted onto the label offers a label for each line", async (t) => {
	if (NO_PAGE_CLIPBOARD) return t.skip(NO_PAGE_CLIPBOARD);
	const page = await env.open();
	await page.focus("#overlay");
	await page.evaluate(() => {
		const clipboardData = new DataTransfer();
		clipboardData.setData("text/plain", "Test1, a\nTest2, b\nTest3, c");
		document.activeElement.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
		);
	});
	const pasted = (await appState(page)).doc.elements.at(-1);
	assert.equal(pasted.text, "Test1, a\nTest2, b\nTest3, c", "pasted as it was, until asked");
	assert.match(await page.$eval("#toast", (t) => t.textContent), /^3 lines pasted\./);
	await page.click("#toast button");
	assert.equal((await appState(page)).doc.elements.at(-1).text, "{1}\n{2}");
	assert.equal(await page.$eval("#batchCount", (c) => c.textContent), "3");
	assert.equal(await page.$eval("#batchSheet", (s) => s.hidden), false, "the list, to check");
	await page.click("#batchClose");
	await page.click("#btnUndo");
	assert.equal((await appState(page)).doc.elements.at(-1).text, "Test1, a\nTest2, b\nTest3, c");
	assert.deepEqual(page.errors, []);
});

test("the One per line template starts a list, without replacing one already there", async () => {
	const page = await env.open();
	await fromFileMenu(page, "#btnNew");
	await page.click('#templateList [data-id="list"]');
	assert.equal((await appState(page)).doc.elements[0].text, "{1}");
	assert.equal(await page.$eval("#batchData", (t) => t.value.split("\n")[0]), "Cumin");
	assert.equal(await page.$eval("#batchSheet", (s) => s.hidden), false);
	await typeInto(page, "#batchData", "Mine\nOurs");
	await page.click("#batchClose");
	await fromFileMenu(page, "#btnNew");
	await page.click('#templateList [data-id="list"]');
	assert.equal(await page.$eval("#batchData", (t) => t.value), "Mine\nOurs");
	assert.deepEqual(page.errors, []);
});
