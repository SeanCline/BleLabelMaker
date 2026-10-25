import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, printedMatchesPreview } from "./harness.js";
import { installFakeSerial } from "./fake-serial.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

const openWithFakeSerial = async () => {
	const page = await env.open({ beforeLoad: (p) => p.evaluateOnNewDocument(installFakeSerial) });
	await page.select("#target", "serial");
	return page;
};
const fake = (page, expr) =>
	page.evaluate(`(() => { const f = window.fakeSerial; return ${expr}; })()`);
const statusText = (page) => page.$eval("#printerStatus", (s) => s.textContent);

test("serial port: connect, status, and a print that decodes to the preview", async () => {
	const page = await openWithFakeSerial();
	await page.click("#btnConnect");
	await page.waitForFunction(() =>
		/^Connected to D30 \(serial\) · battery 72%$/.test(
			document.querySelector("#printerStatus").textContent,
		),
	);
	const asked = await fake(page, "f.requestOptions");
	assert.deepEqual(asked.allowedBluetoothServiceClassIds, ["00001101-0000-1000-8000-00805f9b34fb"]);
	assert.equal((await fake(page, "f.openOptions")).baudRate, 115200);
	// It's a D30, so only its 12 mm sizes are offered.
	const sizes = await page.$$eval("#labelPreset option", (o) => o.map((x) => x.textContent));
	assert.ok(
		sizes.every((t) => /× 12 mm|Continuous|Custom/.test(t)),
		sizes.join(", "),
	);

	await page.click("#btnPrint");
	await page.waitForFunction(() => window.fakeSerial.labels.length === 1);
	// The send finishes a pause after its last write, so the toast can trail the label.
	await page.waitForFunction(() =>
		/Sent 1 label to D30 \(serial\)/.test(document.querySelector("#toast").textContent),
	);
	const writes = await fake(page, "f.writes.map((w) => w.length)");
	assert.ok(
		writes.every((n) => n <= 512),
		"paced in chunks of at most 512 bytes",
	);
	assert.equal(await printedMatchesPreview(page, "fakeSerial"), true);
	assert.equal(await page.evaluate(() => window.labelApp.historyEntries()[0].target), "serial");
	assert.deepEqual(page.errors, []);
});

test("serial port: problems reported by the printer show up; Forget asks for the port again", async () => {
	const page = await openWithFakeSerial();
	await page.click("#btnConnect");
	await page.waitForFunction(() =>
		/Connected/.test(document.querySelector("#printerStatus").textContent),
	);
	// The printer says so, and its replies to the app's status queries agree (they may arrive
	// after this, on a slow machine).
	await page.evaluate(() => {
		window.fakeSerial.state.coverOpen = true;
		window.fakeSerial.notify([0x1a, 0x05, 0x99]);
	});
	await page.waitForFunction(() =>
		/cover open/.test(document.querySelector("#printerStatus").textContent),
	);

	await page.click(".advanced summary");
	await page.click("#btnForget");
	await page.waitForFunction(() =>
		/Not connected/.test(document.querySelector("#printerStatus").textContent),
	);
	await page.evaluate(() => (window.fakeSerial.state.coverOpen = false));
	await page.click("#btnPrint");
	await page.waitForFunction(() => window.fakeSerial.labels.length === 1);
	assert.equal(await fake(page, "f.pickerCount"), 2);
	assert.match(await statusText(page), /Connected/);
	assert.deepEqual(page.errors, []);
});
