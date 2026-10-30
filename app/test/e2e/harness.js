import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { startServer } from "../../serve.js";
import { storageKey } from "../../src/app-info.js";

// BROWSER=firefox runs the tests in Firefox, which has no Web Bluetooth or Web Serial: the
// tests check that everything else works there, as DESIGN.md promises.
export const FIREFOX = process.env.BROWSER === "firefox";

const CHROMES = [
	process.env.CHROME_PATH,
	"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	"C:/Program Files/Google/Chrome/Application/chrome.exe",
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/microsoft-edge",
];
const FIREFOXES = [
	process.env.FIREFOX_PATH,
	"C:/Program Files/Mozilla Firefox/firefox.exe",
	"/Applications/Firefox.app/Contents/MacOS/firefox",
	"/usr/bin/firefox",
];

/** A Chromium-based browser, or Firefox when asked for. */
export const findBrowser = ({ firefox = false } = {}) =>
	(firefox ? FIREFOXES : CHROMES).find((p) => p && existsSync(p));

// Set by c8 (npm run coverage). Most of the app only runs in the browser, so the pages
// record what ran and it's written where c8 collects Node's own coverage. Only Chrome
// reports it.
const coverageDir = FIREFOX ? undefined : process.env.NODE_V8_COVERAGE;
const appRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Starts the static server and a headless browser. Each test gets a fresh page with
 * empty storage so autosave from one test can't leak into the next.
 */
export const setup = async () => {
	const executablePath = findBrowser({ firefox: FIREFOX });
	if (!executablePath)
		throw new Error(
			FIREFOX
				? "No Firefox found; set FIREFOX_PATH."
				: "No Chromium-based browser found; set CHROME_PATH.",
		);
	const { server, url } = await startServer(0);
	const browser = await puppeteer.launch({
		executablePath,
		browser: FIREFOX ? "firefox" : "chrome",
		headless: true,
		// GitHub's Ubuntu runners don't allow the user namespaces Chrome's sandbox needs; the
		// browser only ever loads this app, so CI runs it without one.
		args: FIREFOX ? [] : ["--no-first-run", ...(process.env.CI ? ["--no-sandbox"] : [])],
	});
	const pages = [];

	/**
	 * Pages start on the virtual printer, so tests print without a device picker; `printer: null`
	 * leaves the app's own default. The service worker only runs where a test asks for it
	 * (`offline: true`): installing it fetches every file the app has, for every page.
	 * Downloads are saved to `downloads`, where a test asks for them.
	 * @param {{width?: number, height?: number, printer?: string | null, offline?: boolean, downloads?: string, beforeLoad?: (page: import("puppeteer-core").Page) => Promise<unknown>}} [options]
	 * @returns {Promise<import("puppeteer-core").Page & {errors: string[]}>} errors collects console errors and uncaught exceptions
	 */
	const open = async ({
		width = 1280,
		height = 900,
		printer = "virtual",
		offline = false,
		downloads,
		beforeLoad,
	} = {}) => {
		const context = await browser.createBrowserContext(
			downloads ? { downloadBehavior: { policy: "allow", downloadPath: downloads } } : {},
		);
		const page = /** @type {import("puppeteer-core").Page & {errors: string[]}} */ (
			await context.newPage()
		);
		if (coverageDir) {
			// Kept across reloads, which some tests do.
			await page.coverage.startJSCoverage({
				resetOnNavigation: false,
				includeRawScriptCoverage: true,
			});
		}
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
		if (!offline)
			await page.evaluateOnNewDocument(
				() => delete (/** @type {any} */ (Navigator.prototype).serviceWorker),
			);
		if (beforeLoad) await beforeLoad(page);
		pages.push(page);
		page.errors = [];
		page.on("console", (m) => m.type() === "error" && page.errors.push(m.text()));
		page.on("pageerror", (e) => page.errors.push(String(e)));
		await page.setViewport({ width, height });
		// Not networkidle0, which waits out half a second of quiet on every page: the app's own
		// ready, and the fonts it asked for, are what tests need.
		await page.goto(url, { waitUntil: "load" });
		await loaded(page);
		return page;
	};

	/**
	 * Really takes the app offline: emulated offline mode doesn't reach service workers. The
	 * server stays up and drops every connection, because a closed port isn't the same
	 * everywhere: Firefox on Windows waits seconds on each refused connection.
	 */
	const goOffline = () => {
		server.removeAllListeners("request");
		server.on("request", (req) => req.socket.destroy());
		server.closeAllConnections();
	};
	const stopServer = () =>
		new Promise((done) => {
			server.close(done);
			server.closeAllConnections();
		});

	/** V8's coverage in the shape Node writes, with the app's URLs turned back into its files. */
	const saveCoverage = async () => {
		mkdirSync(coverageDir, { recursive: true });
		for (const [i, page] of pages.entries()) {
			if (page.isClosed()) continue;
			const result = (await page.coverage.stopJSCoverage())
				.filter((e) => e.url.startsWith(url) && e.rawScriptCoverage)
				.map((e) => ({
					...e.rawScriptCoverage,
					url: pathToFileURL(join(appRoot, new URL(e.url).pathname)).href,
				}));
			writeFileSync(
				join(coverageDir, `coverage-browser-${process.pid}-${i}.json`),
				JSON.stringify({ result }),
			);
		}
	};

	const teardown = async () => {
		if (coverageDir) await saveCoverage();
		await browser.close();
		await stopServer();
	};
	return { url, open, goOffline, teardown };
};

/** Waits for a page (re)loaded with waitUntil "load" to be drawn, with its fonts. */
export const loaded = (page) =>
	page.evaluate(async () => {
		await window.labelApp.ready;
		await document.fonts.ready;
	});

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

/** Opens the settings for what's selected (the bar's More…), for the fields not on the bar. */
export const openSettings = async (page) => {
	if (await page.$eval("#settings", (s) => s.hidden))
		await page.click('#quickbar [data-qb-action="more"]');
};
/** Clicks something inside menus (the printer's, the label size…), opening them first. */
export const clickInMenu = async (page, selector) => {
	await page.$eval(selector, (el) => {
		for (let d = el.closest("details"); d; d = d.parentElement.closest("details")) d.open = true;
	});
	await page.click(selector);
};
/** Opens the batch list, from its button beside Print. */
export const openBatchList = (page) => page.click("#btnBatch");
/** Picks an item from the File menu (New, Open, Save, Share, History). */
export const fromFileMenu = async (page, selector) => {
	await page.$eval("#fileMenu", (d) => d.setAttribute("open", ""));
	await page.click(selector);
};
/** Opens the list of elements beside the label. */
export const openElements = (page) =>
	page.$eval("#layersMenu", (d) => /** @type {HTMLDetailsElement} */ (d).setAttribute("open", ""));

/**
 * Does something that prints to the virtual printer (by default, clicks Print) and waits for
 * that print on the tape. Waiting for a new first print, rather than a count, still works when
 * the tape already holds prints, or as many as it keeps.
 * @param {import("puppeteer-core").Page} page
 */
export const printVirtual = async (page, act = () => page.click("#btnPrint")) => {
	const before = await page.$("#tape .printed");
	await act();
	await page.waitForFunction(
		(old) => {
			const newest = document.querySelector("#tape .printed");
			return !!newest && newest !== old;
		},
		{},
		before,
	);
};

export const appState = (page) =>
	page.evaluate(() => JSON.parse(JSON.stringify(window.labelApp.state)));
export const serialized = (page) => page.evaluate(() => window.labelApp.serialize());
export const redraw = (page) => page.evaluate(() => window.labelApp.drawCanvas());

/** Drags from the centre of an element by (dx, dy) screen pixels. */
export const dragBy = async (page, selector, dx, dy, { alt = false } = {}) => {
	const el = await page.$(selector);
	// As a user would scroll to it first: Firefox won't move the mouse off the page.
	await el.scrollIntoView();
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

/**
 * How far the caret is, in screen pixels, from the right edge of the ink in its line on the
 * label canvas, and the line's height for scale. With the caret after a line's last letter,
 * they should nearly meet: anything that puts the editor at another scale or in another
 * font than the label shows up here, whatever the editor itself thinks.
 */
export const caretFromInk = (page) =>
	page.evaluate(() => {
		const caret = document.querySelector(".inline-caret").getBoundingClientRect();
		const c = /** @type {HTMLCanvasElement} */ (document.querySelector("#labelCanvas"));
		const r = c.getBoundingClientRect();
		const k = c.width / r.width;
		const top = Math.max(0, Math.floor((caret.top - r.top) * k));
		const bottom = Math.min(c.height, Math.ceil((caret.bottom - r.top) * k));
		const d = c.getContext("2d").getImageData(0, top, c.width, bottom - top).data;
		let right = -1;
		for (let i = 0; i < d.length; i += 4) if (!d[i]) right = Math.max(right, (i / 4) % c.width);
		return { gap: caret.left - (r.left + (right + 1) / k), height: caret.height };
	});
