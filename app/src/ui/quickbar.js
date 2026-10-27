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
	const e = els.length === 1 ? els[0] : null;
	if (!e) closeSettings();
	// An empty label says so where the eye is, as the first-visit hint does; the bar has
	// nothing to change then. With nothing selected, the bar's room says what to do.
	const blank = !state.doc.elements.length;
	$("#emptyHint").hidden = !blank;
	bar.hidden = blank;
	bar.classList.toggle("empty", !els.length);
	if (!els.length) {
		for (const group of $$("[data-qb]", bar)) group.hidden = group.dataset.qb !== "empty";
		$("#barHint").textContent =
			`${touch.matches ? "Tap" : "Click"} something on the label to change it`;
		barKeys();
		place({ x: 0, y: 0, w: state.doc.label.widthMm, h: 0 });
		return;
	}
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

// On a phone the bar docks to the bottom of the screen (styles.css), above the on-screen
// keyboard; it's placed here only where it floats over the label.
const phone = matchMedia("(max-width: 600px)");
const touch = matchMedia("(pointer: coarse)");

/** The bar's width on one row, from its controls' own widths, which wrapping doesn't change. */
const oneRowWidth = () => {
	const css = getComputedStyle(bar);
	// A text's controls are the bar's own items (display: contents in styles.css).
	const items = [...bar.children]
		.filter((c) => !(/** @type {HTMLElement} */ (c).hidden))
		.flatMap((c) => (getComputedStyle(c).display === "contents" ? [...c.children] : [c]))
		.filter((c) => c.getClientRects().length);
	const sum = items.reduce((w, c) => w + /** @type {HTMLElement} */ (c).offsetWidth, 0);
	const frame = bar.offsetWidth - bar.clientWidth + parseFloat(css.paddingLeft) * 2;
	return sum + parseFloat(css.columnGap) * (items.length - 1) + frame;
};
/** Each set of controls' full width, measured while the bar last showed it untightened. */
const fullWidths = new Map();
/**
 * Tightens the bar when its full width won't fit on one row, and loosens it once it would.
 * Measured as it is, never by trying the other way: changing the bar to measure it made a
 * slider being dragged in it jump.
 */
const tighten = (room) => {
	// Which controls are showing: a kind of element, and typing or not, has its own width.
	const shown = [...bar.querySelectorAll("[data-qb], button, select, input")]
		.map((c) => (c.getClientRects().length || getComputedStyle(c).display === "contents" ? 1 : 0))
		.join("");
	const compact = bar.classList.contains("compact");
	if (compact && fullWidths.has(shown)) {
		if (fullWidths.get(shown) <= room) bar.classList.remove("compact");
		return;
	}
	// Controls not seen untightened yet (another kind selected) are measured untightened.
	if (compact) bar.classList.remove("compact");
	const full = oneRowWidth();
	fullWidths.set(shown, full);
	if (full > room) bar.classList.add("compact");
};

/** Above the label, centred on what it's for, kept inside the stage. */
const place = (box) => {
	if (phone.matches) {
		Object.assign(bar.style, { left: "", top: "", maxWidth: "" });
		stage.style.paddingTop = "";
		return;
	}
	const o = overlay.getBoundingClientRect();
	const s = stage.getBoundingClientRect();
	const k = o.width / state.doc.label.widthMm;
	// Clear of the rail, whose room is the stage's left padding: a bar too wide for the rest
	// wraps, rather than covering the rail's buttons.
	const railEdge = s.left + parseFloat(getComputedStyle(stage).paddingLeft) - 8;
	// Its width is its content's (styles.css), not what's left of the window right of it, so
	// it's measured where it is. Moving it away to measure, even for a moment, made a slider
	// being dragged in it jump to its end in some browsers.
	const roomRight = s.right - 8 - railEdge;
	bar.style.maxWidth = `${roomRight}px`;
	tighten(roomRight);
	// On a narrow screen the bar wraps; the label moves down rather than going under it.
	const room = `${Math.max(56, bar.offsetHeight + 20)}px`;
	if (stage.style.paddingTop !== room) {
		stage.style.paddingTop = room;
		return place(box);
	}
	const centre = o.left + (box.x + box.w / 2) * k;
	const x = Math.max(
		Math.min(centre - bar.offsetWidth / 2, s.right - bar.offsetWidth - 8),
		railEdge,
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
	// Typing carries on behind the settings, so a weight picked there is for the words selected.
	if (action === "more") settings.hidden ? openSettings() : closeSettings();
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
// Leaving the bar or the settings for anywhere but the text ends the typing, as leaving the
// text does.
const keepTyping = (ev) => {
	const to = /** @type {Element} */ (ev.relatedTarget);
	if (!inlineEdit() || bar.contains(to) || settings.contains(to) || to?.matches(".inline-edit"))
		return;
	stopInlineEdit();
};
bar.addEventListener("focusout", keepTyping);
settings.addEventListener("focusout", keepTyping);
// The settings' own copy of the text and the label can't both be typed on at once.
settings.addEventListener("focusin", (ev) => {
	if (/** @type {Element} */ (ev.target).matches('[data-prop="text"]')) stopInlineEdit();
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
	if (phone.matches) {
		// A sheet resting on the docked bar.
		Object.assign(settings.style, {
			top: "",
			left: "",
			bottom: `${innerHeight - b.top}px`,
			maxHeight: "",
		});
		return;
	}
	settings.style.bottom = "";
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
phone.addEventListener("change", render);
// How much of the window the on-screen keyboard covers, for what's docked above it.
const keyboard = () => {
	const v = visualViewport;
	const covered = Math.max(0, Math.round(innerHeight - v.height - v.offsetTop));
	document.documentElement.style.setProperty("--keyboard", `${covered}px`);
	render();
};
visualViewport?.addEventListener("resize", keyboard);
visualViewport?.addEventListener("scroll", keyboard);
stage.addEventListener("scroll", render);
render();
