// Rulers along the top and left of the label, in millimetres, for sizing things precisely.
// They show where the selection starts and ends and where the pointer is. They sit in the
// stage's scroll area beside the label, sticking to the edges when a zoomed label scrolls.
import { boundsOf } from "../model.js";
import { round } from "../units.js";
import { $, loadJson, storeJson } from "./dom.js";
import { storageKey } from "../app-info.js";
import { sizeStage } from "./viewport.js";
import { state, subscribe, selectedElements } from "./store.js";

const KEY = storageKey("ruler");
// The ruler's thickness in CSS pixels; styles.css sizes the grid track to match.
const SIZE = 20;

const paper = $("#paper");
const label = $("#labelCanvas");
const top = /** @type {HTMLCanvasElement} */ ($("#rulerTop"));
const left = /** @type {HTMLCanvasElement} */ ($("#rulerLeft"));
const button = $("#btnRuler");

let shown = loadJson(KEY) === true;
/** @type {{x: number, y: number} | null} the pointer over the label, in mm */
let pointer = null;

/** The tick spacing that keeps ticks and numbers readable at this zoom. */
const steps = (pxPerMm) => {
	const minor = [1, 2, 5, 10].find((mm) => mm * pxPerMm >= 4) ?? 10;
	const labelled = [5, 10, 20, 50].find((mm) => mm * pxPerMm >= 28) ?? 50;
	return { minor, labelled };
};

/**
 * Draws one ruler.
 * @param {HTMLCanvasElement} canvas
 * @param {"x"|"y"} axis
 * @param {number} lengthMm
 * @param {number} pxPerMm
 * @param {{from: number, to: number} | null} span the selection's extent, in mm
 * @param {number | null} at the pointer, in mm
 */
const draw = (canvas, axis, lengthMm, pxPerMm, span, at) => {
	const along = lengthMm * pxPerMm;
	const ratio = devicePixelRatio || 1;
	const [w, h] = axis === "x" ? [along, SIZE] : [SIZE, along];
	canvas.style.width = `${w}px`;
	canvas.style.height = `${h}px`;
	canvas.width = Math.round(w * ratio);
	canvas.height = Math.round(h * ratio);
	const ctx = canvas.getContext("2d");
	ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
	// Drawn as if horizontal; the left ruler is the same picture turned a quarter turn.
	if (axis === "y") ctx.transform(0, 1, -1, 0, SIZE, 0);

	const css = getComputedStyle(document.documentElement);
	const color = (name) => css.getPropertyValue(name).trim();
	ctx.fillStyle = color("--surface");
	ctx.fillRect(0, 0, along, SIZE);
	if (span) {
		ctx.fillStyle = color("--select");
		ctx.globalAlpha = 0.18;
		ctx.fillRect(span.from * pxPerMm, 0, (span.to - span.from) * pxPerMm, SIZE);
		ctx.globalAlpha = 1;
	}
	const { minor, labelled } = steps(pxPerMm);
	ctx.strokeStyle = color("--muted");
	ctx.fillStyle = color("--muted");
	ctx.lineWidth = 1;
	ctx.font = "10px system-ui, sans-serif";
	ctx.textBaseline = "top";
	ctx.beginPath();
	for (let mm = 0; mm <= lengthMm + 1e-6; mm += minor) {
		const x = Math.round(mm * pxPerMm) + 0.5;
		const major = mm % labelled === 0;
		const tall = major ? SIZE : mm % 5 === 0 ? SIZE * 0.45 : SIZE * 0.25;
		ctx.moveTo(x, SIZE);
		ctx.lineTo(x, SIZE - tall);
		if (major && mm > 0 && mm < lengthMm) ctx.fillText(String(mm), x + 2, 2);
	}
	ctx.stroke();
	// The selection's edges, to a tenth of a millimetre.
	if (span) {
		ctx.fillStyle = color("--select");
		ctx.strokeStyle = color("--select");
		ctx.beginPath();
		for (const edge of [span.from, span.to]) {
			const x = Math.round(edge * pxPerMm) + 0.5;
			ctx.moveTo(x, 0);
			ctx.lineTo(x, SIZE);
		}
		ctx.stroke();
		ctx.font = "bold 10px system-ui, sans-serif";
		// Outside the selection, on a backing so ticks don't run through the digits.
		const edgeLabel = (mm, side) => {
			const text = String(round(mm, 1));
			const width = ctx.measureText(text).width;
			const wanted = mm * pxPerMm + (side < 0 ? -width - 3 : 3);
			const x = Math.max(0, Math.min(along - width, wanted));
			ctx.fillStyle = color("--surface");
			ctx.fillRect(x - 1, SIZE - 12, width + 2, 12);
			ctx.fillStyle = color("--select");
			ctx.fillText(text, x, SIZE - 11);
		};
		edgeLabel(span.from, -1);
		edgeLabel(span.to, 1);
	}
	if (at !== null) {
		ctx.strokeStyle = color("--accent");
		ctx.beginPath();
		const x = Math.round(at * pxPerMm) + 0.5;
		ctx.moveTo(x, 0);
		ctx.lineTo(x, SIZE);
		ctx.stroke();
	}
};

/** Redraws both rulers for the current zoom, selection and pointer. */
const renderRulers = () => {
	paper.parentElement.classList.toggle("with-ruler", shown);
	button.setAttribute("aria-pressed", String(shown));
	top.hidden = left.hidden = !shown;
	if (!shown) return;
	const { widthMm, heightMm } = state.doc.label;
	const pxPerMm = label.getBoundingClientRect().width / widthMm;
	if (!pxPerMm) return;
	const selected = selectedElements();
	const box = selected.length ? boundsOf(selected) : null;
	const spanOf = (axis) =>
		box && (axis === "x" ? { from: box.x, to: box.x + box.w } : { from: box.y, to: box.y + box.h });
	draw(top, "x", widthMm, pxPerMm, spanOf("x"), pointer?.x ?? null);
	draw(left, "y", heightMm, pxPerMm, spanOf("y"), pointer?.y ?? null);
};

let queued = false;
const scheduleRulers = () => {
	if (queued || !shown) return;
	queued = true;
	requestAnimationFrame(() => {
		queued = false;
		renderRulers();
	});
};

button.addEventListener("click", () => {
	shown = !shown;
	storeJson(KEY, shown);
	renderRulers();
	sizeStage();
});
subscribe(scheduleRulers);
// Zooming, a resized window or a new label size all change the label's size on screen.
new ResizeObserver(scheduleRulers).observe(label);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", scheduleRulers);
$("#overlay").addEventListener("pointermove", (ev) => {
	const r = label.getBoundingClientRect();
	const { widthMm, heightMm } = state.doc.label;
	pointer = {
		x: ((ev.clientX - r.left) / r.width) * widthMm,
		y: ((ev.clientY - r.top) / r.height) * heightMm,
	};
	scheduleRulers();
});
$("#overlay").addEventListener("pointerleave", () => {
	pointer = null;
	scheduleRulers();
});
renderRulers();
