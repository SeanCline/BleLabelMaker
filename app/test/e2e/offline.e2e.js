import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, typeInto, redraw } from "./harness.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

test("works offline after one visit: app, fonts and virtual printing", async () => {
	const page = await env.open();
	// Wait until the service worker has installed (precached everything) and controls the page.
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (!navigator.serviceWorker.controller) {
			await new Promise((r) =>
				navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }),
			);
		}
	});

	await env.stopServer();
	await page.reload({ waitUntil: "load" });
	await page.evaluate(() => window.labelApp.ready);
	// Guard against a vacuous pass: if the worker could still reach the server, this would be
	// a 404 response rather than a network failure.
	const reachable = await page.evaluate(() =>
		fetch(`not-cached-${Math.random()}`).then(
			() => true,
			() => false,
		),
	);
	assert.equal(reachable, false, "network should be unreachable from the service worker");
	// That probe logs exactly one expected network error; anything else is a real failure.
	assert.deepEqual(page.errors, ["Failed to load resource: net::ERR_FAILED"]);
	page.errors.length = 0;

	await page.select('#quickbar [data-prop="fontFamily"]', "Pacifico");
	await typeInto(page, '#textProps [data-prop="text"]', "Offline");
	await redraw(page);
	// Pacifico isn't used by the default label, so it can only come from the precache.
	assert.ok(
		await page.evaluate(() => document.fonts.check('400 20px "Pacifico"', "Offline")),
		"font served offline",
	);

	await page.click("#btnPrint");
	await page.waitForSelector("#tape .printed");
	assert.deepEqual(page.errors, []);
});
