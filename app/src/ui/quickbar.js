// The bar over the label: the selected element's essentials where the eye already is, so
// the settings sheet ("More…") is only for the rest. Typing on a text swaps in what applies
// to the typing; several selected elements get aligning and spacing.
// The bar is a [data-panel] like the settings' sections, so panels.js binds its fields.
import { boundsOf } from "../model.js";
import { fontInfo, nearestWeight, weightsFor } from "../fonts.js";
import { clearStyle, stylesBetween, textOf } from "../richtext.js";
import { $, $$ } from "./dom.js";
import {
	state,
	history,
	selectedElements,
	elementById,
	updateElement,
	subscribe,
} from "./store.js";
import { deleteSelected, duplicateSelected, syncProps } from "./panels.js";
import { rovingToolbar } from "./toolbar.js";
import {
	inlineEdit,
	onDrawn,
	onInlineChange,
	refocusInline,
	startInlineEdit,
	stopInlineEdit,
	toggleStyle,
} from "./stage.js";

const bar = $("#quickbar");
const stage = $("#stage");
const overlay = $("#overlay");
const settings = $("#settings");
const more = $('[data-qb-action="more"]', bar);
const layersMenu = /** @type {HTMLDetailsElement} */ ($("#layersMenu"));
/** Menus that drop down from a button: File, the printer, Print's options, the label size. */
const menus = /** @type {HTMLDetailsElement[]} */ ([...$$("details.menu"), layersMenu]);
const BOLD = 600;
const barKeys = rovingToolbar(bar);
rovingToolbar($(".rail"), { vertical: true });

/**
 * What the bar is for: the text being typed, simple mode's one text, or what's selected.
 * @returns {import("../model.js").Element[]}
 */
const targets = () => {
	// The text being typed can be gone, as when a file is opened over it.
	const typing = inlineEdit() && elementById(inlineEdit().id);
	if (typing) return [typing];
	return selectedElements();
};

/** How much of the text (the selection, or all of it) has a style: "true", "false", "mixed". */
const pressed = (e, prop) => {
	const editing = inlineEdit();
	const from = editing?.from ?? 0;
	const to = editing?.to ?? textOf(e.text).length;
	const pending =
		editing && from === to && editing.pending?.at === from ? editing.pending.style : {};
	const looks = stylesBetween(e.text, from, to, e).map((s) => ({ ...s, ...pending }));
	const on = looks.map((s) => (prop === "fontWeight" ? s.fontWeight >= BOLD : !!s[prop]));
	if (on.every(Boolean)) return "true";
	return on.some(Boolean) ? "mixed" : "false";
};

const render = () => {
	const els = targets();
	bar.hidden = !els.length;
	const e = els.length === 1 ? els[0] : null;
	if (!e) closeSettings();
	if (!els.length) return;
	const editing = !!inlineEdit();
	for (const group of $$("[data-qb]", bar)) {
		const kind = group.dataset.qb;
		group.hidden = kind === "common" ? false : kind === "multi" ? els.length < 2 : kind !== e?.type;
	}
	for (const b of $$('[data-qb-action="duplicate"], [data-qb-action="delete"]', bar))
		b.hidden = editing;
	more.hidden = !e;
	$('[data-qb-action="edit"]', bar).hidden = editing;
	$('[data-qb-action="done"]', bar).hidden = !editing;
	if (e) syncProps(bar, e);
	if (e?.type === "text") {
		for (const b of $$("[data-style]", bar))
			b.setAttribute("aria-pressed", pressed(e, b.dataset.style));
		$('[data-style="italic"]', bar).disabled = !(fontInfo(e.fontFamily)?.italic ?? true);
		$('[data-style="fontWeight"]', bar).disabled = Math.max(...weightsFor(e.fontFamily)) < BOLD;
	}
	barKeys();
	place(boundsOf(els));
	if (!settings.hidden) placeSettings();
};

/** Above the label, centred on what it's for, kept inside the stage. */
const place = (box) => {
	const o = overlay.getBoundingClientRect();
	const s = stage.getBoundingClientRect();
	const k = o.width / state.doc.label.widthMm;
	// From the left edge, so its width is its own and not what was left of the window.
	bar.style.left = "0px";
	bar.style.maxWidth = `${s.width - 16}px`;
	// On a narrow screen the bar wraps; the label moves down rather than going under it.
	const room = `${Math.max(56, bar.offsetHeight + 20)}px`;
	if (stage.style.paddingTop !== room) {
		stage.style.paddingTop = room;
		return place(box);
	}
	const centre = o.left + (box.x + box.w / 2) * k;
	const x = Math.min(
		// Clear of the rail, whose room is the stage's left padding.
		Math.max(
			centre - bar.offsetWidth / 2,
			s.left + parseFloat(getComputedStyle(stage).paddingLeft) - 8,
		),
		s.right - bar.offsetWidth - 8,
	);
	// Over the label only when it's scrolled so far there's no room above it.
	const y = Math.max(o.top - bar.offsetHeight - 10, s.top + 4);
	Object.assign(bar.style, { left: `${x}px`, top: `${y}px` });
};

// Styling the whole box, when nothing's being typed: the same buttons, for every word.
const styleBox = (e, prop) => {
	const on = pressed(e, prop) !== "true";
	const value = prop === "fontWeight" ? nearestWeight(e.fontFamily, on ? 700 : 400) : on;
	updateElement(e.id, { [prop]: value, text: clearStyle(e.text, prop) });
	history.seal();
};

// Buttons mustn't take the focus from the text being typed, or typing would stop.
bar.addEventListener("pointerdown", (ev) => {
	if (inlineEdit() && /** @type {Element} */ (ev.target).closest("button")) ev.preventDefault();
});

bar.addEventListener("click", (ev) => {
	const b = /** @type {HTMLElement} */ (ev.target).closest("button");
	const [e] = targets();
	if (!b || !e) return;
	if (b.dataset.style) {
		if (inlineEdit()) toggleStyle(b.dataset.style);
		else styleBox(e, b.dataset.style);
		render();
		return;
	}
	const action = b.dataset.qbAction;
	if (action === "edit") startInlineEdit(e.id);
	if (action === "done") stopInlineEdit();
	if (action === "duplicate") duplicateSelected();
	if (action === "delete") deleteSelected();
	if (action === "more") {
		stopInlineEdit();
		settings.hidden ? openSettings() : closeSettings();
	}
});

// A field picked while typing hands the focus back, so typing carries on where it was.
bar.addEventListener("change", (ev) => {
	if (inlineEdit() && /** @type {Element} */ (ev.target).matches("select")) refocusInline();
});
bar.addEventListener("keydown", (ev) => {
	if (!inlineEdit() || (ev.key !== "Enter" && ev.key !== "Escape")) return;
	ev.preventDefault();
	ev.stopPropagation();
	refocusInline();
});
// Leaving the bar for anywhere but the text ends the typing, as leaving the text does.
bar.addEventListener("focusout", (ev) => {
	const to = /** @type {Element} */ (ev.relatedTarget);
	if (!inlineEdit() || bar.contains(to) || to?.matches(".inline-edit")) return;
	stopInlineEdit();
});

// ---------------------------------------------------------------------------
// Settings: everything about the element, in a sheet under the bar.

const openSettings = () => {
	settings.hidden = false;
	more.setAttribute("aria-expanded", "true");
	placeSettings();
	// So Tab goes on into it, and a screen reader says what opened.
	settings.focus({ preventScroll: true });
};
function closeSettings() {
	if (settings.hidden) return;
	settings.hidden = true;
	more.setAttribute("aria-expanded", "false");
	if (settings.contains(document.activeElement)) more.focus();
}
/** Under the bar, as far down the window as there's room for. */
const placeSettings = () => {
	const b = bar.getBoundingClientRect();
	const top = b.bottom + 6;
	const left = Math.max(8, Math.min(b.left, innerWidth - settings.offsetWidth - 8));
	Object.assign(settings.style, {
		top: `${top}px`,
		left: `${left}px`,
		maxHeight: `${innerHeight - top - 8}px`,
	});
};

// Clicking away closes the settings and the menus (File, the list of elements).
document.addEventListener("pointerdown", (ev) => {
	const t = /** @type {Element} */ (ev.target);
	// A dialog opened from them (the emoji picker) isn't clicking away.
	if (t.closest("dialog")) return;
	if (!settings.contains(t) && !bar.contains(t)) closeSettings();
	for (const menu of menus) if (!menu.contains(t)) menu.open = false;
});
// Esc closes them first, before the page's own Esc deselects the element.
document.addEventListener(
	"keydown",
	(ev) => {
		if (ev.key !== "Escape") return;
		if (!settings.hidden) {
			ev.stopPropagation();
			closeSettings();
		} else {
			const menu = menus.find((m) => m.open);
			if (!menu) return;
			ev.stopPropagation();
			menu.open = false;
			menu.querySelector("summary").focus();
		}
	},
	true,
);
// Picking an element from the list is what the list was opened for.
$("#layers").addEventListener("click", (ev) => {
	const plain = !(ev.ctrlKey || ev.metaKey || ev.shiftKey);
	if (plain && /** @type {Element} */ (ev.target).closest("li")) layersMenu.open = false;
});
$("#fileMenu .menu-list").addEventListener("click", () => ($("#fileMenu").open = false));

subscribe(render);
onInlineChange(render);
onDrawn(render);
addEventListener("resize", render);
stage.addEventListener("scroll", render);
render();
