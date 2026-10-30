// The batch list: paste lines or spreadsheet cells (or open a CSV), and each row prints as
// its own label, with {1}, {2}… or {Column name} in the design filled from that row.
// The list is a per-browser convenience (local storage), not part of the .label file: the
// same design is often printed with different lists.
import { parseBatch } from "../batch.js";
import { $, loadJson, storeJson, toast, plural } from "./dom.js";
import { storageKey } from "../app-info.js";
import { signal } from "./signal.js";

const KEY = storageKey("batch");
const saved = { text: "", headings: false, csv: false, ...loadJson(KEY) };
let preview = 0;
let parsed = parseBatch(saved.text, saved);
const batchChanged = signal();
/** Called when the list or the previewed row changes. */
export const onBatchChange = batchChanged.on;

/** The rows to print, or null when the list is empty (a normal print). */
export const batchData = () => (parsed.rows.length ? parsed : null);
/** Which row the canvas previews. */
export const previewRow = () => Math.min(preview, Math.max(0, parsed.rows.length - 1));

const changed = () => {
	parsed = parseBatch(saved.text, saved);
	storeJson(KEY, saved);
	render();
	batchChanged.emit();
};

const render = () => {
	const n = parsed.rows.length;
	if ($("#batchData").value !== saved.text) $("#batchData").value = saved.text;
	$("#batchHeadings").checked = saved.headings;
	$("#batchSummary").textContent = n ? `· ${plural(n, "label")}` : "";
	$("#batchCount").hidden = n === 0;
	$("#batchCount").textContent = n ? String(n) : "";
	$("#btnBatch").classList.toggle("active", n > 0);
	$("#btnBatch").setAttribute(
		"aria-label",
		n ? `Batch: ${plural(n, "label")} from a list` : "Batch",
	);
	// On the label area while there's a list: which row it shows, and the way back to the list.
	$("#batchNav").hidden = n === 0;
	$("#batchPos").textContent = n ? `Row ${previewRow() + 1} of ${n}` : "";
	$("#batchPrev").disabled = previewRow() === 0;
	$("#batchNext").disabled = previewRow() >= n - 1;
	const cols = parsed.columns ?? parsed.rows[0]?.map((_, i) => String(i + 1)) ?? [];
	$("#batchHint").textContent = n
		? `Columns: ${cols.map((c) => `{${c}}`).join(" ")}. Put them in your text, barcode or QR code.`
		: "";
	// With one column, {0} is just {1}.
	$("#batchWhole").hidden = cols.length < 2;
};

/** Whether there's a list now, which a template's sample rows mustn't replace. */
export const hasBatch = () => parsed.rows.length > 0;

/** Puts a list in the batch, as if pasted there, and shows the first row. */
export const setBatch = (text) => {
	saved.text = text;
	saved.csv = false;
	saved.headings = false;
	preview = 0;
	changed();
};

$("#batchData").addEventListener("input", (ev) => {
	saved.text = ev.target.value;
	// Typed or pasted text is read as CSV only when it looks like it (batch.js); an opened .csv
	// file always is.
	saved.csv = false;
	changed();
});
$("#batchHeadings").addEventListener("change", (ev) => {
	saved.headings = ev.target.checked;
	changed();
});
$("#batchClear").addEventListener("click", () => {
	saved.text = "";
	preview = 0;
	changed();
});
$("#batchOpen").addEventListener("click", () => $("#batchFile").click());
$("#batchFile").addEventListener("change", async (ev) => {
	const file = ev.target.files[0];
	ev.target.value = "";
	if (!file) return;
	if (file.size > 2_000_000)
		return toast("That file is too big for a batch list.", { error: true });
	saved.text = await file.text();
	saved.csv = /\.csv$/i.test(file.name);
	preview = 0;
	changed();
});
const step = (d) => {
	preview = Math.max(0, Math.min(parsed.rows.length - 1, previewRow() + d));
	render();
	batchChanged.emit();
};
$("#batchPrev").addEventListener("click", () => step(-1));
$("#batchNext").addEventListener("click", () => step(1));

const sheet = $("#batchSheet");
/** Opens the batch list, with the cursor in it. */
export const openBatch = () => {
	sheet.hidden = false;
	$("#batchData").focus();
};
const closeBatch = () => {
	sheet.hidden = true;
};
$("#batchEdit").addEventListener("click", openBatch);
$("#batchClose").addEventListener("click", closeBatch);
sheet.addEventListener("keydown", (ev) => {
	if (ev.key !== "Escape") return;
	ev.stopPropagation();
	closeBatch();
});
$("#btnBatch").addEventListener("click", openBatch);

// A list from last time shows on the label area (and in the Print button's count), so a
// batch print is never a surprise.
render();
