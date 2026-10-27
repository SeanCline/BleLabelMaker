import { test } from "node:test";
import assert from "node:assert/strict";
import {
	createDocument,
	createText,
	resizeLabel,
	printableArea,
	rotateTo,
	alignPatches,
	distributePatches,
	placeCopies,
	boundsOf,
} from "../src/model.js";
import { History } from "../src/history.js";
import { threshold, toOneBit } from "../src/raster.js";

test("a text filling the label keeps filling it when the label changes size", () => {
	const doc = resizeLabel(createDocument(), { widthMm: 50, heightMm: 15, continuous: false });
	const { x, y, w, h } = doc.elements[0];
	assert.deepEqual({ x, y, w, h }, printableArea({ widthMm: 50, heightMm: 15 }));
});

test("resizing a design clamps elements back onto the label", () => {
	const doc = createDocument({ widthMm: 50, heightMm: 12, continuous: false });
	doc.elements.push(createText(doc, { x: 45, y: 0, w: 10, h: 4 }));
	const next = resizeLabel(doc, { widthMm: 30, heightMm: 12, continuous: false });
	const e = next.elements[1];
	assert.ok(e.x + e.w <= 30);
});

test("history groups, undoes and redoes", () => {
	const h = new History({ v: 0 });
	h.push({ v: 1 }, "typing");
	h.push({ v: 2 }, "typing");
	h.push({ v: 3 });
	assert.deepEqual(h.undo(), { v: 2 });
	assert.deepEqual(h.undo(), { v: 0 });
	assert.equal(h.canUndo, false);
	assert.deepEqual(h.redo(), { v: 2 });
	h.push({ v: 9 });
	assert.equal(h.canRedo, false);
});

test("threshold and dither produce pure black/white", () => {
	const mk = () => {
		const data = new Uint8ClampedArray(16 * 16 * 4);
		for (let i = 0; i < data.length; i += 4) {
			data[i] = data[i + 1] = data[i + 2] = (i / 4) % 256;
			data[i + 3] = 255;
		}
		return { width: 16, height: 16, data };
	};
	const t = threshold(mk());
	for (let i = 0; i < t.data.length; i += 4) assert.ok(t.data[i] === 0 || t.data[i] === 255);
	const d = toOneBit(mk(), { mode: "dither" });
	let black = 0;
	for (let i = 0; i < d.data.length; i += 4) {
		assert.ok(d.data[i + 3] === 0 || (d.data[i] === 0 && d.data[i + 3] === 255));
		if (d.data[i + 3]) black++;
	}
	// A 0..255 ramp should dither to roughly half black.
	assert.ok(black > 96 && black < 160, `black=${black}`);
});

test("rotating a quarter turn swaps width and height around the centre", () => {
	const doc = createDocument();
	const e = createText(doc, { x: 10, y: 2, w: 20, h: 6 });
	const r = rotateTo(e, 90);
	assert.deepEqual([r.x, r.y, r.w, r.h, r.rotation], [17, -5, 6, 20, 90]);
	const half = rotateTo(e, 180);
	assert.deepEqual([half.x, half.y, half.w, half.h], [10, 2, 20, 6]);
	assert.deepEqual(rotateTo(r, 0), { ...e });
});

test("toOneBit: threshold level, brightness bias and invert", () => {
	const ramp = () => {
		const data = new Uint8ClampedArray(256 * 4);
		for (let i = 0; i < 256; i++) data.set([i, i, i, 255], i * 4);
		return { width: 256, height: 1, data };
	};
	const blackCount = (img) => {
		let n = 0;
		for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3]) n++;
		return n;
	};
	assert.equal(blackCount(toOneBit(ramp(), { mode: "threshold", level: 64 })), 64);
	assert.equal(blackCount(toOneBit(ramp(), { mode: "threshold", level: 200 })), 200);
	assert.equal(
		blackCount(toOneBit(ramp(), { mode: "threshold", level: 64, invert: true })),
		256 - 64,
	);
	const light = blackCount(toOneBit(ramp(), { mode: "dither", level: 64 }));
	const dark = blackCount(toOneBit(ramp(), { mode: "dither", level: 192 }));
	assert.ok(light < 100 && dark > 156, `light=${light} dark=${dark}`);

	// Transparent pixels count as paper, and invert turns them black.
	const clear = { width: 2, height: 1, data: new Uint8ClampedArray(8) };
	assert.equal(blackCount(toOneBit(clear, { mode: "threshold" })), 0);
	assert.equal(
		blackCount(
			toOneBit(
				{ width: 2, height: 1, data: new Uint8ClampedArray(8) },
				{ mode: "threshold", invert: true },
			),
		),
		2,
	);
});

test("align lines elements up on an edge or centre of their combined bounds", () => {
	const boxes = [
		{ id: "a", x: 2, y: 1, w: 4, h: 2 },
		{ id: "b", x: 10, y: 3, w: 6, h: 4 },
	];
	assert.deepEqual(alignPatches(boxes, "left"), { a: { x: 2 }, b: { x: 2 } });
	assert.deepEqual(alignPatches(boxes, "right"), { a: { x: 12 }, b: { x: 10 } });
	assert.deepEqual(alignPatches(boxes, "center"), { a: { x: 7 }, b: { x: 6 } });
	assert.deepEqual(alignPatches(boxes, "bottom"), { a: { y: 5 }, b: { y: 3 } });
	assert.deepEqual(boundsOf(boxes), { x: 2, y: 1, w: 14, h: 6 });
});

test("distribute evens out the gaps and keeps the outer two in place", () => {
	const boxes = [
		{ id: "c", x: 30, y: 0, w: 2, h: 1 },
		{ id: "a", x: 0, y: 0, w: 4, h: 1 },
		{ id: "b", x: 5, y: 0, w: 6, h: 1 },
	];
	// Span 0..32, widths 12, so two gaps of 10.
	assert.deepEqual(distributePatches(boxes, "x"), { a: { x: 0 }, b: { x: 14 }, c: { x: 30 } });
	assert.deepEqual(distributePatches(boxes.slice(0, 2), "x"), {}, "needs three");
});

test("copies get fresh ids and step aside when they'd land on the original", () => {
	const doc = createDocument();
	const original = createText(doc, { x: 5, y: 2, w: 10, h: 4 });
	doc.elements.push(original);
	const [copy] = placeCopies(doc, [original]);
	assert.notEqual(copy.id, original.id);
	assert.equal(copy.x, original.x + 2);
	assert.equal(copy.y, original.y + 2);
	// Into a label that doesn't have the original (pasting elsewhere), it keeps its place.
	const other = { label: doc.label, elements: [] };
	const [kept] = placeCopies(other, [original]);
	assert.deepEqual([kept.x, kept.y], [original.x, original.y]);
	// Several copies never share an id.
	const many = placeCopies(doc, [original, { ...original, id: "zz", x: 20 }]);
	assert.equal(new Set([...doc.elements, ...many].map((e) => e.id)).size, 4);
});
