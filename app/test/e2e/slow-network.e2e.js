import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup } from "./harness.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

test("on a connection that never answers, the app opens from the cache within seconds", async () => {
	const page = await env.open({ offline: true });
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (!navigator.serviceWorker.controller) {
			await new Promise((r) =>
				navigator.serviceWorker.addEventListener("controllerchange", r, { once: true }),
			);
		}
	});
	env.goSlow();
	const start = Date.now();
	await page.reload({ waitUntil: "load", timeout: 30_000 });
	await page.evaluate(() => window.labelApp.ready);
	const took = Date.now() - start;
	// Each request waits out the network's few seconds, many of them at once.
	assert.ok(took < 20_000, `opened in ${took} ms`);
	assert.ok(await page.$("#labelCanvas"));
});
