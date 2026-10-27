import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, typeInto, appState, fromFileMenu } from "./harness.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

/** A design with two 6 mm QR codes side by side and nothing else, both unselected. */
const twoCodes = async () => {
	const page = await env.open();
	await page.focus("#overlay");
	await page.keyboard.down("Control");
	await page.keyboard.press("a");
	await page.keyboard.up("Control");
	await page.keyboard.press("Delete");
	for (const x of ["4", "24"]) {
		await page.click("#addQr");
		await typeInto(page, '#geomProps [data-prop="x"]', x);
		await typeInto(page, '#geomProps [data-prop="y"]', "3");
		await typeInto(page, '#geomProps [data-prop="w"]', "6");
		await typeInto(page, '#geomProps [data-prop="h"]', "6");
	}
	await page.keyboard.press("Escape");
	return page;
};
const elements = async (page) => (await appState(page)).doc.elements;
const centreOf = async (page, i) => {
	const b = await (await page.$$("#overlay .box"))[i].boundingBox();
	return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const shiftClick = async (page, at) => {
	await page.keyboard.down("Shift");
	await page.mouse.click(at.x, at.y);
	await page.keyboard.up("Shift");
};

test("shift-click selects several; dragging one moves them all, and undoes in one step", async () => {
	const page = await twoCodes();
	await page.mouse.click(...Object.values(await centreOf(page, 0)));
	await shiftClick(page, await centreOf(page, 1));
	assert.equal((await appState(page)).selectedIds.length, 2);
	assert.equal(await page.$eval('#quickbar [data-qb="multi"]', (g) => g.hidden), false);
	assert.equal(await page.$eval("#multiCount", (c) => c.textContent), "2 selected");
	assert.equal(
		await page.$eval('#quickbar [data-qb-action="more"]', (b) => b.hidden),
		true,
		"no single-element settings",
	);
	assert.equal(await page.$$eval("#layers [aria-selected=true]", (l) => l.length), 2);

	const before = await elements(page);
	const from = await centreOf(page, 1);
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 40, from.y, { steps: 5 });
	await page.mouse.up();
	const after = await elements(page);
	const dx = after[0].x - before[0].x;
	assert.ok(dx > 1, `moved ${dx} mm`);
	assert.equal(after[1].x - before[1].x, dx, "both moved by the same amount");

	await page.evaluate(() => window.labelApp.undo());
	assert.deepEqual(
		(await elements(page)).map((e) => e.x),
		before.map((e) => e.x),
	);
	assert.deepEqual(page.errors, []);
});

test("dragging across empty space selects what it touches; a plain click clears", async () => {
	const page = await twoCodes();
	const paper = await (await page.$("#overlay")).boundingBox();
	const a = await centreOf(page, 0);
	const b = await centreOf(page, 1);
	// From empty space at the left edge (the corners are rounded off) to the second code.
	const empty = { x: paper.x + 3, y: paper.y + paper.height / 2 };
	await page.mouse.move(empty.x, empty.y);
	await page.mouse.down();
	await page.mouse.move(b.x, b.y, { steps: 6 });
	assert.equal(await page.$eval(".marquee", (m) => m.hidden), false);
	await page.mouse.up();
	assert.equal((await appState(page)).selectedIds.length, 2);
	assert.equal(await page.$eval(".marquee", (m) => m.hidden), true);

	await page.mouse.click(empty.x, empty.y);
	assert.deepEqual((await appState(page)).selectedIds, []);
	assert.ok(a.x < b.x);
});

test("align, distribute, rotate, nudge and delete act on the whole selection", async () => {
	const page = await twoCodes();
	await page.click("#addQr");
	await typeInto(page, '#geomProps [data-prop="x"]', "10");
	await typeInto(page, '#geomProps [data-prop="y"]', "1");
	await typeInto(page, '#geomProps [data-prop="w"]', "6");
	await typeInto(page, '#geomProps [data-prop="h"]', "6");
	await page.focus("#overlay");
	await page.keyboard.down("Control");
	await page.keyboard.press("a");
	await page.keyboard.up("Control");
	assert.equal((await appState(page)).selectedIds.length, 3);

	await page.click('[data-align="top"]');
	assert.deepEqual(
		(await elements(page)).map((e) => e.y),
		[1, 1, 1],
	);
	// x: 4, 24 and 10 (all 6 wide) → evenly spread between 4 and 24.
	await page.click('[data-distribute="x"]');
	assert.deepEqual(
		(await elements(page)).map((e) => e.x),
		[4, 24, 14],
	);

	await page.focus("#overlay");
	await page.keyboard.down("Shift");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.up("Shift");
	assert.deepEqual(
		(await elements(page)).map((e) => e.x),
		[5, 25, 15],
	);
	await page.keyboard.press("r");
	assert.ok((await elements(page)).every((e) => e.rotation === 90));

	await page.keyboard.press("Delete");
	assert.deepEqual(await elements(page), []);
	assert.deepEqual(page.errors, []);
});

/** Fires a clipboard event the way the browser does for Ctrl+C/X/V, and returns its data. */
const clipboardEvent = (page, type, data = null) =>
	page.evaluate(
		(type, data) => {
			const clipboardData = new DataTransfer();
			if (data !== null) clipboardData.setData("text/plain", data);
			document.activeElement.dispatchEvent(
				new ClipboardEvent(type, { clipboardData, bubbles: true, cancelable: true }),
			);
			return clipboardData.getData("text/plain");
		},
		type,
		data,
	);

test("copy and paste: duplicates beside the original, and between labels at the same spot", async () => {
	const page = await twoCodes();
	await page.mouse.click(...Object.values(await centreOf(page, 0)));
	await page.focus("#overlay");
	const copied = await clipboardEvent(page, "copy");
	assert.match(copied, /labelmaker-elements/);
	// Text selected on the page copies as text, though the element is still selected.
	await page.evaluate(() =>
		document.getSelection().selectAllChildren(document.querySelector("h1, header")),
	);
	assert.equal(await clipboardEvent(page, "copy"), "", "left to the browser");
	await page.mouse.click(...Object.values(await centreOf(page, 0)));
	assert.match(await clipboardEvent(page, "copy"), /labelmaker-elements/, "a click clears it");

	await clipboardEvent(page, "paste", copied);
	let list = await elements(page);
	assert.equal(list.length, 3);
	assert.deepEqual([list[2].x, list[2].y], [list[0].x + 2, list[0].y + 2], "stepped aside");
	assert.deepEqual((await appState(page)).selectedIds, [list[2].id], "the paste is selected");

	// Into a new label: same position, since nothing is in the way.
	await fromFileMenu(page, "#btnNew");
	await page.click('#templateList [data-id="blank"]');
	await page.focus("#overlay");
	await clipboardEvent(page, "paste", copied);
	list = await elements(page);
	const pasted = list.at(-1);
	assert.equal(pasted.type, "qr");
	assert.deepEqual([pasted.x, pasted.y], [4, 3]);

	// Plain text pasted onto the label becomes a text box; text fields paste as usual.
	await clipboardEvent(page, "paste", "Use by Friday");
	assert.equal((await elements(page)).at(-1).text, "Use by Friday");
	assert.deepEqual(page.errors, []);
});

test("Ctrl+D duplicates the selection; cut removes it", async () => {
	const page = await twoCodes();
	await page.focus("#overlay");
	await page.keyboard.down("Control");
	await page.keyboard.press("a");
	await page.keyboard.press("d");
	await page.keyboard.up("Control");
	assert.equal((await elements(page)).length, 4);
	assert.equal((await appState(page)).selectedIds.length, 2, "the copies are selected");

	await clipboardEvent(page, "cut");
	assert.equal((await elements(page)).length, 2);
});
