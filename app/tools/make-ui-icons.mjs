// Builds icons/ui.svg, one sprite of the Lucide icons the page uses, from the pinned
// lucide-static package: npm run ui-icons. The page shows one with
// <svg class="icon"><use href="icons/ui.svg#name" /></svg>; .icon in styles.css draws it.
import { copyFile, readFile, writeFile } from "node:fs/promises";

const ICONS = [
	// File menu, undo and print
	"file",
	"file-plus",
	"folder-open",
	"download",
	"share-2",
	"history",
	"undo-2",
	"redo-2",
	"printer",
	"chevron-down",
	// The label size, and the batch list
	"tag",
	"table",
	// Adding elements, and the list of them
	"type",
	"square",
	"barcode",
	"qr-code",
	"image",
	"layers",
	// Zoom and ruler
	"zoom-in",
	"zoom-out",
	"ruler",
	// The bar over the label
	"bold",
	"italic",
	"underline",
	"align-left",
	"align-center",
	"align-right",
	"smile",
	"pencil",
	"check",
	"copy",
	"trash-2",
	"sliders-horizontal",
	"align-start-vertical",
	"align-center-vertical",
	"align-end-vertical",
	"align-start-horizontal",
	"align-center-horizontal",
	"align-end-horizontal",
	"align-horizontal-distribute-center",
	"align-vertical-distribute-center",
	"x",
	"grip-vertical",
	"braces",
];

const source = new URL("../node_modules/lucide-static/", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("package.json", source), "utf8"));
const symbols = [];
for (const name of ICONS) {
	const svg = await readFile(new URL(`icons/${name}.svg`, source), "utf8");
	const body = svg
		.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, svg.lastIndexOf("</svg>"))
		.trim()
		.replace(/\s*\n\s*/g, "");
	symbols.push(`<symbol id="${name}" viewBox="0 0 24 24">${body}</symbol>`);
}
await writeFile(
	new URL("../icons/ui.svg", import.meta.url),
	`<!-- Lucide v${version} (ISC; icons/LICENSE-lucide.txt). Made by tools/make-ui-icons.mjs. -->
<svg xmlns="http://www.w3.org/2000/svg">
${symbols.join("\n")}
</svg>
`,
);
await copyFile(new URL("LICENSE", source), new URL("../icons/LICENSE-lucide.txt", import.meta.url));
