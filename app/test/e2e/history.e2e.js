import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setup, typeInto, serialized, appState, fromFileMenu, loaded } from "./harness.js";

let env;
let downloads;
before(async () => {
	env = await setup();
	downloads = await mkdtemp(join(tmpdir(), "labels-dl-"));
});
after(async () => {
	await env?.teardown();
	await rm(downloads, { recursive: true, force: true });
});

const printText = async (page, text) => {
	await typeInto(page, '#textProps [data-prop="text"]', text);
	const before = await page.$$eval("#tape .printed", (n) => n.length);
	await page.click("#btnPrint");
	await page.waitForFunction(
		(n) => document.querySelectorAll("#tape .printed").length > n,
		{},
		before,
	);
};

const waitForDownload = async (dir, timeout = 5000) => {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		const done = (await readdir(dir)).filter((f) => !f.endsWith(".crdownload"));
		if (done.length) return join(dir, done[0]);
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("no download");
};

test("prints are recorded, reprints merge, entries reopen, export/import round-trips", async () => {
	const page = await env.open();
	await printText(page, "Flour");
	await printText(page, "Sugar");
	await printText(page, "Flour");

	await fromFileMenu(page, "#btnHistory");
	await page.waitForSelector("#historyList li");
	const titles = await page.$$eval("#historyList li strong", (n) => n.map((x) => x.textContent));
	assert.deepEqual(titles, ["Flour", "Sugar"]);
	assert.match(
		await page.$eval("#historyList li .hint", (e) => e.textContent),
		/2 copies over 2 prints/,
	);

	// Thumbnails are real renders, not blank canvases.
	await page.waitForFunction(() => {
		const c = document.querySelector("#historyList .thumb");
		if (!c.width) return false;
		const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
		for (let i = 0; i < d.length; i += 4) if (d[i] === 0) return true;
		return false;
	});

	await typeInto(page, "#historySearch", "sug");
	assert.equal(await page.$$eval("#historyList li", (n) => n.length), 1);
	await page.click('#historyList li [data-action="open"]');
	assert.equal(await page.$eval("#historyDialog", (d) => d.open), false);
	assert.equal(await page.$eval('#textProps [data-prop="text"]', (t) => t.value), "Sugar");

	// Export through the real download path.
	// Each test page lives in its own browser context, so downloads are allowed per context.
	const cdp = await page.browser().target().createCDPSession();
	await cdp.send("Browser.setDownloadBehavior", {
		behavior: "allow",
		downloadPath: downloads,
		browserContextId: page.browserContext().id,
	});
	await fromFileMenu(page, "#btnHistory");
	await page.click("#btnHistoryExport");
	const exported = await waitForDownload(downloads);
	const json = JSON.parse(await readFile(exported, "utf8"));
	assert.equal(json.format, "labelmaker-history");
	assert.equal(json.entries.length, 2);

	// A fresh browser profile imports it and gets the same labels.
	const other = await env.open();
	await fromFileMenu(other, "#btnHistory");
	const input = await other.$("#historyFile");
	await input.uploadFile(exported);
	await other.waitForFunction(() => document.querySelectorAll("#historyList li").length === 2);
	assert.match(await other.$eval("#toast", (t) => t.textContent), /Imported 2 new labels/);

	// Importing again merges rather than duplicating.
	await input.uploadFile(exported);
	await other.waitForFunction(() => /merged 2/.test(document.querySelector("#toast").textContent));
	assert.equal(await other.$$eval("#historyList li", (n) => n.length), 2);

	// "Print again" opens and prints in one go.
	const beforeFile = await serialized(other);
	await other.click('#historyList li [data-action="print"]');
	await other.waitForSelector("#tape .printed");
	assert.notEqual(await serialized(other), beforeFile);
	assert.deepEqual(page.errors, []);
	assert.deepEqual(other.errors, []);
});

test("history survives a reload; delete and clear work", async () => {
	const page = await env.open();
	await printText(page, "One");
	await printText(page, "Two");
	await page.evaluate(() => window.labelApp.historySaved());
	await page.reload({ waitUntil: "load" });
	await loaded(page);
	await fromFileMenu(page, "#btnHistory");
	await page.waitForSelector("#historyList li");
	await page.click('#historyList li [data-action="delete"]');
	assert.deepEqual(
		await page.$$eval("#historyList li strong", (n) => n.map((x) => x.textContent)),
		["One"],
	);
	page.once("dialog", (d) => d.accept());
	await page.click("#btnHistoryClear");
	await page.waitForFunction(() => !document.querySelector("#historyList li"));
	assert.equal(await page.evaluate(() => window.labelApp.historyEntries().length), 0);
});

test("history holds more than localStorage could: big images survive a reload", async () => {
	const page = await env.open();
	// Three labels, each with a ~2.5 MB noise image (incompressible): ~7.5 MB in all, past the
	// ~5 MB localStorage the history used to live in.
	let total = 0;
	for (let i = 0; i < 3; i++) {
		const file = await page.evaluate(() => {
			const c = document.createElement("canvas");
			c.width = c.height = 800;
			const ctx = c.getContext("2d");
			const img = ctx.createImageData(800, 800);
			// Real randomness: a simple generator repeats, and PNG compresses it away.
			for (let o = 0; o < img.data.length; o += 65536) {
				crypto.getRandomValues(img.data.subarray(o, o + 65536));
			}
			for (let a = 3; a < img.data.length; a += 4) img.data[a] = 255;
			ctx.putImageData(img, 0, 0);
			return import("/src/model.js").then(({ createDocument, createImage }) =>
				import("/src/fileformat.js").then(({ serialize }) => {
					const doc = createDocument();
					doc.elements = [
						createImage(doc, { x: 1, y: 1, w: 10, h: 10, src: c.toDataURL("image/png") }),
					];
					return serialize(doc, { selectedIds: [] });
				}),
			);
		});
		total += file.length;
		await page.evaluate((t) => window.labelApp.loadText(t), file);
		assert.equal((await appState(page)).doc.elements[0]?.type, "image", "the file loaded");
		const before = await page.$$eval("#tape .printed", (n) => n.length);
		await page.click("#btnPrint");
		await page.waitForFunction(
			(n) => document.querySelectorAll("#tape .printed").length > n,
			{},
			before,
		);
	}
	assert.ok(total > 6_000_000, `${total} characters of labels`);
	await page.waitForFunction(() => window.labelApp.historyEntries().length === 3);
	await page.evaluate(() => window.labelApp.historySaved());
	await page.reload({ waitUntil: "load" });
	await loaded(page);
	assert.equal(await page.evaluate(() => window.labelApp.historyEntries().length), 3);
	assert.deepEqual(page.errors, []);
});
