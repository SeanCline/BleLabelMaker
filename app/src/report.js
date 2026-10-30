// Bug reports and "it works" reports, as text and as pre-filled GitHub issues. Nothing is sent
// anywhere by the app: copying puts the text on the clipboard, and reporting opens GitHub's
// new-issue page for the person to read, edit and submit themselves.
import { APP_NAME, BUILD_VERSION, REPO_URL } from "./app-info.js";

/**
 * @typedef {object} ReportInfo
 * @property {{url: string, installed: boolean}} page where the app runs; never the URL's
 *   fragment, which holds a shared label
 * @property {{userAgent: string, bluetooth: boolean, serial: boolean}} browser
 * @property {{widthMm: number, heightMm: number, continuous: boolean}} label
 * @property {{target: string, model: {id: string, name: string, vendor: string,
 *   tested: boolean}, deviceName: string | null, status: Record<string, any> | null,
 *   messages: {at: Date, hex: string}[], settings: Record<string, any>}} printer
 */

const TARGETS = { virtual: "virtual printer", bluetooth: "Bluetooth", serial: "serial port" };

const yesNo = (v) => (v ? "yes" : "no");
const time = (d) => d.toTimeString().slice(0, 8);
const labelText = (l) =>
	`${l.widthMm} × ${l.heightMm} mm, ${l.continuous ? "continuous" : "with gaps"}`;

/** Everything the printer has reported, for a bug report; the UI shows only problems. */
const statusDetails = (s) => {
	if (!s) return "not connected";
	const parts = [];
	if (typeof s.battery === "number")
		parts.push(`battery ${s.battery}%${s.charging ? " (charging)" : ""}`);
	if (s.paper !== undefined) parts.push(s.paper === false ? "out of labels" : "labels loaded");
	if (s.coverOpen !== undefined) parts.push(s.coverOpen ? "cover open" : "cover closed");
	if (s.autoPowerOff !== undefined) parts.push(`auto power-off ${s.autoPowerOff} min`);
	return parts.join(" · ") || "nothing reported";
};

/**
 * Everything a bug report should say about this browser, printer and setup.
 * @param {ReportInfo} info
 * @param {{messages?: number}} [options] how many of the printer's last messages to include
 */
export const diagnostics = (info, { messages = 20 } = {}) => {
	const p = info.printer;
	const lines = [
		`${APP_NAME} ${BUILD_VERSION}`,
		`Page: ${info.page.url}${info.page.installed ? " (installed app)" : ""}`,
		`Browser: ${info.browser.userAgent}`,
		`Web Bluetooth: ${yesNo(info.browser.bluetooth)} · Web Serial: ${yesNo(info.browser.serial)}`,
		`Printing to: ${TARGETS[p.target] ?? p.target}`,
		`Model: ${p.model.vendor} ${p.model.name} (${p.model.id}), ${p.model.tested ? "tested" : "untested"}`,
		`Device: ${p.deviceName ?? "none connected"}`,
		`Firmware: ${p.status?.firmware ?? "unknown"}`,
		`Status: ${statusDetails(p.status)}`,
		`Label: ${labelText(info.label)}`,
		`Settings: ${JSON.stringify(p.settings)}`,
	];
	const heard = messages ? p.messages.slice(-messages) : [];
	if (heard.length) {
		lines.push("Printer messages (newest last):");
		for (const m of heard) lines.push(`  ${time(m.at)}  ${m.hex}`);
	} else if (p.messages.length) {
		lines.push(`Printer messages: ${p.messages.length} left out; use Copy diagnostics for them.`);
	}
	return lines.join("\n");
};

/**
 * @typedef {{template: string, title: string, fields: Record<string, string>}} Report one of
 *   the repository's issue forms (.github/ISSUE_TEMPLATE), with `fields` keyed by its field ids
 */

/**
 * A bug report to fill in.
 * @param {ReportInfo} info
 * @param {{messages?: number}} [options] as for diagnostics
 * @returns {Report}
 */
export const problemReport = (info, options) => ({
	template: "problem.yml",
	title: "",
	fields: { diagnostics: diagnostics(info, options) },
});

/**
 * A report that a printer works, so an untested model can be marked tested.
 * @param {ReportInfo} info
 * @param {{messages?: number}} [options] as for diagnostics
 * @returns {Report}
 */
export const worksReport = (info, options) => {
	const p = info.printer;
	const device = p.deviceName ? ` (it calls itself "${p.deviceName}")` : "";
	return {
		template: "confirmed-working.yml",
		title: `Confirmed working: ${p.model.vendor} ${p.model.name}`,
		fields: {
			printer: `${p.model.vendor} ${p.model.name}${device}`,
			connection: TARGETS[p.target] ?? p.target,
			labels: labelText(info.label),
			diagnostics: diagnostics(info, options),
		},
	};
};

// GitHub refuses very long URLs; this leaves room for the address itself.
const MAX_URL = 7500;

/**
 * GitHub's new-issue page with the report's form filled in, leaving out printer messages if
 * they'd make the address too long. The form applies its own label.
 * @param {(info: ReportInfo, options: {messages: number}) => Report} make problemReport or
 *   worksReport
 * @param {ReportInfo} info
 */
export const issueUrl = (make, info) => {
	let url = "";
	for (const messages of [20, 5, 0]) {
		const { template, title, fields } = make(info, { messages });
		const params = new URLSearchParams({ template, ...fields });
		if (title) params.set("title", title);
		url = `${REPO_URL}/issues/new?${params}`;
		if (url.length <= MAX_URL) break;
	}
	return url;
};
