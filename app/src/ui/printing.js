// The print button and what it prints: copies, the counter, the batch row the preview shows,
// and telling the user how a print went. The print itself is print.js; the printer, the
// printer menu.
import { printDocument } from "../print.js";
import { fieldsUsed } from "../fields.js";
import { clamp } from "../units.js";
import { $, el, toast } from "./dom.js";
import { showVirtualOutput } from "./virtual-output.js";
import { setFieldContext } from "./stage.js";
import { state, subscribe } from "./store.js";
import { batchData, previewRow, onBatchChange } from "./batch.js";
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

const currentCopies = () => clamp(Math.round(Number($("#copies").valueAsNumber) || 1), 1, 99);

/** Prints the current design: each batch row, each copy, with its fields filled in. */
export const print = async ({ copies = currentCopies() } = {}) => {
	if (busy) return false;
	copies = clamp(Math.round(copies), 1, 99);
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
			batch: batchData(),
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
			reportBrokenSend(outcome);
			return false;
		}
		if (outcome.decoded)
			showVirtualOutput(outcome.decoded, outcome.total, settings, currentPrinter());
		else toast(`Sent ${outcome.total} label${outcome.total === 1 ? "" : "s"} to ${t.name}`);
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
	const of = `${labels} of ${total} label${total === 1 ? "" : "s"}`;
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
$("#copies").addEventListener("input", renderPrintBar);
$("#counterStart").addEventListener("input", (ev) => {
	const v = ev.target.valueAsNumber;
	if (!Number.isInteger(v) || v < 0) return;
	settings.counterStart = v;
	saveSettings();
	refreshPreview();
});
renderPrintBar();
