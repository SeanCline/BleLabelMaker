// Every printer the app knows, from every driver. Nothing outside src/printers/ knows which
// brand a printer is: it asks the selected model for its sizes and its driver for the bytes.
//
// Adding a printer that speaks a protocol the app already has is one entry in that driver's
// models. Adding a new kind of printer is a new folder here with a driver and its models,
// added to PRINTERS below.
import { MODELS as PHOMEMO } from "./phomemo/models.js";

/**
 * What the app sends and hears, in the vocabulary every driver shares.
 * @typedef {{type: "battery", percent: number | null} | {type: "charging", charging: boolean}
 *   | {type: "paper", present: boolean} | {type: "cover", open: boolean}
 *   | {type: "firmware", version: string} | {type: "autoPowerOff", minutes: number}
 *   | {type: "printed"} | {type: string, [detail: string]: any}} StatusEvent
 */

/**
 * The state a virtual printer pretends to be in.
 * @typedef {{battery: number, charging: boolean, paper: boolean, coverOpen: boolean,
 *   firmware: [number, number, number], autoPowerOff: number}} SimulatedPrinter
 */

/**
 * A kind of printer: its commands, how to reach it, and how to understand what it says.
 * @typedef {object} PrinterDriver
 * @property {string} id
 * @property {{service: string, write: string}} bluetooth GATT service and write characteristic
 * @property {number} packetSize bytes per Bluetooth write the printer reliably takes
 * @property {(raster: import("../raster.js").Raster, opts: {copies: number,
 *   paper: "gaps"|"continuous", density: number | null, printer: PrinterModel,
 *   feedLines?: number}) => Uint8Array} buildJob one label, printed `copies` times
 * @property {{light: number, normal: number, dark: number}} densities its values for each
 * @property {Uint8Array[]} statusQueries sent on connect and after each print
 * @property {(onEvent: (e: StatusEvent) => void) => {feed(bytes: Uint8Array): void}}
 *   statusParser reads what the printer notifies
 * @property {{minutes: number[], command: (minutes: number) => Uint8Array}} [autoPowerOff]
 *   the choices it offers (0 is never), if it has the setting
 * @property {(handlers: {onLabel?: (raster: import("../raster.js").Raster) => void,
 *   onEvent?: (e: {type: string, [detail: string]: any}) => void}) => {feed(bytes: Uint8Array):
 *   void, leftover: number}} decoder reads a job the way the firmware would, for the virtual
 *   printer and tests
 * @property {{reply: (event: {type: string, [detail: string]: any}, s: SimulatedPrinter) =>
 *   Uint8Array[], afterJob: (s: SimulatedPrinter, printed: boolean) => Uint8Array[],
 *   blocks: (s: SimulatedPrinter) => boolean}} simulator
 *   what a printer in state `s` would notify: in answer to a decoded command, and after a job
 */

/**
 * One printer model. Drivers may add fields of their own (the D-series has `feedAfter`).
 * @typedef {object} PrinterModel
 * @property {string} id stored in settings
 * @property {string} name shown to people
 * @property {string} vendor
 * @property {PrinterDriver} driver
 * @property {string[]} prefixes how it names itself over Bluetooth, without spaces; the longest
 *   match across every model wins, so "D30PRO" beats "D30"
 * @property {number} headDots print head width in dots
 * @property {import("../raster.js").Turn} labelTurn how a label passes under the head: 90 when
 *   the head spans the label's height (tape printers), 0 when it spans its width
 * @property {number} dotsPerMm its resolution: 8 for 203 dpi, 11.8 for 300 dpi. Labels are
 *   drawn at it, so the preview is the bitmap it prints
 * @property {number} feedLines dot lines fed after a continuous label, 0 for none; the
 *   default for the Advanced setting, which can override it
 * @property {"each"|"last"} [feedAfter] which continuous copies get that feed
 * @property {{widthMm: number, heightMm: number}[]} presets pre-cut label sizes
 * @property {number} continuousHeightMm height of its continuous rolls
 * @property {boolean} tested printed with this app on the real printer
 */

/** @type {PrinterModel[]} */
export const PRINTERS = [...PHOMEMO];

/** The model the app starts with: a tested one. */
export const DEFAULT_PRINTER = PRINTERS.find((p) => p.tested) ?? PRINTERS[0];

/** @returns {PrinterModel} */
export const printerById = (id) => PRINTERS.find((p) => p.id === id) ?? DEFAULT_PRINTER;

/**
 * The model a Bluetooth name belongs to ("D30", "Q30_1A2B", "D30 Pro"), or null.
 * @returns {PrinterModel | null}
 */
export const printerForName = (name) => {
	const n = String(name ?? "")
		.replace(/\s+/g, "")
		.toUpperCase();
	let best = null;
	let bestLength = 0;
	for (const p of PRINTERS) {
		for (const prefix of p.prefixes) {
			if (n.startsWith(prefix) && prefix.length > bestLength) {
				best = p;
				bestLength = prefix.length;
			}
		}
	}
	return best;
};

const unique = (list) => [...new Set(list)];

/** Every name prefix, for the Bluetooth device picker's filter. */
export const bluetoothPrefixes = () => unique(PRINTERS.flatMap((p) => p.prefixes));

/** Every driver's GATT service, so the picker can offer any known printer. */
export const bluetoothServices = () => unique(PRINTERS.map((p) => p.driver.bluetooth.service));
