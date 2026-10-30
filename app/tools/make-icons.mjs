// Renders icons/icon.svg to the PNGs install prompts and home screens need: npm run icons
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { findBrowser } from "../test/e2e/harness.js";

const svg = await readFile(new URL("../icons/icon.svg", import.meta.url), "utf8");
// The tile's colour, from its first shape.
const background = svg.match(/fill="(#[0-9a-f]+)"/i)[1];
const executablePath = findBrowser();
if (!executablePath) throw new Error("No Chromium-based browser found; set CHROME_PATH.");
const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
const render = async (name, size, style) => {
	await page.setViewport({ width: size, height: size });
	await page.setContent(
		`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}${style}</style>${svg}`,
	);
	await page.screenshot({
		path: fileURLToPath(new URL(`../icons/${name}`, import.meta.url)),
		omitBackground: true,
	});
};
for (const size of [192, 512]) await render(`icon-${size}.png`, size, "");
// Android crops a maskable icon to its own shape (a circle, a squircle), keeping only the
// middle 80% for sure. So the tile shrinks to that over a full square of its own colour,
// where the rounded corners vanish, and the label inside stays whole whatever the crop.
await render("icon-maskable-512.png", 512, `body{background:${background}}svg{scale:.8}`);
await browser.close();
