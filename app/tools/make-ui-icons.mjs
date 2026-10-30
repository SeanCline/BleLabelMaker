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
	"chevron-left",
	"chevron-right",
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
	// The settings under More
	"contrast",
	"scaling",
	"square-dimensions",
	"type-outline",
	"pen-tool",
	"captions",
	"image-up",
	"crop",
	"maximize-2",
	"paint-bucket",
	"circle-dot",
	// The printer menu
	"monitor",
	"bluetooth",
	"bluetooth-searching",
	"cable",
	"plug",
	"unplug",
	"rotate-cw",
	"unlink",
	"clipboard-copy",
	// The label size, the batch list, history and dialogs
	"move-horizontal",
	"heading",
	"search",
	"bug",
];

// Drawn here, in Lucide's style (24 grid, 2 px round strokes), where it has nothing that fits.
const BOX = '<rect width="18" height="18" x="3" y="3" rx="2" />';
/** Two centred lines of text in a box, at its top, middle or bottom. */
const textIn = (y) => `${BOX}<path d="M7 ${y}h10" /><path d="M9 ${y + 4}h6" />`;
// Lucide's "letters" A, with its B under it rather than beside it.
const A = '<path d="m8 10 3.453-7.648a.6.6 0 0 1 1.094 0L16 10" /><path d="M15 8H9" />';
const B =
	'<path d="M9 18h4a2 2 0 0 1 0 4H9.5a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5H12a2 2 0 0 1 0 4" />';
// Dither and Threshold are one gradient, black at the top left to white at the bottom right,
// each drawn as that way of printing it would. The dots are an ordered (2×2 Bayer) dither:
// real error diffusion at this size looks like noise rather than a fade.
const FILL = 'fill="currentColor" stroke="none"';
/** Black squares filling the box's inside, from rows of "#" (black) and "." (white). */
const pixels = (rows) => {
	const cell = 16 / rows.length;
	const at = (n) => +(4 + n * cell).toFixed(3);
	let d = "";
	rows.forEach((row, y) => {
		for (const run of row.matchAll(/#+/g))
			d += `M${at(run.index)} ${at(y)}H${at(run.index + run[0].length)}V${at(y + 1)}H${at(run.index)}z`;
	});
	return `${BOX}<path ${FILL} d="${d}" />`;
};
const SPLIT = "M4 20c5 0 6-3 8-8s3-8 8-8";
const CUSTOM = {
	dither: pixels(["##.#.#.", "#####.#", ".#.#.#.", "###.#.#", ".#.#...", "#.#.#..", ".#....."]),
	threshold: `<path ${FILL} d="${SPLIT}L4 4z" />${BOX}<path d="${SPLIT}" />`,
	"text-valign-top": textIn(8),
	"text-valign-middle": textIn(10),
	"text-valign-bottom": textIn(12),
	"letters-stacked": A + B,
	// Darkness: the same dots as Dither, sparser or denser.
	"density-light": pixels([
		".......",
		".#...#.",
		".......",
		"...#...",
		".......",
		".#...#.",
		".......",
	]),
	"density-normal": pixels([
		"#.#.#.#",
		".#.#.#.",
		"#.#.#.#",
		".#.#.#.",
		"#.#.#.#",
		".#.#.#.",
		"#.#.#.#",
	]),
	"density-dark": pixels([
		"#######",
		"##.####",
		"#######",
		"####.##",
		"#######",
		"##.####",
		"#######",
	]),
};

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
for (const [name, body] of Object.entries(CUSTOM))
	symbols.push(`<symbol id="${name}" viewBox="0 0 24 24">${body}</symbol>`);
await writeFile(
	new URL("../icons/ui.svg", import.meta.url),
	`<!-- Lucide v${version} (ISC; icons/LICENSE-lucide.txt), and a few drawn in its style. Made by tools/make-ui-icons.mjs. -->
<svg xmlns="http://www.w3.org/2000/svg">
${symbols.join("\n")}
</svg>
`,
);
await copyFile(new URL("LICENSE", source), new URL("../icons/LICENSE-lucide.txt", import.meta.url));
