import {
	LIMITS,
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
import { FONTS, WEIGHT_NAMES, weightsFor, nearestWeight, fontInfo, hasEmoji } from "../fonts.js";
import { clamp, round, dotsToMm } from "../units.js";
import { encodeBarcode } from "../barcode.js";
import { $, $$, el, toast, announce } from "./dom.js";
import { contentOf, describeElement, typeName } from "./describe.js";
import { importImageFile, fitBox } from "./images.js";
import {
	state,
	history,
	commit,
	updateElement,
	updateElements,
	select,
	selected,
	selectedElements,
	toggleSelected,
	subscribe,
	undo,
	redo,
} from "./store.js";
import {
	fittedSizes,
	inlineEdit,
	onDrawn,
	onInlineChange,
	renderWarnings,
	startInlineEdit,
} from "./stage.js";
import {
	STYLE_PROPS,
	clearStyle,
	mapStyles,
	retext,
	setStyle,
	stylesBetween,
	textOf,
} from "../richtext.js";

// ---------------------------------------------------------------------------
// Property binding: inputs carry data-prop / data-type, panels carry data-panel.

/** The words selected while typing on this text, if any: what a weight picked is for. */
const typedSelection = (element) => {
	const typing = inlineEdit();
	return typing?.id === element.id && typing.from !== typing.to ? typing : null;
};

/** The weights the face has, and "Mixed" while the words (those selected, or all) differ. */
const weightOptions = (sel, element) => {
	const weights = weightsFor(element.fontFamily);
	const { from, to } = typedSelection(element) ?? { from: 0, to: textOf(element.text).length };
	const used = new Set(stylesBetween(element.text, from, to, element).map((s) => s.fontWeight));
	const mixed = used.size > 1;
	const key = weights.join(",") + (mixed ? ",mixed" : "");
	if (sel.dataset.key !== key) {
		sel.replaceChildren(
			...(mixed ? [Object.assign(new Option("Mixed", ""), { disabled: true })] : []),
			...weights.map((w) => new Option(`${WEIGHT_NAMES[w]} (${w})`, String(w))),
		);
		sel.dataset.key = key;
	}
	// Picking a weight while it's mixed sets it for every word (see onPropInput).
	sel.value = mixed ? "" : String([...used][0] ?? element.fontWeight);
};

export const syncProps = (root, element) => {
	for (const input of $$("[data-prop]", root)) {
		const prop = input.dataset.prop;
		// Don't fight the user's cursor, or a slider a finger is dragging (it doesn't take focus).
		if (document.activeElement === input || input.matches(":active")) continue;
		if (prop === "fontWeight") {
			weightOptions(input, element);
			continue;
		}
		if (prop === "fontFamily" && ![...input.options].some((o) => o.value === element.fontFamily)) {
			// Unknown family from a loaded file: show it rather than silently switching fonts.
			input.append(new Option(`${element.fontFamily} (from file)`, element.fontFamily));
		}
		if (input.type === "checkbox") input.checked = !!element[prop];
		else if (prop === "fontSizePt") input.value = String(shownSize(element));
		else if (prop === "text") input.value = textOf(element.text);
		else
			input.value =
				typeof element[prop] === "number" ? String(round(element[prop], 3)) : (element[prop] ?? "");
	}
	for (const group of $$("[data-radio]", root)) {
		for (const b of $$("button", group)) {
			b.setAttribute(
				"aria-pressed",
				String(b.dataset.value === String(element[group.dataset.radio])),
			);
		}
	}
	const italic = $('[data-prop="italic"]', root);
	if (italic) italic.disabled = !(fontInfo(element.fontFamily)?.italic ?? true);
	for (const node of $$("[data-show-for]", root)) {
		node.hidden = !node.dataset.showFor.split(" ").includes(element.shape);
	}
	for (const node of $$("[data-show-if]", root)) node.hidden = !element[node.dataset.showIf];
	// Only worth offering while there's an emoji to print.
	for (const node of $$("[data-show-if-emoji]", root))
		node.hidden = !hasEmoji(textOf(element.text ?? ""));
};

/** The size a text is drawn at: the fitted one while it fits itself, else the one set. */
const shownSize = (e) =>
	round(e.fit && fittedSizes().has(e.id) ? fittedSizes().get(e.id) : e.fontSizePt, 1);

// Fitting happens while drawing, so the size box catches up once a draw has finished.
const updateFittedSizes = () => {
	const show = (root, e) => {
		const input = $('[data-prop="fontSizePt"]', root);
		if (!input || !e?.fit || document.activeElement === input) return;
		input.value = String(shownSize(e));
	};
	if (selected()?.type === "text") show($("#textProps"), selected());
	const warning = selected() && renderWarnings().get(selected().id);
	$("#elementWarning").hidden = !warning;
	$("#elementWarning").textContent = warning ? `⚠ ${warning}` : "";
	for (const box of $$("#overlay .box"))
		box.classList.toggle("warn", renderWarnings().has(box.dataset.id));
};
onDrawn(updateFittedSizes);

const coerce = (input) => {
	if (input.dataset.type === "bool") return input.checked;
	if (input.dataset.type === "number") return input.valueAsNumber ?? Number(input.value);
	return input.value;
};

/** The element a settings section (or the bar) edits: the one selected. */
export const targetFor = (_root) => selected();

const onPropInput = (ev) => {
	const input = ev.target.closest("[data-prop]");
	if (!input) return;
	const e = targetFor(input.closest("[data-panel]"));
	if (!e) return;
	const prop = input.dataset.prop;
	const value = coerce(input);
	if (typeof value === "number" && !Number.isFinite(value)) return; // mid-typing, e.g. "-"

	const patch = { [prop]: value };
	// Typing a size means that size, so it stops fitting.
	if (prop === "fontSizePt")
		Object.assign(patch, { fontSizePt: clamp(value, ...LIMITS.fontSizePt), fit: false });
	if (prop === "letterSpacingPt") patch.letterSpacingPt = clamp(value, ...LIMITS.letterSpacingPt);
	if (prop === "w" || prop === "h") patch[prop] = Math.max(LIMITS.elementMinMm, value);
	if (prop === "text" && e.type === "text")
		patch.text = retext(e.text, String(value), { caret: input.selectionEnd });
	if (prop === "fontFamily" && e.type === "text") {
		patch.fontWeight = nearestWeight(value, e.fontWeight);
		const italic = fontInfo(value)?.italic ?? true;
		if (!italic) patch.italic = false;
		// Formatted words too: a bold word stays as bold as the new face allows.
		patch.text = mapStyles(e.text, ({ fontWeight, italic: slanted, ...rest }) => ({
			...rest,
			...(fontWeight !== undefined && { fontWeight: nearestWeight(value, fontWeight) }),
			...(italic && slanted !== undefined && { italic: slanted }),
		}));
	}
	// Setting it for the whole box sets it for every word in it.
	if (STYLE_PROPS.includes(prop) && e.type === "text") patch.text = clearStyle(e.text, prop);
	// …but while typing, the words selected get it, as with the bar's B.
	const words = prop === "fontWeight" && e.type === "text" && typedSelection(e);
	if (words) {
		updateElement(e.id, { text: setStyle(e.text, words.from, words.to, prop, value) });
		history.seal();
		return;
	}
	// Turning fit off should keep what the user was looking at, not jump back to an old size.
	if (prop === "fit" && !value && fittedSizes().has(e.id))
		patch.fontSizePt = round(fittedSizes().get(e.id), 1);
	updateElement(e.id, patch, `${e.id}:${prop}`);
};

const radioValue = (group, raw) => (group.dataset.radioType === "number" ? Number(raw) : raw);

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

for (const root of $$("[data-panel]")) {
	root.addEventListener("input", onPropInput);
	root.addEventListener("change", () => history.seal());
	root.addEventListener("click", (ev) => {
		const b = ev.target.closest("[data-radio] button");
		if (!b) return;
		const group = b.closest("[data-radio]");
		const e = targetFor(root);
		if (!e) return;
		const prop = group.dataset.radio;
		const value = radioValue(group, b.dataset.value);
		if (prop === "rotation") rotateElement(e, value);
		else updateElement(e.id, { [prop]: value });
		history.seal();
	});
}
$$(".font-select").forEach((sel) =>
	sel.replaceChildren(...FONTS.map((f) => new Option(f.label, f.family))),
);

// ---------------------------------------------------------------------------
// Panel rendering

const LAYER_KIND = { text: "T", shape: "▭", barcode: "║", qr: "▦", image: "▣" };

let layersKey = "";
/**
 * Listbox with roving tabindex: Tab lands on the selected element, arrows move between them.
 * Rebuilt only when what it shows changes; a drag commits on every frame, and rebuilding
 * then is wasted work that can also make screen readers re-read the list.
 */
const renderLayers = () => {
	const ordered = [...state.doc.elements].reverse();
	const items = ordered.map((e) => [e.id, e.type, typeName(e), contentOf(e)]);
	const key = JSON.stringify([items, state.selectedIds]);
	if (key === layersKey) return;
	layersKey = key;
	const focusId = state.selectedIds.at(-1) ?? ordered[0]?.id;
	const hadFocus = $("#layers").contains(document.activeElement);
	$("#layers").replaceChildren(
		...ordered.map((e) =>
			el(
				"li",
				{
					role: "option",
					dataset: { id: e.id },
					"aria-selected": String(state.selectedIds.includes(e.id)),
					tabIndex: e.id === focusId ? 0 : -1,
				},
				el("span", { className: "kind", "aria-hidden": "true" }, LAYER_KIND[e.type] ?? "▭"),
				el("span", { className: "sr-only" }, `${typeName(e)}: `),
				contentOf(e) || typeName(e),
			),
		),
	);
	if (hadFocus) $(`#layers [data-id="${focusId}"]`)?.focus();
};

const renderPanels = () => {
	$("#btnUndo").disabled = !history.canUndo;
	$("#btnRedo").disabled = !history.canRedo;
	renderLayers();

	const e = selected();
	const count = state.selectedIds.length;
	if (count > 1) {
		$("#multiCount").textContent = `${count} selected`;
		for (const b of $$("[data-distribute]")) b.disabled = count < 3;
	}
	for (const panel of $$("#designPanel [data-panel][data-types]")) {
		const types = panel.dataset.types.split(" ");
		panel.hidden = !e || !(types.includes(e.type) || types.includes("*"));
		if (!panel.hidden) syncProps(panel, e);
	}
	if (!e) return;
	const idx = state.doc.elements.indexOf(e);
	$("#btnForward").disabled = idx === state.doc.elements.length - 1;
	$("#btnBackward").disabled = idx === 0;
};

$("#layers").addEventListener("click", (ev) => {
	const li = ev.target.closest("li");
	if (!li) return;
	if (ev.ctrlKey || ev.metaKey || ev.shiftKey) toggleSelected(li.dataset.id);
	else select(li.dataset.id);
});
$("#layers").addEventListener("keydown", (ev) => {
	const items = $$("#layers li");
	const i = items.indexOf(document.activeElement);
	const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[ev.key];
	if (next === undefined || !items.length) return;
	ev.preventDefault();
	ev.stopPropagation(); // arrows here pick an element; they don't nudge it
	const target = items[Math.max(0, Math.min(items.length - 1, next))];
	select(target.dataset.id);
	announce(describeElement(state.doc.elements.find((e) => e.id === target.dataset.id)));
});

// ---------------------------------------------------------------------------
// Design actions

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
	const width = Math.min(a.w, Math.ceil(dotsToMm(modules * 2) + 0.5));
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

const moveLayer = (delta) => {
	const list = [...state.doc.elements];
	const i = list.findIndex((e) => e.id === state.selectedId);
	const j = i + delta;
	if (i < 0 || j < 0 || j >= list.length) return;
	[list[i], list[j]] = [list[j], list[i]];
	commit({ ...state.doc, elements: list });
	history.seal();
};

$("#btnForward").addEventListener("click", () => moveLayer(1));
$("#btnBackward").addEventListener("click", () => moveLayer(-1));
$("#btnUndo").addEventListener("click", undo);
$("#btnRedo").addEventListener("click", redo);

subscribe(renderPanels);
// The weight shown is the selected words' while typing, so it follows the selection.
onInlineChange(renderPanels);
