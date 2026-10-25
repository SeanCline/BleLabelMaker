import { test } from "node:test";
import assert from "node:assert/strict";
import { snapTargets, snapMove, snapResize } from "../src/snap.js";

const label = { widthMm: 40, heightMm: 12 };
const area = { x: 1, y: 1.5, w: 38, h: 9 };

test("centre of a box snaps to the label centre within threshold", () => {
	const t = snapTargets(label, area, []);
	const r = snapMove({ x: 15.3, y: 4, w: 10, h: 4 }, t, 0.5);
	assert.equal(r.x, 15); // centre 20.3 → 20
	assert.equal(r.y, 4); // centre 6 is already the label's middle
	assert.deepEqual(
		r.guides.map((g) => [g.axis, g.pos, g.kind]),
		[
			["x", 20, "center"],
			["y", 6, "center"],
		],
	);
});

test("nothing snaps outside the threshold", () => {
	const t = snapTargets(label, area, []);
	const r = snapMove({ x: 13, y: 3.2, w: 10, h: 2 }, t, 0.25);
	assert.deepEqual([r.x, r.y, r.guides.length], [13, 3.2, 0]);
});

test("edges snap to other elements and margins", () => {
	const other = { x: 5, y: 2, w: 8, h: 3 };
	const t = snapTargets(label, area, [other]);
	const r = snapMove({ x: 13.2, y: 7.9, w: 6, h: 2.5 }, t, 0.5);
	assert.equal(r.x, 13); // left edge onto other's right edge
	assert.equal(r.y, 8); // bottom edge 10.4 onto the bottom margin 10.5
});

test("resize snaps only the moving edges and respects minimum size", () => {
	const t = snapTargets(label, area, []);
	const r = snapResize({ x: 10, y: 3, w: 28.8, h: 4 }, "e", t, 0.5, 1);
	assert.equal(r.w, 29); // right edge 38.8 → printable edge 39
	assert.equal(r.x, 10);
	const tiny = snapResize({ x: 19.6, y: 3, w: 0.6, h: 4 }, "w", t, 0.5, 1);
	assert.equal(tiny.x, 19.6, "snapping left edge to 20 would leave 0.2 mm; skipped");
	const nw = snapResize({ x: 1.3, y: 1.2, w: 10, h: 5 }, "nw", t, 0.5, 1);
	assert.deepEqual([nw.x, nw.y, nw.w, nw.h], [1, 1.5, 10.3, 4.7]);
});
