import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
	setup,
	appState,
	serialized,
	typeInto,
	labelPixels,
	openElements,
	openSettings,
	fromFileMenu,
} from "./harness.js";

// The app icon doubles as a test picture: a blue square with a white label shape.
const ICON = fileURLToPath(new URL("../../icons/icon-192.png", import.meta.url));

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

const blackDots = async (page) => (await labelPixels(page)).black;

test("import an image, switch styles and invert, print, and save/load it", async () => {
	const page = await env.open();
	await openElements(page);
	await page.click("#layers li");
	await page.keyboard.press("Delete");

	const [chooser] = await Promise.all([page.waitForFileChooser(), page.click("#addImage")]);
	await chooser.accept([ICON]);
	await page.waitForFunction(() =>
		window.labelApp.state.doc.elements.some((e) => e.type === "image"),
	);
	const img = (await appState(page)).doc.elements[0];
	assert.equal(img.w, img.h, "square picture gets a square box");
	assert.match(img.src, /^data:image\/png;base64,/);

	const dithered = await blackDots(page);
	assert.ok(dithered > 500, `dithered image has ink (${dithered})`);

	// Style and darkness are on the bar; invert is in the settings.
	await page.click('#quickbar [data-radio="mode"] [data-value="threshold"]');
	const solid = await blackDots(page);
	await openSettings(page);
	await page.click('#imageProps [data-prop="invert"]');
	const inverted = await blackDots(page);
	const boxDots = Math.round(img.w * 8) * Math.round(img.h * 8);
	// Inverting flips every dot inside the box (the rest of the label stays white).
	assert.ok(
		Math.abs(solid + inverted - boxDots) <= boxDots * 0.02,
		`${solid} + ${inverted} ≈ ${boxDots}`,
	);

	await typeInto(page, '#quickbar [data-qb="image"] [data-prop="level"]', "40");
	assert.notEqual(await blackDots(page), inverted, "darkness slider changes the result");

	await page.click("#btnPrint");
	await page.waitForSelector("#tape .printed");

	const saved = await serialized(page);
	await fromFileMenu(page, "#btnNew");
	await page.click('#templateList [data-id="blank"]');
	await page.evaluate((t) => window.labelApp.loadText(t), saved);
	assert.equal(await serialized(page), saved);
	assert.deepEqual(page.errors, []);
});

test("dropping a picture on the page adds it as an image element", async () => {
	const page = await env.open();
	const before = (await appState(page)).doc.elements.length;
	await page.evaluate(async () => {
		const blob = await (await fetch("icons/icon-192.png")).blob();
		const dt = new DataTransfer();
		dt.items.add(new File([blob], "logo.png", { type: "image/png" }));
		document.body.dispatchEvent(
			new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }),
		);
	});
	await page.waitForFunction((n) => window.labelApp.state.doc.elements.length > n, {}, before);
	const last = (await appState(page)).doc.elements.at(-1);
	assert.equal(last.type, "image");
});

test("fit, fill and stretch, and the position picks which part of a filled image shows", async () => {
	const page = await env.open();
	await openElements(page);
	await page.click("#layers li");
	await page.keyboard.press("Delete");
	const [chooser] = await Promise.all([page.waitForFileChooser(), page.click("#addImage")]);
	await chooser.accept([ICON]);
	await page.waitForFunction(() =>
		window.labelApp.state.doc.elements.some((e) => e.type === "image"),
	);
	// A wide box around a square picture: fit leaves bands, fill crops, stretch distorts.
	await typeInto(page, '#geomProps [data-prop="w"]', "30");
	await typeInto(page, '#geomProps [data-prop="h"]', "8");
	const signature = async () => (await labelPixels(page)).hash;
	await openSettings(page);
	const looks = {};
	for (const fit of ["contain", "cover", "stretch"]) {
		await page.click(`#imageProps [data-radio="fit"] [data-value="${fit}"]`);
		looks[fit] = await signature();
	}
	assert.equal(new Set(Object.values(looks)).size, 3, "three different results");

	await page.click('#imageProps [data-radio="fit"] [data-value="cover"]');
	await page.click('#imageProps [data-radio="vAlign"] [data-value="top"]');
	const top = await signature();
	await page.click('#imageProps [data-radio="vAlign"] [data-value="bottom"]');
	assert.notEqual(await signature(), top, "top and bottom crops differ");
	const img = (await appState(page)).doc.elements[0];
	assert.deepEqual([img.fit, img.vAlign], ["cover", "bottom"]);
	assert.deepEqual(page.errors, []);
});
