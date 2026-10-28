// The Elements list beside the rail: every element, front first, to pick from (it's a listbox
// for the keyboard) and, by each row's grip or Alt+arrows, to restack.
import { $, $$, el, announce } from "./dom.js";
import { contentOf, describeElement, typeName } from "./describe.js";
import { state, history, commit, select, toggleSelected, subscribe } from "./store.js";

const LAYER_KIND = { text: "T", shape: "▭", barcode: "║", qr: "▦", image: "▣" };

const gripIcon = () => {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", "icon");
	const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
	use.setAttribute("href", "icons/ui.svg#grip-vertical");
	svg.append(use);
	return svg;
};

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
				el(
					"span",
					{ className: "grip", title: "Drag to reorder", "aria-hidden": "true" },
					gripIcon(),
				),
				el("span", { className: "kind", "aria-hidden": "true" }, LAYER_KIND[e.type] ?? "▭"),
				el("span", { className: "sr-only" }, `${typeName(e)}: `),
				contentOf(e) || typeName(e),
			),
		),
	);
	if (hadFocus) $(`#layers [data-id="${focusId}"]`)?.focus();
};

/** Restacks the elements in the order the list shows them, top of the list in front. */
const restack = (ids) => {
	const byId = new Map(state.doc.elements.map((e) => [e.id, e]));
	const elements = ids.map((id) => byId.get(id)).reverse();
	if (elements.every((e, i) => e === state.doc.elements[i])) return;
	commit({ ...state.doc, elements });
	history.seal();
};
const listedIds = () => $$("#layers li").map((li) => li.dataset.id);

// White prints as nothing, so the stacking order rarely shows; for when it does, a grip on
// each row drags it up or down the list. The row moves as it's dragged, and the order is
// committed once, on letting go, so the drag is one undo step.
let dragged = null;
$("#layers").addEventListener("pointerdown", (ev) => {
	const grip = ev.target.closest(".grip");
	if (!grip) return;
	ev.preventDefault();
	grip.setPointerCapture(ev.pointerId);
	dragged = grip.closest("li");
	dragged.classList.add("dragging");
});
$("#layers").addEventListener("pointermove", (ev) => {
	if (!dragged) return;
	const over = $$("#layers li").find((li) => {
		const r = li.getBoundingClientRect();
		return li !== dragged && ev.clientY >= r.top && ev.clientY < r.bottom;
	});
	if (!over) return;
	if (over.compareDocumentPosition(dragged) & Node.DOCUMENT_POSITION_PRECEDING) over.after(dragged);
	else over.before(dragged);
});
const drop = () => {
	if (!dragged) return;
	dragged.classList.remove("dragging");
	dragged = null;
	restack(listedIds());
};
$("#layers").addEventListener("pointerup", drop);
$("#layers").addEventListener("pointercancel", drop);

$("#layers").addEventListener("click", (ev) => {
	if (ev.target.closest(".grip")) return;
	const li = ev.target.closest("li");
	if (!li) return;
	if (ev.ctrlKey || ev.metaKey || ev.shiftKey) toggleSelected(li.dataset.id);
	else select(li.dataset.id);
});
$("#layers").addEventListener("keydown", (ev) => {
	const items = $$("#layers li");
	const i = items.indexOf(document.activeElement);
	// Alt+arrows move the element up or down the list, as dragging its grip does.
	if (ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown") && i >= 0) {
		ev.preventDefault();
		ev.stopPropagation();
		const ids = items.map((li) => li.dataset.id);
		const j = i + (ev.key === "ArrowUp" ? -1 : 1);
		if (j < 0 || j >= ids.length) return;
		[ids[i], ids[j]] = [ids[j], ids[i]];
		restack(ids);
		$(`#layers [data-id="${ids[j]}"]`)?.focus();
		announce(ev.key === "ArrowUp" ? "Moved forward" : "Moved back");
		return;
	}
	const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[ev.key];
	if (next === undefined || !items.length) return;
	ev.preventDefault();
	ev.stopPropagation(); // arrows here pick an element; they don't nudge it
	const target = items[Math.max(0, Math.min(items.length - 1, next))];
	select(target.dataset.id);
	announce(describeElement(state.doc.elements.find((e) => e.id === target.dataset.id)));
});

subscribe(renderLayers);
