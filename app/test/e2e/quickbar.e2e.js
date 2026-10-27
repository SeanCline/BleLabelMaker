import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, appState, labelPixels, openElements, typeInto } from "./harness.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

const BOLD = { fontWeight: 700 };
const first = async (page) => (await appState(page)).doc.elements[0];
const bar = (page, selector) => page.$(`#quickbar ${selector}`);
const pressed = (page, style) =>
	page.$eval(`#quickbar [data-style="${style}"]`, (b) => b.getAttribute("aria-pressed"));
const visible = (page, selector) =>
	page.$eval(selector, (n) => !n.closest("[hidden]") && n.getClientRects().length > 0);
const typeOnLabel = async (page) => {
	const o = await (await page.$("#overlay")).boundingBox();
	await page.mouse.click(o.x + o.width / 2, o.y + o.height / 2, { clickCount: 2 });
	await page.waitForSelector(".inline-edit");
};

test("the bar sits over the label, and its B sets the whole text, or just what's selected while typing", async () => {
	const page = await env.open();
	assert.equal(await visible(page, "#quickbar"), true, "a new label's text starts out selected");
	const barBox = await (await page.$("#quickbar")).boundingBox();
	const label = await (await page.$("#overlay")).boundingBox();
	assert.ok(barBox.y + barBox.height <= label.y, "above the label, not over it");

	await (await bar(page, '[data-style="fontWeight"]')).click();
	assert.equal((await first(page)).fontWeight, 700);
	assert.equal(await pressed(page, "fontWeight"), "true");
	await (await bar(page, '[data-style="fontWeight"]')).click();
	assert.equal((await first(page)).fontWeight, 400);

	await typeOnLabel(page);
	await page.$eval(".inline-edit", (t) => t.setSelectionRange(6, 11));
	await (await bar(page, '[data-style="fontWeight"]')).click();
	assert.deepEqual((await first(page)).text, ["Hello ", [BOLD, "world"]]);
	assert.ok(await page.$(".inline-edit"), "still typing");
	assert.equal(
		await page.$eval('#textProps [data-prop="fontWeight"]', (s) => s.selectedOptions[0].text),
		"Mixed",
		"the settings' weight says the words differ",
	);
	await page.$eval(".inline-edit", (t) => t.setSelectionRange(0, 11));
	await page.$eval(".inline-edit", (t) => t.dispatchEvent(new Event("select")));
	assert.equal(await pressed(page, "fontWeight"), "mixed");

	// Picking a font hands the focus back to the text, so typing carries on.
	await page.select("#quickbar .font-select", "Oswald");
	assert.equal((await first(page)).fontFamily, "Oswald");
	assert.equal(await page.evaluate(() => document.activeElement.className), "inline-edit");
	await page.keyboard.press("End");
	await page.keyboard.type("!");
	assert.deepEqual((await first(page)).text, ["Hello ", [BOLD, "world!"]]);

	// Bold on a selection that's partly bold makes it all bold, as word processors do.
	await page.$eval(".inline-edit", (t) => t.setSelectionRange(0, 12));
	await (await bar(page, '[data-style="fontWeight"]')).click();
	assert.equal((await first(page)).fontWeight, 400, "the box itself stays as it was");
	assert.deepEqual((await first(page)).text, [[BOLD, "Hello world!"]]);
	assert.deepEqual(page.errors, []);
});

test("a field from the bar goes in where the cursor was on the label", async () => {
	const page = await env.open();
	await typeOnLabel(page);
	await page.$eval(".inline-edit", (t) => t.setSelectionRange(5, 5));
	await page.select("#quickbar .insert-field", "{n}");
	assert.equal((await first(page)).text, "Hello{n} world");
	assert.equal(
		await page.$eval(".inline-edit", (t) => [t.selectionStart, t.selectionEnd].join()),
		"8,8",
		"typing on, after the field",
	);
	assert.deepEqual(page.errors, []);
});

test("More… opens the rest of the settings under the bar; Esc or clicking away closes them", async () => {
	const page = await env.open();
	assert.equal(await visible(page, "#settings"), false);
	await (await bar(page, '[data-qb-action="more"]')).click();
	assert.equal(await visible(page, "#settings"), true);
	assert.equal(await visible(page, "#textProps"), true, "the selected text's settings");
	assert.equal(
		await page.$eval('#quickbar [data-qb-action="more"]', (b) => b.getAttribute("aria-expanded")),
		"true",
	);
	const sheet = await (await page.$("#settings")).boundingBox();
	const barBox = await (await page.$("#quickbar")).boundingBox();
	assert.ok(sheet.y >= barBox.y + barBox.height, "under the bar");

	// Settings changed there show on the bar too; the bar's own aren't repeated there.
	assert.equal(await page.$('#settings [data-prop="fontSizePt"]'), null);
	await typeInto(page, '#textProps [data-prop="fontWeight"]', "700");
	assert.equal(await pressed(page, "fontWeight"), "true");

	await page.keyboard.press("Escape");
	assert.equal(await visible(page, "#settings"), false);
	assert.equal((await appState(page)).selectedIds.length, 1, "Esc closed them, not the selection");

	await (await bar(page, '[data-qb-action="more"]')).click();
	await page.mouse.click(5, 5);
	assert.equal(await visible(page, "#settings"), false);
	assert.deepEqual(page.errors, []);
});

test("each kind of element gets its own bar, and new ones start where their content goes", async () => {
	const page = await env.open();
	await page.click("#addText");
	assert.ok(await page.$(".inline-edit"), "a new text is typed on straight away");
	await page.keyboard.type("Jam");
	await page.keyboard.press("Escape");
	assert.equal((await appState(page)).doc.elements.at(-1).text, "Jam");

	await page.click("#addBarcode");
	assert.equal(
		await page.evaluate(() => document.activeElement.closest("[data-qb]")?.dataset.qb),
		"barcode",
		"the cursor is in the bar's data field",
	);
	await page.keyboard.type("JAM-1");
	assert.equal((await appState(page)).doc.elements.at(-1).data, "JAM-1");
	assert.equal(await visible(page, '#quickbar [data-qb="text"]'), false);

	await page.click("#addShape");
	const plain = await labelPixels(page);
	await page.click('#quickbar [data-qb="shape"] [data-prop="fill"]');
	assert.equal((await appState(page)).doc.elements.at(-1).fill, true);
	assert.ok((await labelPixels(page)).black > plain.black);

	// Several selected: aligning and spacing, and no More… (it's about one element).
	await page.focus("#overlay");
	await page.keyboard.down("Control");
	await page.keyboard.press("a");
	await page.keyboard.up("Control");
	assert.equal(await visible(page, '#quickbar [data-qb="multi"]'), true);
	assert.equal(await page.$eval("#multiCount", (c) => c.textContent), "4 selected");
	assert.equal(await visible(page, '#quickbar [data-qb-action="more"]'), false);

	// The list of elements closes once one is picked from it.
	await openElements(page);
	await page.click("#layers li:last-child");
	assert.equal(await page.$eval("#layersMenu", (d) => d.open), false);
	assert.equal((await appState(page)).selectedIds.length, 1);
	assert.deepEqual(page.errors, []);
});
