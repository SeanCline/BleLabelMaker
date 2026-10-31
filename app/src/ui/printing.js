// The print button and what it prints: copies, the counter, the batch row the preview shows,
// and telling the user how a print went. The print itself is print.js; the printer, the
// printer menu.
import { printDocument } from "../print.js";
import { fieldsUsed } from "../fields.js";
import { clamp } from "../units.js";
import { $, el, toast, plural } from "./dom.js";
import { showVirtualOutput } from "./virtual-output.js";
import { setFieldContext } from "./stage.js";
import { state, subscribe } from "./store.js";
import { batchData, previewRow, previewedOnly, onBatchChange } from "./batch.js";
import { settings, saveSettings, currentPrinter } from "./settings.js";
import {
	connection,
	hardware,
	onPrinterChange,
	renderPrinterStatus,
	reportPrintError,
} from "./printer-menu.js";
import { signal } from "./signal.js";

let busy = false;
const printed = signal();
/** Called after every print that got labels out, with { copies, target, image }. */
export const onPrinted = printed.on;

// A count from anywhere (the box, a reprint) as one the printer takes: blank or NaN is 1.
const toCopies = (v) => clamp(Math.round(v) || 1, 1, 99);
const currentCopies = () => toCopies($("#copies").valueAsNumber);

/**
 * Prints the current design: each batch row, each copy, with its fields filled in. `only`
 * prints just the batch row the preview shows.
 */
export const print = async ({ copies = currentCopies(), only = false } = {}) => {
	if (busy) return false;
	copies = toCopies(copies);
	$("#copies").value = copies;
	const t = connection();
	const progress = $("#progress");
	busy = true;
	renderPrinterStatus();
	try {
		const outcome = await printDocument(state.doc, {
			connection: t,
			printer: currentPrinter(),
			copies,
			batch: only ? previewedOnly() : batchData(),
			counterStart: settings.counterStart,
			settings,
			confirm: (question) => confirm(question),
			onStart: () => (progress.hidden = false),
			onProgress: (done, total) => (progress.value = done / total),
		});
		if (outcome.result === "declined") return false;
		// The labels that did go out are printed: keep their serials used and their history.
		if (outcome.labels) finishPrint(outcome);
		if (outcome.result === "partial") {
			// Its row numbers count from the row printed, not the list.
			reportBrokenSend(only ? { ...outcome, firstUnsentRow: null } : outcome);
			return false;
		}
		if (outcome.decoded)
			showVirtualOutput(outcome.decoded, outcome.total, settings, currentPrinter());
		else toast(`Sent ${plural(outcome.total, "label")} to ${t.name}`);
		return true;
	} catch (err) {
		reportPrintError(err);
		return false;
	} finally {
		busy = false;
		progress.hidden = true;
		progress.value = 0;
		renderPrinterStatus();
	}
};

/**
 * After labels went out: the counter moves past the values they used, and listeners hear.
 * @param {import("../print.js").PrintOutcome} outcome
 */
const finishPrint = ({ labels, nextCounter, image }) => {
	if (nextCounter !== settings.counterStart) {
		settings.counterStart = nextCounter;
		saveSettings();
		renderPrintBar();
		refreshPreview();
	}
	printed.emit({ copies: labels, target: settings.target, image });
};

/**
 * Says how far a print got before the connection broke, and what's left to print.
 * @param {import("../print.js").PrintOutcome} outcome
 */
const reportBrokenSend = ({ error, labels, total, firstUnsentRow }) => {
	console.error(error);
	const of = `${labels} of ${plural(total, "label")}`;
	const rest =
		firstUnsentRow !== null
			? ` Rows from ${firstUnsentRow + 1} on weren't sent.`
			: labels
				? " Print again for the rest."
				: "";
	toast(`The connection to the printer broke off after ${of} (${error.message}).${rest}`, {
		error: true,
	});
};

/** The print button says how many labels a batch will make; the counter shows when used. */
const renderPrintBar = () => {
	const used = fieldsUsed(state.doc);
	$("#counterRow").hidden = !used.counter;
	if (document.activeElement !== $("#counterStart")) {
		$("#counterStart").value = String(settings.counterStart);
	}
	renderPrintButton();
	$("#batchUnused").hidden = !batchData() || used.columns;
};

/**
 * The print button says what a click will do: how many labels a batch makes, and for a real
 * printer, whether it connects first. Which printer it is, the chip beside it says.
 */
const renderPrintButton = () => {
	const batch = batchData();
	const total = (batch?.rows.length ?? 1) * currentCopies();
	const real = hardware();
	// On a phone, "Connect &" and the count go, to keep Print on the top row beside the
	// printer's chip (whose dot says it isn't connected) and Batch (which shows the count).
	const connect =
		real && !real.connected ? [el("span", { className: "print-connect" }, "Connect & ")] : [];
	const what = batch ? [el("span", { className: "print-unit" }, ` ${total} labels`)] : [];
	$("#btnPrint .print-label").replaceChildren(...connect, "Print", ...what);
	$("#btnPrint").disabled = busy;
	$("#batchPrintRow").disabled = busy;
};

// The preview shows the batch row being looked at and the next counter value.
const refreshPreview = () =>
	setFieldContext(() => {
		const batch = batchData();
		return {
			now: new Date(),
			n: settings.counterStart,
			row: batch ? batch.rows[previewRow()] : null,
			line: batch?.lines[previewRow()],
			columns: batch?.columns ?? null,
		};
	});
refreshPreview();
onBatchChange(() => {
	refreshPreview();
	renderPrintBar();
});
subscribe(renderPrintBar);
onPrinterChange(renderPrintButton);

$("#btnPrint").addEventListener("click", () => print());
$("#batchPrintRow").addEventListener("click", () => print({ only: true }));
$("#copies").addEventListener("input", renderPrintBar);
$("#counterStart").addEventListener("input", (ev) => {
	const v = ev.target.valueAsNumber;
	if (!Number.isInteger(v) || v < 0) return;
	settings.counterStart = v;
	saveSettings();
	refreshPreview();
});
renderPrintBar();
