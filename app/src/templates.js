// Starting points for a new label. Each lays itself out on the label that's loaded rather
// than carrying a size, so it fits every printer and roll, from 25 mm pre-cut to continuous.
import { createBarcode, createDocument, createQr, createText, printableArea } from "./model.js";
import { round } from "./units.js";

/**
 * @typedef {{x: number, y: number, w: number, h: number}} Area
 * @typedef {object} Template
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {(doc: import("./model.js").Doc, area: Area) => import("./model.js").Element[]} [elements]
 *   what goes on the label, given an empty document on it and its printable area
 */

/** Splits the area's width into columns, `gap` mm apart, by the given shares. */
const columns = (area, shares, gap = 1) => {
	const total = shares.reduce((a, b) => a + b, 0);
	const free = area.w - gap * (shares.length - 1);
	let x = area.x;
	return shares.map((share, i) => {
		// The last takes what's left, so rounding can't push it past the edge.
		const w = i === shares.length - 1 ? round(area.x + area.w - x) : round((free * share) / total);
		const col = { x: round(x), y: area.y, w, h: area.h };
		x += w + gap;
		return col;
	});
};

/** @type {Template[]} */
export const TEMPLATES = [
	{
		id: "blank",
		name: "Blank",
		description: "One line of text that fills the label",
	},
	{
		id: "name",
		name: "Name tag",
		description: "A name, with a smaller line under it",
		elements: (doc, area) => [
			createText(doc, {
				...area,
				text: "Alex Morgan\nFacilities",
				fit: true,
				fontWeight: 700,
				firstLineScale: 2,
			}),
		],
	},
	{
		id: "food",
		name: "Use-by date",
		description: "Today's date, and the date three days on, filled in when it prints",
		elements: (doc, area) => [
			createText(doc, { ...area, text: "Made {date}\nUse by {date+3d}", fit: true }),
		],
	},
	{
		id: "bin",
		name: "Storage bin",
		description: "A QR code beside what's in the box",
		elements: (doc, area) => {
			const [code, words] = [area.h, area.w - area.h - 1];
			return [
				createQr(doc, { x: area.x, y: area.y, w: code, h: code, data: "Bin A-12" }),
				createText(doc, {
					x: round(area.x + code + 1),
					y: area.y,
					w: round(words),
					h: area.h,
					text: "Bin A-12\nM3 screws",
					fit: true,
					align: "left",
					fontWeight: 600,
					firstLineScale: 1.5,
				}),
			];
		},
	},
	{
		id: "price",
		name: "Price tag",
		description: "The item, and its price in white on black",
		elements: (doc, area) => {
			const [item, price] = columns(area, [3, 2]);
			return [
				createText(doc, { ...item, text: "Sourdough loaf", fit: true, align: "left" }),
				createText(doc, { ...price, text: "$4.50", fit: true, fontWeight: 800, invert: true }),
			];
		},
	},
	{
		id: "cable",
		name: "Cable flag",
		description:
			"The middle wraps round the cable and the ends meet as a flag, readable from both sides",
		elements: (doc, area) => {
			// The middle third goes round the cable, so nothing is printed there. The fold turns
			// the right end over sideways, not top to bottom, so both ends print upright.
			const [left, , right] = columns(area, [1, 1, 1], 0);
			const flag = { text: "NAS port 3", fit: true, fontWeight: 600 };
			return [createText(doc, { ...left, ...flag }), createText(doc, { ...right, ...flag })];
		},
	},
	{
		id: "asset",
		name: "Asset tag",
		description: "A barcode that counts up with every label printed",
		elements: (doc, area) => [createBarcode(doc, { ...area, data: "A-{n:0000}" })],
	},
];

/**
 * A new document from a template, on `label`.
 * @param {Template} template
 * @param {import("./model.js").Label} label
 * @returns {import("./model.js").Doc}
 */
export const fromTemplate = (template, label) => {
	if (!template.elements) return createDocument(label);
	const empty = { label: { ...label }, elements: [] };
	return { label: empty.label, elements: template.elements(empty, printableArea(label)) };
};
