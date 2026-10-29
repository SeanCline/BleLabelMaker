import { LIMITS, printableArea, boundsOf } from "../model.js";
import { renderLabel, QUARTER } from "../render.js";
import { pictureFrame, pictureSize } from "../painters/image.js";
import { fillDocument } from "../fields.js";
import { ensureFontsFor } from "../fonts.js";
import { clamp, round } from "../units.js";
import { textOf } from "../richtext.js";
import { currentScale, onModelChange } from "./settings.js";
import { snapTargets, snapMove, snapResize } from "../snap.js";
import { $, el, DRAG_SLACK_PX } from "./dom.js";
import { describeLabel } from "./describe.js";
import { sizeStage, placeStyle, pct } from "./viewport.js";
import { inlineEdit, relayoutInline, startInlineEdit, onEditingChange } from "./inline-editor.js";
import {
	state,
	history,
	select,
	setSelection,
	toggleSelected,
	isSelected,
	selectedElements,
	updateElement,
	updateElements,
	elementById,
	subscribe,
} from "./store.js";

export const SNAP_MM = 0.25;
// Guides grab within this many screen pixels, whatever the zoom.
const GUIDE_PX = 6;

const canvas = $("#labelCanvas");
const paper = $("#paper");
const overlay = $("#overlay");

// ---------------------------------------------------------------------------
// Canvas

let renderToken = 0;
let fitted = new Map();
let warnings = new Map();
const drawnListeners = new Set();

/** Font sizes (pt) chosen by fit-to-box in the last render, keyed by element id. */
export const fittedSizes = () => fitted;
/** Per-element problems from the last render (e.g. a barcode too narrow to scan). */
export const renderWarnings = () => warnings;
export const onDrawn = (fn) => drawnListeners.add(fn);
export const labelCanvas = () => canvas;

/** @type {() => import("../fields.js").FieldContext} */
let fieldContext = () => ({ now: new Date(), n: 1, row: null, columns: null });
/**
 * Sets what fields show on the preview (the batch row being previewed, the next counter
 * value). The print code fills each label itself.
 */
export const setFieldContext = (fn) => {
	fieldContext = fn;
	scheduleCanvas();
};

/** The document as the preview shows it: fields filled in for the row and number in view. */
export const previewDocument = () =>
	// The text being typed on the label stays as typed, so the caret lines up with it.
	fillDocument(state.doc, fieldContext(), { except: inlineEdit()?.id });

// The newest render. One that a newer render overtakes resolves with it instead, so waiting on
// any render waits until the canvas shows the document as it is now.
let latestRender = Promise.resolve();

/** Resolves once the canvas shows the current document with its real fonts. */
export const drawCanvas = () => (latestRender = render());

const render = async () => {
	const token = ++renderToken;
	const doc = previewDocument();
	await ensureFontsFor(doc);
	if (token !== renderToken) return latestRender;
	// Off-screen first: a render that waits on an image can overlap a newer one, and two
	// renders sharing the visible canvas would leave pieces of the older label on it.
	const scratch = document.createElement("canvas");
	const result = await renderLabel(doc, scratch, { dots: currentScale() });
	if (token !== renderToken) return latestRender;
	({ fittedSizes: fitted, warnings } = result);
	if (canvas.width !== scratch.width) canvas.width = scratch.width;
	if (canvas.height !== scratch.height) canvas.height = scratch.height;
	canvas.getContext("2d", { willReadFrequently: true }).drawImage(scratch, 0, 0);
	canvas.setAttribute("aria-label", describeLabel(doc));
	// A picture's size is known once it's drawn, and with it where its pan handle goes.
	const picked = elementById(state.selectedId);
	if (picked?.type === "image") syncBox(picked, state.doc.label);
	sizeStage();
	// The editor was laid out when the text changed, perhaps before a newly picked font had
	// loaded or before the label's new length set its scale; now both are settled.
	relayoutInline();
	for (const fn of drawnListeners) fn();
};

let queued = false;
// Another model may print at another resolution, which the preview shows.
onModelChange(() => scheduleCanvas());
export const scheduleCanvas = () => {
	if (queued) return;
	queued = true;
	requestAnimationFrame(() => {
		queued = false;
		drawCanvas();
	});
};

// ---------------------------------------------------------------------------
// Overlay: printable-area guide, selection boxes, handles

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

// Overlay layers are created once. Boxes are updated in place, keyed by id: replacing the
// element under the pointer mid-gesture makes Chrome drop the click/dblclick that follows.
const guideEl = el("div", { className: "guide", title: "Printable area" });
const snapLayer = el("div", { className: "layer" });
const boxLayer = el("div", { className: "layer boxes" });
overlay.append(guideEl, snapLayer, boxLayer);
const boxEls = new Map();

/**
 * Where a picture's pan handle goes: on the picture's centre, kept inside the box, in mm from
 * the box's corner. Null when there's no room to pan it, or its size isn't known yet. `slack`
 * is the room in the picture's own frame (negative when it's cropped), and `turn` maps a
 * movement on the label into that frame.
 */
const panSpot = (e) => {
	const size = e.type === "image" && e.fit !== "stretch" && pictureSize(e.src);
	if (!size) return null;
	const quarter = ((e.rotation ?? 0) / 90) % 4;
	const local = quarter % 2 ? { w: e.h, h: e.w } : { w: e.w, h: e.h };
	const f = pictureFrame(e, local, size);
	const slack = { x: local.w - f.w, y: local.h - f.h };
	if (Math.abs(slack.x) < 0.05 && Math.abs(slack.y) < 0.05) return null;
	const cx = clamp(f.x + f.w / 2, 0, local.w);
	const cy = clamp(f.y + f.h / 2, 0, local.h);
	const [a, b, c, d, tx, ty] = QUARTER[quarter](e.w, e.h);
	return { x: a * cx + c * cy + tx, y: b * cx + d * cy + ty, slack, turn: [a, b, c, d] };
};

const syncBox = (e, label) => {
	let box = boxEls.get(e.id);
	if (!box) {
		box = el("div", { className: "box", dataset: { id: e.id } });
		boxEls.set(e.id, box);
	}
	const isSel = isSelected(e.id);
	box.classList.toggle("selected", isSel);
	Object.assign(box.style, placeStyle(e, label));
	const hasHandles = box.firstChild !== null;
	// Resize handles only on a lone selection; a group moves but doesn't resize.
	const wantHandles = e.id === state.selectedId;
	if (wantHandles && !hasHandles)
		box.append(...HANDLES.map((dir) => el("div", { className: "handle", dataset: { dir } })));
	if (!wantHandles && hasHandles) box.replaceChildren();
	const spot = wantHandles && panSpot(e);
	let pan = box.querySelector(".pan");
	if (spot && !pan) {
		pan = el("div", {
			className: "pan",
			title: "Drag to move the picture in its box",
			dataset: { dir: "pan" },
		});
		box.append(pan);
	}
	if (spot) Object.assign(pan.style, { left: pct(spot.x, e.w), top: pct(spot.y, e.h) });
	else pan?.remove();
	return box;
};

const renderOverlay = () => {
	const label = state.doc.label;
	paper.classList.toggle("continuous", label.continuous);
	Object.assign(guideEl.style, placeStyle(printableArea(label), label));

	snapLayer.replaceChildren(
		...activeGuides.map((g) =>
			el("div", {
				className: `snapline ${g.axis}`,
				style:
					g.axis === "x"
						? { left: pct(g.pos, label.widthMm) }
						: { top: pct(g.pos, label.heightMm) },
			}),
		),
	);

	const elements = state.doc.elements;
	const live = new Set(elements.map((e) => e.id));
	for (const [id, box] of boxEls) {
		if (!live.has(id)) {
			box.remove();
			boxEls.delete(id);
		}
	}
	// Re-appending existing nodes in z-order moves them without recreating them.
	elements.forEach((e, i) => {
		const box = syncBox(e, label);
		if (boxLayer.children[i] !== box) boxLayer.insertBefore(box, boxLayer.children[i] ?? null);
	});

	relayoutInline(overlay);
};

// ---------------------------------------------------------------------------
// Drag / resize

let drag = null;
let dragSeq = 0;
let activeGuides = [];
const marqueeEl = el("div", { className: "marquee", hidden: true });
overlay.append(marqueeEl);

const overlayMm = (ev) => {
	const rect = overlay.getBoundingClientRect();
	const mmPerPx = state.doc.label.widthMm / rect.width;
	return { x: (ev.clientX - rect.left) * mmPerPx, y: (ev.clientY - rect.top) * mmPerPx, mmPerPx };
};

overlay.addEventListener("pointerdown", (ev) => {
	if (ev.button !== 0) return;
	// So arrow keys, R and Delete act on what was just clicked, not on a panel field.
	overlay.focus({ preventScroll: true });
	// The preventDefault below keeps the browser from clearing a text selection elsewhere on
	// the page, and a selection left there would make Ctrl+C copy it instead of the elements.
	document.getSelection()?.removeAllRanges();
	const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
	const at = overlayMm(ev);
	const boxEl = ev.target.closest(".box");
	if (!boxEl) {
		// Empty space: drag out a box to select what it touches.
		drag = { kind: "marquee", start: at, additive, base: additive ? state.selectedIds : [] };
		overlay.setPointerCapture(ev.pointerId);
		ev.preventDefault();
		return;
	}
	const id = boxEl.dataset.id;
	if (ev.target.dataset.dir === "pan" && !additive) {
		// The dot is only ever on a picture.
		const e = /** @type {import("../model.js").ImageElement} */ (elementById(id));
		const spot = panSpot(e);
		drag = {
			kind: "pan",
			id,
			startX: ev.clientX,
			startY: ev.clientY,
			mmPerPx: at.mmPerPx,
			orig: { panX: e.panX, panY: e.panY },
			slack: spot.slack,
			turn: spot.turn,
			group: `drag-${++dragSeq}`,
			moved: false,
		};
		overlay.setPointerCapture(ev.pointerId);
		ev.preventDefault();
		return;
	}
	// A finger can't double-click comfortably: tapping text that's already selected types on it.
	const tapToType =
		ev.pointerType !== "mouse" &&
		!additive &&
		state.selectedId === id &&
		elementById(id).type === "text";
	if (additive) {
		toggleSelected(id);
		if (!isSelected(id)) return; // just took it out of the selection
	} else if (!isSelected(id)) {
		select(id);
	}
	const dir = ev.target.dataset.dir ?? "move";
	// Handles only exist on a lone selection, so a resize is always one element.
	const moving = dir === "move" ? selectedElements() : [elementById(id)];
	const ids = moving.map((e) => e.id);
	drag = {
		kind: dir === "move" ? "move" : "resize",
		id,
		dir,
		startX: ev.clientX,
		startY: ev.clientY,
		mmPerPx: at.mmPerPx,
		orig: Object.fromEntries(moving.map((e) => [e.id, { x: e.x, y: e.y, w: e.w, h: e.h }])),
		bounds: boundsOf(moving),
		group: `drag-${++dragSeq}`,
		tapToType,
		moved: false,
		targets: snapTargets(
			state.doc.label,
			printableArea(state.doc.label),
			state.doc.elements.filter((o) => !ids.includes(o.id)),
		),
	};
	overlay.setPointerCapture(ev.pointerId);
	ev.preventDefault();
});

const updateMarquee = (ev) => {
	const at = overlayMm(ev);
	const r = {
		x: Math.min(at.x, drag.start.x),
		y: Math.min(at.y, drag.start.y),
		w: Math.abs(at.x - drag.start.x),
		h: Math.abs(at.y - drag.start.y),
	};
	// Ignore jitter so a plain click on empty space still just clears the selection.
	if (r.w / at.mmPerPx < 3 && r.h / at.mmPerPx < 3) return;
	drag.moved = true;
	marqueeEl.hidden = false;
	Object.assign(marqueeEl.style, placeStyle(r, state.doc.label));
	const touched = state.doc.elements
		.filter((e) => e.x < r.x + r.w && e.x + e.w > r.x && e.y < r.y + r.h && e.y + e.h > r.y)
		.map((e) => e.id);
	setSelection([...new Set([...drag.base, ...touched])]);
};

/** Moves the whole selection; snapping and the grid apply to its combined bounds. */
const moveSelection = (dx, dy, free, grid, threshold) => {
	const b = drag.bounds;
	let x = b.x + dx;
	let y = b.y + dy;
	const s = free ? null : snapMove({ ...b, x, y }, drag.targets, threshold);
	x = s?.snappedX ? s.x : grid(x);
	y = s?.snappedY ? s.y : grid(y);
	// Allow hanging off the edge a little (bleed), but never so far it can't be grabbed again.
	const { widthMm, heightMm } = state.doc.label;
	x = clamp(x, -b.w + 1, widthMm - 1);
	y = clamp(y, -b.h + 1, heightMm - 1);
	activeGuides = s?.guides ?? [];
	const patches = {};
	for (const [id, o] of Object.entries(drag.orig)) {
		patches[id] = { x: round(o.x + x - b.x, 3), y: round(o.y + y - b.y, 3) };
	}
	updateElements(patches, drag.group);
};

/**
 * Moves a picture inside its box by as much as the pointer moved, as far as it goes, snapping
 * to the middle and the edges.
 */
const panPicture = (dx, dy, free, threshold) => {
	// Into the picture's own frame, which a rotated box turns.
	const [a, b, c, d] = drag.turn;
	const along = (p, delta, slack) => {
		if (Math.abs(slack) < 0.05) return p;
		let to = clamp(p + delta / slack, 0, 1);
		if (!free) for (const t of [0, 0.5, 1]) if (Math.abs((to - t) * slack) < threshold) to = t;
		return round(to, 4);
	};
	updateElement(
		drag.id,
		{
			panX: along(drag.orig.panX, a * dx + b * dy, drag.slack.x),
			panY: along(drag.orig.panY, c * dx + d * dy, drag.slack.y),
		},
		drag.group,
	);
};

overlay.addEventListener("pointermove", (ev) => {
	if (!drag) return;
	if (drag.kind === "marquee") return updateMarquee(ev);
	// A few pixels of slack, so a tap or click doesn't shift what it lands on.
	if (!drag.moved && Math.hypot(ev.clientX - drag.startX, ev.clientY - drag.startY) < DRAG_SLACK_PX)
		return;
	drag.moved = true;
	// Alt turns off all snapping, for fine placement.
	const free = ev.altKey;
	const grid = (v) => (free ? round(v, 3) : Math.round(v / SNAP_MM) * SNAP_MM);
	const dx = (ev.clientX - drag.startX) * drag.mmPerPx;
	const dy = (ev.clientY - drag.startY) * drag.mmPerPx;
	const threshold = GUIDE_PX * drag.mmPerPx;
	if (drag.kind === "move") return moveSelection(dx, dy, free, grid, threshold);
	if (drag.kind === "pan") return panPicture(dx, dy, free, threshold);

	const o = drag.orig[drag.id];
	const min = LIMITS.elementMinMm;
	let { x, y, w, h } = o;
	if (drag.dir.includes("e")) w = Math.max(min, o.w + dx);
	if (drag.dir.includes("s")) h = Math.max(min, o.h + dy);
	if (drag.dir.includes("w")) {
		x = Math.min(o.x + dx, o.x + o.w - min);
		w = o.x + o.w - x;
	}
	if (drag.dir.includes("n")) {
		y = Math.min(o.y + dy, o.y + o.h - min);
		h = o.y + o.h - y;
	}
	const s = free ? null : snapResize({ x, y, w, h }, drag.dir, drag.targets, threshold, min);
	if (s) ({ x, y, w, h } = s);
	// Edges that didn't land on a guide still snap to the grid.
	if (!s?.snappedX) {
		if (drag.dir.includes("w")) {
			const right = x + w;
			x = Math.min(grid(x), right - min);
			w = right - x;
		} else if (drag.dir.includes("e")) w = Math.max(min, grid(x + w) - x);
	}
	if (!s?.snappedY) {
		if (drag.dir.includes("n")) {
			const bottom = y + h;
			y = Math.min(grid(y), bottom - min);
			h = bottom - y;
		} else if (drag.dir.includes("s")) h = Math.max(min, grid(y + h) - y);
	}
	const { widthMm, heightMm } = state.doc.label;
	x = clamp(x, -w + 1, widthMm - 1);
	y = clamp(y, -h + 1, heightMm - 1);
	activeGuides = s?.guides ?? [];
	updateElement(
		drag.id,
		{ x: round(x, 3), y: round(y, 3), w: round(w, 3), h: round(h, 3) },
		drag.group,
	);
});

const endDrag = () => {
	if (!drag) return;
	const wasClick = drag.kind === "marquee" && !drag.moved;
	const tapped = drag.tapToType && !drag.moved ? drag.id : null;
	if (wasClick && !drag.additive) select(null);
	drag = null;
	marqueeEl.hidden = true;
	activeGuides = [];
	renderOverlay();
	history.seal();
	if (tapped) {
		const end = textOf(
			/** @type {import("../model.js").TextElement} */ (elementById(tapped)).text,
		).length;
		startInlineEdit(tapped, { start: end, end });
	}
};
overlay.addEventListener("pointerup", endDrag);
overlay.addEventListener("pointercancel", endDrag);

overlay.addEventListener("dblclick", (ev) => {
	// The drag code captures the pointer, so the dblclick targets the overlay; the first click
	// selected the box.
	const id = ev.target.closest(".box")?.dataset.id ?? state.selectedId;
	const e = id && elementById(id);
	if (!e) return;
	if (e.type === "text") {
		startInlineEdit(id);
	} else {
		const field = $(`#quickbar [data-qb="${e.type}"] [data-prop]`);
		field?.focus();
		field?.select?.();
	}
});

subscribe(() => {
	renderOverlay();
	scheduleCanvas();
});
// Typing starts with the fields in that text shown as typed, and ends with them filled in.
onEditingChange(() => {
	renderOverlay();
	scheduleCanvas();
});
