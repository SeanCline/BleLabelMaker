import { LIMITS, printableArea, boundsOf } from "../model.js";
import { renderLabel, layoutTextBox } from "../render.js";
import { fillDocument } from "../fields.js";
import { ensureFontsFor } from "../fonts.js";
import { clamp, round, mmToDots } from "../units.js";
import { caretMap, caretAt, indexAt, lineOf, nearestStop, selectionRects } from "../caretmap.js";
import { cssFont, fontInfo, nearestWeight } from "../fonts.js";
import {
	applyEdit,
	diffText,
	setStyle,
	spansBetween,
	spliceSpans,
	stylesBetween,
	textOf,
	typingStyle,
} from "../richtext.js";
import { isFormatted, parseHtml, spansForBox, spansFromHtml, toHtml } from "../htmltext.js";
import { snapTargets, snapMove, snapResize } from "../snap.js";
import { $, el } from "./dom.js";
import { describeLabel } from "./describe.js";
import { rememberCaret } from "./caret.js";
import { sizeStage } from "./viewport.js";
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
const DRAG_SLACK_PX = 4;

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
	fillDocument(state.doc, fieldContext(), { except: inline?.id });

/** Resolves once the canvas shows the current document with its real fonts. */
export const drawCanvas = async () => {
	const token = ++renderToken;
	const doc = previewDocument();
	await ensureFontsFor(doc);
	if (token !== renderToken) return;
	// Off-screen first: a render that waits on an image can overlap a newer one, and two
	// renders sharing the visible canvas would leave pieces of the older label on it.
	const scratch = document.createElement("canvas");
	const result = await renderLabel(doc, scratch);
	if (token !== renderToken) return;
	({ fittedSizes: fitted, warnings } = result);
	if (canvas.width !== scratch.width) canvas.width = scratch.width;
	if (canvas.height !== scratch.height) canvas.height = scratch.height;
	canvas.getContext("2d", { willReadFrequently: true }).drawImage(scratch, 0, 0);
	canvas.setAttribute("aria-label", describeLabel(doc));
	sizeStage();
	for (const fn of drawnListeners) fn();
};

let queued = false;
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

const pct = (v, total) => `${(v / total) * 100}%`;
const placeStyle = ({ x, y, w, h }, { widthMm, heightMm }) => ({
	left: pct(x, widthMm),
	top: pct(y, heightMm),
	width: pct(w, widthMm),
	height: pct(h, heightMm),
});

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

// Overlay layers are created once. Boxes are updated in place, keyed by id: replacing the
// element under the pointer mid-gesture makes Chrome drop the click/dblclick that follows.
const guideEl = el("div", { className: "guide", title: "Printable area" });
const snapLayer = el("div", { className: "layer" });
const boxLayer = el("div", { className: "layer boxes" });
overlay.append(guideEl, snapLayer, boxLayer);
const boxEls = new Map();

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

	if (inline) {
		const e = elementById(inline.id);
		if (e) positionInline(e);
		if (!inline.frame.isConnected) overlay.append(inline.frame);
	}
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

// ---------------------------------------------------------------------------
// Inline text editing. A hidden textarea takes the typing (so paste, undo, spellcheck and
// input methods work as usual), but nothing of its own layout shows: the canvas underneath is
// the text you read, and the caret and selection are drawn from the renderer's own layout
// (caretmap.js). So they follow the label's line breaks, and work the same on rotated,
// stacked and mixed-size text, which a textarea can't lay out. An earlier version showed the
// textarea's own caret, which drifted wherever its wrapping differed from the label's.

let inline = null;

const inlineListeners = new Set();
/** Runs when typing on the label starts, stops, or its selection moves (the quick bar). */
export const onInlineChange = (fn) => inlineListeners.add(fn);
const inlineChanged = () => {
	for (const fn of inlineListeners) fn();
};
/** What's being typed on the label, if anything. */
export const inlineEdit = () =>
	inline && {
		id: inline.id,
		from: inline.textarea.selectionStart,
		to: inline.textarea.selectionEnd,
		pending: inline.pending,
	};
/** Back to typing, after a quick bar control took the focus. */
export const refocusInline = () => inline?.textarea.focus({ preventScroll: true });

const measureCtx = document.createElement("canvas").getContext("2d");

// The element's local frame inside its box, as the renderer turns it (QUARTER in render.js).
const QUARTER_CSS = [
	() => [1, 0, 0, 1, 0, 0],
	(w) => [0, 1, -1, 0, w, 0],
	(w, h) => [-1, 0, 0, -1, w, h],
	(_w, h) => [0, -1, 1, 0, 0, h],
];
/** A point in the box (dots, as on the label) in the element's local frame. */
const toLocal = (quarter, w, h, x, y) =>
	[() => [x, y], () => [y, w - x], () => [w - x, h - y], () => [h - y, x]][quarter]();

const positionInline = (e) => {
	const dot = parseFloat(getComputedStyle(paper).getPropertyValue("--dot")) || 1;
	const box = { w: Math.round(mmToDots(e.w)), h: Math.round(mmToDots(e.h)) };
	const quarter = ((e.rotation ?? 0) / 90) % 4;
	const local = quarter % 2 ? { w: box.h, h: box.w } : box;
	// The same layout the renderer uses, computed now rather than taken from the last render,
	// which lags a frame behind typing.
	const layout = layoutTextBox(measureCtx, e, local);
	Object.assign(inline, {
		map: caretMap({ layout, width: local.w, align: e.align, measure: layout.measure }),
		quarter,
		box,
		dot,
	});
	Object.assign(inline.frame.style, placeStyle(e, state.doc.label));
	const [a, b, c, d, tx, ty] = QUARTER_CSS[quarter](box.w, box.h);
	Object.assign(inline.local.style, {
		width: `${local.w * dot}px`,
		height: `${local.h * dot}px`,
		transform: `matrix(${a}, ${b}, ${c}, ${d}, ${tx * dot}, ${ty * dot})`,
	});
	inline.frame.classList.toggle("invert", !!e.invert);
	// Input methods put their candidate window by the textarea's caret.
	inline.textarea.style.font = cssFont(e, layout.fontSize * dot);
	drawCaret();
};

/** Shows the textarea's selection on the label's layout. */
const drawCaret = () => {
	if (!inline?.map) return;
	const { textarea, map, dot, caret, selection } = inline;
	const { selectionStart: a, selectionEnd: b } = textarea;
	const px = (v) => `${v * dot}px`;
	const at = caretAt(map, focusOf(textarea));
	caret.hidden = a !== b;
	Object.assign(caret.style, { left: px(at.x), top: px(at.top), height: px(at.height) });
	// Restart the blink, so the caret is visible the moment it moves.
	caret.classList.remove("blink");
	void caret.offsetWidth;
	caret.classList.add("blink");
	Object.assign(textarea.style, { left: px(at.x), top: px(at.top), height: px(at.height) });
	selection.replaceChildren(
		...selectionRects(map, a, b).map((r) =>
			el("div", {
				style: { left: px(r.x), top: px(r.top), width: px(r.width), height: px(r.height) },
			}),
		),
	);
	// Markers in the text's own frame, which turns with it, say where the handles go.
	for (const [end, index] of [
		["start", a],
		["end", b],
	]) {
		const p = caretAt(map, index);
		const { foot, aim } = inline.handles[end];
		Object.assign(foot.style, { left: px(p.x), top: px(p.top + p.height) });
		Object.assign(aim.style, { left: px(p.x), top: px(p.top + p.height / 2) });
	}
	placeHandles();
	inlineChanged();
};

/**
 * A finger covers the caret, so it gets handles to drag, as phones give their own text: one
 * under the caret, or one at each end of a selection. They're over the page rather than in
 * the label, which would cut them off below its edge.
 */
const placeHandles = () => {
	if (!inline) return;
	const { selectionStart: a, selectionEnd: b } = inline.textarea;
	const touch = lastPointer !== "mouse";
	const shownFor = { start: touch && a !== b, end: touch };
	for (const [end, shown] of Object.entries(shownFor)) {
		const { handle, foot } = inline.handles[end];
		handle.hidden = !shown;
		if (!shown) continue;
		const r = foot.getBoundingClientRect();
		Object.assign(handle.style, { left: `${r.left}px`, top: `${r.top}px` });
	}
};

// Whether the last press was a mouse, a finger or a pen: only fingers and pens get handles.
let lastPointer = matchMedia("(pointer: coarse)").matches ? "touch" : "mouse";
document.addEventListener("pointerdown", (ev) => (lastPointer = ev.pointerType), true);

/** Taps in a row on the same spot, for double- and triple-tap; a mouse counts its own. */
let tapRun = { count: 0, time: 0, x: 0, y: 0 };
const tapCount = (ev) => {
	if (ev.pointerType === "mouse") return ev.detail;
	const near = Math.hypot(ev.clientX - tapRun.x, ev.clientY - tapRun.y) < 24;
	const count = near && ev.timeStamp - tapRun.time < 400 ? tapRun.count + 1 : 1;
	tapRun = { count, time: ev.timeStamp, x: ev.clientX, y: ev.clientY };
	return count;
};
const LONG_PRESS_MS = 500;

/** The end of the selection that moves: where the caret is. */
const focusOf = (t) => (t.selectionDirection === "backward" ? t.selectionStart : t.selectionEnd);
const anchorOf = (t) => (t.selectionDirection === "backward" ? t.selectionEnd : t.selectionStart);
/** Moves the caret to `index`, keeping the anchor when extending a selection. */
const moveCaret = (index, extend) => {
	const t = inline.textarea;
	const anchor = extend ? anchorOf(t) : index;
	if (index < anchor) t.setSelectionRange(index, anchor, "backward");
	else t.setSelectionRange(anchor, index, "forward");
	drawCaret();
};

/** The caret position under a pointer event, through the element's rotation. */
const indexFromEvent = (ev) => {
	const { frame, box, quarter, map } = inline;
	const rect = frame.getBoundingClientRect();
	const x = ((ev.clientX - rect.left) / rect.width) * box.w;
	const y = ((ev.clientY - rect.top) / rect.height) * box.h;
	const [lx, ly] = toLocal(quarter, box.w, box.h, x, y);
	return indexAt(map, lx, ly);
};

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: "word" });
/** The word (or run of spaces) around a position, as a double-click selects. */
const wordAround = (text, index) => {
	for (const s of wordSegmenter.segment(text)) {
		if (index < s.index + s.segment.length) return [s.index, s.index + s.segment.length];
	}
	return [index, index];
};

/** Up, down, Home and End go by the label's lines, which only the caret map knows. */
const lineKey = (key) => {
	const { map, textarea } = inline;
	const focus = focusOf(textarea);
	const i = lineOf(map, focus);
	if (key === "Home") return map[i].start;
	if (key === "End") return map[i].end;
	const to = i + (key === "ArrowUp" ? -1 : 1);
	if (to < 0) return 0;
	if (to >= map.length) return textarea.value.length;
	// Keep to the column the caret started from, across short lines.
	inline.goalX ??= caretAt(map, focus).x;
	return nearestStop(map[to], inline.goalX).index;
};

// Ctrl+B, I and U format what's selected, or with nothing selected, what's typed next.
const STYLE_KEYS = { b: "fontWeight", i: "italic", u: "underline" };
const BOLD = 600;

export const toggleStyle = (prop) => {
	const e = /** @type {import("../model.js").TextElement} */ (elementById(inline.id));
	if (prop === "italic" && !(fontInfo(e.fontFamily)?.italic ?? true)) return;
	const { selectionStart: a, selectionEnd: b } = inline.textarea;
	const pending = a === b && inline.pending?.at === a ? inline.pending.style : {};
	const looks = stylesBetween(e.text, a, b, e).map((s) => ({ ...s, ...pending }));
	const on =
		prop === "fontWeight"
			? !looks.every((s) => s.fontWeight >= BOLD)
			: !looks.every((s) => s[prop]);
	// Unbolding goes back to the box's weight, unless the box itself is bold.
	const value =
		prop === "fontWeight"
			? nearestWeight(e.fontFamily, on ? 700 : e.fontWeight < BOLD ? e.fontWeight : 400)
			: on;
	if (a === b) {
		inline.pending = { at: a, style: { ...typingStyle(e.text, a), ...pending, [prop]: value } };
		inlineChanged();
		return;
	}
	// Its own undo step, apart from the typing around it.
	history.seal();
	updateElement(e.id, { text: setStyle(e.text, a, b, prop, value) });
	history.seal();
};

/** @param {{start: number, end: number}} [caret] where to put the cursor; default selects all */
export const startInlineEdit = (id, caret) => {
	const e = elementById(id);
	if (!e || e.type !== "text") return;
	stopInlineEdit();
	const textarea = el("textarea", {
		className: "inline-edit",
		value: textOf(e.text),
		spellcheck: true,
		"aria-label": "Label text",
	});
	const caretEl = el("div", { className: "inline-caret blink" });
	const selection = el("div", { className: "inline-selection" });
	// Each handle hangs from its line's foot, and moves the caret to wherever its aim, in the
	// middle of the line, is: so the finger can be below the text it's moving through.
	const handleFor = (end) => ({
		handle: el("div", { className: `inline-handle ${end}`, hidden: true, "aria-hidden": "true" }),
		foot: el("div", { className: "inline-marker" }),
		aim: el("div", { className: "inline-marker" }),
	});
	const handles = { start: handleFor("start"), end: handleFor("end") };
	const local = el(
		"div",
		{ className: "inline-local" },
		selection,
		caretEl,
		textarea,
		...Object.values(handles).flatMap((h) => [h.foot, h.aim]),
	);
	document.body.append(handles.start.handle, handles.end.handle);
	const frame = el("div", { className: "inline-editor" }, local);
	inline = {
		id,
		textarea,
		frame,
		local,
		caret: caretEl,
		selection,
		handles,
		group: `inline-${++dragSeq}`,
		goalX: null,
		/** @type {{at: number, style: import("../richtext.js").Style} | null} */
		pending: null,
		/** @type {{at: number, removed: number, value: string, spans: import("../richtext.js").Span[]} | null} */
		pasting: null,
	};
	textarea.addEventListener("input", () => {
		inline.goalX = null;
		const current = /** @type {import("../model.js").TextElement} */ (elementById(id));
		const edit = diffText(textOf(current.text), textarea.value, textarea.selectionEnd);
		const style = inline.pending?.at === edit.at ? inline.pending.style : undefined;
		const { pasting } = inline;
		inline.pending = inline.pasting = null;
		// Checked against the whole value, as a diff can't tell where a paste that begins like
		// what it replaced went in.
		const text =
			pasting?.value === textarea.value
				? spliceSpans(current.text, pasting.at, pasting.removed, pasting.spans)
				: applyEdit(current.text, edit, style);
		updateElement(id, { text }, inline.group);
	});
	// The clipboard gets the selection's formatting as HTML, beside the plain text, and HTML
	// pasted keeps its bold, italic and underline. The text still goes in through the textarea
	// (execCommand), so its own undo takes a paste back like any typing.
	const copy = (ev) => {
		const { selectionStart: a, selectionEnd: b } = textarea;
		if (a === b) return false;
		const e = /** @type {import("../model.js").TextElement} */ (elementById(id));
		const base = { fontWeight: e.fontWeight, italic: !!e.italic, underline: !!e.underline };
		ev.clipboardData.setData("text/plain", textarea.value.slice(a, b));
		ev.clipboardData.setData("text/html", toHtml(spansBetween(e.text, a, b), base));
		ev.preventDefault();
		return true;
	};
	textarea.addEventListener("copy", copy);
	textarea.addEventListener("cut", (ev) => {
		if (copy(ev)) document.execCommand("delete");
	});
	textarea.addEventListener("paste", (ev) => {
		const html = ev.clipboardData.getData("text/html");
		if (!html) return;
		const spans = spansFromHtml(parseHtml(html));
		// Plain from the HTML is plain from the text beside it, which the browser pastes better.
		if (!isFormatted(spans)) return;
		ev.preventDefault();
		const { selectionStart: a, selectionEnd: b, value } = textarea;
		const inserted = spans.map((p) => p.text).join("");
		inline.pasting = {
			at: a,
			removed: b - a,
			value: value.slice(0, a) + inserted + value.slice(b),
			spans: spansForBox(spans, /** @type {import("../model.js").TextElement} */ (elementById(id))),
		};
		document.execCommand("insertText", false, inserted);
	});
	textarea.addEventListener("blur", (ev) => {
		rememberCaret(id, textarea, "inline");
		// The bar's fields set the font or insert a field while typing, and the settings the
		// weight; typing goes on.
		if (/** @type {Element} */ (ev.relatedTarget)?.closest?.("#quickbar, #settings")) return;
		stopInlineEdit();
	});
	textarea.addEventListener("keydown", (ev) => {
		if (ev.key === "Escape") {
			ev.stopPropagation();
			stopInlineEdit();
			return;
		}
		const style = (ev.ctrlKey || ev.metaKey) && !ev.altKey && STYLE_KEYS[ev.key.toLowerCase()];
		if (style) {
			ev.preventDefault();
			toggleStyle(style);
			return;
		}
		const vertical = ev.key === "ArrowUp" || ev.key === "ArrowDown";
		const lineEnds = (ev.key === "Home" || ev.key === "End") && !ev.ctrlKey && !ev.metaKey;
		if (vertical || lineEnds) {
			ev.preventDefault();
			const index = lineKey(ev.key);
			if (!vertical) inline.goalX = null;
			moveCaret(index, ev.shiftKey);
			return;
		}
		inline.goalX = null;
		// The textarea moves its own caret after this event; draw it once it has.
		requestAnimationFrame(drawCaret);
	});
	textarea.addEventListener("select", drawCaret);

	let dragging = false;
	let longPress = 0;
	const selectWord = (index) => {
		const [a, b] = wordAround(textarea.value, index);
		textarea.setSelectionRange(a, b, "forward");
		drawCaret();
	};
	frame.addEventListener("pointerdown", (ev) => {
		if (ev.button !== 0) return;
		// Keep the focus (and the edit) in the textarea, and the press away from the drag code.
		ev.preventDefault();
		ev.stopPropagation();
		inline.goalX = null;
		const index = indexFromEvent(ev);
		const taps = tapCount(ev);
		if (taps === 2) selectWord(index);
		else if (taps >= 3) {
			const line = inline.map[lineOf(inline.map, index)];
			textarea.setSelectionRange(line.start, line.end, "forward");
		} else {
			moveCaret(index, ev.shiftKey);
			dragging = true;
			frame.setPointerCapture(ev.pointerId);
			// Holding a finger still selects the word under it, as on a phone's own text.
			if (ev.pointerType !== "mouse") {
				const at = [ev.clientX, ev.clientY];
				longPress = window.setTimeout(() => {
					dragging = false;
					selectWord(index);
				}, LONG_PRESS_MS);
				inline.pressAt = at;
			}
		}
		drawCaret();
	});
	frame.addEventListener("pointermove", (ev) => {
		const [x, y] = inline.pressAt ?? [];
		if (longPress && Math.hypot(ev.clientX - x, ev.clientY - y) > DRAG_SLACK_PX) {
			clearTimeout(longPress);
			longPress = 0;
		}
		if (dragging) moveCaret(indexFromEvent(ev), true);
	});
	const endSelect = () => {
		dragging = false;
		clearTimeout(longPress);
		longPress = 0;
	};

	// Dragging a handle moves its end of the selection (or the caret), aiming at the line above
	// the finger. The ends can't cross, so each handle stays the end it is.
	for (const [end, { handle: h, aim }] of Object.entries(handles)) {
		let grip = null;
		h.addEventListener("pointerdown", (ev) => {
			// Like a press on the text, it mustn't take the focus from the typing.
			ev.preventDefault();
			ev.stopPropagation();
			h.setPointerCapture(ev.pointerId);
			const at = aim.getBoundingClientRect();
			grip = [ev.clientX - at.left, ev.clientY - at.top];
		});
		h.addEventListener("pointermove", (ev) => {
			if (!grip) return;
			const index = indexFromEvent({
				clientX: ev.clientX - grip[0],
				clientY: ev.clientY - grip[1],
			});
			const { selectionStart: a, selectionEnd: b } = textarea;
			if (end === "start") textarea.setSelectionRange(Math.min(index, b - 1), b, "backward");
			else if (a === b) textarea.setSelectionRange(index, index);
			else textarea.setSelectionRange(a, Math.max(index, a + 1), "forward");
			drawCaret();
		});
		const release = () => (grip = null);
		h.addEventListener("pointerup", release);
		h.addEventListener("pointercancel", release);
	}
	frame.addEventListener("pointerup", endSelect);
	frame.addEventListener("pointercancel", endSelect);
	// A tap on anything that isn't a text field puts a phone's keyboard away, even with the
	// focus kept in the textarea: the taps and presses that move the caret, select a word or
	// drag a handle are kept from the browser's own handling, so the keyboard stays to type on.
	for (const target of [frame, ...Object.values(handles).map((h) => h.handle)]) {
		target.addEventListener("touchend", (ev) => ev.cancelable && ev.preventDefault(), {
			passive: false,
		});
		target.addEventListener("contextmenu", (ev) => ev.preventDefault());
	}
	// A double-click inside the editor selects a word; it isn't a request to start editing.
	frame.addEventListener("dblclick", (ev) => ev.stopPropagation());

	renderOverlay();
	scheduleCanvas();
	textarea.focus({ preventScroll: true });
	if (caret) textarea.setSelectionRange(caret.start, caret.end);
	else textarea.select();
	drawCaret();
};

// Covers what changes the textarea's selection without a key or select event, such as the
// context menu's Select all.
document.addEventListener("selectionchange", () => {
	if (inline && document.activeElement === inline.textarea) drawCaret();
});
// The handles are over the page, so they follow the label when it scrolls or the window moves.
$("#stage").addEventListener("scroll", placeHandles);
addEventListener("resize", placeHandles);
visualViewport?.addEventListener("scroll", placeHandles);

export const stopInlineEdit = () => {
	if (!inline) return;
	const { frame, handles } = inline;
	inline = null;
	frame.remove();
	for (const { handle } of Object.values(handles)) handle.remove();
	history.seal();
	inlineChanged();
	renderOverlay();
	// Fields in the text it was showing as typed get filled in again.
	scheduleCanvas();
};

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
