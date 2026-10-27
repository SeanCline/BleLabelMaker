import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, appState } from "./harness.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

/** A phone-sized page with a touch screen. */
const phone = async () => {
	const page = await env.open({ width: 390, height: 800 });
	await page.setViewport({ width: 390, height: 800, hasTouch: true, isMobile: true });
	await page.evaluate(() => window.labelApp.ready);
	return page;
};
const rect = (page, selector) =>
	page.$eval(selector, (e) => JSON.parse(JSON.stringify(e.getBoundingClientRect())));

test("on a phone the bar docks to the bottom, and nothing runs off the side", async () => {
	const page = await phone();
	const bar = await rect(page, "#quickbar");
	assert.equal(Math.round(bar.bottom), 800, "on the bottom edge");
	assert.deepEqual([bar.left, Math.round(bar.width)], [0, 390], "the full width");
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
	assert.match(await page.$eval("#welcomeText", (t) => t.textContent), /^Tap the label/);

	// More opens the settings as a sheet resting on the bar.
	await page.click('#quickbar [data-qb-action="more"]');
	const sheet = await rect(page, "#settings");
	const barNow = await rect(page, "#quickbar");
	assert.equal(Math.round(sheet.bottom), Math.round(barNow.top));
	assert.equal(Math.round(sheet.width), 390);
	assert.deepEqual(page.errors, []);
});

test("tapping the selected text types on it, with the cursor at the end", async () => {
	const page = await phone();
	const box = await (await page.$(".box.selected")).boundingBox();
	await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForSelector(".inline-edit");
	assert.equal(await page.$eval(".inline-edit", (t) => t.selectionStart), "Hello world".length);
	await page.keyboard.type("!");
	assert.equal((await appState(page)).doc.elements[0].text, "Hello world!");
	assert.deepEqual(page.errors, []);
});

test("a tap selects; only a second tap on the same text types", async () => {
	const page = await phone();
	await page.click("#addQr");
	assert.equal((await appState(page)).doc.elements.at(-1).type, "qr");
	// The text is under the QR code only in the middle; its left end is clear.
	const text = await (await page.$$(".box"))[0].boundingBox();
	const at = [text.x + 6, text.y + text.height / 2];
	await page.touchscreen.tap(...at);
	assert.equal((await appState(page)).selectedId, (await appState(page)).doc.elements[0].id);
	assert.equal(await page.$(".inline-edit"), null, "the first tap only selects");
	const before = (await appState(page)).doc.elements[0];
	await page.touchscreen.tap(...at);
	await page.waitForSelector(".inline-edit");
	const after = (await appState(page)).doc.elements[0];
	assert.deepEqual([after.x, after.y], [before.x, before.y], "and taps don't move it");
	assert.deepEqual(page.errors, []);
});
