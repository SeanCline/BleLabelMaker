import { round } from "./units.js";
import { DEFAULT_PRINTER } from "./printers/index.js";
import { plainText } from "./layout.js";

/**
 * The document model, as saved in .label files (see DESIGN.md). Units are mm and pt.
 * @typedef {{widthMm: number, heightMm: number, continuous: boolean}} Label
 * @typedef {{id: string, x: number, y: number, w: number, h: number}} Rect
 * @typedef {Rect & {rotation: 0|90|180|270}} Box
 * @typedef {Box & {type: "text", text: string, fontFamily: string, fontSizePt: number,
 *   fontWeight: number, italic: boolean, align: "left"|"center"|"right",
 *   vAlign: "top"|"middle"|"bottom", fit: boolean, invert: boolean, letterSpacingPt: number,
 *   underline: boolean, outline: boolean, stacked: boolean, firstLineScale: 1|1.5|2}} TextElement
 * @typedef {Box & {type: "shape", shape: "rect"|"ellipse"|"line", strokeMm: number,
 *   fill: boolean, radiusMm: number}} ShapeElement
 * @typedef {Box & {type: "barcode", data: string, symbology: "CODE128"|"EAN13"|"UPCA",
 *   showText: boolean, textFont: string}} BarcodeElement
 * @typedef {Box & {type: "qr", data: string, level: "L"|"M"|"Q"|"H"}} QrElement
 * @typedef {Box & {type: "image", src: string, mode: "dither"|"threshold", level: number,
 *   invert: boolean, fit: "contain"|"cover"|"stretch", align: "left"|"center"|"right",
 *   vAlign: "top"|"middle"|"bottom"}} ImageElement
 * @typedef {TextElement | ShapeElement | BarcodeElement | QrElement | ImageElement} Element
 * @typedef {{label: Label, elements: Element[]}} Doc
 * @typedef {{label: Label, elements: [TextElement, ...Element[]]}} TextFirstDoc a new or
 *   simple-mode document, which always starts with its text
 */

// Continuous rolls are one long label, cut or torn off after printing, so the length is
// whatever the design needs.
export const CONTINUOUS_LENGTH_MM = 60;
export const DEFAULT_LABEL = { ...DEFAULT_PRINTER.presets[0], continuous: false };

// The unprintable edge of a label. Every model so far has the same
// one; a model that needs another would carry its own.
export const MARGIN = { x: 1, y: 1.5 };

export const LIMITS = {
	labelWidthMm: [10, 200],
	labelHeightMm: [6, 15],
	fontSizePt: [4, 200],
	letterSpacingPt: [-5, 50],
	elementMinMm: 1,
	strokeMm: [0.125, 5],
	radiusMm: [0, 20],
	// Embedded images are downscaled on import; this only stops pathological files.
	imageSrcChars: 3_000_000,
	// A whole .label file, a few images' worth. Anything bigger is refused before it's read, so a
	// huge file or a crafted share link can't exhaust memory.
	fileChars: 20_000_000,
};

export const ALIGN = ["left", "center", "right"];
export const VALIGN = ["top", "middle", "bottom"];
export const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
export const ROTATIONS = [0, 90, 180, 270];
export const SHAPES = ["rect", "ellipse", "line"];
export const BARCODE_TYPES = ["CODE128", "EAN13", "UPCA"];
export const QR_LEVELS = ["L", "M", "Q", "H"];
export const IMAGE_MODES = ["dither", "threshold"];
export const FIRST_LINE_SCALES = [1, 1.5, 2];
// contain: the whole picture, letterboxed; cover: fills the box, cropping what sticks out.
export const IMAGE_FITS = ["contain", "cover", "stretch"];

/** @param {{widthMm: number, heightMm: number}} label */
export const printableArea = (label) => ({
	x: MARGIN.x,
	y: MARGIN.y,
	w: round(label.widthMm - MARGIN.x * 2),
	h: round(label.heightMm - MARGIN.y * 2),
});

let idCounter = 0;
export const newId = (doc) => {
	const taken = new Set(doc?.elements.map((e) => e.id) ?? []);
	let id;
	do id = `e${++idCounter}`;
	while (taken.has(id));
	return id;
};

/** @type {Omit<TextElement, keyof Box | "type">} */
export const TEXT_DEFAULTS = {
	text: "Text",
	fontFamily: "Inter",
	fontSizePt: 12,
	fontWeight: 400,
	italic: false,
	align: "center",
	vAlign: "middle",
	fit: false,
	invert: false,
	letterSpacingPt: 0,
	underline: false,
	outline: false,
	// One letter per line, for a narrow label read top to bottom without turning your head.
	stacked: false,
	// A title: the first line larger than the rest.
	firstLineScale: 1,
};

/**
 * @param {Doc} doc
 * @param {Partial<TextElement>} [props]
 * @returns {TextElement}
 */
export const createText = (doc, props = {}) => ({
	id: newId(doc),
	type: "text",
	x: 2,
	y: 2,
	w: 20,
	h: 6,
	rotation: 0,
	...TEXT_DEFAULTS,
	...props,
	text: plainText(props.text ?? TEXT_DEFAULTS.text),
});

/**
 * @param {Doc} doc
 * @param {Partial<ShapeElement>} [props]
 * @returns {ShapeElement}
 */
export const createShape = (doc, props = {}) => ({
	id: newId(doc),
	type: "shape",
	x: 2,
	y: 2,
	w: 20,
	h: 6,
	rotation: 0,
	shape: "rect",
	strokeMm: 0.5,
	fill: false,
	radiusMm: 1,
	...props,
});

/**
 * @param {Doc} doc
 * @param {Partial<BarcodeElement>} [props]
 * @returns {BarcodeElement}
 */
export const createBarcode = (doc, props = {}) => ({
	id: newId(doc),
	type: "barcode",
	x: 2,
	y: 2,
	w: 30,
	h: 8,
	rotation: 0,
	data: "ABC-123",
	symbology: "CODE128",
	showText: true,
	textFont: "Roboto Condensed",
	...props,
});

/**
 * @param {Doc} doc
 * @param {Partial<QrElement>} [props]
 * @returns {QrElement}
 */
export const createQr = (doc, props = {}) => ({
	id: newId(doc),
	type: "qr",
	x: 2,
	y: 2,
	w: 9,
	h: 9,
	rotation: 0,
	data: "https://example.com",
	level: "M",
	...props,
});

/**
 * @param {Doc} doc
 * @param {Partial<ImageElement>} [props]
 * @returns {ImageElement}
 */
export const createImage = (doc, props = {}) => ({
	id: newId(doc),
	type: "image",
	x: 2,
	y: 2,
	w: 10,
	h: 10,
	rotation: 0,
	src: "",
	mode: "dither",
	level: 128,
	invert: false,
	fit: "contain",
	align: "center",
	vAlign: "middle",
	...props,
});

/**
 * Rotates an element to an absolute angle. Boxes are axis-aligned, so a quarter turn swaps
 * width and height around the centre; the content keeps its shape instead of squashing.
 */
/**
 * @template {Element} E
 * @param {E} e
 * @param {0|90|180|270} rotation
 * @returns {E}
 */
export const rotateTo = (e, rotation) => {
	const quarterTurn = ((((rotation - e.rotation) / 90) % 2) + 2) % 2 === 1;
	if (!quarterTurn) return { ...e, rotation };
	const cx = e.x + e.w / 2;
	const cy = e.y + e.h / 2;
	return { ...e, rotation, w: e.h, h: e.w, x: round(cx - e.h / 2, 3), y: round(cy - e.w / 2, 3) };
};

/**
 * @param {Label} [label]
 * @returns {TextFirstDoc}
 */
export const createDocument = (label = DEFAULT_LABEL) => {
	const empty = { label: { ...label }, elements: [] };
	const text = createText(empty, { ...printableArea(label), text: "Hello world", fit: true });
	return { label: empty.label, elements: [text] };
};

// Simple mode can represent a design only if it is one text box covering the printable area;
// anything else would be lost on the way in.
/** @param {Doc} doc */
export const isSimpleCompatible = (doc) => {
	if (doc.elements.length !== 1 || doc.elements[0].type !== "text") return false;
	const e = doc.elements[0];
	const area = printableArea(doc.label);
	return (
		e.x === area.x &&
		e.y === area.y &&
		e.w === area.w &&
		e.h === area.h &&
		e.align === "center" &&
		e.rotation === 0 &&
		!e.invert
	);
};

/**
 * @param {Doc} doc
 * @returns {TextFirstDoc}
 */
export const toSimple = (doc) => {
	const source = doc.elements.find((e) => e.type === "text") ?? TEXT_DEFAULTS;
	const empty = { label: { ...doc.label }, elements: [] };
	const text = createText(empty, {
		...pick(source, Object.keys(TEXT_DEFAULTS)),
		...printableArea(doc.label),
		align: "center",
		vAlign: "middle",
		invert: false,
	});
	return { label: empty.label, elements: [text] };
};

// Elements keep their mm position on resize; clamp so nothing is stranded off the label.
/**
 * @param {Doc} doc
 * @param {Label} label
 * @returns {Doc}
 */
export const resizeLabel = (doc, label, { refitSimple = false } = {}) => {
	if (refitSimple) return toSimple({ ...doc, label });
	return {
		label: { ...label },
		elements: doc.elements.map((e) => clampToLabel(e, label)),
	};
};

/**
 * @template {Element} E
 * @param {E} e
 * @param {Label} label
 * @returns {E}
 */
export const clampToLabel = (e, label) => {
	const w = Math.min(e.w, label.widthMm);
	const h = Math.min(e.h, label.heightMm);
	return {
		...e,
		w,
		h,
		x: round(Math.min(Math.max(e.x, 0), label.widthMm - w)),
		y: round(Math.min(Math.max(e.y, 0), label.heightMm - h)),
	};
};

// ---------------------------------------------------------------------------
// Arranging several elements

/** @param {Omit<Rect, "id">[]} boxes */
export const boundsOf = (boxes) => {
	const x = Math.min(...boxes.map((b) => b.x));
	const y = Math.min(...boxes.map((b) => b.y));
	const right = Math.max(...boxes.map((b) => b.x + b.w));
	const bottom = Math.max(...boxes.map((b) => b.y + b.h));
	return { x, y, w: right - x, h: bottom - y };
};

/**
 * Lines elements up on one edge or centre of their combined bounds.
 * @param {Rect[]} boxes
 * @param {"left"|"center"|"right"|"top"|"middle"|"bottom"} edge
 * @returns {Record<string, {x?: number, y?: number}>} position patches by id
 */
export const alignPatches = (boxes, edge) => {
	const b = boundsOf(boxes);
	const place = {
		left: () => ({ x: b.x }),
		center: (e) => ({ x: b.x + (b.w - e.w) / 2 }),
		right: (e) => ({ x: b.x + b.w - e.w }),
		top: () => ({ y: b.y }),
		middle: (e) => ({ y: b.y + (b.h - e.h) / 2 }),
		bottom: (e) => ({ y: b.y + b.h - e.h }),
	}[edge];
	return Object.fromEntries(
		boxes.map((e) => [
			e.id,
			Object.fromEntries(Object.entries(place(e)).map(([k, v]) => [k, round(v, 3)])),
		]),
	);
};

/**
 * Spaces three or more elements so the gaps between them are equal. The outermost two stay
 * put; the rest move along the axis, keeping their order.
 * @param {Rect[]} boxes
 * @param {"x"|"y"} axis
 * @returns {Record<string, {x?: number, y?: number}>}
 */
export const distributePatches = (boxes, axis) => {
	if (boxes.length < 3) return {};
	const size = axis === "x" ? "w" : "h";
	const sorted = [...boxes].sort((a, b) => a[axis] + a[size] / 2 - (b[axis] + b[size] / 2));
	const first = sorted[0];
	const last = sorted.at(-1);
	const span = last[axis] + last[size] - first[axis];
	const gap = (span - sorted.reduce((n, b) => n + b[size], 0)) / (sorted.length - 1);
	let at = first[axis];
	const patches = {};
	for (const b of sorted) {
		patches[b.id] = { [axis]: round(at, 3) };
		at += b[size] + gap;
	}
	return patches;
};

/**
 * Copies of elements with fresh ids, for paste and duplicate, kept on the label. Copies that
 * would land exactly on an element already there are stepped down and right, so a paste
 * never hides under (or on top of) its original.
 * @template {Element} E
 * @param {Doc} doc where the copies will go
 * @param {E[]} elements
 * @returns {E[]}
 */
export const placeCopies = (doc, elements, stepMm = 2) => {
	const same = (a, b) =>
		a.type === b.type && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
	let offset = 0;
	const at = (e) =>
		clampToLabel({ ...e, x: round(e.x + offset), y: round(e.y + offset) }, doc.label);
	for (let i = 0; i < 20 && elements.some((e) => doc.elements.some((o) => same(at(e), o))); i++) {
		offset += stepMm;
	}
	const taken = { label: doc.label, elements: [...doc.elements] };
	return elements.map((e) => {
		const copy = { ...at(e), id: newId(taken) };
		taken.elements.push(copy);
		return copy;
	});
};

const pick = (obj, keys) =>
	Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
