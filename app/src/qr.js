import qrcode from "./vendor/qrcode-generator.js";

export const QR_LEVELS = { L: "Low (7%)", M: "Medium (15%)", Q: "Quartile (25%)", H: "High (30%)" };
// Scanners want a light border; 2 modules is enough for phone cameras and saves label space.
export const QR_QUIET = 2;

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
