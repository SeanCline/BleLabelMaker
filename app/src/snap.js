/**
 * Smart guides: while dragging, edges and centres snap to the label's edges and centre, the
 * printable margins, and other elements. Pure functions so the maths is unit-testable.
 */

// Results are rounded to 1 µm so float noise (10.299999…) never reaches the document.
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Lines worth snapping to, in mm. */
export const snapTargets = (label, area, others) => {
	const xs = [
		{ pos: 0, kind: "edge" },
		{ pos: label.widthMm, kind: "edge" },
		{ pos: label.widthMm / 2, kind: "center" },
		{ pos: area.x, kind: "margin" },
		{ pos: area.x + area.w, kind: "margin" },
	];
	const ys = [
		{ pos: 0, kind: "edge" },
		{ pos: label.heightMm, kind: "edge" },
		{ pos: label.heightMm / 2, kind: "center" },
		{ pos: area.y, kind: "margin" },
		{ pos: area.y + area.h, kind: "margin" },
	];
	for (const o of others) {
		xs.push(
			{ pos: o.x, kind: "element" },
			{ pos: o.x + o.w / 2, kind: "element" },
			{ pos: o.x + o.w, kind: "element" },
		);
		ys.push(
			{ pos: o.y, kind: "element" },
			{ pos: o.y + o.h / 2, kind: "element" },
			{ pos: o.y + o.h, kind: "element" },
		);
	}
	return { xs, ys };
};

/**
 * Finds the smallest shift (within threshold) that lines up any of `points` with a target.
 * @returns {{shift: number, guide: {pos, kind}|null}}
 */
const bestShift = (points, targets, threshold) => {
	let best = { shift: 0, guide: null, dist: threshold };
	for (const p of points) {
		for (const t of targets) {
			const d = Math.abs(t.pos - p);
			// Prefer exact centre/edge matches over margins and elements when equally close.
			if (d < best.dist || (d === best.dist && best.guide && rank(t) < rank(best.guide))) {
				best = { shift: t.pos - p, guide: t, dist: d };
			}
		}
	}
	return best;
};
const RANK = { center: 0, edge: 1, margin: 2, element: 3 };
const rank = (t) => RANK[t.kind];

/**
 * Snaps a moved box. Each axis snaps independently: a box can align its centre to the label
 * centre horizontally while its top lines up with another element.
 * @returns {{x: number, y: number, snappedX: boolean, snappedY: boolean,
 *   guides: Array<{axis: "x"|"y", pos: number, kind: string}>}}
 */
export const snapMove = (box, targets, threshold) => {
	const sx = bestShift([box.x, box.x + box.w / 2, box.x + box.w], targets.xs, threshold);
	const sy = bestShift([box.y, box.y + box.h / 2, box.y + box.h], targets.ys, threshold);
	const guides = [];
	if (sx.guide) guides.push({ axis: "x", pos: sx.guide.pos, kind: sx.guide.kind });
	if (sy.guide) guides.push({ axis: "y", pos: sy.guide.pos, kind: sy.guide.kind });
	return {
		x: r3(box.x + sx.shift),
		y: r3(box.y + sy.shift),
		guides,
		snappedX: !!sx.guide,
		snappedY: !!sy.guide,
	};
};

/**
 * Snaps only the edges a resize handle moves (e.g. "se" moves right and bottom). An edge
 * snap that would shrink the box below minSize is skipped.
 * @returns {{x, y, w, h, guides, snappedX, snappedY}}
 */
export const snapResize = (box, dir, targets, threshold, minSize) => {
	let { x, y, w, h } = box;
	const guides = [];
	let snappedX = false;
	let snappedY = false;
	const nearest = (value, list) => bestShift([value], list, threshold);

	if (dir.includes("e")) {
		const s = nearest(x + w, targets.xs);
		if (s.guide && w + s.shift >= minSize) {
			w += s.shift;
			guides.push({ axis: "x", pos: s.guide.pos, kind: s.guide.kind });
			snappedX = true;
		}
	} else if (dir.includes("w")) {
		const s = nearest(x, targets.xs);
		if (s.guide && w - s.shift >= minSize) {
			x += s.shift;
			w -= s.shift;
			guides.push({ axis: "x", pos: s.guide.pos, kind: s.guide.kind });
			snappedX = true;
		}
	}
	if (dir.includes("s")) {
		const s = nearest(y + h, targets.ys);
		if (s.guide && h + s.shift >= minSize) {
			h += s.shift;
			guides.push({ axis: "y", pos: s.guide.pos, kind: s.guide.kind });
			snappedY = true;
		}
	} else if (dir.includes("n")) {
		const s = nearest(y, targets.ys);
		if (s.guide && h - s.shift >= minSize) {
			y += s.shift;
			h -= s.shift;
			guides.push({ axis: "y", pos: s.guide.pos, kind: s.guide.kind });
			snappedY = true;
		}
	}
	return { x: r3(x), y: r3(y), w: r3(w), h: r3(h), guides, snappedX, snappedY };
};
