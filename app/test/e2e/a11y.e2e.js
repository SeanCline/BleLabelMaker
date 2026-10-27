import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { openSettings, setup, fromFileMenu } from "./harness.js";

const axeSource = await readFile(
	createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
	"utf8",
);

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

/** Runs axe on the page (or a part of it) and returns serious/critical violations. */
const audit = async (page, include) => {
	await page.evaluate(axeSource);
	const results = await page.evaluate(
		(sel) => window.axe.run(sel ? { include: [sel] } : document, { resultTypes: ["violations"] }),
		include ?? null,
	);
	return results.violations
		.filter((v) => v.impact === "serious" || v.impact === "critical")
		.map(
			(v) =>
				`${v.id}: ${v.help} → ${v.nodes
					.map((n) => n.target.join(" "))
					.slice(0, 3)
					.join(", ")}`,
		);
};

test("a new label has no serious accessibility violations, menus open or not", async () => {
	const page = await env.open();
	assert.deepEqual(await audit(page), []);
	await page.click("#fileMenu > summary");
	await page.click("#layersMenu > summary");
	assert.deepEqual(await audit(page), [], "with File and the list of elements open");
});

test("every element type selected has no serious violations", async () => {
	const page = await env.open();
	for (const add of ["#addText", "#addShape", "#addBarcode", "#addQr"]) {
		await page.click(add);
		assert.deepEqual(await audit(page), [], `after ${add}`);
	}
});

test("dialogs have no serious violations", async () => {
	const page = await env.open();
	await fromFileMenu(page, "#btnHistory");
	assert.deepEqual(await audit(page, "#historyDialog"), []);
	await page.keyboard.press("Escape");
	await page.click("#addText");
	assert.deepEqual(await audit(page, "#quickbar"), []);
	await page.click("#quickbar .insert-emoji");
	assert.deepEqual(await audit(page, "#emojiDialog"), []);
	await page.keyboard.press("Escape");
	await openSettings(page);
	assert.deepEqual(await audit(page, "#settings"), []);
});

test("keyboard only: pick elements in the list, rotate, nudge on the canvas, delete; with announcements", async () => {
	const page = await env.open();
	await page.click("#addQr");
	await page.click("#addShape");
	const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.labelApp.state)));

	// Open the list, focus it (Tab order lands on the selected option), then arrow down to the QR code.
	await page.focus("#layersMenu > summary");
	await page.keyboard.press("Enter");
	await page.focus("#layers li[tabindex='0']");
	await page.keyboard.press("ArrowDown");
	let s = await state();
	assert.equal(s.doc.elements.find((e) => e.id === s.selectedId).type, "qr");
	await page.waitForFunction(() =>
		/QR code/.test(document.querySelector("#announcer").textContent),
	);
	assert.equal(
		await page.evaluate(() => document.activeElement.getAttribute("role")),
		"option",
		"focus follows selection",
	);
	const before = s.doc.elements.find((e) => e.id === s.selectedId);

	// Arrows in the list must not move the element.
	assert.equal(before.x, (await state()).doc.elements.find((e) => e.id === before.id).x);

	await page.keyboard.press("r");
	await page.waitForFunction(() =>
		/Rotated to 90°/.test(document.querySelector("#announcer").textContent),
	);

	// On the canvas, arrows nudge.
	await page.focus("#overlay");
	await page.keyboard.down("Shift");
	await page.keyboard.press("ArrowRight");
	await page.keyboard.up("Shift");
	const moved = (await state()).doc.elements.find((e) => e.id === before.id);
	assert.equal(moved.x, before.x + 1);

	// The canvas describes the label for screen readers.
	assert.match(
		await page.$eval("#labelCanvas", (c) => c.getAttribute("aria-label")),
		/QR code “https:\/\/example.com”, rotated 90°/,
	);

	await page.keyboard.press("Delete");
	await page.waitForFunction(() =>
		/Deleted QR code/.test(document.querySelector("#announcer").textContent),
	);
	assert.equal(
		(await state()).doc.elements.some((e) => e.type === "qr"),
		false,
	);
	assert.deepEqual(page.errors, []);
});
