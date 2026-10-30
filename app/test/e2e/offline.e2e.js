import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, typeInto, redraw, printVirtual } from "./harness.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

test("works offline after one visit: app, fonts and virtual printing", async () => {
	const page = await env.open({ offline: true });
	// Wait until the service worker has installed (precached everything) and controls the page.
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (!navigator.serviceWorker.controller) {
			await new Promise((r) =>
				navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }),
			);
		}
	});

	env.goOffline();
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
	// That probe logs exactly one expected network error (each browser words it its own way);
	// anything else is a real failure.
	assert.equal(page.errors.length, 1, page.errors.join("\n"));
	page.errors.length = 0;

	await page.select('#quickbar [data-prop="fontFamily"]', "Pacifico");
	await typeInto(page, '#textProps [data-prop="text"]', "Offline");
	await redraw(page);
	// Pacifico isn't used by the default label, so it can only come from the precache.
	assert.ok(
		await page.evaluate(() => document.fonts.check('400 20px "Pacifico"', "Offline")),
		"font served offline",
	);

	await printVirtual(page);
	assert.deepEqual(page.errors, []);
});
