// Rectangles, ellipses and lines.

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
export const drawShape = (ctx, e, box, dots) => {
	const t = Math.max(1, Math.round(dots.mm(e.strokeMm)));
	ctx.fillStyle = "#000";
	if (e.shape === "line") {
		ctx.fillRect(0, Math.round((box.h - t) / 2), box.w, t);
		return;
	}
	const r = dots.mm(e.radiusMm);
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
