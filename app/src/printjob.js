// From a design to the bytes a printer gets: which labels a print makes (batch rows, copies,
// counter values) and the job for each. Rendering is passed in, so this runs in tests too.
import { fillDocument, fieldsUsed } from "./fields.js";
import { centreOnHead, flipped, toPrinterRaster } from "./raster.js";
import { concat } from "./bytes.js";

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
		const ctx = (n) => ({ now, n, row, line, columns: batch?.columns ?? null });
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
 * The bytes for every label in a plan, as one stream: a batch goes out in one send instead of
 * reconnecting per label.
 * @param {LabelPlan} plan
 * @param {object} opts
 * @param {(doc: import("./model.js").Doc) => Promise<ImageData | {width: number, height: number,
 *   data: Uint8ClampedArray}>} opts.render a label's pixels, as the preview draws them
 * @param {import("./printers/index.js").PrinterModel} opts.printer
 * @param {"gaps"|"continuous"} opts.paper
 * @param {number|null} opts.density
 * @param {boolean} opts.flip180 upside down from the model's own orientation
 * @param {number} [opts.feedLines] overrides the model's continuous feed
 * @returns {Promise<{bytes: Uint8Array, firstImage: any, ends: number[]}>} firstImage is for the
 *   history thumbnail; ends[i] is where label i's bytes end, to tell which labels a broken-off
 *   send got out
 */
export const buildJobs = async (plan, { render, printer, paper, density, flip180, feedLines }) => {
	const jobs = [];
	const ends = [];
	let end = 0;
	let firstImage;
	for (const label of plan.labels) {
		const pixels = await render(label.doc);
		firstImage ??= pixels;
		const turn = flipped(printer.labelTurn, flip180);
		const raster = toPrinterRaster(centreOnHead(pixels, printer.headDots, turn), { turn });
		const options = { copies: label.copies, paper, density, printer, feedLines };
		const job = printer.driver.buildJob(raster, options);
		jobs.push(job);
		ends.push((end += job.length));
	}
	return { bytes: concat(...jobs), firstImage, ends };
};

/**
 * What got out when a send broke off after `sentBytes`: the labels whose bytes all arrived,
 * how many labels that is, and where the counter continues from.
 * @param {LabelPlan} plan
 * @param {number[]} ends from buildJobs
 * @param {number} sentBytes
 * @param {number} counterStart
 */
export const sentPart = (plan, ends, sentBytes, counterStart) => {
	const done = ends.filter((end) => end <= sentBytes).length;
	const labels = plan.labels.slice(0, done);
	return {
		labels: labels.reduce((s, l) => s + l.copies, 0),
		nextCounter: labels.at(-1)?.nextCounter ?? counterStart,
		firstUnsentRow: plan.labels[done]?.row ?? null,
	};
};
