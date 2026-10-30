import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { setup, appState, FIREFOX } from "./harness.js";
import { installFakeBluetooth } from "./fake-bluetooth.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

// Puppeteer can't emulate a touch screen in Firefox.
const NO_TOUCH = FIREFOX && "needs touch emulation, which Firefox lacks";

/** A phone-sized page with a touch screen. */
const phone = async () => {
	const page = await env.open({ width: 390, height: 800 });
	await page.setViewport({ width: 390, height: 800, hasTouch: true, isMobile: true });
	await page.evaluate(() => window.labelApp.ready);
	return page;
};
const rect = (page, selector) =>
	page.$eval(selector, (e) => JSON.parse(JSON.stringify(e.getBoundingClientRect())));

test("on a phone the bar docks to the bottom, and nothing runs off the side", async (t) => {
	if (NO_TOUCH) return t.skip(NO_TOUCH);
	const page = await phone();
	const bar = await rect(page, "#quickbar");
	assert.equal(Math.round(bar.bottom), 800, "on the bottom edge");
	assert.deepEqual([bar.left, Math.round(bar.width)], [0, 390], "the full width");
	assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
	assert.match(await page.$eval("#welcomeText", (t) => t.textContent), /^Tap the label/);
	assert.equal(
		await page.$eval("#keysHelp", (k) => k.getClientRects().length),
		0,
		"no keyboard shortcuts for a finger",
	);

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

test("typing by touch: double tap or hold for a word, handles to drag the ends", async (t) => {
	if (NO_TOUCH) return t.skip(NO_TOUCH);
	const page = await phone();
	const box = await (await page.$(".box.selected")).boundingBox();
	await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
	await page.waitForSelector(".inline-edit");
	const selection = () => page.$eval(".inline-edit", (t) => [t.selectionStart, t.selectionEnd]);
	const shown = () => page.$$eval(".inline-handle", (h) => h.map((x) => !x.hidden));
	assert.deepEqual(await shown(), [false, true], "one handle, under the caret");

	const f = await (await page.$(".inline-editor")).boundingBox();
	const hello = [f.x + f.width * 0.25, f.y + f.height / 2];
	await page.touchscreen.tap(...hello);
	await page.touchscreen.tap(...hello);
	assert.deepEqual(await selection(), [0, 5], "a double tap selects the word");
	assert.deepEqual(await shown(), [true, true], "a handle at each end");

	// The end handle, dragged right, takes in the next word; it aims at the line, not the finger.
	const end = await (await page.$(".inline-handle.end")).boundingBox();
	const at = [end.x + end.width / 2, end.y + end.height / 2];
	const cdp = await page.createCDPSession();
	const touch = (type, x = 0, y = 0) =>
		cdp.send("Input.dispatchTouchEvent", {
			type,
			touchPoints: type === "touchEnd" ? [] : [{ x, y }],
		});
	await touch("touchStart", ...at);
	await touch("touchMove", at[0] + 60, at[1]);
	await touch("touchMove", at[0] + 120, at[1]);
	await touch("touchEnd");
	const [from, to] = await selection();
	assert.equal(from, 0);
	assert.ok(to > 6, `past the space (to ${to})`);
	// The keyboard stays: the browser doesn't take a tap on the label as a tap away.
	assert.equal(await page.evaluate(() => document.activeElement.className), "inline-edit");

	// Holding still on a word selects it.
	await page.touchscreen.tap(f.x + 4, f.y + f.height / 2);
	await new Promise((r) => setTimeout(r, 450));
	await touch("touchStart", f.x + f.width * 0.75, f.y + f.height / 2);
	await page.waitForFunction(() => document.querySelector(".inline-edit").selectionStart === 6, {
		timeout: 2000,
	});
	await touch("touchEnd");
	assert.deepEqual(await selection(), [6, 11]);

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

test("on a phone the bar's controls are one finger size, none cut off, and Print stays up top", async (t) => {
	if (NO_TOUCH) return t.skip(NO_TOUCH);
	const page = await phone();
	const sizes = await page.$$eval(
		"#quickbar .segmented, #quickbar .segmented button, #quickbar select, #quickbar input, #quickbar .field-picker",
		(els) =>
			els
				.filter((e) => e.getClientRects().length)
				.map((e) => {
					const r = e.getBoundingClientRect();
					const group = e.closest(".segmented")?.getBoundingClientRect();
					const inside = !group || e === e.closest(".segmented") || r.bottom <= group.bottom + 0.5;
					return [e.className || e.tagName, Math.round(r.height), inside];
				}),
	);
	for (const [what, height, inside] of sizes) {
		assert.ok(height >= 42 && height <= 44, `${what} is ${height}px`);
		assert.ok(inside, `${what} fits inside its group`);
	}
	// A Bluetooth printer not yet connected: the dot says so, and Print keeps to one row on a
	// common phone width (narrower ones depend on the system font).
	const bt = await env.open({
		width: 390,
		height: 800,
		printer: null,
		beforeLoad: (p) => p.evaluateOnNewDocument(installFakeBluetooth),
	});
	await bt.setViewport({ width: 390, height: 800, hasTouch: true, isMobile: true });
	await bt.evaluate(() => window.labelApp.ready);
	assert.equal(await bt.$eval("#btnPrint", (b) => b.innerText.trim()), "Print");
	const row = await bt.$$eval(".topbar > *", (els) =>
		els
			.filter((e) => e.getClientRects().length > 0 && e.offsetHeight > 2)
			.map((e) => Math.round(e.getBoundingClientRect().top)),
	);
	assert.ok(Math.max(...row) - Math.min(...row) < 10, `one row: ${row}`);
	assert.deepEqual(page.errors, []);
	assert.deepEqual(bt.errors, []);
});

test("pinching the label zooms the selected picture, and leaves its box where it is", async (t) => {
	if (NO_TOUCH) return t.skip(NO_TOUCH);
	const page = await phone();
	const [chooser] = await Promise.all([page.waitForFileChooser(), page.click("#addImage")]);
	await chooser.accept([fileURLToPath(new URL("../../icons/icon-192.png", import.meta.url))]);
	await page.waitForFunction(() => window.labelApp.state.doc.elements.at(-1).type === "image");
	const picture = async () => (await appState(page)).doc.elements.at(-1);
	const before = await picture();
	const b = await (await page.$(".box.selected")).boundingBox();
	const [cx, cy] = [b.x + b.width / 2, b.y + b.height / 2];
	const cdp = await page.createCDPSession();
	const touch = (type, ...xs) =>
		cdp.send("Input.dispatchTouchEvent", {
			type,
			touchPoints: xs.map((x, id) => ({ x, y: cy, id })),
		});
	// One finger, then a second, and they spread to twice as far apart.
	await touch("touchStart", cx - 10);
	await touch("touchStart", cx - 10, cx + 10);
	for (const spread of [12, 15, 20]) await touch("touchMove", cx - spread, cx + spread);
	await touch("touchEnd");
	const after = await picture();
	assert.ok(Math.abs(after.zoom - 2) < 0.01, `twice as close (${after.zoom})`);
	assert.deepEqual([after.x, after.y, after.w], [before.x, before.y, before.w], "the box stays");
	await page.evaluate(() => window.labelApp.undo());
	assert.equal((await picture()).zoom, 1, "one undo step");
	assert.deepEqual(page.errors, []);
});
