import { mmToDots, ptToDots } from "./units.js";
import { layoutText, stackLetters, LINE_HEIGHT } from "./layout.js";
import { threshold, toOneBit } from "./raster.js";
import { cssFont, cssFamily } from "./fonts.js";
import { encodeBarcode } from "./barcode.js";
import { encodeQr, QR_QUIET } from "./qr.js";

export const labelDots = (label) => ({
	width: Math.round(mmToDots(label.widthMm)),
	height: Math.round(mmToDots(label.heightMm)),
});

const makeCanvas = (w, h) => {
	const c = document.createElement("canvas");
	c.width = Math.max(1, w);
	c.height = Math.max(1, h);
	return c;
};

/**
 * Exact integer transforms for quarter turns (clockwise). Using rotate() around a centre
 * that falls on a half pixel would smear one-dot lines, which matters for barcodes.
 * Each maps a local frame of size (lw, lh) onto a box of size (w, h).
 */
const QUARTER = [
	() => [1, 0, 0, 1, 0, 0],
	(w) => [0, 1, -1, 0, w, 0],
	(w, h) => [-1, 0, 0, -1, w, h],
	(_w, h) => [0, -1, 1, 0, 0, h],
];

// Each element's drawing, keyed by everything that shapes it except where it sits, so a drag
// (which only moves things) redraws nothing: barcodes aren't re-encoded and photos aren't
// re-dithered every frame. Keys refer to images by a short id rather than the data URL.
const elementCache = new Map();
const ELEMENT_CACHE_SIZE = 64;
const imageIds = new Map();
const cacheKey = (e, box) => {
	const { id: _id, x: _x, y: _y, ...look } = e;
	if ("src" in look) {
		if (!imageIds.has(look.src)) imageIds.set(look.src, imageIds.size);
		look.src = imageIds.get(look.src);
	}
	return JSON.stringify([look, box.w, box.h]);
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
 * @returns {Promise<{fittedSizes: Map<string, number>, warnings: Map<string, string>}>}
 *   font sizes chosen by fit-to-box (pt), and per-element problems worth telling the user
 */
export const renderLabel = async (doc, canvas) => {
	const { width, height } = labelDots(doc.label);
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
			x: Math.round(mmToDots(e.x)),
			y: Math.round(mmToDots(e.y)),
			w: Math.max(1, Math.round(mmToDots(e.w))),
			h: Math.max(1, Math.round(mmToDots(e.h))),
		};
		const key = cacheKey(e, box);
		let drawn = elementCache.get(key);
		if (drawn) {
			// Most recently used last, so the oldest is the one dropped.
			elementCache.delete(key);
		} else {
			drawn = await drawElement(draw, e, box);
			if (imageIds.size > ELEMENT_CACHE_SIZE) clearRenderCache();
		}
		if (!drawn.retry) elementCache.set(key, drawn);
		if (elementCache.size > ELEMENT_CACHE_SIZE)
			elementCache.delete(elementCache.keys().next().value);
		if (drawn.fittedPx) fittedSizes.set(e.id, drawn.fittedPx / ptToDots(1));
		if (drawn.warning) warnings.set(e.id, drawn.warning);
		ctx.drawImage(drawn.canvas, box.x, box.y);
	}

	const image = ctx.getImageData(0, 0, width, height);
	threshold(image);
	ctx.putImageData(image, 0, 0);
	return { fittedSizes, warnings };
};

/** Draws one element into its own canvas the size of its box, rotated into place. */
const drawElement = async (draw, e, box) => {
	const quarter = ((e.rotation ?? 0) / 90) % 4;
	const local = quarter % 2 ? { w: box.h, h: box.w } : { w: box.w, h: box.h };
	const canvas = makeCanvas(box.w, box.h);
	const o = canvas.getContext("2d", { willReadFrequently: true });
	o.setTransform(...QUARTER[quarter](box.w, box.h));
	const result = await draw(o, e, local);
	if (result?.process) {
		o.setTransform(1, 0, 0, 1, 0, 0);
		o.putImageData(result.process(o.getImageData(0, 0, canvas.width, canvas.height)), 0, 0);
	}
	return { canvas, fittedPx: result?.fittedPx, warning: result?.warning, retry: result?.retry };
};

// ---------------------------------------------------------------------------
// Element painters: draw into a local frame (0,0)–(box.w, box.h), already rotated.

/**
 * Where a text element's lines go inside its (unrotated) box, in dots. Shared with the inline
 * editor so its caret sits on the rendered text rather than on its own idea of the layout.
 * Leaves ctx.font set to the chosen size.
 */
export const layoutTextBox = (ctx, e, box) => {
	const spacing = `${ptToDots(e.letterSpacingPt ?? 0)}px`;
	const measure = (s, px) => {
		ctx.font = cssFont(e, px);
		ctx.letterSpacing = spacing;
		return ctx.measureText(s).width;
	};
	const stacked = e.stacked ? stackLetters(e.text) : null;
	const layout = layoutText({
		text: stacked ? stacked.text : e.text,
		width: box.w,
		height: box.h,
		fontSize: ptToDots(e.fontSizePt),
		fit: e.fit,
		measure,
		firstScale: e.firstLineScale ?? 1,
	});
	ctx.font = cssFont(e, layout.fontSize);
	ctx.letterSpacing = spacing;
	// Centre the font's ascent+descent inside each line box so vertical alignment looks even.
	const m = ctx.measureText("Hg");
	const ascent = m.fontBoundingBoxAscent ?? layout.fontSize * 0.8;
	const descent = m.fontBoundingBoxDescent ?? layout.fontSize * 0.2;
	let top = 0;
	if (e.vAlign === "middle") top = (box.h - layout.height) / 2;
	else if (e.vAlign === "bottom") top = box.h - layout.height;
	// Where each line starts in the element's own text, which stacking rearranges.
	const starts = stacked ? layout.starts.map((i) => stacked.source[i]) : layout.starts;
	return { ...layout, starts, top, ascent, descent };
};

const drawText = (ctx, e, box) => {
	const { fontSize, lines, sizes, top, ascent, descent } = layoutTextBox(ctx, e, box);

	if (e.invert) {
		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, box.w, box.h);
	}
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, box.w, box.h);
	ctx.clip();
	ctx.font = cssFont(e, fontSize);
	ctx.fillStyle = e.invert ? "#fff" : "#000";
	ctx.textAlign = e.align;
	ctx.textBaseline = "alphabetic";
	const x = e.align === "left" ? 0 : e.align === "right" ? box.w : box.w / 2;

	ctx.lineJoin = "round";
	ctx.strokeStyle = ctx.fillStyle;
	let y = top;
	lines.forEach((line, i) => {
		// Each line at its own size (a larger first line), its metrics scaled to match.
		const size = sizes[i];
		const k = size / fontSize;
		const lineHeight = size * LINE_HEIGHT;
		const baseline = y + (lineHeight - (ascent + descent) * k) / 2 + ascent * k;
		y += lineHeight;
		ctx.font = cssFont(e, size);
		// Lines in whole dots, scaled to the text. An outline is thinner than an underline: on
		// small text a heavier one fills the letters back in. Outlines read well from about 20 pt.
		const stroke = Math.max(1, Math.round(size / 16));
		ctx.lineWidth = Math.max(1, Math.round(size / 24));
		if (e.outline) ctx.strokeText(line, x, baseline);
		else ctx.fillText(line, x, baseline);
		if (e.underline && line) {
			const w = ctx.measureText(line).width;
			const left = e.align === "left" ? x : e.align === "right" ? x - w : x - w / 2;
			const under = Math.round(baseline + Math.max(1, descent * k * 0.3));
			ctx.fillRect(Math.round(left), under, Math.round(w), stroke);
		}
	});
	ctx.restore();
	return { fittedPx: fontSize };
};

const roundRectPath = (ctx, x, y, w, h, r) => {
	r = Math.max(0, Math.min(r, w / 2, h / 2));
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
};

const ellipsePath = (ctx, x, y, w, h) => {
	if (w <= 0 || h <= 0) return;
	ctx.moveTo(x + w, y + h / 2);
	ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
};

/**
 * Outlines are filled rings (outer path minus inner path, even-odd) rather than strokes, so
 * the line sits entirely inside the box and its thickness is a whole number of dots.
 */
const drawShape = (ctx, e, box) => {
	const t = Math.max(1, Math.round(mmToDots(e.strokeMm)));
	ctx.fillStyle = "#000";
	if (e.shape === "line") {
		ctx.fillRect(0, Math.round((box.h - t) / 2), box.w, t);
		return;
	}
	const r = mmToDots(e.radiusMm);
	ctx.beginPath();
	if (e.shape === "rect") {
		roundRectPath(ctx, 0, 0, box.w, box.h, r);
		if (!e.fill && box.w > 2 * t && box.h > 2 * t) {
			roundRectPath(ctx, t, t, box.w - 2 * t, box.h - 2 * t, Math.max(0, r - t));
		}
	} else {
		ellipsePath(ctx, 0, 0, box.w, box.h);
		if (!e.fill) ellipsePath(ctx, t, t, box.w - 2 * t, box.h - 2 * t);
	}
	ctx.fill("evenodd");
};

/** Placeholder for a code that can't be drawn: an X in a box, plainly not a real code. */
const drawUnavailable = (ctx, box, warning) => {
	ctx.strokeStyle = "#000";
	ctx.lineWidth = 1;
	ctx.strokeRect(0.5, 0.5, box.w - 1, box.h - 1);
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.lineTo(box.w, box.h);
	ctx.moveTo(box.w, 0);
	ctx.lineTo(0, box.h);
	ctx.stroke();
	return { warning };
};

// Human-readable line under 1D barcodes, in mm.
const BARCODE_TEXT_MM = 2.25;

const drawBarcode = (ctx, e, box) => {
	let enc;
	try {
		enc = encodeBarcode(e.symbology, e.data);
	} catch (err) {
		return drawUnavailable(ctx, box, err.message);
	}
	// The quiet zone isn't reserved inside the box: on a 40 mm label that would force 1-dot bars
	// for almost any data. The bars fill the box; the panel asks for blank space around it.
	const unit = Math.floor(box.w / enc.modules.length);
	if (unit < 1)
		return drawUnavailable(
			ctx,
			box,
			"Too much data for this width. Make the barcode wider or shorten the data.",
		);

	const textH = e.showText
		? Math.min(Math.round(mmToDots(BARCODE_TEXT_MM)), Math.floor(box.h * 0.4))
		: 0;
	const barsH = box.h - textH;
	const width = enc.modules.length * unit;
	const x0 = Math.floor((box.w - width) / 2);
	ctx.fillStyle = "#000";
	// Merge runs of bars so each is one exact rectangle.
	for (let i = 0; i < enc.modules.length;) {
		if (!enc.modules[i]) {
			i++;
			continue;
		}
		let j = i;
		while (j < enc.modules.length && enc.modules[j]) j++;
		ctx.fillRect(x0 + i * unit, 0, (j - i) * unit, barsH);
		i = j;
	}
	if (textH) {
		ctx.font = `600 ${textH}px ${cssFamily(e.textFont)}`;
		ctx.textAlign = "center";
		ctx.textBaseline = "bottom";
		ctx.fillText(enc.text, box.w / 2, box.h, box.w);
	}
	if (unit === 1)
		return {
			warning:
				"Bars are one printer dot wide, which may not scan reliably. Make the barcode wider.",
		};
	return null;
};

const drawQr = (ctx, e, box) => {
	let qr;
	try {
		qr = encodeQr(e.data, e.level);
	} catch (err) {
		return drawUnavailable(ctx, box, err.message);
	}
	const side = Math.min(box.w, box.h);
	const unit = Math.floor(side / (qr.size + QR_QUIET * 2));
	if (unit < 1)
		return drawUnavailable(
			ctx,
			box,
			"Too much data for this size. Make the QR code bigger or the text shorter.",
		);
	const px = qr.size * unit;
	const x0 = Math.floor((box.w - px) / 2);
	const y0 = Math.floor((box.h - px) / 2);
	ctx.fillStyle = "#000";
	for (let y = 0; y < qr.size; y++)
		for (let x = 0; x < qr.size; x++)
			if (qr.dark(x, y)) ctx.fillRect(x0 + x * unit, y0 + y * unit, unit, unit);
	if (unit === 1)
		return {
			warning:
				"Each QR square is one printer dot, too small for most phones. Make it bigger or use less text.",
		};
	return null;
};

// Decoded images, keyed by data URL, so dragging an image doesn't re-decode it every frame.
const imageCache = new Map();
const IMAGE_CACHE_SIZE = 24;
const loadImage = (src) => {
	let p = imageCache.get(src);
	if (!p) {
		p = new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error("This image couldn't be read."));
			img.src = src;
		});
		imageCache.set(src, p);
		if (imageCache.size > IMAGE_CACHE_SIZE) imageCache.delete(imageCache.keys().next().value);
	}
	return p;
};

const drawImageElement = async (ctx, e, box) => {
	let img;
	try {
		img = await loadImage(e.src);
	} catch (err) {
		imageCache.delete(e.src);
		// Not cached: the next render tries loading the image again.
		return { ...drawUnavailable(ctx, box, err.message), retry: true };
	}
	const { naturalWidth: iw, naturalHeight: ih } = img;
	const sx = box.w / iw;
	const sy = box.h / ih;
	// contain keeps the whole picture, cover fills the box and crops; both keep proportions.
	const scale = e.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
	const w = e.fit === "stretch" ? box.w : iw * scale;
	const h = e.fit === "stretch" ? box.h : ih * scale;
	// The anchor places a letterboxed picture, or picks which part of a cropped one shows.
	const at = { left: 0, top: 0, center: 0.5, middle: 0.5, right: 1, bottom: 1 };
	const x = (box.w - w) * at[e.align ?? "center"];
	const y = (box.h - h) * at[e.vAlign ?? "middle"];
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, box.w, box.h);
	ctx.clip();
	ctx.drawImage(img, x, y, w, h);
	ctx.restore();
	return { process: (data) => toOneBit(data, { mode: e.mode, level: e.level, invert: e.invert }) };
};

const DRAW = {
	image: drawImageElement,
	text: drawText,
	shape: drawShape,
	barcode: drawBarcode,
	qr: drawQr,
};
