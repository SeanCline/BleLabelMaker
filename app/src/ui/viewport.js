// How big the label is on screen: fitted to the stage, zoomed, and panned by scrolling.
import { labelDots } from "../render.js";
import { currentScale } from "./settings.js";
import { $ } from "./dom.js";
import { state } from "./store.js";

/** A share of a length, as a CSS percentage. */
export const pct = (v, total) => `${(v / total) * 100}%`;
/** Where a box in the label's millimetres sits over the label on screen, as CSS. */
export const placeStyle = ({ x, y, w, h }, { widthMm, heightMm }) => ({
	left: pct(x, widthMm),
	top: pct(y, heightMm),
	width: pct(w, widthMm),
	height: pct(h, heightMm),
});

const canvas = $("#labelCanvas");
const paper = $("#paper");

// Zoom is a multiple of the size that fits the stage, so "fit" survives window resizes.
// Steps of a quarter, from fit to eight times it.
const ZOOMS = Array.from({ length: 29 }, (_, i) => 1 + i / 4);
let zoom = 1;
const stage = $("#stage");

/** Sizes the label on screen for the stage width and the zoom. */
export const sizeStage = () => {
	const { width, height } = labelDots(state.doc.label, currentScale());
	// The border box, not clientWidth: scrollbars appearing at high zoom mustn't change the fit.
	// With rulers, the left one and its gap take room beside the label too.
	const ruler = paper.parentElement.classList.contains("with-ruler") ? 24 : 0;
	// The stage's padding leaves room for the rail, which moves on narrow screens (styles.css).
	const style = getComputedStyle(stage);
	const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
	const avail = stage.getBoundingClientRect().width - 2 - padding - 16 - ruler;
	const fit = avail / width;
	const want = fit * zoom;
	// Half-step zoom keeps each printer dot a crisp block on screen; below 1:1 (phones) any
	// scale is fine, since dots are smaller than a pixel anyway.
	const dot =
		want >= 1
			? Math.min(zoom > 1 ? 32 : 8, Math.max(1, Math.floor(want * 2) / 2))
			: Math.max(0.25, Math.floor(want * 20) / 20);
	canvas.style.width = `${width * dot}px`;
	canvas.style.height = `${height * dot}px`;
	paper.style.setProperty("--dot", `${dot}px`);
	$("#zoomFit").textContent = zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`;
	$("#zoomOut").disabled = zoom === ZOOMS[0];
	$("#zoomIn").disabled = zoom === ZOOMS.at(-1);
};
new ResizeObserver(() => sizeStage()).observe(stage, { box: "border-box" });

/**
 * Sets the zoom, keeping the label point under `anchor` (client coordinates; default: the
 * middle of the stage) where it was, the way map apps zoom.
 */
export const setZoom = (z, anchor) => {
	const next = Math.min(ZOOMS.at(-1), Math.max(ZOOMS[0], z));
	if (next === zoom) return;
	const s = stage.getBoundingClientRect();
	const at = anchor ?? { x: s.left + s.width / 2, y: s.top + s.height / 2 };
	const before = paper.getBoundingClientRect();
	const fx = (at.x - before.left) / before.width;
	const fy = (at.y - before.top) / before.height;
	zoom = next;
	sizeStage();
	const after = paper.getBoundingClientRect();
	stage.scrollLeft += after.left + fx * after.width - at.x;
	stage.scrollTop += after.top + fy * after.height - at.y;
};
export const zoomStep = (dir, anchor) => {
	const i = ZOOMS.findIndex((z) => z >= zoom);
	setZoom(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + dir))], anchor);
};

$("#zoomIn").addEventListener("click", () => zoomStep(1));
$("#zoomOut").addEventListener("click", () => zoomStep(-1));
$("#zoomFit").addEventListener("click", () => setZoom(1));
stage.addEventListener(
	"wheel",
	(ev) => {
		// Ctrl+wheel (and trackpad pinch, which arrives as one) zooms the label, not the page.
		if (!ev.ctrlKey) return;
		ev.preventDefault();
		zoomStep(ev.deltaY < 0 ? 1 : -1, { x: ev.clientX, y: ev.clientY });
	},
	{ passive: false },
);
// Middle-button drag pans when zoomed in, as in most drawing apps.
stage.addEventListener("pointerdown", (ev) => {
	if (ev.button !== 1) return;
	ev.preventDefault();
	const start = { x: ev.clientX, y: ev.clientY, left: stage.scrollLeft, top: stage.scrollTop };
	const move = (m) => {
		stage.scrollLeft = start.left - (m.clientX - start.x);
		stage.scrollTop = start.top - (m.clientY - start.y);
	};
	const up = () => {
		removeEventListener("pointermove", move);
		removeEventListener("pointerup", up);
	};
	addEventListener("pointermove", move);
	addEventListener("pointerup", up);
});
