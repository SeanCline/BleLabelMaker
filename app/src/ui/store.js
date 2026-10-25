import { createDocument } from "../model.js";
import { plainText } from "../layout.js";
import { parse, serialize } from "../fileformat.js";
import { History } from "../history.js";
import { loadText, storeJson } from "./dom.js";
import { storageKey } from "../app-info.js";

const AUTOSAVE_KEY = storageKey("autosave");

/**
 * @type {{doc: import("../model.js").Doc, mode: "simple"|"design", selectedIds: string[],
 *   readonly selectedId: string|null}}
 */
export const state = {
	doc: createDocument(),
	mode: "simple",
	/** In selection order; the panel edits an element only when it's the only one selected. */
	selectedIds: [],
	/** The selected element's id when exactly one is selected, else null. */
	get selectedId() {
		return this.selectedIds.length === 1 ? this.selectedIds[0] : null;
	},
};

const restoreAutosave = () => {
	try {
		const raw = loadText(AUTOSAVE_KEY);
		if (!raw) return;
		const { doc, editor } = parse(raw);
		state.doc = doc;
		state.mode = editor.mode;
		state.selectedIds = editor.selectedIds;
	} catch {
		// A corrupt autosave must never block startup.
	}
};
restoreAutosave();

const snapshot = () => ({ doc: state.doc, mode: state.mode });
export const history = new History(snapshot());

const listeners = new Set();
/** Listeners run after every state change; they re-render whatever they own. */
export const subscribe = (fn) => listeners.add(fn);
export const notify = () => {
	for (const fn of listeners) fn(state);
	scheduleAutosave();
};

// A drag commits every frame, and serializing the label (images and all) that often is
// wasted work; save once things settle, and straight away if the page is going away.
let autosaveTimer = null;
const autosave = () => {
	clearTimeout(autosaveTimer);
	autosaveTimer = null;
	storeJson(AUTOSAVE_KEY, currentFile());
};
const scheduleAutosave = () => {
	clearTimeout(autosaveTimer);
	autosaveTimer = setTimeout(autosave, 300);
};
addEventListener("pagehide", () => autosaveTimer && autosave());
addEventListener("visibilitychange", () => document.hidden && autosaveTimer && autosave());

export const currentFile = () =>
	serialize(state.doc, { mode: state.mode, selectedIds: state.selectedIds });

/** The selected element when exactly one is selected (what the property panel edits). */
export const selected = () => state.doc.elements.find((e) => e.id === state.selectedId) ?? null;
/** Every selected element, in z-order (bottom first). */
export const selectedElements = () =>
	state.doc.elements.filter((e) => state.selectedIds.includes(e.id));
export const isSelected = (id) => state.selectedIds.includes(id);
export const elementById = (id) => state.doc.elements.find((e) => e.id === id) ?? null;

const dropStaleSelection = () => {
	if (state.selectedIds.some((id) => !elementById(id))) {
		state.selectedIds = state.selectedIds.filter((id) => elementById(id));
	}
};

/**
 * Every document change goes through here so undo, autosave and rendering stay in sync.
 * @param {import("../model.js").Doc} doc
 * @param {{group?: string|null, mode?: "simple"|"design", selectedIds?: string[]}} [options]
 *   selectedIds: what to select afterwards (default: keep what's selected, if it still exists)
 */
export const commit = (
	doc,
	{ group = null, mode = state.mode, selectedIds = state.selectedIds } = {},
) => {
	state.doc = doc;
	state.mode = mode;
	state.selectedIds = selectedIds;
	dropStaleSelection();
	history.push(snapshot(), group);
	notify();
};

const patched = (e, patch) =>
	e.type === "text" && "text" in patch
		? { ...e, ...patch, text: plainText(patch.text) }
		: { ...e, ...patch };

export const updateElement = (id, patch, group) => updateElements({ [id]: patch }, group);

/**
 * Patches several elements in one undo step.
 * @param {Record<string, object>} patches by element id
 * @param {string} [group] consecutive updates with the same group undo together
 */
export const updateElements = (patches, group) =>
	commit(
		{
			...state.doc,
			elements: state.doc.elements.map((e) => (patches[e.id] ? patched(e, patches[e.id]) : e)),
		},
		{ group },
	);

/** @param {string[]} ids */
export const setSelection = (ids) => {
	if (ids.length === state.selectedIds.length && ids.every((id, i) => id === state.selectedIds[i]))
		return;
	state.selectedIds = ids;
	notify();
};
/** Selects just this element, or nothing. */
export const select = (id) => setSelection(id ? [id] : []);
/** Adds the element to the selection, or takes it out (Shift/Ctrl-click). */
export const toggleSelected = (id) =>
	setSelection(
		isSelected(id) ? state.selectedIds.filter((x) => x !== id) : [...state.selectedIds, id],
	);

const applySnapshot = (snap) => {
	if (!snap) return;
	state.doc = snap.doc;
	state.mode = snap.mode;
	dropStaleSelection();
	notify();
};
export const undo = () => applySnapshot(history.undo());
export const redo = () => applySnapshot(history.redo());

/** Replaces the whole editor state (file open); undoable like any other change. */
export const loadState = ({ doc, editor }) => {
	commit(doc, { mode: editor.mode, selectedIds: editor.selectedIds });
	history.seal();
};
