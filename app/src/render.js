import { dotScale } from "./units.js";
import { LIMITS, MARGIN, textFillsLabel, withLength } from "./model.js";
import { threshold } from "./raster.js";
import { makeCanvas } from "./painters/common.js";
import { layoutTextBox, drawText } from "./painters/text.js";
import { drawShape } from "./painters/shapes.js";
import { drawBarcode, drawQr } from "./painters/codes.js";
import { drawImageElement } from "./painters/image.js";

export { layoutTextBox };

// Measures text for contentLengthMm. Created on first use, so importing this module needs no DOM.
let lengthCanvasCtx = null;
const lengthContext = () => (lengthCanvasCtx ??= document.createElement("canvas").getContext("2d"));

/**
 * The label's size in the printer's dots.
 * @param {import("./model.js").Label} label
 * @param {import("./units.js").DotScale} [dots]
 */
export const labelDots = (label, dots = dotScale()) => ({
	width: Math.round(dots.mm(label.widthMm)),
	height: Math.round(dots.mm(label.heightMm)),
});

/**
 * How long a continuous label needs to be for what's on it, in whole mm. A label that is one
 * text box is as long as its text at the size the height allows (fit) or the size set, one line
 * per paragraph; anything else ends a margin past its furthest element.
 * @param {import("./model.js").Doc} doc with its fields filled in
 * @param {import("./units.js").DotScale} [dots] the resolution it prints at, which text is
 *   measured in
 */
export const contentLengthMm = (doc, dots = dotScale()) => {
	let mm;
	if (textFillsLabel(doc)) {
		const e = /** @type {import("./model.js").TextElement} */ (doc.elements[0]);
		// So wide nothing wraps: the label grows to the text instead.
		const { lines, sizes, offsets, measure } = layoutTextBox(
			lengthContext(),
			e,
			{ w: 1e6, h: Math.round(dots.mm(e.h)) },
			dots,
		);
		const widest = Math.max(
			0,
			...lines.map((line, i) => measure(offsets[i], offsets[i] + line.length, sizes[i])),
		);
		mm = dots.toMm(widest) + 2 * MARGIN.x;
	} else {
		mm = Math.max(0, ...doc.elements.map((e) => e.x + e.w)) + MARGIN.x;
	}
	const [lo, hi] = LIMITS.labelWidthMm;
	return Math.min(hi, Math.max(lo, Math.ceil(mm)));
};

/**
 * The document at the length its content needs, if it's a continuous roll set to auto length.
 * @param {import("./model.js").Doc} doc
 * @param {import("./units.js").DotScale} [dots]
 */
export const withAutoLength = (doc, dots = dotScale()) =>
	doc.label.continuous && doc.label.autoLength ? withLength(doc, contentLengthMm(doc, dots)) : doc;

/**
 * Exact integer transforms for quarter turns (clockwise). Using rotate() around a centre
 * that falls on a half pixel would smear one-dot lines, which matters for barcodes.
 * Each maps a local frame of size (lw, lh) onto a box of size (w, h).
 */
export const QUARTER = [
	() => [1, 0, 0, 1, 0, 0],
	(w) => [0, 1, -1, 0, w, 0],
	(w, h) => [-1, 0, 0, -1, w, h],
	(_w, h) => [0, -1, 1, 0, 0, h],
];

/** An element's quarter turns, clockwise: 0 to 3. */
export const quarterOf = (e) => ((e.rotation ?? 0) / 90) % 4;
/** The element's own frame inside a box, which a quarter turn lays across it. */
export const localSize = (quarter, box) =>
	quarter % 2 ? { w: box.h, h: box.w } : { w: box.w, h: box.h };

// Each element's drawing, keyed by everything that shapes it except where it sits, so a drag
// (which only moves things) redraws nothing: barcodes aren't re-encoded and photos aren't
// re-dithered every frame. Keys refer to images by a short id rather than the data URL.
const elementCache = new Map();
const ELEMENT_CACHE_SIZE = 64;
const imageIds = new Map();
const cacheKey = (e, box, dots) => {
	const { id: _id, x: _x, y: _y, ...look } = e;
	if ("src" in look) {
		if (!imageIds.has(look.src)) imageIds.set(look.src, imageIds.size);
		look.src = imageIds.get(look.src);
	}
	return JSON.stringify([look, box.w, box.h, dots.dotsPerMm]);
};

/**
 * Forgets cached element drawings. Call it when fonts finish loading: text drawn before then
 * used a fallback face.
 */
export const clearRenderCache = () => {
	elementCache.clear();
	imageIds.clear();
};

/**
 * Draws the document at printer resolution and reduces it to pure black and white, so the
 * canvas is exactly the bitmap that will be sent to the printer.
 *
 * Each element is drawn into its own canvas, snapped to whole dots, rotated in quarter
 * turns, optionally dithered, and then composited in z-order.
 *
 * @param {import("./model.js").Doc} doc
 * @param {HTMLCanvasElement} canvas
 * @param {{dots?: import("./units.js").DotScale}} [options] the printer's resolution
 * @returns {Promise<{fittedSizes: Map<string, number>, warnings: Map<string, string>}>}
 *   font sizes chosen by fit-to-box (pt), and per-element problems worth telling the user
 */
export const renderLabel = async (doc, canvas, { dots = dotScale() } = {}) => {
	const { width, height } = labelDots(doc.label, dots);
	if (canvas.width !== width) canvas.width = width;
	if (canvas.height !== height) canvas.height = height;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.fillStyle = "#fff";
	ctx.fillRect(0, 0, width, height);

	const fittedSizes = new Map();
	const warnings = new Map();
	for (const e of doc.elements) {
		const draw = DRAW[e.type];
		if (!draw) continue;
		const box = {
			x: Math.round(dots.mm(e.x)),
			y: Math.round(dots.mm(e.y)),
			w: Math.max(1, Math.round(dots.mm(e.w))),
			h: Math.max(1, Math.round(dots.mm(e.h))),
		};
		// Before the key: clearing renumbers images, and a drawing filed under an old number
		// could later be found for a different picture.
		if (imageIds.size > ELEMENT_CACHE_SIZE) clearRenderCache();
		const key = cacheKey(e, box, dots);
		let drawn = elementCache.get(key);
		if (drawn) {
			// Most recently used last, so the oldest is the one dropped.
			elementCache.delete(key);
		} else {
			drawn = await drawElement(draw, e, box, dots);
		}
		if (!drawn.retry) elementCache.set(key, drawn);
		if (elementCache.size > ELEMENT_CACHE_SIZE)
			elementCache.delete(elementCache.keys().next().value);
		if (drawn.fittedPx) fittedSizes.set(e.id, drawn.fittedPx / dots.pt(1));
		if (drawn.warning) warnings.set(e.id, drawn.warning);
		ctx.drawImage(drawn.canvas, box.x, box.y);
	}

	const image = ctx.getImageData(0, 0, width, height);
	threshold(image);
	ctx.putImageData(image, 0, 0);
	return { fittedSizes, warnings };
};

/** Draws one element into its own canvas the size of its box, rotated into place. */
const drawElement = async (draw, e, box, dots) => {
	const quarter = quarterOf(e);
	const local = localSize(quarter, box);
	const canvas = makeCanvas(box.w, box.h);
	const o = canvas.getContext("2d", { willReadFrequently: true });
	o.setTransform(...QUARTER[quarter](box.w, box.h));
	const result = await draw(o, e, local, dots);
	if (result?.process) {
		o.setTransform(1, 0, 0, 1, 0, 0);
		o.putImageData(result.process(o.getImageData(0, 0, canvas.width, canvas.height)), 0, 0);
	}
	return { canvas, fittedPx: result?.fittedPx, warning: result?.warning, retry: result?.retry };
};

// Each element type's painter (src/painters/): it draws into a local frame (0,0)–(box.w,
// box.h), already rotated, at the printer's resolution (`dots`) for anything it sizes in
// millimetres or points. A new element type is a painter here and its model in model.js.
/**
 * @typedef {(ctx: CanvasRenderingContext2D, e: any, box: {w: number, h: number},
 *   dots: import("./units.js").DotScale) => Promise<PaintResult | null | void> | PaintResult
 *   | null | void} Painter
 * @typedef {{fittedPx?: number, warning?: string, retry?: boolean,
 *   process?: (image: ImageData) => ImageData}} PaintResult fittedPx: the font size fit chose;
 *   warning: a problem worth telling; retry: don't cache; process: a pass over the drawn pixels
 */
/** @type {Record<string, Painter>} */
const DRAW = {
	image: drawImageElement,
	text: drawText,
	shape: drawShape,
	barcode: drawBarcode,
	qr: drawQr,
};
