import qrcode from "../vendor/qrcode-generator.js";

// Scanners want a light border; 2 modules is enough for phone cameras and saves label space.
const QR_QUIET = 2;

// The library defaults to Latin-1; URLs and labels with accents or emoji need UTF-8.
const encoder = new TextEncoder();
qrcode.stringToBytes = (s) => [...encoder.encode(s)];

export class QrError extends Error {}

/**
 * @param {string} text
 * @param {"L"|"M"|"Q"|"H"} [level]
 * @returns {{size: number, dark: (x: number, y: number) => boolean}}
 */
export const encodeQr = (text, level = "M") => {
	if (!text) throw new QrError("Enter text or a link to encode.");
	try {
		const qr = qrcode(0, level); // 0 = smallest version that fits
		qr.addData(text, "Byte");
		qr.make();
		const size = qr.getModuleCount();
		return { size, dark: (x, y) => qr.isDark(y, x) };
	} catch (err) {
		// The library throws strings like "code length overflow".
		throw new QrError(
			/overflow/i.test(String(err)) ? "Too much data for a QR code." : `QR error: ${err}`,
		);
	}
};

export const QR_LEVEL_NAMES = { L: "Low", M: "Medium", Q: "Quartile", H: "High" };

/**
 * The code for `text` in a square `side` dots across, with its square size in dots. "auto"
 * makes the squares as big as the space allows, up to `enough` dots, then takes the most
 * error correction that keeps them that big: bigger squares help every scan, while error
 * correction only helps once a label is scratched.
 * @param {string} text
 * @param {"auto"|"L"|"M"|"Q"|"H"} level
 * @param {number} side
 * @param {number} enough
 */
export const fitQr = (text, level, side, enough) => {
	const sized = (qr, l) => ({ qr, level: l, unit: Math.floor(side / (qr.size + QR_QUIET * 2)) });
	if (level !== "auto") return sized(encodeQr(text, level), level);
	const fits = [sized(encodeQr(text, "L"), "L")];
	for (const l of /** @type {const} */ (["M", "Q", "H"])) {
		try {
			fits.push(sized(encodeQr(text, l), l));
		} catch {
			break; // more correction only makes it bigger
		}
	}
	const target = Math.min(fits[0].unit, enough);
	return fits.findLast((f) => f.unit >= target);
};
