import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
	setup,
	typeInto,
	appState,
	serialized,
	redraw,
	dragBy,
	labelPixels,
	openElements,
	openSettings,
	fromFileMenu,
} from "./harness.js";

let env;
before(async () => (env = await setup()));
after(async () => env?.teardown());

const printVirtual = async (page, count = 1) => {
	await page.click("#btnPrint");
	await page.waitForFunction(
		(n) => document.querySelectorAll("#tape .printed").length >= n,
		{},
		count,
	);
};

/** Compares the editor canvas with the newest virtual print, pixel for pixel. */
const previewMatchesPrint = (page) =>
	page.evaluate(() => {
		const a = document.querySelector("#labelCanvas");
		const b = document.querySelector("#tape .printed canvas");
		if (a.width !== b.width || a.height !== b.height)
			return `size ${a.width}x${a.height} vs ${b.width}x${b.height}`;
		const da = a.getContext("2d").getImageData(0, 0, a.width, a.height).data;
		const db = b.getContext("2d").getImageData(0, 0, b.width, b.height).data;
		let diff = 0;
		let black = 0;
		for (let i = 0; i < da.length; i += 4) {
			if (da[i] !== db[i]) diff++;
			if (da[i] === 0) black++;
		}
		return diff === 0 && black > 100 ? true : `diff=${diff} black=${black}`;
	});

test("a new label: webfont, fit, and virtual print matches the preview", async () => {
	const page = await env.open();
	await typeInto(page, '#textProps [data-prop="text"]', "Spices\nCumin");
	await page.select('#quickbar [data-prop="fontFamily"]', "Oswald");
	await page.select('#textProps [data-prop="fontWeight"]', "700");
	await redraw(page);
	assert.ok(await page.evaluate(() => document.fonts.check('700 20px "Oswald"')), "Oswald loaded");
	await printVirtual(page);
	assert.equal(await previewMatchesPrint(page), true);

	await typeInto(page, "#copies", "3");
	await printVirtual(page, 2);
	const meta = await page.$eval("#tape .printed .hint", (e) => e.textContent);
	assert.match(meta, /^3 of 3 copies/);
	assert.deepEqual(page.errors, []);
});

test("add an element, drag, resize, undo as one step", async () => {
	const page = await env.open();
	assert.equal((await appState(page)).doc.elements.length, 1, "a new label has one text");

	await page.click("#addQr");
	let s = await appState(page);
	assert.equal(s.doc.elements.length, 2);
	const before = s.doc.elements[1];

	const listItem = await page.$("#layers li");
	await dragBy(page, ".box.selected", 120, 0);
	const moved = (await appState(page)).doc.elements[1];
	assert.ok(
		await listItem.evaluate((li) => li.isConnected),
		"moving an element doesn't rebuild the Elements list",
	);
	assert.ok(moved.x > before.x + 3, `moved ${before.x} → ${moved.x}`);

	await dragBy(page, '.box.selected .handle[data-dir="se"]', -30, -30);
	const resized = (await appState(page)).doc.elements[1];
	assert.ok(resized.w < moved.w, `resized ${moved.w} → ${resized.w}`);

	await page.evaluate(() => window.labelApp.undo());
	assert.equal((await appState(page)).doc.elements[1].w, moved.w, "one undo step per drag");
	assert.deepEqual(page.errors, []);
});

test("save → load restores exactly; bad files leave the label alone; autosave survives reload", async () => {
	const page = await env.open();
	await page.click("#addText");
	await typeInto(page, '#textProps [data-prop="text"]', "a long line that must wrap inside");
	const saved = await serialized(page);

	await fromFileMenu(page, "#btnNew");
	await page.click('#templateList [data-id="blank"]');
	assert.notEqual(await serialized(page), saved);
	await page.evaluate((t) => window.labelApp.loadText(t), saved);
	assert.equal(await serialized(page), saved);
	assert.equal(await page.$eval("#designPanel", (e) => e.hidden), false);

	await page.evaluate(() =>
		window.labelApp.loadText('{"format":"labelmaker-label","version":99}', "future.label"),
	);
	assert.match(await page.$eval("#toast", (e) => e.textContent), /newer version/);
	assert.equal(await serialized(page), saved);

	await page.reload({ waitUntil: "networkidle0" });
	await page.evaluate(() => window.labelApp.ready);
	assert.equal(await serialized(page), saved);
});

test("emoji in text: the picker inserts at the cursor, and emoji print as crisp outlines", async () => {
	const page = await env.open();
	await page.click("#addText");
	const id = (await appState(page)).selectedId;
	const text = () => appState(page).then((s) => s.doc.elements.find((e) => e.id === id).text);
	// The dialog's close event (which inserts the emoji) fires a task after the click.
	const pick = async (emoji) => {
		await page.click(`#emojiGrid button[value="${emoji}"]`);
		await page.waitForFunction(() => !document.querySelector("#emojiDialog").open);
		await page.evaluate(() => new Promise((r) => setTimeout(r)));
	};

	// From the settings' text field: the cursor sits between "Te" and "xt".
	await page.keyboard.press("Escape"); // a new text starts out being typed on the label
	await openSettings(page);
	await page.$eval("#designText", (t) => {
		t.focus();
		t.setSelectionRange(2, 2);
	});
	await page.click("#textProps .insert-emoji");
	// The picker's emoji carry U+FE0F, so they show in colour there; the text doesn't keep it.
	await pick("❄\uFE0F");
	assert.equal(await text(), "Te❄xt");
	assert.equal(
		await page.evaluate(() => document.activeElement.id),
		"designText",
		"back in the field",
	);
	assert.equal(
		await page.$eval("#designText", (t) => t.selectionStart),
		3,
		"cursor after the emoji",
	);

	// Searching by name; Enter takes the first match.
	await page.$eval("#designText", (t) => {
		t.focus();
		t.setSelectionRange(0, 0);
	});
	await page.click("#textProps .insert-emoji");
	await page.type("#emojiSearch", "jar");
	assert.equal(await page.$$eval("#emojiGrid button", (b) => b.length), 1);
	await page.keyboard.press("Enter");
	await page.waitForFunction(() => !document.querySelector("#emojiDialog").open);
	await page.evaluate(() => new Promise((r) => setTimeout(r)));
	assert.equal(await text(), "🫙Te❄xt");
	await page.$eval("#designText", (t) => t.select());
	await page.keyboard.press("Delete");
	await page.keyboard.type("Te❄xt");
	await page.keyboard.press("Escape");

	// From the bar while typing on the label: it reopens with the cursor after the emoji.
	const box = await (await page.$(".box.selected")).boundingBox();
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { count: 2 });
	await page.waitForSelector(".inline-edit");
	await page.keyboard.press("End");
	await page.click("#quickbar .insert-emoji");
	await pick("⭐");
	assert.equal(await text(), "Te❄xt⭐");
	assert.ok(await page.$(".inline-edit"), "inline editor reopened");

	// A light colour emoji would threshold to nothing; the outline font draws it.
	await page.evaluate(async () => {
		const { createDocument } = await import("/src/model.js");
		const { serialize } = await import("/src/fileformat.js");
		const doc = createDocument();
		doc.elements[0].text = "❄";
		await window.labelApp.loadText(serialize(doc, { selectedIds: [] }));
	});
	assert.equal((await appState(page)).doc.elements[0].text, "❄", "the file loaded");
	const { black } = await labelPixels(page);
	assert.ok(black > 300, `snowflake has ${black} black dots`);
	assert.deepEqual(page.errors, []);
});

test("test hooks exist only under automation or with ?debug", async () => {
	const page = await env.open();
	// What a regular visit looks like: no automation flag.
	await page.evaluateOnNewDocument(() =>
		Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }),
	);
	await page.reload({ waitUntil: "networkidle0" });
	assert.equal(await page.evaluate(() => "labelApp" in window), false);
	await page.goto(page.url() + "?debug", { waitUntil: "networkidle0" });
	assert.equal(await page.evaluate(() => "labelApp" in window), true);
});

test("narrow viewport has no horizontal scroll", async () => {
	const page = await env.open({ width: 400, height: 900 });
	await redraw(page);
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
		false,
	);
	assert.deepEqual(page.errors, []);
});

test("smart guides: dragging near the centre snaps exactly and shows a guide; Alt disables it", async () => {
	const page = await env.open();
	await page.click("#addQr");
	// Park it at the left so the drag has somewhere to go.
	await typeInto(page, '#geomProps [data-prop="x"]', "3.1");
	await typeInto(page, '#geomProps [data-prop="y"]', "2");
	await typeInto(page, '#geomProps [data-prop="w"]', "8");
	await typeInto(page, '#geomProps [data-prop="h"]', "8");

	const label = await page.$("#overlay");
	const lb = await label.boundingBox();
	const pxPerMm = lb.width / 40;
	const box = await (await page.$(".box.selected")).boundingBox();
	const startX = box.x + box.width / 2;
	const startY = box.y + box.height / 2;
	// Centre is at 7.1 mm; label centre is 20 mm. Aim a few pixels short (guides grab within 6).
	const aim = (20 - 7.1) * pxPerMm - 3;

	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(startX + aim, startY, { steps: 8 });
	assert.ok(await page.$(".snapline.x"), "vertical guide visible mid-drag");
	await page.mouse.up();
	assert.equal(await page.$(".snapline"), null, "guides cleared after drag");
	let e = (await appState(page)).doc.elements[1];
	assert.equal(e.x + e.w / 2, 20, `centre snapped (x=${e.x})`);

	// Same move with Alt held lands off-centre.
	await page.evaluate(() => window.labelApp.undo());
	await page.keyboard.down("Alt");
	await page.mouse.move(startX, startY);
	await page.mouse.down();
	await page.mouse.move(startX + aim, startY, { steps: 8 });
	await page.mouse.up();
	await page.keyboard.up("Alt");
	e = (await appState(page)).doc.elements[1];
	assert.notEqual(e.x + e.w / 2, 20);
	assert.deepEqual(page.errors, []);
});

test("inline editing: double-click to type on the label, Escape to finish, one undo step", async () => {
	const page = await env.open();
	// Simple mode: double-click anywhere on the label edits its text.
	const overlay = await (await page.$("#overlay")).boundingBox();
	await page.mouse.click(overlay.x + overlay.width / 2, overlay.y + overlay.height / 2, {
		count: 2,
	});
	await page.waitForSelector(".inline-edit");
	await page.keyboard.type("Pantry");
	assert.equal((await appState(page)).doc.elements[0].text, "Pantry");

	// An emoji typed with its presentation selector (U+FE0F) is kept without it, caret and all:
	// with it, the editor drew the emoji wider than the label does and its caret drifted.
	await page.keyboard.type("❤\uFE0F!");
	const field = await page.$eval(".inline-edit", (t) => ({
		value: t.value,
		caret: t.selectionStart,
	}));
	assert.deepEqual(field, { value: "Pantry❤!", caret: 8 });
	assert.equal((await appState(page)).doc.elements[0].text, "Pantry❤!");
	// The caret is drawn where the label's own text ends, not where a textarea would put it
	// (give or take the last glyph's side bearing).
	await redraw(page);
	const ends = await page.evaluate(() => {
		const canvas = document.querySelector("#labelCanvas");
		const { width, height } = canvas;
		const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
		let right = 0;
		for (let y = 0; y < height; y++)
			for (let x = 0; x < width; x++)
				if (data[(y * width + x) * 4] < 128) right = Math.max(right, x);
		const rect = canvas.getBoundingClientRect();
		const caret = document.querySelector(".inline-caret").getBoundingClientRect();
		const dot = rect.width / width;
		return {
			ink: rect.left + (right + 1) * dot,
			caret: caret.left + caret.width / 2,
			line: caret.height,
		};
	});
	assert.ok(
		Math.abs(ends.ink - ends.caret) < ends.line / 4,
		`caret at ${ends.caret}px, text ends at ${ends.ink}px`,
	);
	// Only the canvas shows text: a visible editor on top of it showed up as ghost text.
	assert.equal(
		await page.$eval(".inline-edit", (t) => getComputedStyle(t).color),
		"rgba(0, 0, 0, 0)",
	);
	assert.equal(
		await page.$eval(".inline-edit", (t) => getComputedStyle(t).backgroundColor),
		"rgba(0, 0, 0, 0)",
	);
	assert.equal(
		await page.$eval('#textProps [data-prop="text"]', (t) => t.value),
		"Pantry❤!",
		"settings stay in sync",
	);
	await page.keyboard.press("Escape");
	assert.equal(await page.$(".inline-edit"), null);

	// Design mode: on a text box, with multi-line input.
	await page.click("#addText");
	// A new text box starts out being typed on, with its placeholder selected.
	assert.ok(await page.$(".inline-edit"));
	await page.keyboard.press("Escape");
	const box = await (await page.$(".box.selected")).boundingBox();
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { count: 2 });
	await page.waitForSelector(".inline-edit");
	await page.keyboard.type("Top");
	await page.keyboard.press("Enter");
	await page.keyboard.type("Shelf");
	const id = (await appState(page)).selectedId;
	const text = () => appState(page).then((s) => s.doc.elements.find((e) => e.id === id).text);
	assert.equal(await text(), "Top\nShelf");
	// Typing must not have moved or deleted anything (Backspace/arrows belong to the textarea).
	await page.keyboard.press("Backspace");
	assert.equal(await text(), "Top\nShel");
	await page.mouse.click(5, 5); // click away to finish
	assert.equal(await page.$(".inline-edit"), null);
	await page.evaluate(() => window.labelApp.undo());
	assert.equal(await text(), "Text", "the whole inline edit undoes as one step");
	assert.deepEqual(page.errors, []);
});

test("inline editing follows the label's lines: wrapping, rotation, stacking", async () => {
	const page = await env.open();
	const load = (patch) =>
		page.evaluate(async (patch) => {
			const { createDocument } = await import("/src/model.js");
			const { serialize } = await import("/src/fileformat.js");
			const doc = createDocument();
			Object.assign(doc.elements[0], { fit: false, fontSizePt: 10 }, patch);
			await window.labelApp.loadText(serialize(doc, { selectedIds: [] }));
		}, patch);
	const edit = async () => {
		const id = (await appState(page)).doc.elements[0].id;
		const box = await (await page.$(`.box[data-id="${id}"]`)).boundingBox();
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { count: 2 });
		await page.waitForSelector(".inline-edit");
	};
	const press = async (...keys) => {
		for (const k of keys) await page.keyboard.press(k);
	};
	const text = () => appState(page).then((s) => s.doc.elements[0].text);

	// Wrapped text: Down goes to the line the label wrapped onto, which the text doesn't have.
	await load({ text: "one two three four five six seven eight", w: 20, x: 2 });
	await edit();
	await press("ArrowLeft", "Home", "ArrowDown", "Home");
	await page.keyboard.type("|");
	const wrapped = await text();
	assert.notEqual(wrapped.indexOf("|"), 0, "moved off the first line");
	assert.equal(wrapped[wrapped.indexOf("|") - 1], " ", "to the start of a wrapped line");
	await press("Escape");

	// Rotated: Up goes to the line above in the text's own direction.
	await load({ text: "Top\nShelf", rotation: 90, w: 10, h: 12, x: 2, y: 0 });
	await edit();
	await press("ArrowRight", "ArrowUp");
	await page.keyboard.type("X");
	assert.equal(await text(), "TopX\nShelf");
	await press("Escape");

	// Mixed sizes: End and typing work on the larger first line.
	await load({ text: "Title\nsmall", firstLineScale: 2 });
	await edit();
	await press("ArrowLeft", "End");
	await page.keyboard.type("!");
	assert.equal(await text(), "Title!\nsmall");
	await press("Escape");

	// Stacked: each letter is a line, so Down steps to the next letter.
	await load({ text: "ABC", stacked: true, w: 6, h: 12, x: 2, y: 0 });
	await edit();
	await press("ArrowLeft", "ArrowDown");
	await page.keyboard.type("-");
	assert.equal(await text(), "A-BC");
	await press("Escape");
	assert.deepEqual(page.errors, []);
});

test("shapes, rotation and white-on-black text print exactly as previewed", async () => {
	const page = await env.open();
	await page.click("#addShape");
	let s = await appState(page);
	assert.equal(s.doc.elements.at(-1).type, "shape");
	await page.click('#quickbar [data-radio="shape"] [data-value="ellipse"]');
	assert.equal(
		await page.$eval('#shapeProps [data-show-for="rect"]', (n) => n.hidden),
		true,
		"corner radius hidden for circles",
	);

	// Rotate a text box with the R key: box swaps width/height around its centre.
	await openElements(page);
	await page.click("#layers li:last-child"); // the original text box (bottom of the stack)
	const before = (await appState(page)).doc.elements[0];
	await page.keyboard.press("r");
	const after = (await appState(page)).doc.elements[0];
	assert.equal(after.rotation, 90);
	assert.equal(after.w, Math.min(before.h, 40));
	await openSettings(page);
	await page.click('#textProps [data-prop="invert"]');
	assert.equal((await appState(page)).doc.elements[0].invert, true);

	await redraw(page);
	await printVirtual(page);
	assert.equal(await previewMatchesPrint(page), true);
	assert.deepEqual(page.errors, []);
});

test("cached element drawings match a from-scratch render after moves and edits", async () => {
	const page = await env.open();
	await page.click("#addBarcode");
	await dragBy(page, ".box.selected", 30, 0);
	await typeInto(page, '#quickbar [data-qb="barcode"] [data-prop="data"]', "XYZ-9");
	await page.click("#addQr");
	await dragBy(page, ".box.selected", -40, 0);
	await page.keyboard.press("r");
	const same = await page.evaluate(async () => {
		await window.labelApp.drawCanvas();
		const { renderLabel, clearRenderCache } = await import("/src/render.js");
		const shown = document.querySelector("#labelCanvas");
		const a = shown.getContext("2d").getImageData(0, 0, shown.width, shown.height).data;
		clearRenderCache();
		const fresh = document.createElement("canvas");
		await renderLabel(window.labelApp.state.doc, fresh);
		const b = fresh.getContext("2d").getImageData(0, 0, fresh.width, fresh.height).data;
		return a.length === b.length && a.every((v, i) => v === b[i]);
	});
	assert.equal(same, true);
	assert.deepEqual(page.errors, []);
});

test("zoom: buttons, keys and Ctrl+wheel; dragging still moves by the right amount", async () => {
	const page = await env.open();
	const width = () => page.$eval("#labelCanvas", (c) => c.getBoundingClientRect().width);
	const fit = await width();
	await page.click("#zoomIn");
	await page.click("#zoomIn");
	assert.equal(await page.$eval("#zoomFit", (b) => b.textContent), "200%");
	assert.ok((await width()) > fit * 1.8, "twice as big");
	// The whole label is reachable by scrolling, left edge included.
	const reach = await page.evaluate(() => {
		const s = document.querySelector("#stage");
		s.scrollLeft = 0;
		return (
			document.querySelector("#paper").getBoundingClientRect().left >=
			s.getBoundingClientRect().left
		);
	});
	assert.equal(reach, true);

	// At 200%, the same mouse movement is half as many millimetres.
	await page.click("#addQr");
	const x0 = (await appState(page)).doc.elements.at(-1).x;
	const px = await page.evaluate(() => {
		const o = document.querySelector("#overlay").getBoundingClientRect();
		return o.width / 40; // pixels per mm on a 40 mm label
	});
	await page.keyboard.down("Alt"); // no snapping
	await dragBy(page, ".box.selected", Math.round(px * 4), 0);
	await page.keyboard.up("Alt");
	const moved = (await appState(page)).doc.elements.at(-1).x - x0;
	assert.ok(Math.abs(moved - 4) < 0.3, `moved ${moved} mm`);

	await page.focus("#overlay");
	await page.keyboard.press("0");
	assert.equal(await page.$eval("#zoomFit", (b) => b.textContent), "Fit");
	const stage = await (await page.$("#stage")).boundingBox();
	await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
	await page.keyboard.down("Control");
	await page.mouse.wheel({ deltaY: -100 });
	await page.keyboard.up("Control");
	await page.waitForFunction(() => document.querySelector("#zoomFit").textContent === "150%");
	assert.deepEqual(page.errors, []);
});

test("letter spacing, underline, outline, stacked and image fit each change the print", async () => {
	const page = await env.open();
	const pixels = async () => {
		const p = await labelPixels(page);
		return { ...p, width: p.inkWidth };
	};
	await typeInto(page, "#designText", "Ab");
	await openSettings(page);
	await page.click('#textProps [data-prop="fit"]'); // fixed size, so spacing shows as width
	await typeInto(page, '#quickbar [data-prop="fontSizePt"]', "24");
	const plain = await pixels();
	await typeInto(page, '#textProps [data-prop="letterSpacingPt"]', "6");
	assert.ok((await pixels()).width > plain.width + 10, "letter spacing widens the text");
	await typeInto(page, '#textProps [data-prop="letterSpacingPt"]', "0");
	await page.click('#quickbar [data-style="underline"]');
	assert.ok((await pixels()).black > plain.black, "underline adds ink");
	await page.click('#quickbar [data-style="underline"]');
	await page.click('#textProps [data-prop="outline"]');
	const outlined = await pixels();
	assert.notEqual(outlined.hash, plain.hash, "outline draws differently");
	assert.ok(Math.abs(outlined.width - plain.width) <= 4, "and at the same size");
	await page.click('#textProps [data-prop="outline"]');
	await page.click('#textProps [data-prop="stacked"]');
	assert.ok((await pixels()).width < plain.width, "stacked is narrower");

	// The caption font only shows when there's a caption.
	await page.click("#addBarcode");
	assert.equal(await page.$eval('#barcodeProps [data-show-if="showText"]', (f) => f.hidden), false);
	await openSettings(page);
	await page.click('#barcodeProps [data-prop="showText"]');
	assert.equal(await page.$eval('#barcodeProps [data-show-if="showText"]', (f) => f.hidden), true);
	assert.deepEqual(page.errors, []);
});

test("a larger first line prints larger, and edits on the label", async () => {
	const page = await env.open();
	await typeInto(page, "#designText", "Title\nsmall print");
	const height = async () => (await labelPixels(page)).firstBandHeight;
	const same = await height();
	await openSettings(page);
	await page.click('#textProps [data-radio="firstLineScale"] [data-value="2"]');
	const larger = await height();
	assert.ok(larger > same * 1.2, `first line ${same} → ${larger} dots tall`);
	await page.keyboard.press("Escape"); // the settings sit over the label
	const box = await (await page.$(".box.selected")).boundingBox();
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { count: 2 });
	assert.ok(await page.$(".inline-edit"));
});

test("an unexpected error is reported once, instead of the app failing silently", async () => {
	const page = await env.open();
	// Errors thrown by code the test injects are muted to "Script error.", so raise one the way
	// the browser does for the app's own code.
	await page.evaluate(() => {
		dispatchEvent(new ErrorEvent("error", { error: new Error("boom"), message: "boom" }));
		setTimeout(() => Promise.reject(new Error("second boom")), 10);
	});
	await page.waitForFunction(() =>
		document.querySelector("#toast").textContent.includes("Something went wrong: boom."),
	);
	await new Promise((r) => setTimeout(r, 100));
	assert.match(await page.$eval("#toast", (t) => t.textContent), /: boom\. Your label is saved/);
	assert.equal(await page.$eval("#toast", (t) => t.getAttribute("role")), "alert");
	assert.deepEqual(
		page.errors.filter((e) => !/boom/.test(e)),
		[],
	);
});

test("the first print asks the browser to keep stored labels, once", async () => {
	const page = await env.open({
		beforeLoad: (p) =>
			p.evaluateOnNewDocument(() => {
				window.persistCalls = 0;
				StorageManager.prototype.persisted = async () => false;
				StorageManager.prototype.persist = async () => (window.persistCalls++, true);
			}),
	});
	assert.equal(await page.evaluate(() => window.persistCalls), 0, "not on a first visit");
	await page.evaluate(() => window.labelApp.print());
	await page.evaluate(() => window.labelApp.historySaved());
	await page.evaluate(() => window.labelApp.print());
	await page.evaluate(() => window.labelApp.historySaved());
	assert.equal(await page.evaluate(() => window.persistCalls), 1);
	assert.deepEqual(page.errors, []);
});

test("the page refuses scripts that aren't its own", async () => {
	const page = await env.open();
	const ran = await page.evaluate(() => {
		const s = document.createElement("script");
		s.textContent = "window.injected = true";
		document.body.append(s);
		return window.injected === true;
	});
	assert.equal(ran, false);
	assert.ok(page.errors.every((e) => /Content Security Policy/.test(e)));
});

test("fit to label shows the fitted size in the size box; typing a size stops fitting", async () => {
	const page = await env.open();
	const size = '#quickbar [data-prop="fontSizePt"]';
	await typeInto(page, "#designText", "Hi");
	await typeInto(page, '#textProps [data-prop="fit"]', true);
	await redraw(page);
	const stored = (await appState(page)).doc.elements[0].fontSizePt;
	const shown = Number(await page.$eval(size, (i) => i.value));
	assert.ok(shown > stored, `shows the fitted ${shown} pt, not the stored ${stored} pt`);
	assert.equal(await page.$eval(size, (i) => i.disabled), false);
	assert.equal(await page.$(".fit-hint"), null, "no separate 'Fitted size' line");

	await typeInto(page, size, "10");
	const text = (await appState(page)).doc.elements[0];
	assert.deepEqual([text.fit, text.fontSizePt], [false, 10]);
	assert.equal(await page.$eval('#textProps [data-prop="fit"]', (c) => c.checked), false);
	assert.deepEqual(page.errors, []);
});

test("the ruler toggles, spans the label, still fits the window, and is remembered", async () => {
	const page = await env.open();
	const rulers = () =>
		page.evaluate(() => {
			const label = document.querySelector("#labelCanvas").getBoundingClientRect();
			const top = document.querySelector("#rulerTop");
			const left = document.querySelector("#rulerLeft");
			const stage = document.querySelector("#stage");
			return {
				hidden: top.hidden && left.hidden,
				pressed: document.querySelector("#btnRuler").getAttribute("aria-pressed"),
				topMatches: Math.abs(top.getBoundingClientRect().width - label.width) < 1,
				leftMatches: Math.abs(left.getBoundingClientRect().height - label.height) < 1,
				overflows: stage.scrollWidth > stage.clientWidth,
			};
		});
	assert.deepEqual(await rulers(), {
		hidden: true,
		pressed: "false",
		topMatches: false,
		leftMatches: false,
		overflows: false,
	});
	await page.click("#btnRuler");
	await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))));
	assert.deepEqual(await rulers(), {
		hidden: false,
		pressed: "true",
		topMatches: true,
		leftMatches: true,
		overflows: false,
	});

	await page.reload({ waitUntil: "networkidle0" });
	await page.evaluate(() => window.labelApp.ready);
	assert.equal((await rulers()).pressed, "true", "remembered");
	await page.click("#btnRuler");
	assert.equal((await rulers()).hidden, true);
	assert.deepEqual(page.errors, []);
});

test("dithered emoji: offered only with an emoji in the text, and printed as previewed", async () => {
	const page = await env.open();
	const option = "#textProps [data-show-if-emoji]";
	await typeInto(page, "#designText", "Pantry");
	assert.equal(await page.$eval(option, (l) => l.hidden), true);
	await typeInto(page, "#designText", "Hot 🔥");
	assert.equal(await page.$eval(option, (l) => l.hidden), false);
	await openSettings(page);
	await page.click('#textProps [data-prop="ditherEmoji"]');
	assert.equal((await appState(page)).doc.elements[0].ditherEmoji, true);
	await printVirtual(page);
	assert.equal(await previewMatchesPrint(page), true);
	assert.deepEqual(page.errors, []);
});

test("New offers templates drawn on the loaded label; picking one opens it, first element selected", async () => {
	const page = await env.open();
	await fromFileMenu(page, "#btnNew");
	await page.waitForFunction(() => document.querySelector("#newDialog").open);
	assert.match(await page.$eval("#newLabelSize", (s) => s.textContent), /× 12 mm labels/);
	const names = await page.$$eval("#templateList strong", (n) => n.map((x) => x.textContent));
	assert.equal(names[0], "Blank");
	assert.ok(names.includes("Storage bin"), names.join());
	// Every thumbnail gets drawn, with something on it.
	await page.waitForFunction(() =>
		[...document.querySelectorAll("#templateList canvas")].every((c) => {
			if (!c.width) return false;
			const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
			return d.some((v, i) => i % 4 === 0 && v === 0);
		}),
	);

	await page.click('#templateList [data-id="bin"]');
	assert.equal(await page.$eval("#newDialog", (d) => d.open), false);
	const { selectedIds, doc } = await appState(page);
	assert.deepEqual(selectedIds, [doc.elements[0].id]);
	assert.deepEqual(
		doc.elements.map((e) => e.type),
		["qr", "text"],
	);
	await page.keyboard.down("Control");
	await page.keyboard.press("z");
	await page.keyboard.up("Control");
	assert.equal((await appState(page)).doc.elements[0].text, "Hello world", "undo brings it back");
	assert.deepEqual(page.errors, []);
});

test("the first-run tip goes once the label is typed on, or after a print, and stays gone", async () => {
	const typed = await env.open();
	assert.equal(await typed.$eval("#welcome", (w) => w.hidden), false);
	const o = await (await typed.$("#overlay")).boundingBox();
	await typed.mouse.click(o.x + o.width / 2, o.y + o.height / 2, { count: 2 });
	await typed.waitForSelector(".inline-edit");
	assert.equal(await typed.$eval("#welcome", (w) => w.hidden), true);

	const page = await env.open();
	assert.equal(await page.$eval("#welcome", (w) => w.hidden), false);
	// Ctrl+P prints here, rather than opening the browser's print dialog.
	await page.keyboard.down("Control");
	await page.keyboard.press("p");
	await page.keyboard.up("Control");
	await page.waitForSelector("#tape .printed");
	assert.equal(await page.$eval("#welcome", (w) => w.hidden), true);
	await page.reload();
	await page.evaluate(() => window.labelApp.ready);
	assert.equal(await page.$eval("#welcome", (w) => w.hidden), true);
	assert.deepEqual(page.errors, []);
});
