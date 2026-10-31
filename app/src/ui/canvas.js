// The label's preview: the document drawn at the printer's resolution, with its fields filled
// in for the batch row and counter in view, redrawn a frame after anything changes. What a
// draw found out (fitted font sizes, problems, a QR code's auto level) is kept for the panels.
import { renderLabel } from "../render.js";
import { fillDocument } from "../fields.js";
import { ensureFontsFor } from "../text/fonts.js";
import { $ } from "./dom.js";
import { currentScale, onModelChange } from "./settings.js";
import { describeLabel } from "./describe.js";
import { sizeStage } from "./viewport.js";
import { inlineEdit, relayoutInline } from "./inline-editor.js";
import { state } from "./store.js";
import { signal } from "./signal.js";

const canvas = $("#labelCanvas");

let renderToken = 0;
let fitted = new Map();
let warnings = new Map();
let notes = new Map();
const drawn = signal();

/** Font sizes (pt) chosen by fit-to-box in the last render, keyed by element id. */
export const fittedSizes = () => fitted;
/** Per-element problems from the last render (e.g. a barcode too narrow to scan). */
export const renderWarnings = () => warnings;
/** What painters chose by themselves in the last render (a QR code's auto level). */
export const renderNotes = () => notes;
export const onDrawn = drawn.on;

/** @type {() => import("../fields.js").FieldContext} */
let fieldContext = () => ({ now: new Date(), n: 1, row: null, columns: null });
/**
 * Sets what fields show on the preview (the batch row being previewed, the next counter
 * value). The print code fills each label itself.
 */
export const setFieldContext = (fn) => {
	fieldContext = fn;
	scheduleCanvas();
};

/** The document as the preview shows it: fields filled in for the row and number in view. */
export const previewDocument = () =>
	// The text being typed on the label stays as typed, so the caret lines up with it.
	fillDocument(state.doc, fieldContext(), { except: inlineEdit()?.id });

// The newest render. One that a newer render overtakes resolves with it instead, so waiting on
// any render waits until the canvas shows the document as it is now.
let latestRender = Promise.resolve();

/** Resolves once the canvas shows the current document with its real fonts. */
export const drawCanvas = () => (latestRender = render());

const render = async () => {
	const token = ++renderToken;
	const doc = previewDocument();
	await ensureFontsFor(doc);
	if (token !== renderToken) return latestRender;
	// Off-screen first: a render that waits on an image can overlap a newer one, and two
	// renders sharing the visible canvas would leave pieces of the older label on it.
	const scratch = document.createElement("canvas");
	const result = await renderLabel(doc, scratch, { dots: currentScale() });
	if (token !== renderToken) return latestRender;
	({ fittedSizes: fitted, warnings, notes } = result);
	if (canvas.width !== scratch.width) canvas.width = scratch.width;
	if (canvas.height !== scratch.height) canvas.height = scratch.height;
	canvas.getContext("2d", { willReadFrequently: true }).drawImage(scratch, 0, 0);
	canvas.setAttribute("aria-label", describeLabel(doc));
	sizeStage();
	// The editor was laid out when the text changed, perhaps before a newly picked font had
	// loaded or before the label's new length set its scale; now both are settled.
	relayoutInline();
	drawn.emit();
};

let queued = false;
// Another model may print at another resolution, which the preview shows.
onModelChange(() => scheduleCanvas());
export const scheduleCanvas = () => {
	if (queued) return;
	queued = true;
	requestAnimationFrame(() => {
		queued = false;
		drawCanvas();
	});
};
