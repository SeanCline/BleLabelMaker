import { round } from "../units.js";
import { isTyping } from "./dom.js";
import {
	state,
	history,
	select,
	setSelection,
	selectedElements,
	updateElements,
	undo,
	redo,
} from "./store.js";
import { SNAP_MM } from "./stage.js";
import { setZoom, zoomStep } from "./viewport.js";
import { deleteSelected, duplicateSelected, rotateElements } from "./panels.js";
import { save, openPicker } from "./files.js";
import { print } from "./printing.js";

// Shortcuts that make sense even while a field has focus.
const GLOBAL = {
	s: save,
	o: openPicker,
	Enter: () => print(),
};

document.addEventListener("keydown", (ev) => {
	const mod = ev.ctrlKey || ev.metaKey;
	const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
	if (mod && GLOBAL[key]) {
		ev.preventDefault();
		GLOBAL[key]();
		return;
	}
	if (isTyping(ev.target)) return;
	// Elements list handles its own arrow keys (moving the selection).
	const inList = /** @type {Element} */ (ev.target).closest?.("#layers");
	if (mod && key === "z") {
		ev.preventDefault();
		ev.shiftKey ? redo() : undo();
		return;
	}
	if (mod && key === "y") {
		ev.preventDefault();
		redo();
		return;
	}
	if (!mod && (key === "+" || key === "=")) return zoomStep(1);
	if (!mod && (key === "-" || key === "_")) return zoomStep(-1);
	if (!mod && key === "0") return setZoom(1);
	if (state.mode !== "design") return;
	if (mod && key === "a") {
		ev.preventDefault();
		setSelection(state.doc.elements.map((e) => e.id));
		return;
	}
	const els = selectedElements();
	if (!els.length) return;
	if (mod && key === "d") {
		ev.preventDefault(); // the browser's bookmark shortcut
		duplicateSelected();
		return;
	}
	if (key === "Delete" || key === "Backspace") {
		ev.preventDefault();
		deleteSelected();
		return;
	}
	if (key === "Escape") {
		select(null);
		return;
	}
	if (key === "r" && !mod) {
		ev.preventDefault();
		rotateElements(els, ev.shiftKey ? 270 : 90);
		return;
	}
	const step = ev.shiftKey ? 1 : SNAP_MM;
	const d = {
		ArrowLeft: [-step, 0],
		ArrowRight: [step, 0],
		ArrowUp: [0, -step],
		ArrowDown: [0, step],
	}[key];
	if (d && !inList) {
		ev.preventDefault();
		const patches = {};
		for (const e of els) patches[e.id] = { x: round(e.x + d[0], 3), y: round(e.y + d[1], 3) };
		updateElements(patches, `nudge-${state.selectedIds.join()}`);
	}
});
document.addEventListener("keyup", (ev) => {
	if (ev.key.startsWith("Arrow")) history.seal();
});
