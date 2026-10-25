// The label bar: pre-cut sizes for the printer in use, a continuous roll, or a custom size.
import { LIMITS, CONTINUOUS_LENGTH_MM, resizeLabel } from "../model.js";
import { labelDots } from "../render.js";
import { storageKey } from "../app-info.js";
import { $, el, loadJson, storeJson } from "./dom.js";
import { state, history, commit, subscribe } from "./store.js";
import { currentPrinter, onPrinterChange } from "./printing.js";

const presetKey = (l) => `${l.widthMm}x${l.heightMm}`;
// The sizes the printer being used takes; some models only take 12 mm labels, say.
const visiblePresets = () => currentPrinter().presets;

const renderPresetOptions = () => {
	const sel = $("#labelPreset");
	const presets = visiblePresets();
	const key = presets.map(presetKey).join() + currentPrinter().continuousHeightMm;
	if (sel.dataset.key === key) return;
	sel.dataset.key = key;
	// Grouped by what the printer does at the end of a label, which matters more than the size.
	sel.replaceChildren(
		el(
			"optgroup",
			{ label: "Pre-cut labels" },
			...presets.map((p) => new Option(`${p.widthMm} × ${p.heightMm} mm`, presetKey(p))),
			new Option("Custom size…", "custom"),
		),
		el(
			"optgroup",
			{ label: "Continuous tape" },
			new Option(`Continuous roll (${currentPrinter().continuousHeightMm} mm)`, "continuous"),
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
	for (const [id, v] of [
		["#labelW", l.widthMm],
		["#labelH", l.heightMm],
		["#labelLen", l.widthMm],
	]) {
		if (document.activeElement !== $(id)) $(id).value = v;
	}
	const kind = $("#labelKind");
	kind.dataset.kind = l.continuous ? "continuous" : "precut";
	kind.textContent = l.continuous
		? "Continuous tape: printed to length, then fed out to tear off"
		: "Pre-cut labels: the printer stops at each gap";
	const { width, height } = labelDots(l);
	$("#labelInfo").textContent = `${width} × ${height} dots`;
};

// The last label chosen for each printer model, so switching printers (or connecting one)
// brings back the roll that's usually in it.
const MEMORY_KEY = storageKey("labelByPrinter");
const remembered = () => loadJson(MEMORY_KEY) ?? {};
const remember = ({ widthMm, heightMm, continuous }) =>
	storeJson(MEMORY_KEY, {
		...remembered(),
		[currentPrinter().id]: { widthMm, heightMm, continuous },
	});

let printerId = currentPrinter().id;
onPrinterChange(() => {
	if (currentPrinter().id !== printerId) {
		printerId = currentPrinter().id;
		const l = remembered()[printerId];
		if (l) {
			setLabel({ widthMm: l.widthMm, heightMm: l.heightMm, continuous: l.continuous === true });
			history.seal();
		}
	}
	renderLabelBar();
});

const setLabel = (label) => {
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
	if (
		l.widthMm === label.widthMm &&
		l.heightMm === label.heightMm &&
		l.continuous === label.continuous
	)
		return;
	commit(resizeLabel(state.doc, label, { refitSimple: state.mode === "simple" }), {
		group: "label-size",
	});
};

$("#labelPreset").addEventListener("change", (ev) => {
	const v = ev.target.value;
	delete ev.target.dataset.forceCustom;
	if (v === "continuous") {
		const length = state.doc.label.continuous ? state.doc.label.widthMm : CONTINUOUS_LENGTH_MM;
		setLabel({ widthMm: length, heightMm: currentPrinter().continuousHeightMm, continuous: true });
		history.seal();
		$("#labelLen").focus();
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

subscribe(renderLabelBar);
