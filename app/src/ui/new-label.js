// New: pick a starting point. Templates show what the app can do, which a blank label doesn't.
import { TEMPLATES, fromTemplate } from "../templates.js";
import { fillDocument } from "../fields.js";
import { renderLabel } from "../render.js";
import { currentScale } from "./settings.js";
import { ensureFontsFor } from "../fonts.js";
import { $, el, toast } from "./dom.js";
import { state, commit, history } from "./store.js";
import { hasBatch, openBatch, setBatch } from "./batch.js";

const dialog = $("#newDialog");
const list = $("#templateList");

let thumbToken = 0;
const renderList = async () => {
	const label = state.doc.label;
	$("#newLabelSize").textContent = label.continuous
		? `${label.heightMm} mm continuous tape`
		: `${label.widthMm} × ${label.heightMm} mm labels`;
	const jobs = TEMPLATES.map((t) => {
		const thumb = el("canvas", { className: "thumb" });
		const item = el(
			"li",
			{},
			el(
				"button",
				{ className: "template", dataset: { id: t.id } },
				el("span", { className: "thumb-frame" }, thumb),
				el("strong", {}, t.name),
				el("span", { className: "hint" }, t.description),
			),
		);
		return { item, thumb, doc: fromTemplate(t, label), row: t.batch?.split("\n").slice(0, 1) };
	});
	list.replaceChildren(...jobs.map((j) => j.item));
	// Thumbnails show fields filled in, as the preview does, so "{date}" reads as a date and a
	// list's column as its first sample line.
	const token = ++thumbToken;
	for (const { thumb, doc, row } of jobs) {
		const filled = fillDocument(doc, { now: new Date(), n: 1, row: row ?? null, columns: null });
		await ensureFontsFor(filled);
		if (token !== thumbToken) return;
		await renderLabel(filled, thumb, { dots: currentScale() });
	}
};

list.addEventListener("click", (ev) => {
	const id = ev.target.closest("[data-id]")?.dataset.id;
	const template = TEMPLATES.find((t) => t.id === id);
	if (!template) return;
	const doc = fromTemplate(template, state.doc.label);
	commit(doc, { selectedIds: doc.elements.slice(0, 1).map((e) => e.id) });
	history.seal();
	dialog.close();
	// Its sample lines show how a list fills the label, but never replace a list already there.
	if (template.batch) {
		if (!hasBatch()) setBatch(template.batch);
		openBatch();
		return toast("Replace the sample lines with yours: type, paste or open a CSV.");
	}
	toast(
		`New ${template.id === "blank" ? "label" : template.name.toLowerCase()}. Undo (Ctrl+Z) brings the previous one back.`,
	);
});

$("#btnNew").addEventListener("click", () => {
	renderList();
	dialog.showModal();
	list.querySelector("button")?.focus();
});
