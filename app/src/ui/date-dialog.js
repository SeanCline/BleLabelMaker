// "Date or time…" from the Field menu: the date and time fields ({date+30d:iso}, {time})
// chosen from a few questions instead of typed, with words like "Best before" ahead of them.
// What it inserts is plain fields, filled in each time the label prints.
import { fillFields } from "../fields.js";
import { storageKey } from "../app-info.js";
import { $, loadJson, showChoice, storeJson } from "./dom.js";

const dialog = /** @type {HTMLDialogElement} */ ($("#dateDialog"));
const KEY = storageKey("dateDialog");

// The last choices, so a run of "Use by" labels is one click each.
const choice = { show: "date", prefix: "", offset: 0, unit: "d", format: "", ...loadJson(KEY) };

const dateField = () => {
	const n = Math.trunc(Number(choice.offset)) || 0;
	const shift = n ? `${n > 0 ? "+" : "-"}${Math.abs(n)}${choice.unit}` : "";
	return `{date${shift}${choice.format ? `:${choice.format}` : ""}}`;
};

/** The text it inserts: "Best before: {date+30d}". */
const text = () => {
	const parts = [];
	if (choice.show !== "time") parts.push(dateField());
	if (choice.show !== "date") parts.push("{time}");
	return (choice.prefix ? `${choice.prefix}: ` : "") + parts.join(" ");
};

const now = () => ({ now: new Date(), n: 1, row: null, columns: null });

const render = () => {
	showChoice($("#dateShow"), choice.show);
	for (const row of dialog.querySelectorAll("[data-date-only]"))
		/** @type {HTMLElement} */ (row).hidden = choice.show === "time";
	// Each format as it shows today.
	const formats = $("#dateFormat");
	if (!formats.options.length)
		formats.append(
			...["", "num", "iso"].map((f) => new Option(fillFields(`{date${f && `:${f}`}}`, now()), f)),
		);
	$("#datePrefix").value = choice.prefix;
	$("#dateOffset").value = String(choice.offset);
	$("#dateUnit").value = choice.unit;
	formats.value = choice.format;
	$("#datePreview").textContent = fillFields(text(), now());
};

$("#dateShow").addEventListener("click", (ev) => {
	const b = /** @type {HTMLElement} */ (ev.target).closest("button");
	if (!b) return;
	choice.show = b.dataset.value;
	render();
});
for (const [id, key] of [
	["#datePrefix", "prefix"],
	["#dateOffset", "offset"],
	["#dateUnit", "unit"],
	["#dateFormat", "format"],
])
	$(id).addEventListener("input", (ev) => {
		choice[key] = /** @type {HTMLInputElement} */ (ev.target).value;
		render();
	});

let done = null;
dialog.addEventListener("close", () => {
	if (dialog.returnValue === "insert" && done) {
		storeJson(KEY, choice);
		done(text());
	}
	done = null;
});

/**
 * Asks which date or time, then hands over the fields for it.
 * @param {(text: string) => void} insert
 */
export const pickDateTime = (insert) => {
	done = insert;
	dialog.returnValue = "";
	render();
	dialog.showModal();
	/** @type {HTMLElement} */ (dialog.querySelector("#dateShow button[aria-pressed=true]"))?.focus();
};
