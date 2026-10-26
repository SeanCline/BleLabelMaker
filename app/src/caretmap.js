// Where caret positions fall on a text element as the label draws it. The inline editor draws
// its caret and selection from this instead of letting a textarea lay the text out, so they
// follow the label's own line breaks, sizes, rotation and stacking exactly.
import { graphemes, LINE_HEIGHT } from "./layout.js";

/**
 * @typedef {{index: number, x: number}} Stop a caret position and its x, in the box's dots
 * @typedef {{start: number, end: number, top: number, height: number, stops: Stop[]}} CaretLine
 */

/**
 * @param {object} p
 * @param {{lines: string[], sizes: number[], starts: number[], offsets: number[], top: number}}
 *   p.layout from layoutTextBox
 * @param {number} p.width the box's width, in dots
 * @param {"left"|"center"|"right"} p.align
 * @param {(from: number, to: number, size: number) => number} p.measure width of the laid-out
 *   text between two offsets at a font size, as drawn
 * @returns {CaretLine[]}
 */
export const caretMap = ({ layout, width, align, measure }) => {
	let y = layout.top;
	return layout.lines.map((line, i) => {
		const size = layout.sizes[i];
		const start = layout.starts[i];
		const from = layout.offsets[i];
		const full = measure(from, from + line.length, size);
		const left = align === "left" ? 0 : align === "right" ? width - full : (width - full) / 2;
		const stops = [{ index: start, x: left }];
		let prefix = 0;
		for (const g of graphemes(line)) {
			prefix += g.length;
			stops.push({ index: start + prefix, x: left + measure(from, from + prefix, size) });
		}
		const height = size * LINE_HEIGHT;
		const out = { start, end: start + line.length, top: y, height, stops };
		y += height;
		return out;
	});
};

/**
 * The line a caret position is drawn on. Positions the label doesn't draw (spaces dropped at
 * a wrap, line breaks, spaces in stacked text) belong to the line before them.
 */
export const lineOf = (map, index) => {
	let found = 0;
	map.forEach((line, i) => {
		if (line.start <= index) found = i;
	});
	return found;
};

/** The stop at or before `index` on a line. */
const stopOf = (line, index) => {
	let found = line.stops[0];
	for (const s of line.stops) if (s.index <= index) found = s;
	return found;
};

/** Where to draw the caret for a position: x, and the line's top and height. */
export const caretAt = (map, index) => {
	const line = map[lineOf(map, index)];
	return { x: stopOf(line, index).x, top: line.top, height: line.height };
};

/** The caret position nearest a point in the box (dots), as a click would place it. */
export const indexAt = (map, x, y) => {
	let i = map.findIndex((line) => y < line.top + line.height);
	if (i === -1) i = map.length - 1;
	return nearestStop(map[i], x).index;
};

/** The stop on a line closest to x, for clicks and for moving up and down a line. */
export const nearestStop = (line, x) =>
	line.stops.reduce((best, s) => (Math.abs(s.x - x) < Math.abs(best.x - x) ? s : best));

/**
 * Rectangles covering the selection [a, b), one per line it touches. Where it runs on past a
 * line's end (taking the line break with it), the rectangle reaches a little further to say so.
 * @returns {{x: number, top: number, width: number, height: number}[]}
 */
export const selectionRects = (map, a, b) => {
	const rects = [];
	map.forEach((line, i) => {
		if (b <= line.start || a > line.end) return;
		const x0 = stopOf(line, Math.max(a, line.start)).x;
		let x1 = stopOf(line, Math.min(b, line.end)).x;
		// What the label doesn't draw between this line and the next (a line break, a space
		// dropped at the wrap): selected if the selection covers it.
		const next = map[i + 1]?.start ?? Infinity;
		if (next > line.end && b > line.end) x1 += line.height / 4;
		if (x1 > x0) rects.push({ x: x0, top: line.top, width: x1 - x0, height: line.height });
	});
	return rects;
};
