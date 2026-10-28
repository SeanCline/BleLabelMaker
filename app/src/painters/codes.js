// Barcodes and QR codes, in whole dots so every bar and square scans.
import { cssFamily } from "../fonts.js";
import { encodeBarcode } from "../barcode.js";
import { encodeQr, QR_QUIET } from "../qr.js";
import { drawUnavailable } from "./common.js";

// Human-readable line under 1D barcodes, in mm.
const BARCODE_TEXT_MM = 2.25;

export const drawBarcode = (ctx, e, box, dots) => {
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
		? Math.min(Math.round(dots.mm(BARCODE_TEXT_MM)), Math.floor(box.h * 0.4))
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

export const drawQr = (ctx, e, box) => {
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
