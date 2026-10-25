// Bug reports and "confirmed working" reports. After the first real print on a model nobody has
// confirmed yet, a pop-up asks how it came out; a problem can be reported from the footer at
// any time, and diagnostics copied from Advanced.
import { APP_VERSION, storageKey } from "../app-info.js";
import { diagnostics, problemReport, worksReport, issueUrl } from "../report.js";
import { bluetoothAvailable, serialAvailable } from "../transport.js";
import { $, loadJson, storeJson, toast } from "./dom.js";
import { state } from "./store.js";
import { printerInfo, currentPrinter, onPrinted } from "./printing.js";

// Models the pop-up has asked about, so it asks once per model.
const ASKED_KEY = storageKey("worksAsked");

/** @returns {import("../report.js").ReportInfo} */
const reportInfo = () => ({
	page: {
		url: location.origin + location.pathname,
		installed: matchMedia("(display-mode: standalone)").matches,
	},
	browser: {
		userAgent: navigator.userAgent,
		bluetooth: bluetoothAvailable(),
		serial: serialAvailable(),
	},
	label: { ...state.doc.label },
	printer: printerInfo(),
});

const copy = async (text, what) => {
	try {
		await navigator.clipboard.writeText(text);
		toast(`${what} copied.`);
	} catch {
		toast(`Couldn't copy the ${what.toLowerCase()}: this browser didn't allow it.`, {
			error: true,
		});
	}
};

const openIssue = (make) => {
	// noopener: the issue page has no business with this one.
	window.open(issueUrl(make, reportInfo()), "_blank", "noopener");
};

const asked = () => loadJson(ASKED_KEY) ?? [];
const markAsked = (id) => storeJson(ASKED_KEY, [...new Set([...asked(), id])]);

const dialog = /** @type {HTMLDialogElement} */ ($("#printedDialog"));

const init = () => {
	$("#appVersion").textContent = `Version ${APP_VERSION}`;
	$("#btnCopyDiagnostics").addEventListener("click", () =>
		copy(diagnostics(reportInfo()), "Diagnostics"),
	);
	$("#btnReportProblem").addEventListener("click", () => openIssue(problemReport));
	// A real print on an unconfirmed model is the evidence that would mark it tested.
	onPrinted(({ target }) => {
		const m = currentPrinter();
		if (target === "virtual" || m.tested || asked().includes(m.id) || dialog.open) return;
		markAsked(m.id);
		$("#printedText").textContent =
			`Nobody has confirmed the ${m.name} works with this app yet. If the label came out right, a quick report lets everyone with one know.`;
		dialog.returnValue = "";
		dialog.showModal();
	});
	dialog.addEventListener("close", () => {
		if (dialog.returnValue === "works") openIssue(worksReport);
		if (dialog.returnValue === "problem") openIssue(problemReport);
	});
};
init();
