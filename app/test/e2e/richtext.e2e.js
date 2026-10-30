import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
	setup,
	appState,
	labelPixels,
	printedMatchesPreview,
	openSettings,
	redraw,
	typeInto,
	loaded,
	FIREFOX,
} from "./harness.js";
import { installFakeBluetooth } from "./fake-bluetooth.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

// Firefox hands listeners an empty clipboardData on clipboard events a page fires, so the
// tests that fire them only run in Chrome. Real copy and paste are trusted, and filled in.
const NO_PAGE_CLIPBOARD = FIREFOX && "Firefox empties clipboardData on page-made events";

const BOLD = { fontWeight: 700 };
const text = async (page) => (await appState(page)).doc.elements[0].text;
const ctrl = async (page, key) => {
	await page.keyboard.down("Control");
	await page.keyboard.press(key);
	await page.keyboard.up("Control");
};

/** Simple mode's "Hello world", being typed on the label. */
const editing = async (options) => {
	const page = await env.open(options);
	const overlay = await (await page.$("#overlay")).boundingBox();
	await page.mouse.click(overlay.x + overlay.width / 2, overlay.y + overlay.height / 2, {
		count: 2,
	});
	await page.waitForSelector(".inline-edit");
	return page;
};
const selectText = (page, from, to) =>
	page.$eval(".inline-edit", (t, from, to) => t.setSelectionRange(from, to), from, to);

/** Where the caret is drawn, against where the label's ink ends, in screen pixels. */
const caretAndInk = (page) =>
	page.evaluate(() => {
		const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector("#labelCanvas"));
		const { width, height } = canvas;
		const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
		let right = 0;
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++)
				if (data[(y * width + x) * 4] < 128) right = Math.max(right, x);
		const rect = canvas.getBoundingClientRect();
		const caret = document.querySelector(".inline-caret").getBoundingClientRect();
		return {
			ink: rect.left + ((right + 1) * rect.width) / width,
			caret: caret.left + caret.width / 2,
			line: caret.height,
		};
	});

test("Ctrl+B on a selected word makes just that word bold, and typing after it stays bold", async () => {
	const page = await editing();
	const plain = await labelPixels(page);
	await selectText(page, 6, 11);
	await ctrl(page, "b");
	assert.deepEqual(await text(page), ["Hello ", [BOLD, "world"]]);
	const bold = await labelPixels(page);
	assert.ok(bold.black > plain.black, "more ink");

	await page.keyboard.press("End");
	await page.keyboard.type("!");
	assert.deepEqual(await text(page), ["Hello ", [BOLD, "world!"]], "as in word processors");
	// Layout, caret and drawing measure the bold word alike, so the caret ends with the ink.
	await redraw(page);
	const ends = await caretAndInk(page);
	assert.ok(
		Math.abs(ends.ink - ends.caret) < ends.line / 4,
		`caret at ${ends.caret}px, text ends at ${ends.ink}px`,
	);

	// Undo takes the typing back, then the bold, each a step of its own.
	await page.keyboard.press("Escape");
	await page.focus("#overlay");
	await ctrl(page, "z");
	assert.deepEqual(await text(page), ["Hello ", [BOLD, "world"]]);
	await ctrl(page, "z");
	assert.equal(await text(page), "Hello world");
	assert.equal((await labelPixels(page)).hash, plain.hash, "and the label is as it was");
	assert.deepEqual(page.errors, []);
});

test("with nothing selected, Ctrl+I and Ctrl+U style what's typed next", async () => {
	const page = await editing();
	await selectText(page, 5, 5);
	await ctrl(page, "i");
	await ctrl(page, "u");
	await page.keyboard.type(",");
	assert.deepEqual(await text(page), ["Hello", [{ italic: true, underline: true }, ","], " world"]);
	// The same keys again turn it off for a selection that has it.
	await selectText(page, 0, "Hello, world".length);
	await ctrl(page, "u");
	assert.deepEqual(await text(page), [
		[{ underline: true }, "Hello"],
		[{ italic: true, underline: true }, ","],
		[{ underline: true }, " world"],
	]);
	await ctrl(page, "u");
	assert.deepEqual(await text(page), ["Hello", [{ italic: true }, ","], " world"]);
	assert.deepEqual(page.errors, []);
});

test("formatting survives a reload, and editing in the settings keeps it on its letters", async () => {
	const page = await editing();
	await selectText(page, 0, 5);
	await ctrl(page, "b");
	await page.keyboard.press("Escape");
	const before = await labelPixels(page);

	await page.reload({ waitUntil: "load" });
	await loaded(page);
	assert.deepEqual(await text(page), [[BOLD, "Hello"], " world"]);
	assert.equal((await labelPixels(page)).hash, before.hash, "it looks the same");

	// The settings' text box is plain text, but typing there keeps the formatting in place.
	await openSettings(page);
	assert.equal(await page.$eval("#designText", (t) => t.value), "Hello world");
	await page.focus("#designText");
	await page.$eval("#designText", (t) => t.setSelectionRange(11, 11));
	await page.keyboard.type(", hi");
	assert.deepEqual(await text(page), [[BOLD, "Hello"], " world, hi"]);

	// Setting the weight for the whole box sets it for every word.
	await typeInto(page, '#textProps [data-prop="fontWeight"]', "700");
	assert.equal(await text(page), "Hello world, hi");
	assert.equal((await appState(page)).doc.elements[0].fontWeight, 700);
	assert.deepEqual(page.errors, []);
});

test("formatted text prints exactly as the preview shows it", async () => {
	const page = await editing({
		beforeLoad: (p) => p.evaluateOnNewDocument(installFakeBluetooth),
	});
	await selectText(page, 0, 5);
	await ctrl(page, "b");
	await selectText(page, 6, 11);
	await ctrl(page, "u");
	await page.keyboard.press("Escape");
	await page.select("#target", "bluetooth");
	await page.click("#btnPrint");
	await page.waitForFunction(() => window.fakeD30.labels.length === 1);
	await redraw(page);
	assert.equal(await printedMatchesPreview(page, "fakeD30"), true);
	assert.deepEqual(page.errors, []);
});

/** Fires a clipboard event on the text being typed, as Ctrl+C/X/V do, and returns its data. */
const clip = (page, type, data = {}) =>
	page.$eval(
		".inline-edit",
		(t, type, data) => {
			const clipboardData = new DataTransfer();
			for (const [kind, value] of Object.entries(data)) clipboardData.setData(kind, value);
			const handled = !t.dispatchEvent(
				new ClipboardEvent(type, { clipboardData, bubbles: true, cancelable: true }),
			);
			return {
				handled,
				plain: clipboardData.getData("text/plain"),
				html: clipboardData.getData("text/html"),
			};
		},
		type,
		data,
	);

test("copy and paste keep bold, italic and underline, from the label and from other apps", async (t) => {
	if (NO_PAGE_CLIPBOARD) return t.skip(NO_PAGE_CLIPBOARD);
	const page = await editing();
	await selectText(page, 6, 11);
	await ctrl(page, "b");
	await selectText(page, 4, 11);
	const copied = await clip(page, "copy");
	assert.equal(copied.plain, "o world");
	assert.equal(copied.html, 'o <span style="font-weight:700">world</span>');

	// Pasted at the start, the bold comes along; typing undoes it as one step.
	await selectText(page, 0, 0);
	await clip(page, "paste", { "text/plain": copied.plain, "text/html": copied.html });
	assert.deepEqual(await text(page), ["o ", [BOLD, "world"], "Hello ", [BOLD, "world"]]);
	assert.equal(await page.$eval(".inline-edit", (t) => t.selectionStart), 7, "after the paste");
	await ctrl(page, "z");
	assert.deepEqual(await text(page), ["Hello ", [BOLD, "world"]]);

	// Cut takes it out, and leaves it on the clipboard formatted.
	await selectText(page, 5, 11);
	const cut = await clip(page, "cut");
	assert.equal(cut.html, ' <span style="font-weight:700">world</span>');
	assert.equal(await text(page), "Hello");

	// Google Docs: a <b> that isn't bold around it all, spans saying how each part looks.
	await selectText(page, 5, 5);
	const docs =
		'<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">' +
		'<span style="font-weight:400;">, </span><span style="font-weight:700;font-style:italic;">big</span>' +
		'<span style="font-weight:400;text-decoration:underline;"> deal</span></b><br class="Apple-interchange-newline">';
	await clip(page, "paste", { "text/plain": ", big deal", "text/html": docs });
	assert.deepEqual(await text(page), [
		"Hello, ",
		[{ fontWeight: 700, italic: true }, "big"],
		[{ underline: true }, " deal"],
	]);

	// Word: paragraphs, <b> and <i>, comments and its own markup.
	await page.keyboard.down("Control");
	await page.keyboard.press("a");
	await page.keyboard.up("Control");
	const word =
		"<html><head><style>p{margin:0}</style></head><body><!--StartFragment-->" +
		"<p class=MsoNormal><b>Best</b> before<o:p></o:p></p>\r\n<p class=MsoNormal><i>June</i>&nbsp;2027</p>" +
		"<!--EndFragment--></body></html>";
	await clip(page, "paste", { "text/plain": "Best before\r\nJune 2027", "text/html": word });
	assert.deepEqual(await text(page), [
		[BOLD, "Best"],
		" before\n",
		[{ italic: true }, "June"],
		" 2027",
	]);

	// HTML with nothing formatted is pasted as the plain text beside it.
	const plain = await clip(page, "paste", { "text/plain": "plain", "text/html": "<p>other</p>" });
	assert.equal(plain.handled, false, "left to the browser");
	assert.deepEqual(page.errors, []);
});

test("formatted text pasted onto the label becomes a box formatted the same", async (t) => {
	if (NO_PAGE_CLIPBOARD) return t.skip(NO_PAGE_CLIPBOARD);
	const page = await env.open();
	await page.focus("#overlay");
	await page.evaluate(() => {
		const clipboardData = new DataTransfer();
		clipboardData.setData("text/plain", "Fragile glass");
		clipboardData.setData("text/html", "<strong>Fragile</strong> <u>glass</u>");
		document.activeElement.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
		);
	});
	const added = (await appState(page)).doc.elements.at(-1);
	assert.deepEqual(added.text, [[BOLD, "Fragile"], " ", [{ underline: true }, "glass"]]);
	assert.deepEqual(page.errors, []);
});
