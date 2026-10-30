// Renders icons/icon.svg to the PNGs install prompts and home screens need: npm run icons
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { findBrowser } from "../test/e2e/harness.js";

const svg = await readFile(new URL("../icons/icon.svg", import.meta.url), "utf8");
// The tag's colour, from its first shape: the tile behind it on a home screen. The tag goes
// white on it, its hole and arcs cut through to the tile.
const blue = svg.match(/fill="(#[0-9a-f]+)"/i)[1];
const executablePath = findBrowser();
if (!executablePath) throw new Error("No Chromium-based browser found; set CHROME_PATH.");
const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
const render = async (name, size, style) => {
	await page.setViewport({ width: size, height: size });
	await page.setContent(
		`<style>*{margin:0}.tile{width:${size}px;height:${size}px;display:grid;place-items:center;` +
			`background:${blue};border-radius:22%}svg{width:74%;height:74%}.tag{fill:#fff}${style}</style>` +
			`<div class="tile">${svg}</div>`,
	);
	await page.screenshot({
		path: fileURLToPath(new URL(`../icons/${name}`, import.meta.url)),
		omitBackground: true,
	});
};
for (const size of [192, 512]) await render(`icon-${size}.png`, size, "");
// Android crops a maskable icon to its own shape (a circle, a squircle), keeping only the
// middle 80% for sure. So the tile fills the square, and the tag shrinks to stay whole
// inside that middle whatever the crop.
await render("icon-maskable-512.png", 512, ".tile{border-radius:0}svg{width:60%;height:60%}");
await browser.close();
