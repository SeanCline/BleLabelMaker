import { test } from "node:test";
import assert from "node:assert/strict";
import { pictureFrame } from "../src/painters/image.js";

// A square picture in a wide box: fit leaves bands either side, fill crops top and bottom.
const box = { w: 40, h: 10 };
const square = { w: 100, h: 100 };
const frame = (props) =>
	pictureFrame({ fit: "contain", zoom: 1, panX: 0.5, panY: 0.5, ...props }, box, square);

test("fit, fill and stretch place a picture in its box", () => {
	assert.deepEqual(frame({}), { x: 15, y: 0, w: 10, h: 10 });
	assert.deepEqual(frame({ fit: "cover" }), { x: 0, y: -15, w: 40, h: 40 });
	assert.deepEqual(frame({ fit: "stretch" }), { x: 0, y: 0, w: 40, h: 10 });
});

test("zoom enlarges the fitted or filled picture about where it's panned to", () => {
	assert.deepEqual(frame({ zoom: 2 }), { x: 10, y: -5, w: 20, h: 20 }, "about the middle");
	assert.deepEqual(frame({ zoom: 2, panX: 0, panY: 1 }), { x: 0, y: -10, w: 20, h: 20 });
	// Fill still covers the box at any zoom, so it stays filled when the box is resized.
	assert.deepEqual(frame({ fit: "cover", zoom: 2 }), { x: -20, y: -35, w: 80, h: 80 });
	assert.deepEqual(
		frame({ fit: "stretch", zoom: 3 }),
		frame({ fit: "stretch" }),
		"no zooming a stretch",
	);
});
