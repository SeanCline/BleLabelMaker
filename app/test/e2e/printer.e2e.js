import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { setup, typeInto, appState } from "./harness.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

const statusText = (page) => page.$eval("#printerStatus", (s) => s.textContent);
const printCount = (page) => page.$$eval("#tape .printed", (n) => n.length);

test("status line shows what the printer reports; density is sent and decoded", async () => {
	const page = await env.open();
	// Firmware arrives with the rest of the status.
	await page.waitForFunction(() => /Firmware/.test(document.querySelector("#printerStatus").title));
	assert.match(await page.$eval("#printerStatus", (s) => s.title), /Firmware 1\.0\.0/);
	assert.equal(await statusText(page), "", "a virtual printer with labels has nothing to report");
	assert.equal(await page.$eval("#virtualModelRow", (r) => r.hidden), false);
	assert.equal(await page.$eval("#setPrinterRow", (r) => r.hidden), true);

	assert.equal(await page.$eval("#density", (s) => s.value), "normal", "Normal is the default");
	assert.deepEqual(await page.$$eval("#density option", (o) => o.map((x) => x.value)), [
		"light",
		"normal",
		"dark",
	]);
	await page.select("#density", "dark");
	await page.click("#btnPrint");
	await page.waitForSelector("#tape .printed");
	assert.match(await page.$eval("#tape .printed .hint", (e) => e.textContent), /density dark/);

	// The setting persists.
	await page.reload({ waitUntil: "networkidle0" });
	await page.evaluate(() => window.labelApp.ready);
	assert.equal(await page.$eval("#density", (s) => s.value), "dark");
	assert.deepEqual(page.errors, []);
});

test("out of paper: warned immediately, asked before printing, and nothing prints", async () => {
	const page = await env.open();
	await page.evaluate(() => window.labelApp.simulateVirtual({ paper: false }));
	await page.waitForFunction(() =>
		/out of labels/.test(document.querySelector("#printerStatus").textContent),
	);
	assert.match(await page.$eval("#toast", (t) => t.textContent), /out of labels/);
	assert.equal(await page.$eval("#toast", (t) => t.getAttribute("role")), "alert");
	assert.ok(await page.$("#printerStatus.problem"));

	// Declining the confirmation sends nothing.
	page.once("dialog", (d) => d.dismiss());
	await page.click("#btnPrint");
	await page.waitForFunction(() => !document.querySelector("#btnPrint").disabled);
	assert.equal(await printCount(page), 0);

	// Printing anyway reaches the printer, which (like a real D30) prints nothing and says why.
	page.once("dialog", (d) => d.accept());
	await page.click("#btnPrint");
	await page.waitForFunction(() =>
		/Print failed: .*out of labels/.test(document.querySelector("#toast").textContent),
	);
	assert.equal(await printCount(page), 0);
	assert.equal(
		await page.evaluate(() => window.labelApp.historyEntries().length),
		0,
		"failed prints aren't recorded",
	);

	// Loading labels clears the problem.
	await page.evaluate(() => window.labelApp.simulateVirtual({ paper: true }));
	await page.waitForFunction(() => !document.querySelector("#printerStatus.problem"));
	await page.click("#btnPrint");
	await page.waitForSelector("#tape .printed");
});

test("pre-cut labels stop at the gap; a continuous roll feeds and has a free length", async () => {
	const page = await env.open();
	await page.click("#btnPrint");
	await page.waitForSelector("#tape .printed");
	assert.match(
		await page.$eval("#tape .printed .hint", (e) => e.textContent),
		/gap labels: stops at the gap/,
	);

	await page.select("#labelPreset", "continuous");
	assert.equal(await page.$eval("#continuousSize", (e) => e.hidden), false);
	await typeInto(page, "#labelLen", "85");
	const { label } = (await appState(page)).doc;
	assert.deepEqual(label, { widthMm: 85, heightMm: 12, continuous: true });
	assert.ok(await page.$("#paper.continuous"), "square corners");
	await page.click("#btnPrint");
	await page.waitForFunction(() => document.querySelectorAll("#tape .printed").length === 2);
	const hint = await page.$eval("#tape .printed .hint", (e) => e.textContent);
	assert.match(hint, /feed 23/);
	assert.match(hint, /96×680 dots/, "85 mm long");

	// Picking a pre-cut size again turns it back into a gapped label.
	await page.select("#labelPreset", "40x12");
	assert.equal((await appState(page)).doc.label.continuous, false);
	assert.deepEqual(page.errors, []);
});

test("the continuous feed can be overridden, and a model change restores its default", async () => {
	const page = await env.open();
	const feed = () =>
		page.$eval("#setFeed", (i) => ({
			value: i.value,
			resettable: !document.querySelector("#setFeedReset").hidden,
			hint: document.querySelector("#setFeedDefault").textContent,
		}));
	assert.deepEqual(await feed(), { value: "23", resettable: false, hint: "D30 default: 23" });
	await typeInto(page, "#setFeed", "40");
	assert.equal((await feed()).resettable, true);

	await page.select("#labelPreset", "continuous");
	await page.click("#btnPrint");
	await page.waitForSelector("#tape .printed");
	assert.match(await page.$eval("#tape .printed .hint", (e) => e.textContent), /feed 40/);

	await page.reload({ waitUntil: "networkidle0" });
	await page.evaluate(() => window.labelApp.ready);
	assert.equal((await feed()).value, "40", "kept across reloads");

	await page.select("#virtualModel", "a30");
	assert.deepEqual(await feed(), { value: "12", resettable: false, hint: "A30 default: 12" });
	await page.select("#virtualModel", "p15");
	await page.click("#btnPrint");
	await page.waitForSelector("#tape .printed");
	assert.match(
		await page.$eval("#tape .printed .hint", (e) => e.textContent),
		/continuous: no feed/,
	);

	await page.select("#virtualModel", "d30");
	await typeInto(page, "#setFeed", "999");
	assert.equal((await feed()).value, "23", "out of range is refused");
	assert.deepEqual(page.errors, []);
});

test("cover open and low battery are shown", async () => {
	const page = await env.open();
	await page.evaluate(() =>
		window.labelApp.simulateVirtual({ coverOpen: true, battery: 9, charging: true }),
	);
	await page.waitForFunction(() =>
		/cover open/.test(document.querySelector("#printerStatus").textContent),
	);
	assert.doesNotMatch(await statusText(page), /battery/, "a virtual battery isn't shown");
	await page.evaluate(() => window.labelApp.simulateVirtual({ coverOpen: false, paper: false }));
	await page.waitForFunction(() =>
		/^out of labels$/.test(document.querySelector("#printerStatus").textContent),
	);
});

test("auto power-off shows what the printer reports and sets it", async () => {
	const page = await env.open();
	await page.waitForFunction(() => document.querySelector("#setAutoPower").value === "30");
	await page.click(".advanced summary");
	await page.select("#setAutoPower", "180");
	await page.waitForFunction(() =>
		/turn itself off after 3 hours/.test(document.querySelector("#toast").textContent),
	);
	assert.equal(await page.$eval("#setAutoPower", (s) => s.value), "180");
	assert.deepEqual(page.errors, []);
});

test("the label menu says pre-cut or continuous, and each printer remembers its label", async () => {
	const page = await env.open();
	const kind = () => page.$eval("#labelKind", (k) => k.textContent);
	const label = () => appState(page).then((s) => s.doc.label);
	assert.match(await kind(), /^Pre-cut labels/);
	assert.deepEqual(await page.$$eval("#labelPreset optgroup", (g) => g.map((x) => x.label)), [
		"Pre-cut labels",
		"Continuous tape",
	]);

	// A D30 with continuous tape in it…
	await page.select("#labelPreset", "continuous");
	assert.match(await kind(), /^Continuous tape/);
	// …and an A30 with 14 mm labels.
	await page.select("#virtualModel", "a30");
	await page.select("#labelPreset", "30x14");
	assert.deepEqual(await label(), { widthMm: 30, heightMm: 14, continuous: false });

	await page.select("#virtualModel", "d30");
	assert.equal((await label()).continuous, true, "the D30's tape comes back");
	await page.select("#virtualModel", "a30");
	assert.deepEqual(await label(), { widthMm: 30, heightMm: 14, continuous: false });
	// One undo step per switch, like choosing the size by hand.
	await page.evaluate(() => window.labelApp.undo());
	assert.equal((await label()).continuous, true);
	assert.deepEqual(page.errors, []);
});
