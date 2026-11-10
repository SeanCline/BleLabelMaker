// The print for printers that take a job as bytes and don't answer until it's done: every
// label's job back to back in one send, so a batch doesn't reconnect per label. A printer that
// answers each step (Niimbot's page start, rows, page end) has a driver with its own print.
import { concat } from "../bytes.js";
import { SendError, PartialPrintError } from "../transport/errors.js";

/**
 * @param {(raster: import("../raster.js").Raster, opts: {copies: number,
 *   paper: "gaps"|"continuous", density: number | null,
 *   printer: import("./index.js").PrinterModel, feedLines?: number}) => Uint8Array} buildJob
 *   one label's bytes, printed `copies` times
 * @returns {import("./index.js").PrinterDriver["print"]}
 */
export const streamed = (buildJob) => async (link, labels, opts) => {
	const { onProgress, ...jobOptions } = opts;
	const jobs = labels.map((l) => buildJob(l.raster, { ...jobOptions, copies: l.copies }));
	try {
		await link.send(concat(...jobs), onProgress);
	} catch (err) {
		if (!(err instanceof SendError)) throw err;
		// A label is printed only if all of its bytes arrived.
		let end = 0;
		const whole = jobs.filter((job) => (end += job.length) <= err.sent).length;
		throw new PartialPrintError(err.cause, whole);
	}
};
