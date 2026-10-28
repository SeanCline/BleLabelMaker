// A print from start to finish, without any UI: plan the labels, connect, check the printer,
// render and encode each label, send, and say what came of it. The page decides what to ask
// and what to tell; anything else that prints (a script, a test) can use this as it is.
import { planLabels, buildJobs, sentPart } from "./printjob.js";
import { renderLabel, withAutoLength } from "./render.js";
import { ensureFontsFor } from "./fonts.js";
import { SendError, VirtualPrinter } from "./transport.js";
import { dotScale } from "./units.js";

/**
 * What's worth knowing about the printer: problems ("cover open · out of labels") and its
 * battery. Loaded labels are the normal case, so they go unmentioned.
 * @param {{coverOpen?: boolean | null, paper?: boolean | null, battery?: number | null,
 *   charging?: boolean | null}} st
 */
export const describeStatus = (st, { battery = true } = {}) => {
	const parts = [];
	if (st.coverOpen) parts.push("cover open");
	if (st.paper === false) parts.push("out of labels");
	if (battery && typeof st.battery === "number")
		parts.push(`battery ${st.battery}%${st.charging ? " (charging)" : ""}`);
	return parts.join(" · ");
};

/** Whether the printer has said something that would stop it printing. */
export const hasProblem = (st) => st.coverOpen === true || st.paper === false;

/**
 * One label's pixels at the printer's resolution, the same way the preview draws them. With
 * auto length, each label is as long as its own text, so batch rows can differ.
 * @param {import("./model.js").Doc} doc with its fields filled in
 * @param {import("./units.js").DotScale} dots
 */
export const renderForPrint = async (doc, dots) => {
	await ensureFontsFor(doc);
	const canvas = document.createElement("canvas");
	await renderLabel(withAutoLength(doc, dots), canvas, { dots });
	return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
};

/**
 * @typedef {object} PrintOutcome
 * @property {"printed" | "partial" | "declined"} result declined: a question was answered no
 * @property {number} labels how many labels went out
 * @property {number} total how many were asked for
 * @property {number} nextCounter where {n} continues
 * @property {number | null} [firstUnsentRow] a partial batch's first row that didn't go out
 * @property {Error} [error] why a partial print stopped
 * @property {any} [image] the first label's pixels, for the history
 * @property {any} [decoded] what the virtual printer made of the job
 */

/**
 * Prints a document: each batch row, each copy, with its fields filled in.
 * @param {import("./model.js").Doc} doc
 * @param {object} o
 * @param {import("./transport.js").BluetoothPrinter | import("./transport.js").SerialPrinter
 *   | import("./transport.js").VirtualPrinter} o.connection
 * @param {import("./printers/index.js").PrinterModel} o.printer
 * @param {number} o.copies per batch row
 * @param {{columns: string[] | null, rows: string[][], lines?: string[]} | null} o.batch
 * @param {number} o.counterStart the value {n} starts at
 * @param {{density: "light"|"normal"|"dark", flip180: boolean, feedLines: number,
 *   showAllDevices: boolean}} o.settings
 * @param {(question: string) => boolean} [o.confirm] asked before a long batch, or a print
 *   to a printer reporting a problem; no answer is yes
 * @param {(done: number, total: number) => void} [o.onProgress]
 * @param {() => void} [o.onStart] once it's under way: connected, nothing declined
 * @param {(doc: import("./model.js").Doc, dots: import("./units.js").DotScale) =>
 *   Promise<{width: number, height: number, data: Uint8ClampedArray}>} [o.render] a label's
 *   pixels; renderForPrint, unless something else draws them (tests, without a browser)
 * @returns {Promise<PrintOutcome>} throws when nothing could be printed
 */
export const printDocument = async (doc, o) => {
	const { connection: t, printer, settings, confirm = () => true, render = renderForPrint } = o;
	const plan = planLabels(doc, {
		copies: o.copies,
		batch: o.batch,
		counterStart: o.counterStart,
		now: new Date(),
	});
	const outcome = { labels: 0, total: plan.total, nextCounter: o.counterStart };
	// A long batch uses a lot of labels; make sure it's meant.
	if (plan.total > 20 && !confirm(`Print ${plan.total} labels?`))
		return { ...outcome, result: "declined" };
	// Ask for the device first: the picker needs the click's user activation, which awaiting
	// fonts and rendering could use up.
	if (!t.connected) await t.connect({ showAllDevices: settings.showAllDevices });
	// The status mapping is reverse-engineered, so a reported problem asks rather than blocks.
	if (
		hasProblem(t.status) &&
		!confirm(`The printer reports: ${describeStatus(t.status)}. Print anyway?`)
	)
		return { ...outcome, result: "declined" };
	o.onStart?.();
	const dots = dotScale(printer.dotsPerMm);
	const {
		bytes,
		firstImage: image,
		ends,
	} = await buildJobs(plan, {
		render: (d) => render(d, dots),
		printer,
		paper: doc.label.continuous ? "continuous" : "gaps",
		density: printer.driver.densities[settings.density],
		flip180: settings.flip180,
		feedLines: settings.feedLines,
	});
	/** @type {PrintOutcome} */
	const printed = { ...outcome, result: "printed", labels: plan.total, image };
	if (t instanceof VirtualPrinter) {
		const decoded = await t.send(bytes, o.onProgress);
		// A virtual printer told to be out of paper prints nothing, like the real one.
		if (!decoded.labels.length) throw new Error(`the printer reports ${describeStatus(t.status)}`);
		return { ...printed, nextCounter: plan.nextCounter, decoded };
	}
	try {
		await t.send(bytes, o.onProgress);
	} catch (err) {
		if (!(err instanceof SendError)) throw err;
		// The labels that did go out are printed: their serials are used and they're history.
		const part = sentPart(plan, ends, err.sent, o.counterStart);
		return { ...printed, ...part, result: "partial", error: err };
	}
	t.refreshStatus();
	return { ...printed, nextCounter: plan.nextCounter };
};
