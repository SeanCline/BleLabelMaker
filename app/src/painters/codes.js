// Barcodes and QR codes, in whole dots so every bar and square scans.
import { cssFamily } from "../text/fonts.js";
import { encodeBarcode, SYMBOLOGIES } from "../codes/barcode.js";
import { encodeDataMatrix } from "../codes/datamatrix.js";
import { fitQr, QR_LEVEL_NAMES } from "../codes/qr.js";
import { drawUnavailable } from "./common.js";

// The human-readable line under a barcode, in mm.
const BARCODE_TEXT_MM = 2.25;

/** The barcode's text under it, in the space it left: `textH` dots tall. */
const drawCaption = (ctx, e, text, box, textH) => {
	ctx.font = `600 ${textH}px ${cssFamily(e.textFont)}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "bottom";
	ctx.fillText(text, box.w / 2, box.h, box.w);
};

const captionHeight = (e, box, dots) =>
	e.showText ? Math.min(Math.round(dots.mm(BARCODE_TEXT_MM)), Math.floor(box.h * 0.4)) : 0;

export const drawBarcode = (ctx, e, box, dots) => {
	if (SYMBOLOGIES[e.symbology]?.matrix) return drawDataMatrix(ctx, e, box, dots);
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

	const textH = captionHeight(e, box, dots);
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
	if (textH) drawCaption(ctx, e, enc.text, box, textH);
	if (unit === 1)
		return {
			warning:
				"Bars are one printer dot wide, which may not scan reliably. Make the barcode wider.",
		};
	return null;
};

/**
 * A 2D code's squares, `unit` dots each, centred in a `room` (w × h) at the top left of the
 * box, with what's worth saying about them.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{rows: number, cols: number, dark: (x: number, y: number) => boolean}} code
 * @param {number} unit
 * @param {{w: number, h: number}} room
 * @param {string} [note] what the painter chose, for the settings to show
 */
const drawSquares = (ctx, code, unit, room, note) => {
	const x0 = Math.floor((room.w - code.cols * unit) / 2);
	const y0 = Math.floor((room.h - code.rows * unit) / 2);
	ctx.fillStyle = "#000";
	for (let y = 0; y < code.rows; y++)
		for (let x = 0; x < code.cols; x++)
			if (code.dark(x, y)) ctx.fillRect(x0 + x * unit, y0 + y * unit, unit, unit);
	if (unit === 1)
		return {
			note,
			warning:
				"Each square is one printer dot, too small for most phones and scanners. Make the code bigger or use less data.",
		};
	return { note };
};

const TOO_SMALL = "Too much data for this size. Make the code bigger or the data shorter.";

// Data Matrix keeps a one-square blank border inside its box, as a QR code keeps its own.
const MATRIX_QUIET = 1;

/** A Data Matrix, in the size and shape (square or rectangle) that fits its box best. */
const drawDataMatrix = (ctx, e, box, dots) => {
	const textH = captionHeight(e, box, dots);
	let m;
	try {
		m = encodeDataMatrix(e.data, { width: box.w, height: box.h - textH }, MATRIX_QUIET);
	} catch (err) {
		return drawUnavailable(ctx, box, err.message);
	}
	if (m.unit < 1) return drawUnavailable(ctx, box, TOO_SMALL);
	if (textH) drawCaption(ctx, e, e.data, box, textH);
	return drawSquares(ctx, m, m.unit, { w: box.w, h: box.h - textH });
};

// Squares this big (in mm) scan easily; auto error correction stops growing them here.
const QR_ENOUGH_MM = 0.5;

export const drawQr = (ctx, e, box, dots) => {
	let fit;
	try {
		fit = fitQr(e.data, e.level, Math.min(box.w, box.h), Math.round(dots.mm(QR_ENOUGH_MM)));
	} catch (err) {
		return drawUnavailable(ctx, box, err.message);
	}
	if (fit.unit < 1) return drawUnavailable(ctx, box, TOO_SMALL);
	const { size, dark } = fit.qr;
	// What auto chose, for the settings to show.
	const note = e.level === "auto" ? QR_LEVEL_NAMES[fit.level] : undefined;
	return drawSquares(ctx, { rows: size, cols: size, dark }, fit.unit, box, note);
};
