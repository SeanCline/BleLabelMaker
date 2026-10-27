// Keyboard for a toolbar (the WAI-ARIA toolbar pattern): its buttons are one Tab stop, and
// the arrow keys, Home and End move between its controls. Fields in it (font, size, data)
// keep their own Tab stop and their own arrow keys, so nothing in it is out of reach.
import { $$ } from "./dom.js";

const FIELDS = "input, select, textarea";
const CONTROLS = `button, summary, ${FIELDS}`;

/**
 * @param {HTMLElement} toolbar
 * @param {{vertical?: boolean}} [options] how it's laid out where there's room, for screen readers
 * @returns {() => void} call after the toolbar shows or hides controls, to keep a Tab stop
 */
export const rovingToolbar = (toolbar, { vertical = false } = {}) => {
	toolbar.setAttribute("role", "toolbar");
	if (vertical) toolbar.setAttribute("aria-orientation", "vertical");
	const controls = () =>
		/** @type {HTMLElement[]} */ (
			$$(CONTROLS, /** @type {any} */ (toolbar)).filter(
				(c) => !(/** @type {any} */ (c).disabled) && c.checkVisibility() && !c.closest("[hidden]"),
			)
		);
	const buttons = () => controls().filter((c) => !c.matches(FIELDS));
	let current = null;
	/** The button that's the Tab stop: the last one used, while it's still there. */
	const refresh = () => {
		const all = buttons();
		if (!all.includes(current)) current = all[0] ?? null;
		for (const b of $$("button, summary", /** @type {any} */ (toolbar)))
			b.tabIndex = b === current ? 0 : -1;
	};
	toolbar.addEventListener("focusin", (ev) => {
		const t = /** @type {HTMLElement} */ (ev.target);
		if (t.matches(FIELDS) || !t.matches(CONTROLS)) return;
		current = t;
		refresh();
	});
	toolbar.addEventListener("keydown", (ev) => {
		const t = /** @type {HTMLElement} */ (ev.target);
		// A field's own arrows move its cursor or change its value.
		if (t.matches(FIELDS) || ev.altKey || ev.ctrlKey || ev.metaKey) return;
		const all = controls();
		const i = all.indexOf(t);
		if (i < 0) return;
		// Both pairs of arrows: the rail lies down the label on a desktop and along it on a phone.
		const back = (i - 1 + all.length) % all.length;
		const on = (i + 1) % all.length;
		const to = {
			ArrowLeft: back,
			ArrowUp: back,
			ArrowRight: on,
			ArrowDown: on,
			Home: 0,
			End: all.length - 1,
		}[ev.key];
		if (to === undefined) return;
		ev.preventDefault();
		// The page's own arrow keys nudge the selection; these are the toolbar's.
		ev.stopPropagation();
		all[to].focus();
	});
	refresh();
	return refresh;
};
