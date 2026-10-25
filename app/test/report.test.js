import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { diagnostics, problemReport, worksReport, issueUrl } from "../src/report.js";
import { APP_NAME, APP_VERSION, REPO_URL } from "../src/app-info.js";

/** @returns {import("../src/report.js").ReportInfo} */
const info = ({ messages = 3, tested = false } = {}) => ({
	page: { url: "https://example.com/", installed: false },
	browser: { userAgent: "TestBrowser/1.0", bluetooth: true, serial: false },
	label: { widthMm: 40, heightMm: 12, continuous: false },
	printer: {
		target: "bluetooth",
		model: { id: "acme-q1", name: "Q1", vendor: "Acme", tested },
		deviceName: "Q1-ABCD",
		status: { battery: 64, charging: false, paper: true, coverOpen: false, firmware: "1.2.3" },
		messages: Array.from({ length: messages }, (_, i) => ({
			at: new Date(2026, 0, 1, 12, 0, i),
			hex: `1a 04 ${i.toString(16).padStart(2, "0")}`,
		})),
		settings: { target: "bluetooth", density: "normal" },
	},
});

test("diagnostics say which app, browser, printer and setup", () => {
	const text = diagnostics(info());
	for (const expected of [
		`${APP_NAME} ${APP_VERSION}`,
		"Browser: TestBrowser/1.0",
		"Web Bluetooth: yes · Web Serial: no",
		"Printing to: Bluetooth",
		"Model: Acme Q1 (acme-q1), untested",
		"Device: Q1-ABCD",
		"Firmware: 1.2.3",
		"battery 64%",
		"Label: 40 × 12 mm, with gaps",
		'"density":"normal"',
		"12:00:02  1a 04 02",
	]) {
		assert.ok(text.includes(expected), expected);
	}
});

test("diagnostics keep only the printer's last messages", () => {
	const text = diagnostics(info({ messages: 30 }), { messages: 5 });
	assert.ok(text.includes("1a 04 1d"));
	assert.ok(!text.includes("1a 04 18"));
	assert.ok(diagnostics(info(), { messages: 0 }).includes("3 left out"));
});

test("an issue link opens the repository's issue form, filled in", () => {
	const url = new URL(issueUrl(worksReport, info()));
	assert.equal(url.origin + url.pathname, `${REPO_URL}/issues/new`);
	assert.equal(url.searchParams.get("template"), "confirmed-working.yml");
	assert.equal(url.searchParams.get("title"), "Confirmed working: Acme Q1");
	assert.equal(url.searchParams.get("printer"), 'Acme Q1 (it calls itself "Q1-ABCD")');
	assert.equal(url.searchParams.get("connection"), "Bluetooth");
	assert.ok(url.searchParams.get("diagnostics").includes("Model: Acme Q1"));
	const problem = new URL(issueUrl(problemReport, info()));
	assert.equal(problem.searchParams.get("template"), "problem.yml");
	assert.equal(problem.searchParams.get("title"), null, "the reporter writes the title");
});

test("every field a report fills in is one its issue form has", async () => {
	const forms = new URL("../../.github/ISSUE_TEMPLATE/", import.meta.url);
	for (const make of [problemReport, worksReport]) {
		const { template, fields } = make(info());
		const yaml = await readFile(new URL(template, forms), "utf8");
		const ids = [...yaml.matchAll(/^\s+id: (\S+)$/gm)].map((m) => m[1]);
		for (const field of Object.keys(fields))
			assert.ok(ids.includes(field), `${template}: ${field}`);
	}
});

test("a link that would be too long leaves out printer messages first", () => {
	const many = info({ messages: 40 });
	many.printer.messages.forEach((m) => (m.hex = "1a ".repeat(100).trim()));
	const url = issueUrl(problemReport, many);
	assert.ok(url.length <= 7500, `${url.length} characters`);
	assert.ok(new URL(url).searchParams.get("diagnostics").includes("Firmware: 1.2.3"));
});
