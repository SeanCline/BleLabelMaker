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
	printVirtual,
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

	await printVirtual(page);

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

test("fit, fill and stretch, and dragging the dot picks which part of a filled image shows", async () => {
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
	const centreOff = () => page.$eval("#centreImage", (b) => b.disabled);
	assert.equal(await page.$(".box .pan"), null, "a stretched picture has nowhere to move");
	assert.equal(await centreOff(), true);

	await page.click('#imageProps [data-radio="fit"] [data-value="cover"]');
	await page.click('#quickbar [data-qb-action="more"]'); // out of the way of the label
	const pan = await page.waitForSelector(".box .pan");
	const dragBy = async (dy) => {
		const at = await pan.boundingBox();
		const [x, y] = [at.x + at.width / 2, at.y + at.height / 2];
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y + dy / 2);
		await page.mouse.move(x, y + dy);
		await page.mouse.up();
		return (await appState(page)).doc.elements[0];
	};
	// The cropped picture moves with the pointer: up shows more of its bottom.
	let img = await dragBy(-12);
	assert.ok(img.panY > 0.5 && img.panY < 1, `part way down (${img.panY})`);
	assert.equal(img.panX, 0.5, "a picture as wide as its box doesn't move across");
	const lower = await signature();
	img = await dragBy(400);
	assert.equal(img.panY, 0, "no further than its top edge");
	assert.notEqual(await signature(), lower, "another part shows");

	await openSettings(page);
	assert.equal(await centreOff(), false);
	await page.click("#centreImage");
	img = (await appState(page)).doc.elements[0];
	assert.deepEqual([img.panX, img.panY], [0.5, 0.5]);
	assert.equal(await centreOff(), true);
	assert.deepEqual(page.errors, []);
});

test("zoom: the slider, and Alt+scroll about the pointer as one undo step; none for a stretch", async () => {
	const page = await env.open();
	await openElements(page);
	await page.click("#layers li");
	await page.keyboard.press("Delete");
	const [chooser] = await Promise.all([page.waitForFileChooser(), page.click("#addImage")]);
	await chooser.accept([ICON]);
	await page.waitForFunction(() =>
		window.labelApp.state.doc.elements.some((e) => e.type === "image"),
	);
	const img = async () => (await appState(page)).doc.elements[0];
	const signature = async () => (await labelPixels(page)).hash;
	const fitted = await signature();

	await openSettings(page);
	const reset = () => page.$eval("#resetImageZoom", (b) => [b.textContent, b.disabled]);
	assert.deepEqual(await reset(), ["100%", true]);
	await typeInto(page, "#imageZoom", "2");
	assert.equal((await img()).zoom, 2);
	assert.deepEqual(await reset(), ["200%", false]);
	assert.notEqual(await signature(), fitted, "a closer view");
	await page.click("#resetImageZoom");
	assert.equal((await img()).zoom, 1);
	assert.equal(await signature(), fitted);

	// Alt+scroll near the right edge zooms in and keeps that side where it was.
	await page.click('#quickbar [data-qb-action="more"]'); // out of the way of the label
	const b = await (await page.$(".box.selected")).boundingBox();
	await page.mouse.move(b.x + b.width * 0.9, b.y + b.height / 2);
	await page.keyboard.down("Alt");
	for (let i = 0; i < 3; i++) await page.mouse.wheel({ deltaY: -100 });
	await page.keyboard.up("Alt");
	await page.waitForFunction(() => window.labelApp.state.doc.elements[0].zoom > 1.8);
	let zoomed = await img();
	assert.ok(zoomed.zoom < 1.9, `about a fifth a step (${zoomed.zoom})`);
	assert.ok(Math.abs(zoomed.panX - 0.9) < 0.01, `towards the pointer (${zoomed.panX})`);
	assert.ok(Math.abs(zoomed.panY - 0.5) < 0.01, `the pointer was halfway down (${zoomed.panY})`);
	await page.evaluate(() => window.labelApp.undo());
	zoomed = await img();
	assert.deepEqual([zoomed.zoom, zoomed.panX], [1, 0.5], "the scroll undoes as one step");

	// A stretched picture fills its box exactly, so there's nothing to zoom.
	await openSettings(page);
	await page.click('#imageProps [data-radio="fit"] [data-value="stretch"]');
	assert.equal(await page.$eval("#imageZoom", (s) => s.disabled), true);
	await page.click('#quickbar [data-qb-action="more"]');
	await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
	await page.keyboard.down("Alt");
	await page.mouse.wheel({ deltaY: -100 });
	await page.keyboard.up("Alt");
	assert.equal((await img()).zoom, 1);
	assert.deepEqual(page.errors, []);
});
