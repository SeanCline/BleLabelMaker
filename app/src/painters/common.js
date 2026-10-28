// What the painters share.

/** A canvas of at least one dot each way: a zero-sized one can't be drawn on or read. */
export const makeCanvas = (w, h) => {
	const c = document.createElement("canvas");
	c.width = Math.max(1, w);
	c.height = Math.max(1, h);
	return c;
};

/** Placeholder for a code that can't be drawn: an X in a box, plainly not a real code. */
export const drawUnavailable = (ctx, box, warning) => {
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
