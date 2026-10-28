// The virtual printer's output: the labels it decoded, shown as they'd come out of the head.
import { rasterToReadingBits } from "../raster.js";
import { $, el } from "./dom.js";

/** Draws 1-bit reading-orientation bits onto a fresh canvas. */
const bitsToCanvas = ({ width, height, bits }) => {
	const c = el("canvas", { width, height });
	const ctx = c.getContext("2d");
	const img = ctx.createImageData(width, height);
	for (let i = 0; i < bits.length; i++) {
		const v = bits[i] ? 0 : 255;
		img.data.set([v, v, v, 255], i * 4);
	}
	ctx.putImageData(img, 0, 0);
	return c;
};

const sameRaster = (a, b) =>
	a.rows === b.rows && a.bytesPerRow === b.bytesPerRow && a.data.every((v, i) => v === b.data[i]);

/**
 * Adds a print to the strip: a picture per different label (a batch or a counter, not one per
 * copy) and what the decoder saw.
 * @param {{labels: any[], events: any[], bytes: number, packets: number}} result
 * @param {number} copies how many labels were asked for
 * @param {{flip180: boolean}} settings
 * @param {import("../printers/index.js").PrinterModel} printer
 */
export const showVirtualOutput = (result, copies, { flip180 }, printer) => {
	const tape = $("#tape");
	const label = result.labels[0];
	const distinct = [];
	for (const l of result.labels) {
		if (distinct.length < 8 && !distinct.some((d) => sameRaster(d, l))) distinct.push(l);
	}
	// Decode without un-flipping: this is how the bytes come out of the head if the reference
	// repo's orientation is right, so a wrong flip setting shows up here as upside-down.
	const pictures = distinct.map((l) => {
		const c = bitsToCanvas(rasterToReadingBits(l, { turn: printer.labelTurn }));
		c.style.width = `${c.width * 2}px`;
		return c;
	});
	const feeds = result.events.filter((e) => e.type === "feed").map((e) => e.lines);
	const gapped = result.events.some((e) => e.type === "paperType" && e.value === "gaps");
	const paper = gapped
		? "gap labels: stops at the gap"
		: `continuous: ${feeds.length ? `feed ${feeds[0]}` : "no feed"}`;
	const density = result.events.find((e) => e.type === "density");
	const { densities } = printer.driver;
	const densityName = density
		? (Object.keys(densities).find((k) => densities[k] === density.value) ?? density.value)
		: "not set";
	const meta = el(
		"div",
		{ className: "hint" },
		`${result.labels.length} of ${copies} cop${copies === 1 ? "y" : "ies"} decoded · ${label.bytesPerRow * 8}×${label.rows} dots · ` +
			`${result.bytes.toLocaleString()} bytes in ${result.packets} packets · density ${densityName} · ${paper} · ${new Date().toLocaleTimeString()}`,
	);
	tape.prepend(el("div", { className: "printed" }, ...pictures, meta));
	while (tape.children.length > 6) tape.lastChild.remove();
	$("#virtualNote").textContent = flip180
		? "Flip 180° is on, so these come out upside down here. That's expected if your printer prints upside down without it."
		: "Decoded from the exact bytes the printer would receive, in the orientation they'd come out of it.";
	$("#virtualOut").hidden = false;
};
