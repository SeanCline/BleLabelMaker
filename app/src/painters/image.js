// Pictures: fitted into the box, then reduced to 1-bit by dithering or a threshold.
import { toOneBit } from "../raster.js";
import { drawUnavailable } from "./common.js";

// Decoded images, keyed by data URL, so dragging an image doesn't re-decode it every frame.
const imageCache = new Map();
// Their sizes once decoded, for placing the handle that pans one, which can't wait.
const sizes = new Map();
const IMAGE_CACHE_SIZE = 24;
const loadImage = (src) => {
	let p = imageCache.get(src);
	if (!p) {
		p = new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				sizes.set(src, { w: img.naturalWidth, h: img.naturalHeight });
				resolve(img);
			};
			img.onerror = () => reject(new Error("This image couldn't be read."));
			img.src = src;
		});
		imageCache.set(src, p);
		if (imageCache.size > IMAGE_CACHE_SIZE) {
			const oldest = imageCache.keys().next().value;
			imageCache.delete(oldest);
			sizes.delete(oldest);
		}
	}
	return p;
};

/**
 * Where the picture goes in its box (in the box's own, unrotated frame), whatever units the box
 * is in: fitted by `fit`, enlarged by `zoom`, then placed by `panX` and `panY`.
 * @param {{w: number, h: number}} box
 * @param {{w: number, h: number}} size the picture's own
 */
export const pictureFrame = (e, box, size) => {
	const sx = box.w / size.w;
	const sy = box.h / size.h;
	// contain keeps the whole picture, cover fills the box and crops; both keep proportions.
	// Zoom multiplies either, so a filled picture still fills its box however it's resized.
	const scale = (e.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy)) * e.zoom;
	const w = e.fit === "stretch" ? box.w : size.w * scale;
	const h = e.fit === "stretch" ? box.h : size.h * scale;
	return { x: (box.w - w) * e.panX, y: (box.h - h) * e.panY, w, h };
};

/** The picture's size, once it has been drawn; null before then. */
export const pictureSize = (src) => sizes.get(src) ?? null;

export const drawImageElement = async (ctx, e, box) => {
	let img;
	try {
		img = await loadImage(e.src);
	} catch (err) {
		imageCache.delete(e.src);
		// Not cached: the next render tries loading the image again.
		return { ...drawUnavailable(ctx, box, err.message), retry: true };
	}
	const { x, y, w, h } = pictureFrame(e, box, { w: img.naturalWidth, h: img.naturalHeight });
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
