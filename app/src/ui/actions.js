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
import { round } from "../units.js";
import { encodeBarcode } from "../barcode.js";
import { $, $$, toast, announce } from "./dom.js";
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
export const rotateElement = (e, rotation) => {
	const { x, y, w, h } = clampToLabel(rotateTo(e, rotation), state.doc.label);
	updateElement(e.id, { rotation, x, y, w, h });
	history.seal();
	announce(`Rotated to ${rotation}°`);
};

export const addElement = (element) => {
	commit(
		{ ...state.doc, elements: [...state.doc.elements, clampToLabel(element, state.doc.label)] },
		{ selectedIds: [element.id] },
	);
	history.seal();
	announce(`Added ${describeElement(element)}`);
};

// New elements go to the centre of the printable area so they're never off-screen on small labels.
export const centred = (w, h) => {
	const a = printableArea(state.doc.label);
	const cw = Math.min(w, a.w);
	const ch = Math.min(h, a.h);
	return { x: round(a.x + (a.w - cw) / 2), y: round(a.y + (a.h - ch) / 2), w: cw, h: ch };
};

$("#addText").addEventListener("click", () => {
	const a = printableArea(state.doc.label);
	const e = createText(state.doc, { ...centred(a.w / 2, a.h / 2), text: "Text", fit: true });
	addElement(e);
	// Straight to typing on it, with the placeholder selected to type over.
	startInlineEdit(e.id);
});

$("#addShape").addEventListener("click", () => {
	const a = printableArea(state.doc.label);
	addElement(createShape(state.doc, { ...a }));
});

$("#addBarcode").addEventListener("click", () => {
	const a = printableArea(state.doc.label);
	const e = createBarcode(state.doc);
	// Wide enough for 2-dot bars (the narrowest that scans reliably), if the label allows.
	const modules = encodeBarcode(e.symbology, e.data).modules.length;
	const width = Math.min(a.w, Math.ceil(currentScale().toMm(modules * 2) + 0.5));
	addElement({ ...e, ...centred(width, a.h) });
	$('#quickbar [data-qb="barcode"] [data-prop="data"]').select();
});

$("#addQr").addEventListener("click", () => {
	const a = printableArea(state.doc.label);
	const side = Math.min(a.h, a.w);
	addElement(createQr(state.doc, centred(side, side)));
	$('#quickbar [data-qb="qr"] [data-prop="data"]').select();
});

/** Adds an image file as a new element, sized to fit the printable area. Switches to design mode. */
export const addImageFile = async (file) => {
	try {
		const img = await importImageFile(file);
		const { w, h } = fitBox(img, printableArea(state.doc.label));
		addElement(createImage(state.doc, { ...centred(w, h), src: img.src }));
	} catch (err) {
		toast(err.message, { error: true });
	}
};

let replacing = null;
$("#addImage").addEventListener("click", () => {
	replacing = null;
	$("#imageFile").click();
});
$("#replaceImage").addEventListener("click", () => {
	replacing = selected()?.id ?? null;
	$("#imageFile").click();
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
	if (!replacing) return addImageFile(file);
	try {
		const { src } = await importImageFile(file);
		updateElement(replacing, { src });
		history.seal();
	} catch (err) {
		toast(err.message, { error: true });
	}
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
