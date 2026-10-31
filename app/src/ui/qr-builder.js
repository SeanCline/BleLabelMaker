// The QR code's builder: what it holds (a link, Wi-Fi, a contact…) as a few fields in the
// settings, with the main one on the bar. The element keeps the text they make
// (qrcontent.js), so fields like {1} and printing work on it as on any QR code.
import {
	QR_KINDS,
	QR_KIND_NAMES,
	convertContent,
	decodeContent,
	encodeContent,
	primaryField,
} from "../codes/qrcontent.js";
import { $, $$, el, icon, showChoice } from "./dom.js";
import { dropdown } from "./dropdown.js";
import { hasBatch, onBatchChange } from "./batch.js";
import { history, selected, subscribe, updateElement } from "./store.js";
import { onDrawn, renderNotes } from "./canvas.js";

const fieldsBox = $("#qrFields");
const primary = /** @type {HTMLInputElement} */ ($("#quickbar [data-qr-primary]"));
const bytes = new TextEncoder();

/** @returns {import("../model.js").QrElement | null} */
const current = () => {
	const e = selected();
	return e?.type === "qr" ? e : null;
};

/** Sets one of the kind's fields, and with it the text the code holds. */
const write = (key, value) => {
	const e = current();
	if (!e) return;
	const values = { ...decodeContent(e.kind, e.data), [key]: value };
	updateElement(e.id, { data: encodeContent(e.kind, values) }, `${e.id}:data`);
};

/** @param {import("../codes/qrcontent.js").QrKind} kind */
const setKind = (kind) => {
	const e = current();
	if (!e || kind === e.kind) return;
	updateElement(e.id, { kind, data: convertContent(e.kind, e.data, kind) });
	history.seal();
};

for (const menu of $$(".qr-kind")) {
	menu.replaceChildren(
		...QR_KIND_NAMES.map((k) =>
			el("option", { value: k, dataset: { icon: QR_KINDS[k].icon } }, QR_KINDS[k].name),
		),
	);
	menu.addEventListener("change", () => setKind(menu.value));
}

/** @param {import("../codes/qrcontent.js").QrField} f */
const row = (f) => {
	const dataset = { qrField: f.key };
	if (f.input === "choice")
		return el(
			"div",
			{ className: "prop-row" },
			el("span", {}, f.label),
			el(
				"span",
				{ className: "segmented fill", role: "group", "aria-label": f.label, dataset },
				...f.options.map(([value, name, glyph]) =>
					el(
						"button",
						{ type: "button", dataset: { value: String(value) }, "aria-pressed": "false" },
						icon(glyph),
						` ${name}`,
					),
				),
			),
		);
	const control =
		f.input === "select"
			? el(
					"select",
					{ dataset },
					...f.options.map(([value, name]) => new Option(name, String(value))),
				)
			: f.input === "textarea"
				? el("textarea", { dataset, rows: 3, spellcheck: false, placeholder: f.placeholder ?? "" })
				: el("input", {
						dataset,
						type: f.inputType ?? "text",
						spellcheck: false,
						placeholder: f.placeholder ?? "",
					});
	const shown = el(
		"label",
		{ className: `prop-row${f.input === "textarea" ? " top" : ""}` },
		f.label,
		control,
	);
	// Drawn by the page, as every list in the settings is.
	if (control instanceof HTMLSelectElement) dropdown(control);
	return shown;
};

let builtFor = null;
const sync = () => {
	const e = current();
	if (!e) return;
	const kind = QR_KINDS[e.kind];
	for (const menu of $$("select.qr-kind")) menu.value = e.kind;
	if (builtFor !== e.kind) {
		fieldsBox.replaceChildren(...kind.fields.map(row));
		builtFor = e.kind;
	}
	$("#qrKindHint").textContent = kind.hint;
	const values = decodeContent(e.kind, e.data);
	kind.fields.forEach((f, i) => {
		const shown = fieldsBox.children[i];
		/** @type {HTMLElement} */ (shown).hidden = !!f.when && !f.when(values);
		const control = $("[data-qr-field]", shown);
		const value = values[f.key];
		if (f.input === "choice") showChoice(control, value ?? f.options[0][0]);
		else if (document.activeElement !== control)
			/** @type {HTMLInputElement} */ (control).value = String(
				value ?? (control instanceof HTMLSelectElement ? control.options[0].value : ""),
			);
	});
	const main = kind.fields[0];
	primary.type = main.inputType ?? "text";
	primary.placeholder = main.placeholder ?? main.label;
	primary.setAttribute("aria-label", `QR code ${main.label.toLowerCase()}`);
	if (document.activeElement !== primary) primary.value = String(values[main.key] ?? "");
	$("#qrRaw").textContent = e.data;
	// The note on fields matters only while there's a batch list to fill them from.
	const filled = hasBatch() ? " Fields like {1} are filled in when it prints." : "";
	$("#qrLength").textContent = `${bytes.encode(e.data).length} bytes.${filled}`;
};

// Which level Auto picked depends on the size drawn, so it shows once a draw has finished.
const syncLevel = () => {
	const e = current();
	const picked = e?.level === "auto" && renderNotes().get(e.id);
	for (const sel of $$(".qr-level"))
		/** @type {HTMLSelectElement} */ (sel).options[0].textContent = picked
			? `Auto (${picked})`
			: "Auto";
};

fieldsBox.addEventListener("input", (ev) => {
	const control = /** @type {HTMLElement} */ (ev.target).closest("input, textarea, select");
	if (control instanceof HTMLElement && control.dataset.qrField)
		write(control.dataset.qrField, /** @type {HTMLInputElement} */ (control).value);
});
fieldsBox.addEventListener("click", (ev) => {
	const b = /** @type {HTMLElement} */ (ev.target).closest("[data-qr-field] button");
	if (!(b instanceof HTMLElement)) return;
	const choice = /** @type {HTMLElement} */ (b.closest("[data-qr-field]"));
	const e = current();
	const f = e && QR_KINDS[e.kind].fields.find((x) => x.key === choice.dataset.qrField);
	const option = f?.options.find(([value]) => String(value) === b.dataset.value);
	if (!option) return;
	write(f.key, option[0]);
	history.seal();
});
primary.addEventListener("input", () => {
	const e = current();
	if (e) write(primaryField(e.kind), primary.value);
});
primary.addEventListener("change", () => history.seal());

subscribe(sync);
onBatchChange(sync);
subscribe(syncLevel);
onDrawn(syncLevel);
