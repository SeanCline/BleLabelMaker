// Phomemo D-series models, as data.
import { dSeries } from "./driver.js";

const label = (heightMm, widths) => widths.map((widthMm) => ({ widthMm, heightMm }));
// The D-series label sizes. The D30 itself takes the 12 mm ones; which of the wider ones each
// relative takes isn't known, so the A30 and P15 offer them all.
const D_SERIES_12 = label(12, [40, 30, 50]);
const D_SERIES_ALL = [...D_SERIES_12, ...label(14, [25, 28, 30, 40, 50]), ...label(15, [30, 50])];

/** @returns {import("../index.js").PrinterModel} */
const model = (name, more = {}) => ({
	id: name.toLowerCase().replace(/\s+/g, "-"),
	name,
	prefixes: [name.replace(/\s+/g, "").toUpperCase()],
	vendor: "Phomemo",
	driver: dSeries,
	headDots: 96,
	dotsPerMm: 8,
	feedLines: 23,
	feedAfter: "each",
	presets: D_SERIES_12,
	continuousHeightMm: 12,
	tested: false,
	...more,
});

/** @type {import("../index.js").PrinterModel[]} */
export const MODELS = [
	model("D30", { tested: true }),
	// These print exactly like the D30. What each calls itself over Bluetooth is a guess from its name.
	...["D10", "D20", "D30 Pro", "D30s", "D35", "Q30", "V30D"].map((name) => model(name)),
	// The D30's print sequence with different continuous-paper feeds.
	model("A30", { feedLines: 12, feedAfter: "last", presets: D_SERIES_ALL }),
	model("P15", { feedLines: 0, presets: D_SERIES_ALL }),
];
