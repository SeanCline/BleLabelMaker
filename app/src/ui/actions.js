// What can be done to the label's elements: add them (the rail's buttons, an image file),
// delete, duplicate, rotate and arrange them. Each is one undo step, said aloud for screen
// readers. The clipboard, keyboard shortcuts and the bar call these too.
import {
	createBarcode,
	createImage,
	createQr,
	createShape,
	createText,
	rotateTo,
	printableArea,
	clampToLabel,
	alignPatches,
	distributePatches,
	placeCopies,
} from "../model.js";
import { clamp, round } from "../units.js";
import { encodeBarcode } from "../barcode.js";
import { $, $$, el, toast, announce, focusBarField, DRAG_SLACK_PX } from "./dom.js";
import { describeElement } from "./describe.js";
import { importImageFile, fitBox } from "./images.js";
import { currentScale } from "./settings.js";
import {
	state,
	history,
	commit,
	updateElement,
	updateElements,
	selected,
	selectedElements,
} from "./store.js";
import { startInlineEdit } from "./inline-editor.js";
import { labelPointAt } from "./stage.js";
import { rovingToolbar } from "./toolbar.js";

/** Turns each element a quarter turn (or three) about its own centre, as one undo step. */
export const rotateElements = (els, deltaDeg) => {
	const patches = {};
	for (const e of els) {
		const { rotation, x, y, w, h } = clampToLabel(
			rotateTo(e, /** @type {0|90|180|270} */ ((e.rotation + deltaDeg) % 360)),
			state.doc.label,
		);
		patches[e.id] = { rotation, x, y, w, h };
	}
	updateElements(patches);
	history.seal();
	announce(
		els.length === 1
			? `Rotated to ${patches[els[0].id].rotation}°`
			: `Rotated ${els.length} elements`,
	);
};

/** Rotation reshapes the box (see rotateTo), so it can't be a plain property patch. */
export const rotateElement = (e, rotation) => rotateElements([e], rotation - e.rotation);

export const addElement = (element) => {
	commit(
		{ ...state.doc, elements: [...state.doc.elements, clampToLabel(element, state.doc.label)] },
		{ selectedIds: [element.id] },
	);
	history.seal();
	announce(`Added ${describeElement(element)}`);
};

/**
 * New elements go to the centre of the printable area so they're never off-screen on small
 * labels. One dragged from the rail is centred on where it was dropped (`at`, in mm), kept
 * inside the printable area.
 */
export const centred = (w, h, at = null) => {
	const a = printableArea(state.doc.label);
	const cw = Math.min(w, a.w);
	const ch = Math.min(h, a.h);
	if (at)
		return {
			x: round(clamp(at.x - cw / 2, a.x, a.x + a.w - cw)),
			y: round(clamp(at.y - ch / 2, a.y, a.y + a.h - ch)),
			w: cw,
			h: ch,
		};
	return { x: round(a.x + (a.w - cw) / 2), y: round(a.y + (a.h - ch) / 2), w: cw, h: ch };
};

/** A new text's box: half the printable area, centred, or on `at` when dropped there. */
export const halfBox = (at = null) => {
	const a = printableArea(state.doc.label);
	return centred(a.w / 2, a.h / 2, at);
};

let replacing = null;
// Where a picture dragged from the rail was dropped, while its file is being picked.
let droppedAt = null;

/** What each of the rail's buttons adds: centred, or at `at` (mm) when dragged there. */
const ADD = {
	text: (at) => {
		const e = createText(state.doc, { ...halfBox(at), text: "Text", fit: true });
		addElement(e);
		// Straight to typing on it, with the placeholder selected to type over.
		startInlineEdit(e.id);
	},
	// A click's fills the label, to draw a border; a dropped one would have nowhere to go at
	// that size, so it's half as big.
	shape: (at) => {
		const a = printableArea(state.doc.label);
		addElement(createShape(state.doc, at ? halfBox(at) : { ...a }));
	},
	barcode: (at) => {
		const a = printableArea(state.doc.label);
		const e = createBarcode(state.doc);
		// Wide enough for 2-dot bars (the narrowest that scans reliably), if the label allows.
		const modules = encodeBarcode(e.symbology, e.data).modules.length;
		const width = Math.min(a.w, Math.ceil(currentScale().toMm(modules * 2) + 0.5));
		addElement({ ...e, ...centred(width, a.h, at) });
		focusBarField("barcode");
	},
	qr: (at) => {
		const a = printableArea(state.doc.label);
		const side = Math.min(a.h, a.w);
		addElement(createQr(state.doc, centred(side, side, at)));
		focusBarField("qr");
	},
	image: (at) => {
		replacing = null;
		droppedAt = at;
		$("#imageFile").click();
	},
};
for (const button of $$(".rail [data-add]"))
	button.addEventListener("click", () => ADD[button.dataset.add](null));

/** Adds an image file as a new element, sized to fit the printable area. */
export const addImageFile = async (file, at = null) => {
	try {
		const img = await importImageFile(file);
		const { w, h } = fitBox(img, printableArea(state.doc.label));
		addElement(createImage(state.doc, { ...centred(w, h, at), src: img.src }));
	} catch (err) {
		toast(err.message, { error: true });
	}
};
$("#replaceImage").addEventListener("click", () => {
	replacing = selected()?.id ?? null;
	$("#imageFile").click();
});
$("#resetImageZoom").addEventListener("click", () => {
	const e = selected();
	if (e?.type !== "image") return;
	updateElement(e.id, { zoom: 1 });
	history.seal();
});
$("#centreImage").addEventListener("click", () => {
	const e = selected();
	if (e?.type !== "image") return;
	updateElement(e.id, { panX: 0.5, panY: 0.5 });
	history.seal();
});
$("#imageFile").addEventListener("change", async (ev) => {
	const file = ev.target.files[0];
	ev.target.value = "";
	if (!file) return;
	if (!replacing) return addImageFile(file, droppedAt);
	try {
		const { src } = await importImageFile(file);
		updateElement(replacing, { src });
		history.seal();
	} catch (err) {
		toast(err.message, { error: true });
	}
});

// ---------------------------------------------------------------------------
// Dragging from the rail onto the label, as in schematic editors, puts it where it's dropped.
// A press that doesn't move is still a click, so clicking works just as it always has.

let railDrag = null;
const rail = $(".rail");
rovingToolbar(rail, { vertical: true });

const endRailDrag = () => {
	railDrag?.ghost?.remove();
	railDrag = null;
};

rail.addEventListener("pointerdown", (ev) => {
	const button = ev.target.closest("[data-add]");
	if (!button || ev.button !== 0) return;
	railDrag = { button, startX: ev.clientX, startY: ev.clientY, ghost: null, cancelled: false };
	button.setPointerCapture(ev.pointerId);
});

rail.addEventListener("pointermove", (ev) => {
	if (!railDrag || railDrag.cancelled) return;
	if (!railDrag.ghost) {
		if (Math.hypot(ev.clientX - railDrag.startX, ev.clientY - railDrag.startY) < DRAG_SLACK_PX)
			return;
		railDrag.ghost = el("div", { className: "rail-ghost floating" });
		railDrag.ghost.append($("svg", railDrag.button).cloneNode(true));
		document.body.append(railDrag.ghost);
	}
	railDrag.ghost.style.translate = `${ev.clientX}px ${ev.clientY}px`;
	railDrag.ghost.classList.toggle("over", !!labelPointAt(ev.clientX, ev.clientY));
});

rail.addEventListener("pointerup", (ev) => {
	const drag = railDrag;
	endRailDrag();
	if (!drag || (!drag.ghost && !drag.cancelled)) return; // a click, which adds it centred
	// The click the browser sends after a drag isn't one.
	const swallow = (/** @type {Event} */ e) => e.stopImmediatePropagation();
	drag.button.addEventListener("click", swallow, { capture: true, once: true });
	setTimeout(() => drag.button.removeEventListener("click", swallow, { capture: true }));
	const at = drag.cancelled ? null : labelPointAt(ev.clientX, ev.clientY);
	if (at) ADD[drag.button.dataset.add](at);
});

rail.addEventListener("pointercancel", endRailDrag);

// Escape mid-drag drops nothing, and letting go afterwards still isn't a click.
addEventListener("keydown", (ev) => {
	if (ev.key !== "Escape" || !railDrag?.ghost) return;
	railDrag.ghost.remove();
	railDrag.ghost = null;
	railDrag.cancelled = true;
});

const describeSelection = (els) =>
	els.length === 1 ? describeElement(els[0]) : `${els.length} elements`;

export const deleteSelected = () => {
	const doomed = selectedElements();
	if (!doomed.length) return;
	announce(`Deleted ${describeSelection(doomed)}`);
	commit({ ...state.doc, elements: state.doc.elements.filter((e) => !doomed.includes(e)) });
	history.seal();
};

/** Adds copies of elements (from the clipboard or a duplicate) and selects them. */
export const addCopies = (elements) => {
	if (!elements.length) return;
	const copies = placeCopies(state.doc, elements);
	commit(
		{ ...state.doc, elements: [...state.doc.elements, ...copies] },
		{ selectedIds: copies.map((c) => c.id) },
	);
	history.seal();
	announce(`Added ${describeSelection(copies)}`);
};

export const duplicateSelected = () => addCopies(selectedElements());

const arrange = (patches) => {
	updateElements(patches);
	history.seal();
};
for (const b of $$("[data-align]")) {
	b.addEventListener("click", () => arrange(alignPatches(selectedElements(), b.dataset.align)));
}
for (const b of $$("[data-distribute]")) {
	b.addEventListener("click", () =>
		arrange(distributePatches(selectedElements(), b.dataset.distribute)),
	);
}
