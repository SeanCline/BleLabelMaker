// The report buttons under Advanced, and the note offering an "it works" report after an
// untested model prints.
import { APP_VERSION, storageKey } from "../app-info.js";
import { diagnostics, problemReport, worksReport, issueUrl } from "../report.js";
import { bluetoothAvailable, serialAvailable } from "../transport.js";
import { $, loadJson, storeJson, toast } from "./dom.js";
import { state } from "./store.js";
import { printerInfo, currentPrinter, onPrinted, onPrinterChange } from "./printing.js";

// Models the person has reported working (or said "not now" about), so the note asks once.
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

const hideNote = () => ($("#untestedNote").hidden = true);

const renderWorksHint = () => {
	const m = currentPrinter();
	$("#reportWorksHint").textContent = m.tested
		? ""
		: `The ${m.name} hasn't been tested yet; a report helps everyone who has one.`;
	if (m.id !== $("#untestedNote").dataset.model) hideNote();
};

const reportWorks = () => {
	markAsked(currentPrinter().id);
	hideNote();
	openIssue(worksReport);
};

const init = () => {
	$("#appVersion").textContent = `Version ${APP_VERSION}`;
	$("#btnCopyDiagnostics").addEventListener("click", () =>
		copy(diagnostics(reportInfo()), "Diagnostics"),
	);
	$("#btnReportProblem").addEventListener("click", () => openIssue(problemReport));
	$("#btnCopyWorks").addEventListener("click", () =>
		copy(worksReport(reportInfo()).body, "Printer details"),
	);
	$("#btnReportWorks").addEventListener("click", reportWorks);
	$("#btnNoteReportWorks").addEventListener("click", reportWorks);
	$("#btnNoteDismiss").addEventListener("click", () => {
		markAsked(currentPrinter().id);
		hideNote();
	});
	// A real print on an untested model is the evidence that would mark it tested.
	onPrinted(({ target }) => {
		const m = currentPrinter();
		if (target === "virtual" || m.tested || asked().includes(m.id)) return;
		$("#untestedText").textContent =
			`Did that print correctly? The ${m.name} is untested; a quick report would let it be marked as working.`;
		$("#untestedNote").dataset.model = m.id;
		$("#untestedNote").hidden = false;
	});
	onPrinterChange(renderWorksHint);
	renderWorksHint();
};
init();
