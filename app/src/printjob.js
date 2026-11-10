// From a design to what a printer is sent: which labels a print makes (batch rows, copies,
// counter values) and each one's picture for the head. Rendering is passed in, so this runs in tests too.
import { fillDocument, fieldsUsed } from "./fields.js";
import { centreOnHead, flipped, toPrinterRaster } from "./raster.js";

/**
 * One label of a print. `row` is its batch row (or null), and `nextCounter` the value {n}
 * continues from once it has printed.
 * @typedef {{doc: import("./model.js").Doc, copies: number, row: number | null,
 *   nextCounter: number}} PlannedLabel
 * @typedef {{labels: PlannedLabel[], total: number, nextCounter: number}} LabelPlan
 */

/**
 * Every label a print makes, with its fields filled in. Identical copies stay one label sent
 * with a copy count; a counter makes every copy different, so each is its own label.
 * @param {import("./model.js").Doc} doc
 * @param {object} opts
 * @param {number} opts.copies per batch row
 * @param {{columns: string[] | null, rows: string[][], lines?: string[]} | null} opts.batch
 * @param {number} opts.counterStart the value {n} starts at
 * @param {Date} opts.now
 * @returns {LabelPlan}
 */
export const planLabels = (doc, { copies, batch, counterStart, now }) => {
	const used = fieldsUsed(doc);
	let n = counterStart;
	const labels = [];
	for (const [index, row] of (batch ? batch.rows : [null]).entries()) {
		const line = batch?.lines?.[index];
		const ctx = (number) => ({ now, n: number, row, line, columns: batch?.columns ?? null });
		const at = batch ? index : null;
		if (used.counter) {
			for (let i = 0; i < copies; i++) {
				const filled = fillDocument(doc, ctx(n++));
				labels.push({ doc: filled, copies: 1, row: at, nextCounter: n });
			}
		} else labels.push({ doc: fillDocument(doc, ctx(n)), copies, row: at, nextCounter: n });
	}
	return { labels, total: labels.reduce((s, l) => s + l.copies, 0), nextCounter: n };
};

/**
 * Every label in a plan as the printer's head sees it, centred and turned.
 * @param {LabelPlan} plan
 * @param {object} opts
 * @param {(doc: import("./model.js").Doc) => Promise<ImageData | {width: number, height: number,
 *   data: Uint8ClampedArray}>} opts.render a label's pixels, as the preview draws them
 * @param {import("./printers/index.js").PrinterModel} opts.printer
 * @param {boolean} opts.flip180 upside down from the model's own orientation
 * @returns {Promise<{labels: import("./printers/index.js").RasterLabel[], firstImage: any}>}
 *   firstImage is for the history thumbnail
 */
export const rasterize = async (plan, { render, printer, flip180 }) => {
	const labels = [];
	let firstImage;
	const turn = flipped(printer.labelTurn, flip180);
	for (const label of plan.labels) {
		const pixels = await render(label.doc);
		firstImage ??= pixels;
		const raster = toPrinterRaster(centreOnHead(pixels, printer.headDots, turn), { turn });
		labels.push({ raster, copies: label.copies });
	}
	return { labels, firstImage };
};

/**
 * What got out when a print broke off after its first `done` labels: how many labels that is
 * with their copies, where the counter continues from, and the batch row to carry on at.
 * @param {LabelPlan} plan
 * @param {number} done
 * @param {number} counterStart
 */
export const sentPart = (plan, done, counterStart) => {
	const labels = plan.labels.slice(0, done);
	return {
		labels: labels.reduce((s, l) => s + l.copies, 0),
		nextCounter: labels.at(-1)?.nextCounter ?? counterStart,
		firstUnsentRow: plan.labels[done]?.row ?? null,
	};
};
