// Bug reports and "it works" reports, as text and as pre-filled GitHub issues. Nothing is sent
// anywhere by the app: copying puts the text on the clipboard, and reporting opens GitHub's
// new-issue page for the person to read, edit and submit themselves.
import { APP_NAME, APP_VERSION, REPO_URL } from "./app-info.js";

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

const describeStatus = (s) => {
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
		`${APP_NAME} ${APP_VERSION}`,
		`Page: ${info.page.url}${info.page.installed ? " (installed app)" : ""}`,
		`Browser: ${info.browser.userAgent}`,
		`Web Bluetooth: ${yesNo(info.browser.bluetooth)} · Web Serial: ${yesNo(info.browser.serial)}`,
		`Printing to: ${TARGETS[p.target] ?? p.target}`,
		`Model: ${p.model.vendor} ${p.model.name} (${p.model.id}), ${p.model.tested ? "tested" : "untested"}`,
		`Device: ${p.deviceName ?? "none connected"}`,
		`Firmware: ${p.status?.firmware ?? "unknown"}`,
		`Status: ${describeStatus(p.status)}`,
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

const details = (text) =>
	["<details><summary>Diagnostics</summary>", "", "```", text, "```", "", "</details>"].join("\n");

/**
 * A bug report to fill in.
 * @param {ReportInfo} info
 * @param {{messages?: number}} [options] as for diagnostics
 */
export const problemReport = (info, options) => ({
	title: "",
	labels: "bug",
	body: [
		"**What happened?**",
		"",
		"",
		"**What did you expect to happen?**",
		"",
		"",
		"**Steps to reproduce** (attaching the .label file helps)",
		"",
		"1. ",
		"",
		details(diagnostics(info, options)),
	].join("\n"),
});

/**
 * A report that a printer works, so an untested model can be marked tested.
 * @param {ReportInfo} info
 * @param {{messages?: number}} [options] as for diagnostics
 */
export const worksReport = (info, options) => {
	const p = info.printer;
	const device = p.deviceName ? ` (it calls itself "${p.deviceName}")` : "";
	return {
		title: `Works: ${p.model.vendor} ${p.model.name}`,
		labels: "printer works",
		body: [
			`**Printer:** ${p.model.vendor} ${p.model.name}${device}`,
			`**Connected over:** ${TARGETS[p.target] ?? p.target}`,
			`**Labels:** ${labelText(info.label)}`,
			"",
			"Tick what you checked:",
			"",
			"- [ ] It printed the right way up",
			"- [ ] The size and position matched the preview",
			"- [ ] The darkness settings look right",
			"- [ ] Barcodes or QR codes scan (if you printed any)",
			"",
			"**Anything you had to change?** (Flip 180°, the feed, the model under Advanced…)",
			"",
			"",
			details(diagnostics(info, options)),
		].join("\n"),
	};
};

// GitHub refuses very long URLs; this leaves room for the address itself.
const MAX_URL = 7500;

/**
 * GitHub's new-issue page with the report filled in, leaving out printer messages if they'd
 * make the address too long.
 * @param {(info: ReportInfo, options: {messages: number}) => {title: string, labels: string,
 *   body: string}} make problemReport or worksReport
 * @param {ReportInfo} info
 */
export const issueUrl = (make, info) => {
	let url = "";
	for (const messages of [20, 5, 0]) {
		const { title, labels, body } = make(info, { messages });
		const params = new URLSearchParams({ body, labels });
		if (title) params.set("title", title);
		url = `${REPO_URL}/issues/new?${params}`;
		if (url.length <= MAX_URL) break;
	}
	return url;
};
