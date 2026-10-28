// The label size (the chip in the label area): pre-cut sizes for the printer in use, a
// continuous roll, or a custom size.
import { LIMITS, CONTINUOUS_LENGTH_MM, resizeLabel, withLength } from "../model.js";
import { labelDots, contentLengthMm } from "../render.js";
import { storageKey } from "../app-info.js";
import { $, el, loadJson, storeJson } from "./dom.js";
import { state, history, commit, amend, subscribe } from "./store.js";
import { onDrawn, previewDocument } from "./stage.js";
import { onPrinterChange } from "./printer-menu.js";
import { currentPrinter, currentScale } from "./settings.js";

const presetKey = (l) => `${l.widthMm}x${l.heightMm}`;
// The sizes the printer being used takes; some models only take 12 mm labels, say.
const visiblePresets = () => currentPrinter().presets;

const KIND_TITLES = {
	precut: "Pre-cut labels: the printer stops at each gap",
	continuous: "Continuous tape: printed to length, then fed out to tear off",
};

const renderPresetOptions = () => {
	const sel = $("#labelPreset");
	const presets = visiblePresets();
	const key = presets.map(presetKey).join() + currentPrinter().continuousHeightMm;
	if (sel.dataset.key === key) return;
	sel.dataset.key = key;
	// Grouped by what the printer does at the end of a label, which matters more than the size.
	// Options repeat their group's tooltip, since an open dropdown may not show the group's.
	const option = (text, value, title) => Object.assign(new Option(text, value), { title });
	sel.replaceChildren(
		el(
			"optgroup",
			{ label: "Pre-cut labels", title: KIND_TITLES.precut },
			...presets.map((p) =>
				option(`${p.widthMm} × ${p.heightMm} mm`, presetKey(p), KIND_TITLES.precut),
			),
			option("Custom size…", "custom", KIND_TITLES.precut),
		),
		el(
			"optgroup",
			{ label: "Continuous tape", title: KIND_TITLES.continuous },
			option(
				`Continuous roll (${currentPrinter().continuousHeightMm} mm)`,
				"continuous",
				KIND_TITLES.continuous,
			),
		),
	);
};

const renderLabelBar = () => {
	renderPresetOptions();
	const l = state.doc.label;
	const isPreset = visiblePresets().some((p) => presetKey(p) === presetKey(l));
	const sel = $("#labelPreset");
	if (document.activeElement !== sel) {
		sel.value = l.continuous
			? "continuous"
			: isPreset && !sel.dataset.forceCustom
				? presetKey(l)
				: "custom";
	}
	$("#customSize").hidden = sel.value !== "custom";
	$("#continuousSize").hidden = sel.value !== "continuous";
	$("#labelAutoLength").checked = !!l.autoLength;
	// The length follows the content, so there's nothing to type.
	$("#labelLen").disabled = !!l.autoLength;
	for (const [id, v] of [
		["#labelW", l.widthMm],
		["#labelH", l.heightMm],
		["#labelLen", l.widthMm],
	]) {
		if (document.activeElement !== $(id)) $(id).value = v;
	}
	sel.title = KIND_TITLES[l.continuous ? "continuous" : "precut"];
	const { width, height } = labelDots(l, currentScale());
	$("#labelInfo").textContent = `${width} × ${height} dots`;
	$("#labelChipText").textContent = l.continuous
		? `${l.heightMm} mm roll, ${l.autoLength ? "auto length" : `${l.widthMm} mm long`}`
		: `${l.widthMm} × ${l.heightMm} mm`;
};

// The last label chosen for each printer model, so switching printers (or connecting one)
// brings back the roll that's usually in it.
const MEMORY_KEY = storageKey("labelByPrinter");
const remembered = () => loadJson(MEMORY_KEY) ?? {};
const remember = (label) =>
	storeJson(MEMORY_KEY, { ...remembered(), [currentPrinter().id]: label });

/**
 * A label as stored: auto length only on a continuous roll, and only when set.
 * @param {{widthMm: number, heightMm: number, continuous?: boolean, autoLength?: boolean}} l
 */
const labelOf = ({ widthMm, heightMm, continuous, autoLength }) => ({
	widthMm,
	heightMm,
	continuous: continuous === true,
	...(continuous === true && autoLength === true ? { autoLength: true } : {}),
});

let printerId = currentPrinter().id;
onPrinterChange(() => {
	if (currentPrinter().id !== printerId) {
		printerId = currentPrinter().id;
		const l = remembered()[printerId];
		if (l) {
			setLabel(l);
			history.seal();
		}
	}
	renderLabelBar();
});

const setLabel = (wanted) => {
	const label = labelOf(wanted);
	const ok =
		Number.isFinite(label.widthMm) &&
		Number.isFinite(label.heightMm) &&
		label.widthMm >= LIMITS.labelWidthMm[0] &&
		label.widthMm <= LIMITS.labelWidthMm[1] &&
		label.heightMm >= LIMITS.labelHeightMm[0] &&
		label.heightMm <= LIMITS.labelHeightMm[1];
	if (!ok) return;
	remember(label);
	const l = state.doc.label;
	if (JSON.stringify(labelOf(l)) === JSON.stringify(label)) return;
	commit(resizeLabel(state.doc, label), { group: "label-size" });
};

$("#labelPreset").addEventListener("change", (ev) => {
	const v = ev.target.value;
	delete ev.target.dataset.forceCustom;
	if (v === "continuous") {
		// A roll starts out as long as what's on it, as the printer's own app does; a length can
		// be set instead.
		const l = state.doc.label;
		setLabel({
			widthMm: l.continuous ? l.widthMm : CONTINUOUS_LENGTH_MM,
			heightMm: currentPrinter().continuousHeightMm,
			continuous: true,
			autoLength: l.continuous ? l.autoLength : true,
		});
		history.seal();
		$("#labelAutoLength").focus();
		return;
	}
	if (v === "custom") {
		ev.target.dataset.forceCustom = "1";
		// Custom sizes are pre-cut labels; only the continuous entry makes one long label.
		if (state.doc.label.continuous) setLabel({ ...state.doc.label, continuous: false });
		renderLabelBar();
		$("#labelW").focus();
		return;
	}
	const [w, h] = v.split("x").map(Number);
	setLabel({ widthMm: w, heightMm: h, continuous: false });
	history.seal();
});
for (const id of ["#labelW", "#labelH"]) {
	$(id).addEventListener("input", () =>
		setLabel({
			widthMm: $("#labelW").valueAsNumber,
			heightMm: $("#labelH").valueAsNumber,
			continuous: false,
		}),
	);
	$(id).addEventListener("change", () => history.seal());
}
$("#labelLen").addEventListener("input", () =>
	setLabel({ ...state.doc.label, widthMm: $("#labelLen").valueAsNumber }),
);
$("#labelLen").addEventListener("change", () => history.seal());
$("#labelAutoLength").addEventListener("change", (ev) => {
	setLabel({ ...state.doc.label, autoLength: ev.target.checked });
	history.seal();
});

// Auto length: after each redraw (which has the fonts loaded and the fields filled in as
// previewed), the label takes the length its content needs. It's part of the edit that
// changed the content, so one undo takes back both.
onDrawn(() => {
	const l = state.doc.label;
	if (!l.continuous || !l.autoLength) return;
	const mm = contentLengthMm(previewDocument(), currentScale());
	if (mm !== l.widthMm) amend(withLength(state.doc, mm));
});

subscribe(renderLabelBar);
