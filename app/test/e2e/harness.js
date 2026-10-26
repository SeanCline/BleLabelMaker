import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { startServer } from "../../serve.js";
import { storageKey } from "../../src/app-info.js";

const CANDIDATES = [
	process.env.CHROME_PATH,
	"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/microsoft-edge",
];

export const findBrowser = () => CANDIDATES.find((p) => p && existsSync(p));

/**
 * Starts the static server and a headless Chromium. Each test gets a fresh page with
 * empty storage so autosave from one test can't leak into the next.
 */
export const setup = async () => {
	const executablePath = findBrowser();
	if (!executablePath) throw new Error("No Chromium-based browser found; set CHROME_PATH.");
	const { server, url } = await startServer(0);
	const browser = await puppeteer.launch({
		executablePath,
		headless: true,
		// GitHub's Ubuntu runners don't allow the user namespaces Chrome's sandbox needs; the
		// browser only ever loads this app, so CI runs it without one.
		args: ["--no-first-run", ...(process.env.CI ? ["--no-sandbox"] : [])],
	});
	const pages = [];

	/**
	 * Pages start on the virtual printer, so tests print without a device picker; `printer: null`
	 * leaves the app's own default.
	 * @param {{width?: number, height?: number, printer?: string | null, beforeLoad?: (page: import("puppeteer-core").Page) => Promise<unknown>}} [options]
	 * @returns {Promise<import("puppeteer-core").Page & {errors: string[]}>} errors collects console errors and uncaught exceptions
	 */
	const open = async ({ width = 1280, height = 900, printer = "virtual", beforeLoad } = {}) => {
		const context = await browser.createBrowserContext();
		const page = /** @type {import("puppeteer-core").Page & {errors: string[]}} */ (
			await context.newPage()
		);
		if (printer) {
			// Only on a first load: a reload keeps what the test chose since.
			await page.evaluateOnNewDocument(
				(key, target) => {
					if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ target }));
				},
				storageKey("settings"),
				printer,
			);
		}
		if (beforeLoad) await beforeLoad(page);
		pages.push(page);
		page.errors = [];
		page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
		page.on("pageerror", (e) => page.errors.push(String(e)));
		await page.setViewport({ width, height });
		await page.goto(url, { waitUntil: "networkidle0" });
		await page.evaluate(() => window.labelApp.ready);
		return page;
	};

	/** Really takes the app offline: emulated offline mode doesn't reach service workers. */
	const stopServer = () =>
		new Promise((done) => {
			server.close(done);
			server.closeAllConnections();
		});

	const teardown = async () => {
		await browser.close();
		if (server.listening) await stopServer();
	};
	return { url, open, stopServer, teardown };
};

/** Sets a form control's value the way a user would, firing the input event the app listens to. */
export const typeInto = (page, selector, value) =>
	page.$eval(
		selector,
		(el, v) => {
			if (el.type === "checkbox") el.checked = v;
			else el.value = v;
			el.dispatchEvent(new Event("input", { bubbles: true }));
			el.dispatchEvent(new Event("change", { bubbles: true }));
		},
		value,
	);

export const appState = (page) =>
	page.evaluate(() => JSON.parse(JSON.stringify(window.labelApp.state)));
export const serialized = (page) => page.evaluate(() => window.labelApp.serialize());
export const redraw = (page) => page.evaluate(() => window.labelApp.drawCanvas());

/** Drags from the centre of an element by (dx, dy) screen pixels. */
export const dragBy = async (page, selector, dx, dy, { alt = false } = {}) => {
	const el = await page.$(selector);
	const b = await el.boundingBox();
	const x = b.x + b.width / 2;
	const y = b.y + b.height / 2;
	if (alt) await page.keyboard.down("Alt");
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + dx, y + dy, { steps: 6 });
	await page.mouse.up();
	if (alt) await page.keyboard.up("Alt");
};

/**
 * Redraws the preview and sums up its pixels: how many dots are black, a hash that changes
 * with any dot, how wide the ink is, and how tall its first band is (the first text line).
 */
export const labelPixels = (page) =>
	page.evaluate(async () => {
		await window.labelApp.drawCanvas();
		const c = /** @type {HTMLCanvasElement} */ (document.querySelector("#labelCanvas"));
		const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
		let black = 0;
		let hash = 0;
		let left = c.width;
		let right = -1;
		const inkRows = new Array(c.height).fill(false);
		for (let i = 0; i < d.length; i += 4) {
			hash = (hash * 31 + d[i]) | 0;
			if (d[i]) continue;
			black++;
			const x = (i / 4) % c.width;
			left = Math.min(left, x);
			right = Math.max(right, x);
			inkRows[Math.floor(i / 4 / c.width)] = true;
		}
		const top = inkRows.indexOf(true);
		let y = top;
		while (y >= 0 && y < c.height && inkRows[y]) y++;
		return { black, hash, inkWidth: right - left, firstBandHeight: top < 0 ? 0 : y - top };
	});

/** Whether the first label a fake printer (window[fakeName]) received is what the preview shows. */
export const printedMatchesPreview = (page, fakeName) =>
	page.evaluate(async (fakeName) => {
		// A variable, so Node tooling doesn't try to resolve the browser path.
		const module = "/src/raster.js";
		const { toPrinterRaster } = await import(module);
		const c = /** @type {HTMLCanvasElement} */ (document.querySelector("#labelCanvas"));
		const expected = toPrinterRaster(c.getContext("2d").getImageData(0, 0, c.width, c.height));
		const got = /** @type {any} */ (window)[fakeName].labels[0];
		return got.rows === expected.rows && got.data.every((b, i) => b === expected.data[i]);
	}, fakeName);
