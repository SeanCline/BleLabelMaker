import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, typeInto, appState, fromFileMenu, loaded } from "./harness.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

test("Share copies a link that opens the label elsewhere; Undo brings back what was there", async () => {
	const page = await env.open();
	await typeInto(page, "#designText", "Shared spices 🌶");
	await page.select("#labelPreset", "continuous");
	await page.evaluate(() => {
		navigator.clipboard.writeText = async (t) => (window.copied = t);
	});
	await fromFileMenu(page, "#btnShare");
	await page.waitForFunction(() => window.copied);
	const link = await page.evaluate(() => window.copied);
	assert.match(link, /#label=[\w-]+$/);
	assert.match(await page.$eval("#toast", (t) => t.textContent), /Link copied/);

	// Somebody else opens it, with their own label on screen.
	const other = await env.open();
	await typeInto(other, "#designText", "Mine");
	await other.goto(link, { waitUntil: "load" });
	await loaded(other);
	let s = await appState(other);
	assert.equal(s.doc.elements[0].text, "Shared spices 🌶");
	assert.equal(s.doc.label.continuous, true);
	assert.equal(await other.evaluate(() => location.hash), "", "a reload won't reopen it");
	await other.evaluate(() => window.labelApp.undo());
	s = await appState(other);
	assert.equal(s.doc.elements[0].text, "Mine");

	// A link cut off in transit says so instead of failing silently.
	await other.goto(link.slice(0, link.length - 20), { waitUntil: "load" });
	await loaded(other);
	assert.match(await other.$eval("#toast", (t) => t.textContent), /damaged or incomplete/);
	assert.deepEqual(page.errors, []);
});
