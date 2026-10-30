import { test } from "node:test";
import assert from "node:assert/strict";
import {
	serialize,
	parse,
	serializeElements,
	parseElements,
	LabelFileError,
	CURRENT_VERSION,
} from "../src/fileformat.js";
import { createDocument, createText, createShape, createImage, createQr } from "../src/model.js";
import { REPO_URL } from "../src/app-info.js";

const sampleDoc = () => {
	const doc = createDocument({ widthMm: 50, heightMm: 14, continuous: false });
	doc.elements.push(createText(doc, { text: "Line one\nline two", fontWeight: 700, italic: true }));
	doc.elements.push(createText(doc, { text: "Lab 👩‍🔬 ❄\uFE0F", x: 30 }));
	return doc;
};

test("round trip restores document and editor state exactly", () => {
	const doc = sampleDoc();
	const editor = { selectedIds: [doc.elements[2].id, doc.elements[0].id] };
	const back = parse(serialize(doc, editor));
	assert.deepEqual(back.doc, doc);
	assert.deepEqual(back.editor, editor);
	assert.equal(serialize(back.doc, back.editor), serialize(doc, editor));
});

test("file carries format id, the app's repository and version", () => {
	const doc = sampleDoc();
	const raw = JSON.parse(serialize(doc));
	assert.equal(raw.format, "labelmaker-label");
	assert.equal(raw.app, REPO_URL);
	assert.equal(raw.version, 1);
	assert.deepEqual(raw.editor.selectedIds, []);
	// Only a note for people: a file without it, or naming somewhere else, opens the same.
	for (const app of [undefined, "https://example.com/fork"]) {
		const text = JSON.stringify({ ...raw, app });
		assert.deepEqual(parse(text).doc, doc);
	}
});

test("unknown fields are dropped, dangling selection is cleared", () => {
	const raw = JSON.parse(serialize(sampleDoc(), { selectedIds: ["nope"] }));
	raw.elements[0].sparkle = true;
	raw.extra = 1;
	const back = parse(JSON.stringify(raw));
	assert.equal("sparkle" in back.doc.elements[0], false);
	assert.deepEqual(back.editor.selectedIds, []);
});

const rejects = (mutate, pattern) => {
	const raw = JSON.parse(serialize(sampleDoc()));
	mutate(raw);
	assert.throws(
		() => parse(JSON.stringify(raw)),
		(e) => e instanceof LabelFileError && pattern.test(e.message),
	);
};

test("rejects malformed files with readable messages", () => {
	assert.throws(() => parse("{nope"), /valid JSON/);
	assert.throws(() => parse("[]"), /format marker/);
	rejects((r) => (r.version = CURRENT_VERSION + 1), /newer version/);
	rejects((r) => (r.version = "1"), /version/);
	rejects((r) => (r.label.widthMm = "40"), /label width must be a number/);
	rejects((r) => (r.label.heightMm = 40), /between/);
	rejects((r) => (r.elements = {}), /must be a list/);
	rejects((r) => (r.elements[0].type = "hologram"), /unknown type/);
	rejects((r) => (r.elements[0].fontWeight = 450), /weight/);
	rejects((r) => (r.elements[0].align = "justify"), /alignment/);
	rejects((r) => (r.elements[1].id = r.elements[0].id), /share the id/);
	rejects((r) => (r.label.continuous = "yes"), /continuous label must be true or false/);
	rejects((r) => (r.elements[2].type = "emoji"), /unknown type/);
});

test("auto length is kept only on continuous rolls, and only when on", () => {
	const raw = JSON.parse(serialize(sampleDoc()));
	const label = (l) => parse(JSON.stringify({ ...raw, label: { ...raw.label, ...l } })).doc.label;
	assert.equal(label({ continuous: true, autoLength: true }).autoLength, true);
	assert.equal("autoLength" in label({ continuous: true, autoLength: false }), false);
	assert.equal("autoLength" in label({ continuous: false, autoLength: true }), false);
	rejects((r) => (r.label = { ...r.label, continuous: true, autoLength: "yes" }), /auto length/);
});

test("a file may leave out what a new element would have anyway", () => {
	const text = JSON.stringify({
		format: "labelmaker-label",
		version: 1,
		label: { widthMm: 40, heightMm: 12 },
		elements: [
			{ id: "t", type: "text", x: 1, y: 1, w: 38, h: 10, text: "Pantry" },
			{ id: "b", type: "barcode", x: 1, y: 1, w: 30, h: 8, data: "123" },
		],
	});
	const { doc, editor } = parse(text);
	assert.equal(doc.label.continuous, false);
	const [t, b] = /** @type {[any, any]} */ (doc.elements);
	assert.equal(t.text, "Pantry");
	assert.equal(t.fontSizePt, createText(doc).fontSizePt);
	assert.equal(t.rotation, 0);
	assert.equal(b.symbology, "CODE128");
	assert.deepEqual(editor, { selectedIds: [] });
	// But not where an element is, or what it shows.
	rejects((r) => delete r.elements[0].x, /x must be a number/);
	rejects((r) => delete r.elements[0].text, /text must be text/);
	rejects((r) => (r.version = 0), /no valid version/);
});

test("continuous labels round-trip", () => {
	const doc = createDocument({ widthMm: 85, heightMm: 12, continuous: true });
	doc.elements.push(createQr(doc));
	assert.deepEqual(parse(serialize(doc)).doc, doc);
});

test("shapes validate and round-trip", () => {
	const doc = sampleDoc();
	doc.elements.push(createShape(doc, { shape: "ellipse", fill: true, rotation: 90 }));
	const back = parse(serialize(doc));
	assert.deepEqual(back.doc, doc);
	rejects((r) => (r.elements[0].rotation = 45), /rotation/);
	const raw = JSON.parse(serialize(doc));
	raw.elements[3].strokeMm = 0;
	assert.throws(() => parse(JSON.stringify(raw)), /line thickness/);
	raw.elements[3].strokeMm = 1;
	raw.elements[3].shape = "star";
	assert.throws(() => parse(JSON.stringify(raw)), /shape must be one of/);
});

test("images must be embedded data, never URLs", () => {
	const doc = sampleDoc();
	const png =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
	doc.elements.push(createImage(doc, { src: png, mode: "threshold", level: 90, invert: true }));
	assert.deepEqual(parse(serialize(doc)).doc, doc);
	for (const src of [
		"https://example.com/a.png",
		"javascript:alert(1)",
		"data:text/html;base64,PGI+",
		"data:image/svg+xml;base64,PHN2Zz4=",
	]) {
		const raw = JSON.parse(serialize(doc));
		raw.elements[3].src = src;
		assert.throws(() => parse(JSON.stringify(raw)), /embedded PNG/, src);
	}
});

test("a picture's position is anywhere in its box; older files' edges and middle carry over", () => {
	const doc = sampleDoc();
	const png =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
	doc.elements.push(createImage(doc, { src: png, fit: "cover", panX: 0.25, panY: 1 }));
	assert.deepEqual(parse(serialize(doc)).doc, doc);
	const raw = JSON.parse(serialize(doc));
	const image = raw.elements[3];
	delete image.panX;
	delete image.panY;
	Object.assign(image, { align: "right", vAlign: "top" });
	const loaded = /** @type {import("../src/model.js").ImageElement} */ (
		parse(JSON.stringify(raw)).doc.elements[3]
	);
	assert.deepEqual([loaded.panX, loaded.panY, "align" in loaded], [1, 0, false]);
	image.panX = 1.5;
	assert.throws(() => parse(JSON.stringify(raw)), /position/);
});

test("a picture's zoom round-trips; files from before zoom open at 100%", () => {
	const doc = sampleDoc();
	const png =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
	doc.elements.push(createImage(doc, { src: png, zoom: 2.5 }));
	assert.deepEqual(parse(serialize(doc)).doc, doc);
	const raw = JSON.parse(serialize(doc));
	delete raw.elements[3].zoom;
	assert.equal(/** @type {any} */ (parse(JSON.stringify(raw)).doc.elements[3]).zoom, 1);
	raw.elements[3].zoom = 9;
	assert.throws(() => parse(JSON.stringify(raw)), /zoom/);
});

test("copied elements round-trip through the clipboard format; other text is left alone", () => {
	const doc = sampleDoc();
	assert.deepEqual(parseElements(serializeElements(doc.elements)), doc.elements);
	assert.equal(parseElements("just some text"), null);
	assert.equal(parseElements('{"format":"something-else"}'), null);
	const raw = JSON.parse(serializeElements(doc.elements));
	raw.elements[0].fontWeight = 450;
	assert.throws(() => parseElements(JSON.stringify(raw)), /weight/);
	raw.version = CURRENT_VERSION + 1;
	assert.throws(() => parseElements(JSON.stringify(raw)), /newer version/);
});

test("text elements never keep emoji presentation selectors", () => {
	const doc = createDocument();
	doc.elements[0].text = "Hot 🌶\uFE0F ❄\uFE0F";
	const loaded = parse(serialize(doc, { selectedIds: [] })).doc;
	assert.equal(/** @type {any} */ (loaded.elements[0]).text, "Hot 🌶 ❄");
	assert.equal(createText(doc, { text: "⚠\uFE0F" }).text, "⚠");
});

test("formatted text saves as runs, and round-trips exactly", () => {
	const doc = sampleDoc();
	doc.elements.push(createText(doc, { text: ["Use ", [{ fontWeight: 700 }, "by"], " Friday"] }));
	const file = serialize(doc);
	const raw = JSON.parse(file);
	assert.equal(raw.version, CURRENT_VERSION);
	assert.deepEqual(raw.elements[3].text, ["Use ", [{ fontWeight: 700 }, "by"], " Friday"]);
	const back = parse(file);
	assert.deepEqual(back.doc, doc);
	assert.equal(serialize(back.doc, back.editor), file);
	// Clipboard copies carry it too.
	assert.deepEqual(parseElements(serializeElements(doc.elements)), doc.elements);
});

test("hand-written runs are tidied; bad ones are refused", () => {
	const raw = JSON.parse(serialize(sampleDoc()));
	// The second element is bold already, so a bold run in it is nothing special.
	raw.elements[1].text = ["Line ", [{ fontWeight: 700 }, "one"], "", [{}, "\nline two"]];
	raw.elements[2].text = [
		[{ underline: true }, "Lab"],
		[{ underline: true }, " 👩‍🔬"],
	];
	const { doc } = parse(JSON.stringify(raw));
	assert.equal(/** @type {any} */ (doc.elements[1]).text, "Line one\nline two");
	assert.deepEqual(/** @type {any} */ (doc.elements[2]).text, [[{ underline: true }, "Lab 👩‍🔬"]]);

	const withText = (text) => (r) => (r.elements[1].text = text);
	rejects(withText(42), /list of runs/);
	rejects(withText([["x"]]), /a style and text/);
	rejects(withText([[{ fontWeight: 450 }, "x"]]), /weight/);
	rejects(withText([[{ colour: "red" }, "x"]]), /unknown style “colour”/);
	rejects(withText([[{ italic: "yes" }, "x"]]), /italic/);
	rejects(withText([[{}, 3]]), /must be text/);
});
