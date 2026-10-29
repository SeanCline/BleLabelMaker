// The Phomemo D-series command set (the D30 and its relatives in models.js). Anything that
// differs between models comes from the PrinterModel.
import { concat } from "../../bytes.js";

export const INIT = Uint8Array.of(0x1b, 0x40);
export const RASTER_PREFIX = Uint8Array.of(0x1d, 0x76, 0x30, 0x00);

/**
 * There is one print sequence per paper type. On gapped label rolls the printer stops at the
 * next gap by itself; a trailing ESC d makes a real D30 keep feeding blank labels, so only
 * continuous paper gets one.
 */
export const PAPER = ["gaps", "continuous"];
export const feed = (lines) => Uint8Array.of(0x1b, 0x64, lines & 0xff);
// Shifts an image narrower than the head across it, in bytes.
export const setOffset = (bytes) => Uint8Array.of(0x1f, 0x11, 0x24, bytes & 0xff);
export const setCopies = (n) => Uint8Array.of(0x1f, 0x11, 0x21, n & 0xff);
/**
 * Which paper is loaded. The printer keeps this setting, and it decides what happens after an
 * image: on "gaps" it feeds on to the next gap, and on continuous tape (which has none) it
 * goes on feeding a distance that grows with the label before giving up. So every job says
 * which paper it was laid out for.
 */
export const PAPER_TYPE = { gaps: 0x0a, continuous: 0x0b };
export const setPaperType = (paper) => Uint8Array.of(0x1f, 0x11, PAPER_TYPE[paper]);

// Print density. Sending nothing leaves whatever the printer last used.
export const DENSITY = { light: 1, normal: 2, dark: 4 };
export const setDensity = (n) => Uint8Array.of(0x1f, 0x11, 0x02, n & 0xff);

// Status queries; replies arrive as BLE notifications (see status.js).
export const QUERY = {
	battery: Uint8Array.of(0x1f, 0x11, 0x08),
	paper: Uint8Array.of(0x1f, 0x11, 0x11),
	firmware: Uint8Array.of(0x1f, 0x11, 0x07),
	autoPowerOff: Uint8Array.of(0x1f, 0x11, 0x0e),
};
// What a connection asks for when it connects and after each print.
export const STATUS_QUERIES = [QUERY.firmware, QUERY.battery, QUERY.paper, QUERY.autoPowerOff];

/**
 * Auto power-off, in the steps the D-series offers; 0 is never. The printer counts in 5-minute
 * units. Not yet confirmed on hardware.
 */
export const AUTO_POWER_OFF_MINUTES = [10, 30, 60, 180, 300, 600, 0];
export const setAutoPowerOff = (minutes) =>
	Uint8Array.of(0x1b, 0x4e, 0x07, Math.round(minutes / 5));

// 128-byte writes are reliable; larger ones can be dropped by the printer.
export const PACKET_SIZE = 128;

/**
 * @param {{bytesPerRow: number, rows: number, data: Uint8Array}} raster
 */
export const rasterCommand = ({ bytesPerRow, rows, data }) => {
	if (data.length !== bytesPerRow * rows) {
		throw new Error(`raster data is ${data.length} bytes, expected ${bytesPerRow * rows}`);
	}
	if (rows > 0xffff || bytesPerRow > 0xffff) throw new Error("raster too large");
	const header = Uint8Array.of(
		...RASTER_PREFIX,
		bytesPerRow & 0xff,
		bytesPerRow >> 8,
		rows & 0xff,
		rows >> 8,
	);
	return concat(header, data);
};

/**
 * @param {import("../../raster.js").Raster} raster
 * @param {object} opts
 * @param {number} [opts.copies]
 * @param {string} [opts.paper] "gaps" or "continuous"
 * @param {number|null} [opts.density] a DENSITY value, or null to leave the printer's setting
 * @param {import("../index.js").PrinterModel} opts.printer
 * @param {number} [opts.feedLines] after each continuous label, overriding the model's
 */
export const buildPrintJob = (
	raster,
	{ copies = 1, paper = "gaps", density = null, printer, feedLines = printer.feedLines },
) => {
	if (!Number.isInteger(feedLines) || feedLines < 0 || feedLines > 255)
		throw new Error("feed must be 0–255 dot lines");
	if (!Number.isInteger(copies) || copies < 1 || copies > 99)
		throw new Error("copies must be 1–99");
	if (!PAPER.includes(paper)) throw new Error(`unknown paper type ${paper}`);
	const image = rasterCommand(raster);
	// After INIT, in case the reset clears it; the printer keeps it as a persistent setting.
	const densityCmd = density !== null ? [setDensity(density)] : [];
	if (paper === "continuous") {
		const parts = [setPaperType("continuous"), INIT, ...densityCmd];
		for (let i = 0; i < copies; i++) {
			parts.push(image);
			const last = i === copies - 1;
			const fed = feedLines > 0 && (printer.feedAfter === "each" || last);
			if (fed) parts.push(feed(feedLines));
		}
		return concat(...parts);
	}
	// The copy count goes even with a single copy, so a count left over from an earlier job
	// can't apply to this one.
	return concat(
		setPaperType("gaps"),
		setOffset(Math.max(0, printer.headDots / 8 - raster.bytesPerRow)),
		INIT,
		...densityCmd,
		setCopies(copies),
		image,
	);
};
