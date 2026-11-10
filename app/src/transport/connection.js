// What every way of reaching a printer shares: a session with one printer over one link.
// Each link (bluetooth.js, serial.js, virtual.js) only opens itself and writes bytes; the
// queueing, chunked sending and status handling are here. What the bytes mean is the
// business of the model's driver (src/printers/).
import { packetize } from "../bytes.js";
import { DEFAULT_PRINTER } from "../printers/index.js";
import { SendError } from "./errors.js";

export { SendError, PartialPrintError } from "./errors.js";

/** @typedef {(sent: number, total: number) => void} OnProgress */
/** @typedef {ReturnType<typeof emptyStatus>} PrinterStatus */
/** @typedef {(status: PrinterStatus, event: import("../printers/index.js").StatusEvent) => void} OnPrinterStatus */
/** @typedef {import("../printers/index.js").PrinterModel} PrinterModel */
/** @typedef {"connecting"|"connected"|"disconnected"} LinkState */

/**
 * Printer state as last reported by the device. Fields stay undefined until the printer
 * says something about them, so the UI can tell "unknown" from "fine".
 */
const emptyStatus = () => ({
	battery: undefined,
	charging: undefined,
	paper: undefined,
	coverOpen: undefined,
	firmware: undefined,
	autoPowerOff: undefined,
});

const applyEvent = (status, e) => {
	if (e.type === "battery") status.battery = e.percent;
	else if (e.type === "charging") status.charging = e.charging;
	else if (e.type === "paper") status.paper = e.present;
	else if (e.type === "cover") status.coverOpen = e.open;
	else if (e.type === "firmware") status.firmware = e.version;
	else if (e.type === "autoPowerOff") status.autoPowerOff = e.minutes;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Enough to show a connect and a print's worth of status replies.
const MESSAGES_KEPT = 40;

/**
 * What every connection shares. Subclasses implement open(), write() and disconnect(), report
 * what the printer sends with this.heard(), and call this.lost() when the link drops.
 */
export class Connection {
	/** Bytes per write, if the link has its own limit rather than the driver's. */
	chunkSize = 0;
	/** Pause after each write, for links with no acknowledgements to pace by. */
	chunkGapMs = 0;
	/** @type {PrinterModel} */
	#model = DEFAULT_PRINTER;

	/**
	 * @param {object} [handlers]
	 * @param {(state: LinkState) => void} [handlers.onStatus]
	 * @param {OnPrinterStatus} [handlers.onPrinterStatus]
	 */
	constructor({ onStatus = () => {}, onPrinterStatus = () => {} } = {}) {
		this.onStatus = onStatus;
		this.onPrinterStatus = onPrinterStatus;
		this.status = emptyStatus();
		this.parser = this.#newParser();
		/** @type {Promise<unknown>} */
		this.queue = Promise.resolve();
	}

	/** The model being talked to: the one the app has selected, or the one that connected. */
	get model() {
		return this.#model;
	}

	set model(model) {
		const driverChanged = model.driver !== this.#model.driver;
		this.#model = model;
		if (driverChanged) this.parser = this.#newParser();
	}

	get driver() {
		return this.#model.driver;
	}

	/** What the printer last said, newest last, for bug reports. */
	messages = [];

	/** Everything the printer sends comes through here. */
	heard(bytes) {
		const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");
		this.messages.push({ at: new Date(), hex });
		if (this.messages.length > MESSAGES_KEPT) this.messages.shift();
		this.parser.feed(bytes);
	}

	#newParser() {
		return this.driver.statusParser((e) => {
			applyEvent(this.status, e);
			this.onPrinterStatus(this.status, e);
		});
	}

	/** @returns {string} */
	get name() {
		return "printer";
	}

	/** @returns {boolean} */
	get connected() {
		return false;
	}

	/**
	 * Opens the link, asking which device if need be.
	 * @param {{showAllDevices?: boolean}} [_options]
	 */
	async open(_options) {}

	/** @param {Uint8Array} _bytes */
	async write(_bytes) {}

	/** Closes the link but keeps the device, so the next connect goes straight back to it. */
	async disconnect() {
		this.lost();
	}

	/** Closes the link and forgets the device, so the next connect asks again. */
	async forget() {
		await this.disconnect();
	}

	/** @param {{showAllDevices?: boolean}} [options] */
	async connect(options = {}) {
		await this.open(options);
		this.onStatus("connected");
		this.refreshStatus();
	}

	/** The link is gone: nothing the printer said before still holds. */
	lost() {
		this.status = emptyStatus();
		this.onStatus("disconnected");
	}

	/**
	 * Runs `fn` with exclusive use of the link. Without this, a status query fired after
	 * connecting lands in the middle of a print job's image data and corrupts it.
	 * @template T
	 * @param {() => Promise<T>} fn
	 * @returns {Promise<T>}
	 */
	exclusive(fn) {
		const run = this.queue.then(fn, fn);
		this.queue = run.catch(() => {});
		return run;
	}

	/** Asks for battery, paper, firmware and settings; answers arrive through onPrinterStatus. */
	async refreshStatus() {
		if (!this.connected) return;
		try {
			await this.exclusive(async () => {
				// The link can go while these wait behind a print, or between them.
				for (const q of this.driver.statusQueries) if (this.connected) await this.write(q);
			});
		} catch (err) {
			console.warn("status query failed:", err);
		}
	}

	/**
	 * @param {Uint8Array} bytes
	 * @param {OnProgress} [onProgress]
	 * @returns {Promise<{packets: number, bytes: number}>}
	 * @throws {SendError} when the link fails part way
	 */
	async send(bytes, onProgress) {
		if (!this.connected) await this.connect();
		return this.exclusive(() => this.#sendNow(bytes, onProgress));
	}

	/**
	 * Prints labels the way the model's driver does, with the link to itself throughout: a
	 * driver that waits for replies between steps can't have a status query land in between.
	 * @param {import("../printers/index.js").RasterLabel[]} labels
	 * @param {Omit<import("../printers/index.js").PrintOptions, "printer">} opts
	 * @returns {Promise<{decoded?: any}>} decoded: what a virtual printer made of it
	 * @throws {import("./errors.js").PartialPrintError} when the link fails part way
	 */
	async print(labels, opts) {
		if (!this.connected) await this.connect();
		const printer = this.model;
		/** @type {import("../printers/index.js").PrintLink} */
		const link = { send: (bytes, onProgress) => this.#sendNow(bytes, onProgress) };
		await this.exclusive(() => printer.driver.print(link, labels, { ...opts, printer }));
		return {};
	}

	/**
	 * Writes in chunks; the caller holds the link.
	 * @param {Uint8Array} bytes
	 * @param {OnProgress} [onProgress]
	 */
	async #sendNow(bytes, onProgress = () => {}) {
		const packets = packetize(bytes, this.chunkSize || this.driver.packetSize);
		let sent = 0;
		for (const [i, p] of packets.entries()) {
			try {
				await this.write(p);
			} catch (err) {
				throw new SendError(err, sent);
			}
			sent += p.length;
			onProgress(sent, bytes.length);
			await this.pace(i);
		}
		return { packets: packets.length, bytes: bytes.length };
	}

	/**
	 * Waits between writes.
	 * @param {number} _index
	 */
	async pace(_index) {
		if (this.chunkGapMs) await sleep(this.chunkGapMs);
	}
}
