// Small previews of labels in a list (templates, print history). They're drawn one at a time
// after the list is on screen, so a long list opens at once and each picture pops in as it's
// drawn.
import { renderLabel } from "../render.js";
import { ensureFontsFor } from "../fonts.js";
import { currentScale } from "./settings.js";

/**
 * A drawer for one list's thumbnails. Drawing the list again stops the drawing still under
 * way, which would otherwise fill canvases no longer on screen.
 */
export const thumbnails = () => {
	let token = 0;
	/** @param {[HTMLCanvasElement, () => import("../model.js").Doc][]} jobs */
	return async (jobs) => {
		const mine = ++token;
		for (const [canvas, docOf] of jobs) {
			const doc = docOf();
			await ensureFontsFor(doc);
			if (mine !== token) return;
			await renderLabel(doc, canvas, { dots: currentScale() });
		}
	};
};
