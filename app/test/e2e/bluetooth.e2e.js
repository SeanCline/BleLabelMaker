import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, typeInto, printedMatchesPreview } from "./harness.js";
import { installFakeBluetooth } from "./fake-bluetooth.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

const openWithFakeD30 = async () => {
	const page = await env.open({ beforeLoad: (p) => p.evaluateOnNewDocument(installFakeBluetooth) });
	await page.select("#target", "bluetooth");
	return page;
};
const fake = (page, expr) =>
	page.evaluate(`(() => { const f = window.fakeD30; return ${expr}; })()`);

test("connect: picker filters for the D30, status arrives over notifications", async () => {
	const page = await openWithFakeD30();
	const sizes = () => page.$$eval("#labelPreset option", (o) => o.map((x) => x.textContent));
	// Set up for an A30, which also takes 14 and 15 mm labels…
	await page.click(".advanced summary");
	await page.select("#setPrinter", "a30");
	assert.ok(
		(await sizes()).some((t) => /× 14 mm/.test(t)),
		"A30 sizes",
	);
	assert.match(await page.$eval("#setPrinter option[value=a30]", (o) => o.textContent), /untested/);
	await page.click("#btnConnect");
	await page.waitForFunction(() =>
		/^Connected to D30-FAKE · battery 64%$/.test(
			document.querySelector("#printerStatus").textContent,
		),
	);
	// …but the printer that connects names itself D30, which only takes 12 mm labels.
	assert.equal(await page.$eval("#setPrinter", (s) => s.value), "d30");
	assert.ok(
		(await sizes()).every((t) => /× 12 mm|Continuous|Custom/.test(t)),
		(await sizes()).join(", "),
	);
	const opts = await fake(page, "f.requestOptions");
	assert.deepEqual(opts.filters[0], { namePrefix: "D30" });
	assert.ok(
		opts.filters.some((f) => f.namePrefix === "Q30"),
		"every model's name is offered",
	);
	assert.deepEqual(opts.optionalServices, ["0000ff00-0000-1000-8000-00805f9b34fb"]);
	assert.match(await page.$eval("#printerStatus", (s) => s.title), /Firmware 2\.1\.7/);
	// Auto power-off: read from the printer, and set by sending ESC N 07 n.
	await page.waitForFunction(() => document.querySelector("#setAutoPower").value === "60");
	await page.click(".advanced summary");
	await page.select("#setAutoPower", "10");
	await page.waitForFunction(() => window.fakeD30.state.autoPowerOff === 10);
	const sent = await fake(page, "f.writes.map((w) => Array.from(w))");
	assert.ok(
		sent.some((w) => w.join() === [0x1b, 0x4e, 0x07, 2].join()),
		"set to 2 × 5 minutes",
	);
	assert.deepEqual(page.errors, []);
});

test("print over Bluetooth: chunked writes decode to the previewed label, one picker for many prints", async () => {
	const page = await openWithFakeD30();
	await page.select("#density", "light");
	await page.click("#btnPrint");
	await page.waitForFunction(() => window.fakeD30.labels.length === 1);
	assert.match(await page.$eval("#toast", (t) => t.textContent), /Sent 1 label to D30-FAKE/);

	const writes = await fake(page, "f.writes.map((w) => Array.from(w))");
	const queries = writes.filter((w) => w[0] === 0x1f && w[1] === 0x11 && w.length === 3);
	const job = writes.filter((w) => !queries.includes(w));
	assert.ok(
		job.every((w) => w.length <= 128),
		"no write over 128 bytes",
	);
	const bytes = job.flat();
	assert.deepEqual(
		bytes.slice(0, 14),
		[0x1f, 0x11, 0x24, 0, 0x1b, 0x40, 0x1f, 0x11, 0x02, 1, 0x1f, 0x11, 0x21, 1],
		"offset, init, density light, copies",
	);
	assert.notDeepEqual(bytes.slice(-3, -1), [0x1b, 0x64], "no feed after a gap label");

	// The printed raster equals what the preview canvas would produce.
	assert.equal(await printedMatchesPreview(page, "fakeD30"), true);

	await page.click("#btnPrint");
	await page.waitForFunction(() => window.fakeD30.labels.length === 2);
	assert.equal(await fake(page, "f.pickerCount"), 1, "the device picker isn't shown again");
	assert.equal(await page.evaluate(() => window.labelApp.historyEntries()[0].target), "bluetooth");
});

test("disconnect and reconnect without re-picking; Forget asks again", async () => {
	const page = await openWithFakeD30();
	await page.click("#btnConnect");
	await page.waitForFunction(() =>
		/Connected/.test(document.querySelector("#printerStatus").textContent),
	);
	await page.evaluate(() => window.fakeD30.device.gatt.disconnect());
	await page.waitForFunction(() =>
		/Not connected/.test(document.querySelector("#printerStatus").textContent),
	);

	await page.click("#btnPrint");
	await page.waitForFunction(() => window.fakeD30.labels.length === 1);
	assert.equal(await fake(page, "f.pickerCount"), 1, "reconnected to the remembered device");

	await page.click(".advanced summary");
	await page.click("#btnForget");
	await page.click("#btnPrint");
	await page.waitForFunction(() => window.fakeD30.labels.length === 2);
	assert.equal(await fake(page, "f.pickerCount"), 2);
});

test("a connection lost mid-print says how far it got, and keeps the serials it used", async () => {
	const page = await openWithFakeD30();
	await typeInto(page, "#simpleText", "BIN-{n}");
	await typeInto(page, "#copies", "3");
	await page.click("#btnConnect");
	await page.waitForFunction(() =>
		/Connected/.test(document.querySelector("#printerStatus").textContent),
	);
	// Each label is about 30 writes, so this drops the link half way through the second.
	await page.evaluate(() => (window.fakeD30.dropAtWrite = window.fakeD30.writes.length + 45));
	await page.click("#btnPrint");
	await page.waitForFunction(() => /broke off/.test(document.querySelector("#toast").textContent));
	assert.match(
		await page.$eval("#toast", (t) => t.textContent),
		/after 1 of 3 labels \(GATT Server is disconnected\.\)\. Print again for the rest\./,
	);
	assert.equal(await fake(page, "f.labels.length"), 1);
	assert.equal(await page.$eval("#counterStart", (i) => i.value), "2", "BIN-1 is used");
	await page.evaluate(() => window.labelApp.historySaved());
	const history = await page.evaluate(() => window.labelApp.historyEntries());
	assert.equal(history[0].copies, 1);
	assert.ok(
		page.errors.every((e) => /disconnected|JSHandle@error/i.test(e)),
		page.errors.join(),
	);
});

test("cancelling the device picker is silent; out-of-paper notification warns", async () => {
	const page = await openWithFakeD30();
	await page.evaluate(() => (window.fakeD30.pickerCancels = true));
	await page.click("#btnPrint");
	await page.waitForFunction(() => !document.querySelector("#btnPrint").disabled);
	assert.equal(
		await page.$eval("#toast", (t) => t.hidden),
		true,
		"no error toast for a cancelled picker",
	);

	await page.evaluate(() => (window.fakeD30.pickerCancels = false));
	await page.click("#btnConnect");
	await page.waitForFunction(() =>
		/Connected/.test(document.querySelector("#printerStatus").textContent),
	);
	// The printer reports running out on its own (e.g. mid-session). Its replies to the
	// app's status queries agree, in case they arrive after this on a slow machine.
	await page.evaluate(() => {
		window.fakeD30.state.paper = false;
		window.fakeD30.notify([0x1a, 0x06, 0x88]);
	});
	await page.waitForFunction(() =>
		/out of labels/.test(document.querySelector("#printerStatus").textContent),
	);
	assert.match(await page.$eval("#toast", (t) => t.textContent), /out of labels/);
	assert.deepEqual(page.errors, []);
});

test("reports: an untested model that prints offers an 'it works' issue; diagnostics copy", async () => {
	const page = await openWithFakeD30();
	await page.evaluate(() => {
		window.fakeD30.name = "Q30-FAKE";
		window.opened = [];
		window.open = (url) => void window.opened.push(url);
		window.copied = [];
		navigator.clipboard.writeText = async (text) => void window.copied.push(text);
	});
	await page.click("#btnPrint");
	await page.waitForFunction(() => window.fakeD30.labels.length === 1);
	await page.waitForFunction(() => !document.querySelector("#untestedNote").hidden);
	assert.match(await page.$eval("#untestedText", (t) => t.textContent), /Q30 is untested/);

	await page.click("#btnNoteReportWorks");
	const works = new URL(await page.evaluate(() => window.opened[0]));
	assert.match(works.pathname, /\/issues\/new$/);
	assert.equal(works.searchParams.get("title"), "Works: Phomemo Q30");
	const body = works.searchParams.get("body");
	assert.match(body, /it calls itself "Q30-FAKE"/);
	assert.match(body, /Firmware: 2\.1\.7/);
	assert.match(body, /1a 04 40/, "what the printer said");
	assert.equal(await page.$eval("#untestedNote", (n) => n.hidden), true);
	// Asked once per model.
	await page.click("#btnPrint");
	await page.waitForFunction(() => window.fakeD30.labels.length === 2);
	assert.equal(await page.$eval("#untestedNote", (n) => n.hidden), true);

	await page.click(".advanced summary");
	assert.match(await page.$eval("#appVersion", (p) => p.textContent), /^Version \d+\.\d+\.\d+$/);
	await page.click("#btnCopyDiagnostics");
	await page.waitForFunction(() => window.copied.length === 1);
	const copied = await page.evaluate(() => window.copied[0]);
	assert.match(copied, /Device: Q30-FAKE/);
	assert.doesNotMatch(copied, /#label=/, "never the shared label in the URL");
	await page.click("#btnReportProblem");
	const problem = new URL(await page.evaluate(() => window.opened[1]));
	assert.equal(problem.searchParams.get("labels"), "bug");
	assert.match(problem.searchParams.get("body"), /Model: Phomemo Q30 \(q30\), untested/);
	assert.deepEqual(page.errors, []);
});
