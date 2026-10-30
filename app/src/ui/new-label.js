// New: pick a starting point. Templates show what the app can do, which a blank label doesn't.
import { TEMPLATES, fromTemplate } from "../templates.js";
import { fillDocument } from "../fields.js";
import { parseBatch } from "../batch.js";
import { thumbnails } from "./thumbs.js";
import { $, el, toast } from "./dom.js";
import { state, commit, history } from "./store.js";
import { hasBatch, openBatch, setBatch } from "./batch.js";

const dialog = $("#newDialog");
const list = $("#templateList");

const drawThumbs = thumbnails();
const renderList = () => {
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
		return { item, thumb, template: t };
	});
	list.replaceChildren(...jobs.map((j) => j.item));
	// Thumbnails show fields filled in, as the preview does, so "{date}" reads as a date and a
	// list's column as its first sample line.
	const now = new Date();
	drawThumbs(
		jobs.map(({ thumb, template }) => [
			thumb,
			() => {
				// The first sample line, read as a real list is, so its columns fill {1}, {2}…
				const sample = template.batch ? parseBatch(template.batch) : null;
				return fillDocument(fromTemplate(template, label), {
					now,
					n: 1,
					row: sample?.rows[0] ?? null,
					line: sample?.lines[0],
					columns: null,
				});
			},
		]),
	);
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
