// The settings for what's selected: each input names the property it edits (data-prop), and
// each section the element types it's for (data-panel, data-types).
import { LIMITS } from "../model.js";
import {
	FONTS,
	WEIGHT_NAMES,
	cssFamily,
	weightsFor,
	nearestWeight,
	fontInfo,
	hasEmoji,
} from "../fonts.js";
import { clamp, round } from "../units.js";
import { $, $$ } from "./dom.js";
import { REPO_URL } from "../app-info.js";
import { state, history, updateElement, selected, subscribe, undo, redo } from "./store.js";
import { rotateElement } from "./actions.js";
import { fittedSizes, onDrawn, renderWarnings } from "./stage.js";
import { inlineEdit, onInlineChange } from "./inline-editor.js";
import {
	STYLE_PROPS,
	clearStyle,
	mapStyles,
	retext,
	setStyle,
	stylesBetween,
	textOf,
} from "../richtext.js";

// The list is kept short on purpose, so one that's asked for is worth adding. Asking is the
// list's last choice, where someone who didn't find theirs ends up.
const REQUEST_FONT = "request-font";
const FONT_REQUEST_URL = `${REPO_URL}/issues/new?template=font-request.yml`;

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
		// A toggle has no cursor to fight, and keeps the focus once pressed.
		if (input instanceof HTMLButtonElement) {
			input.setAttribute("aria-pressed", String(!!element[prop]));
			continue;
		}
		// Don't fight the user's cursor, or a slider a finger is dragging (it doesn't take focus).
		if (document.activeElement === input || input.matches(":active")) continue;
		if (prop === "fontWeight") {
			weightOptions(input, element);
			continue;
		}
		if (input.classList.contains("font-select")) showFamily(input, element[prop]);
		if (prop === "fontSizePt") input.value = String(shownSize(element));
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
	for (const node of $$("[data-show-for]", root)) {
		node.hidden = !node.dataset.showFor.split(" ").includes(element.shape);
	}
	for (const node of $$("[data-show-if]", root)) node.hidden = !element[node.dataset.showIf];
	// Only worth offering while there's an emoji to print.
	for (const node of $$("[data-show-if-emoji]", root))
		node.hidden = !hasEmoji(textOf(element.text ?? ""));
	// A stretched picture fills its box both ways, so it has nowhere to move to. Disabled
	// rather than hidden, so the panel doesn't jump while trying Fit, Fill and Stretch.
	if (element.type === "image") {
		$("#centreImage").disabled =
			element.fit === "stretch" || (element.panX === 0.5 && element.panY === 0.5);
		// Stretch fills the box exactly, so there's no zooming it.
		$("#imageZoom").disabled = element.fit === "stretch";
		const zoom = $("#resetImageZoom");
		zoom.textContent = `${Math.round(element.zoom * 100)}%`;
		zoom.disabled = element.fit === "stretch" || element.zoom === 1;
	}
};

/** A family from a loaded file that the list doesn't have is shown, not silently switched. */
const showFamily = (sel, family) => {
	for (const o of $$("option.from-file", sel)) if (o.value !== family) o.remove();
	// The bar's font list is synced for every element, and only a text has a family.
	if (typeof family !== "string" || [...sel.options].some((o) => o.value === family)) return;
	const option = Object.assign(new Option(`${family} (from file)`, family), {
		className: "from-file",
	});
	sel.insertBefore(option, $("hr", sel) ?? $(`[value="${REQUEST_FONT}"]`, sel));
};

/** The size a text is drawn at: the fitted one while it fits itself, else the one set. */
const shownSize = (e) =>
	round(e.fit && fittedSizes().has(e.id) ? fittedSizes().get(e.id) : e.fontSizePt, 1);

// Problems are found while drawing (a barcode too narrow to scan), so they show once a draw
// has finished. The fitted size does too: the bar renders again after each draw.
const showWarnings = () => {
	const e = selected();
	const warning = e && renderWarnings().get(e.id);
	$("#elementWarning").hidden = !warning;
	$("#elementWarning").textContent = warning ? `⚠ ${warning}` : "";
	for (const box of $$("#overlay .box"))
		box.classList.toggle("warn", renderWarnings().has(box.dataset.id));
};
onDrawn(showWarnings);

const coerce = (input) => {
	if (input.dataset.type === "number") return input.valueAsNumber ?? Number(input.value);
	return input.value;
};

/** What setting `prop` to `value` changes on `e`, with what has to change along with it. */
const patchFor = (e, prop, value) => {
	const patch = { [prop]: value };
	// Typing a size means that size, so it stops fitting.
	if (prop === "fontSizePt")
		Object.assign(patch, { fontSizePt: clamp(value, ...LIMITS.fontSizePt), fit: false });
	if (prop === "letterSpacingPt") patch.letterSpacingPt = clamp(value, ...LIMITS.letterSpacingPt);
	if (prop === "w" || prop === "h") patch[prop] = Math.max(LIMITS.elementMinMm, value);
	if (prop === "zoom") patch.zoom = round(clamp(value, ...LIMITS.imageZoom), 3);
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
	// Turning fit off should keep what the user was looking at, not jump back to an old size.
	if (prop === "fit" && !value && fittedSizes().has(e.id))
		patch.fontSizePt = round(fittedSizes().get(e.id), 1);
	return patch;
};

const onPropInput = (ev) => {
	const input = ev.target.closest("[data-prop]");
	if (!input) return;
	const e = selected();
	if (!e) return;
	const prop = input.dataset.prop;
	if (input.value === REQUEST_FONT) {
		open(FONT_REQUEST_URL, "_blank", "noopener");
		/** @type {HTMLSelectElement} */ (input).value = e[prop];
		return;
	}
	const value = coerce(input);
	if (typeof value === "number" && !Number.isFinite(value)) return; // mid-typing, e.g. "-"

	// While typing, the words selected get a weight picked, as with the bar's B.
	const words = prop === "fontWeight" && e.type === "text" && typedSelection(e);
	if (words) {
		updateElement(e.id, { text: setStyle(e.text, words.from, words.to, prop, value) });
		history.seal();
		return;
	}
	const patch = patchFor(e, prop, value);
	if (prop === "text" && e.type === "text")
		patch.text = retext(e.text, String(value), { caret: input.selectionEnd });
	updateElement(e.id, patch, `${e.id}:${prop}`);
};

const radioValue = (group, raw) =>
	({ number: Number(raw), bool: raw === "true" })[group.dataset.radioType] ?? raw;

for (const root of $$("[data-panel]")) {
	root.addEventListener("input", onPropInput);
	root.addEventListener("change", () => history.seal());
	root.addEventListener("click", (ev) => {
		const e = selected();
		// A toggle: a button that names its property, on or off.
		const toggle = ev.target.closest("button[data-prop]");
		if (toggle && e) {
			updateElement(e.id, patchFor(e, toggle.dataset.prop, !e[toggle.dataset.prop]));
			history.seal();
			return;
		}
		const b = ev.target.closest("[data-radio] button");
		if (!b || !e) return;
		const group = b.closest("[data-radio]");
		const prop = group.dataset.radio;
		const value = radioValue(group, b.dataset.value);
		if (prop === "rotation") rotateElement(e, value);
		else updateElement(e.id, patchFor(e, prop, value));
		history.seal();
	});
}
for (const sel of $$(".font-select")) {
	sel.replaceChildren(
		// Each name in its own face, so the list shows how they look without picking each one.
		...FONTS.map((f) => {
			const option = new Option(f.label, f.family);
			option.style.fontFamily = cssFamily(f.family);
			return option;
		}),
		document.createElement("hr"),
		new Option("Request a font…", REQUEST_FONT),
	);
}

// ---------------------------------------------------------------------------
// Panel rendering

const renderPanels = () => {
	$("#btnUndo").disabled = !history.canUndo;
	$("#btnRedo").disabled = !history.canRedo;

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
};

$("#btnUndo").addEventListener("click", undo);
$("#btnRedo").addEventListener("click", redo);

subscribe(renderPanels);
// The weight shown is the selected words' while typing, so it follows the selection.
onInlineChange(renderPanels);
