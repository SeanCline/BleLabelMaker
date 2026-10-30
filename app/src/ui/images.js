import { round } from "../units.js";

// Longest side kept on import. Even a 200 mm label is 1600 dots long, and images are usually
// a corner of a label, so this is plenty of detail while keeping .label files small.
const MAX_SIDE = 800;

/**
 * Reads an image file, downscales it, and returns an embeddable data URL plus its size.
 * JPEGs stay JPEG (photos compress far better); everything else becomes PNG to keep
 * transparency.
 * @returns {Promise<{src: string, width: number, height: number}>}
 */
export const importImageFile = async (file) => {
	if (!file.type.startsWith("image/")) throw new Error(`${file.name} isn't an image.`);
	let bitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		throw new Error(`${file.name} couldn't be read as an image.`);
	}
	const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext("2d");
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();
	const jpeg = file.type === "image/jpeg";
	return { src: canvas.toDataURL(jpeg ? "image/jpeg" : "image/png", 0.9), width, height };
};

/** Largest box with the image's proportions that fits in `area` (mm). */
export const fitBox = ({ width, height }, area) => {
	const scale = Math.min(area.w / width, area.h / height);
	return { w: round(width * scale), h: round(height * scale) };
};
