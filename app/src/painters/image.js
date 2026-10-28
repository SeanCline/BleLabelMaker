// Pictures: fitted into the box, then reduced to 1-bit by dithering or a threshold.
import { toOneBit } from "../raster.js";
import { drawUnavailable } from "./common.js";

// Decoded images, keyed by data URL, so dragging an image doesn't re-decode it every frame.
const imageCache = new Map();
const IMAGE_CACHE_SIZE = 24;
const loadImage = (src) => {
	let p = imageCache.get(src);
	if (!p) {
		p = new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve(img);
			img.onerror = () => reject(new Error("This image couldn't be read."));
			img.src = src;
		});
		imageCache.set(src, p);
		if (imageCache.size > IMAGE_CACHE_SIZE) imageCache.delete(imageCache.keys().next().value);
	}
	return p;
};

export const drawImageElement = async (ctx, e, box) => {
	let img;
	try {
		img = await loadImage(e.src);
	} catch (err) {
		imageCache.delete(e.src);
		// Not cached: the next render tries loading the image again.
		return { ...drawUnavailable(ctx, box, err.message), retry: true };
	}
	const { naturalWidth: iw, naturalHeight: ih } = img;
	const sx = box.w / iw;
	const sy = box.h / ih;
	// contain keeps the whole picture, cover fills the box and crops; both keep proportions.
	const scale = e.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
	const w = e.fit === "stretch" ? box.w : iw * scale;
	const h = e.fit === "stretch" ? box.h : ih * scale;
	// The anchor places a letterboxed picture, or picks which part of a cropped one shows.
	const at = { left: 0, top: 0, center: 0.5, middle: 0.5, right: 1, bottom: 1 };
	const x = (box.w - w) * at[e.align ?? "center"];
	const y = (box.h - h) * at[e.vAlign ?? "middle"];
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, box.w, box.h);
	ctx.clip();
	ctx.drawImage(img, x, y, w, h);
	ctx.restore();
	return { process: (data) => toOneBit(data, { mode: e.mode, level: e.level, invert: e.invert }) };
};
