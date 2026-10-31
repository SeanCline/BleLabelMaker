// Menus that drop down from a button (File, the printer, Print's options, the label size, the
// list of elements): clicking away or Esc closes them, and picking from one is what it was
// opened for. They're <details>, so opening is the browser's.
import { $, $$ } from "./dom.js";

const layersMenu = /** @type {HTMLDetailsElement} */ ($("#layersMenu"));
const menus = /** @type {HTMLDetailsElement[]} */ ([...$$("details.menu"), layersMenu]);

document.addEventListener("pointerdown", (ev) => {
	const t = /** @type {Element} */ (ev.target);
	// A dialog opened from one isn't clicking away.
	if (t.closest("dialog")) return;
	for (const menu of menus) if (!menu.contains(t)) menu.open = false;
});
// Before the page's own Esc deselects the element.
document.addEventListener(
	"keydown",
	(ev) => {
		if (ev.key !== "Escape") return;
		// An open list (dropdown.js) in one closes first, on its own Esc.
		if (/** @type {Element} */ (ev.target).matches?.('[aria-expanded="true"]')) return;
		const menu = menus.find((m) => m.open);
		if (!menu) return;
		ev.stopPropagation();
		menu.open = false;
		menu.querySelector("summary").focus();
	},
	true,
);

// Picking an element from the list is what the list was opened for; reordering isn't.
$("#layers").addEventListener("click", (ev) => {
	const plain = !(ev.ctrlKey || ev.metaKey || ev.shiftKey);
	const target = /** @type {Element} */ (ev.target);
	if (plain && target.closest("li") && !target.closest(".grip")) layersMenu.open = false;
});
$("#fileMenu .menu-list").addEventListener("click", () => ($("#fileMenu").open = false));
