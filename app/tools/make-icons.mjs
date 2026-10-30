// Renders icons/icon.svg to the PNG sizes install prompts need: npm run icons
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { findBrowser } from "../test/e2e/harness.js";

const svg = await readFile(new URL("../icons/icon.svg", import.meta.url), "utf8");
const executablePath = findBrowser();
if (!executablePath) throw new Error("No Chromium-based browser found; set CHROME_PATH.");
const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
for (const size of [192, 512]) {
	await page.setViewport({ width: size, height: size });
	await page.setContent(
		`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
	);
	await page.screenshot({
		path: fileURLToPath(new URL(`../icons/icon-${size}.png`, import.meta.url)),
		omitBackground: true,
	});
}
await browser.close();
