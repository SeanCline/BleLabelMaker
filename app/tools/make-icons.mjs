// Renders icons/icon.svg to the PNG sizes install prompts need: node tools/make-icons.mjs
import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import { findBrowser } from "../test/e2e/harness.js";

const svg = await readFile(new URL("../icons/icon.svg", import.meta.url), "utf8");
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true });
const page = await browser.newPage();
for (const size of [192, 512]) {
	await page.setViewport({ width: size, height: size });
	await page.setContent(
		`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
	);
	await page.screenshot({
		path: new URL(`../icons/icon-${size}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, "$1"),
		omitBackground: true,
	});
}
await browser.close();
