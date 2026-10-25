// Ways to reach a printer. Each connection only knows how to open its link and write bytes;
// the queueing, status handling and chunked sending they share live in Connection. What the
// bytes mean is the business of the model's driver (src/printers/).
import { packetize } from "./bytes.js";
import {
	DEFAULT_PRINTER,
	printerForName,
	bluetoothPrefixes,
	bluetoothServices,
} from "./printers/index.js";

/** @typedef {(sent: number, total: number) => void} OnProgress */
/** @typedef {ReturnType<typeof emptyStatus>} PrinterStatus */
/** @typedef {(status: PrinterStatus, event: import("./printers/index.js").StatusEvent) => void} OnPrinterStatus */
/** @typedef {import("./printers/index.js").PrinterModel} PrinterModel */
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Enough to show a connect and a print's worth of status replies.
const MESSAGES_KEPT = 40;

/** A send that broke off part way, saying how much got through first. */
export class SendError extends Error {
	/**
	 * @param {unknown} cause
	 * @param {number} sent bytes written before the failure
	 */
	constructor(cause, sent) {
		super(/** @type {any} */ (cause)?.message ?? String(cause), { cause });
		this.name = "SendError";
		this.sent = sent;
	}
}

/**
 * What every connection shares. Subclasses implement open(), write() and forget(), report
 * what the printer sends with this.heard(), and call this.lost() when the link drops.
 */
class Connection {
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

	/** Closes the link and forgets the device, so the next connect asks again. */
	async forget() {
		this.lost();
	}

	/** @param {{showAllDevices?: boolean}} [options] */
	async connect(options = {}) {
		await this.open(options);
		// A printer that names itself is the model it says, whatever was selected.
		this.model = printerForName(this.name) ?? this.model;
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
				for (const q of this.driver.statusQueries) await this.write(q);
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
	async send(bytes, onProgress = () => {}) {
		if (!this.connected) await this.connect();
		const packets = packetize(bytes, this.chunkSize || this.driver.packetSize);
		return this.exclusive(async () => {
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
		});
	}

	/**
	 * Waits between writes.
	 * @param {number} _index
	 */
	async pace(_index) {
		if (this.chunkGapMs) await sleep(this.chunkGapMs);
	}
}

// ---------------------------------------------------------------------------
// Bluetooth LE

export const bluetoothAvailable = () => typeof navigator !== "undefined" && !!navigator.bluetooth;

/**
 * Keeps one GATT connection open across prints, so the device picker shows once rather than
 * for every print.
 */
export class BluetoothPrinter extends Connection {
	device = null;
	characteristic = null;

	get name() {
		return this.device?.name ?? "printer";
	}

	get connected() {
		return !!this.device?.gatt?.connected && !!this.characteristic;
	}

	async open({ showAllDevices = false } = {}) {
		if (!bluetoothAvailable())
			throw new Error("This browser doesn't support Web Bluetooth. Use Chrome or Edge.");
		if (!this.device) {
			const services = bluetoothServices();
			this.device = await navigator.bluetooth.requestDevice(
				showAllDevices
					? { acceptAllDevices: true, optionalServices: services }
					: {
							filters: [
								...bluetoothPrefixes().map((namePrefix) => ({ namePrefix })),
								...services.map((service) => ({ services: [service] })),
							],
							optionalServices: services,
						},
			);
			this.device.addEventListener("gattserverdisconnected", () => {
				this.characteristic = null;
				this.lost();
			});
		}
		// Its name says which driver to talk to before anything is sent.
		this.model = printerForName(this.device.name) ?? this.model;
		const { bluetooth } = this.driver;
		this.onStatus("connecting");
		let service;
		try {
			const server = await this.device.gatt.connect();
			service = await server.getPrimaryService(bluetooth.service);
			this.characteristic = await service.getCharacteristic(bluetooth.write);
		} catch (err) {
			this.onStatus("disconnected");
			throw err;
		}
		await this.#listen(service);
	}

	/**
	 * A printer's BLE notify characteristic isn't always known for certain; subscribing to every notifying one in the service covers it.
	 * Status is a nice-to-have, so failures here never block printing.
	 */
	async #listen(service) {
		try {
			for (const ch of await service.getCharacteristics()) {
				if (!ch.properties.notify && !ch.properties.indicate) continue;
				ch.addEventListener("characteristicvaluechanged", (ev) => {
					const v = ev.target.value;
					this.heard(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
				});
				await ch.startNotifications();
			}
		} catch (err) {
			console.warn("printer status unavailable:", err);
		}
	}

	write(bytes) {
		const ch = this.characteristic;
		// Waiting for each write's response is the printer's only flow control.
		return ch.writeValueWithResponse ? ch.writeValueWithResponse(bytes) : ch.writeValue(bytes);
	}

	async forget() {
		if (this.device?.gatt?.connected) this.device.gatt.disconnect();
		this.device = null;
		this.characteristic = null;
		this.lost();
	}
}

// ---------------------------------------------------------------------------
// Serial port

export const serialAvailable = () => typeof navigator !== "undefined" && "serial" in navigator;

// Classic Bluetooth's Serial Port Profile, the link many label printers' own apps use. Listing
// it lets Chrome offer a printer's Bluetooth serial service as well as plain COM ports.
const SPP = "00001101-0000-1000-8000-00805f9b34fb";

/**
 * The printer as a serial port (Web Serial; Chrome and Edge on desktop). On Windows a paired
 * printer shows up as "Standard Serial over Bluetooth link" COM ports, which gives a second
 * route if Bluetooth LE misbehaves. Same bytes, same status records as BLE. Experimental.
 */
export class SerialPrinter extends Connection {
	// No acknowledgements over a serial link, so writes are paced to stay under what the
	// printer can buffer. A guess until tested on hardware: about 50 KB/s.
	chunkSize = 512;
	chunkGapMs = 10;
	/** @type {any} */
	port = null;
	/** @type {WritableStreamDefaultWriter | null} */
	writer = null;
	reader = null;

	get name() {
		// A port has no name to recognise a model by, so it is whichever one is selected.
		return `${this.model.name} (serial)`;
	}

	get connected() {
		return !!this.writer;
	}

	async open() {
		if (!serialAvailable())
			throw new Error("This browser can't use serial ports. Use Chrome or Edge.");
		const serial = /** @type {any} */ (navigator).serial;
		this.port ??= await serial.requestPort({ allowedBluetoothServiceClassIds: [SPP] });
		this.onStatus("connecting");
		try {
			// Bluetooth serial ignores the rate; a USB adapter needs one, and 115200 is the norm.
			await this.port.open({ baudRate: 115200 });
		} catch (err) {
			// Already open (a second connect) is fine; anything else isn't.
			if (err?.name !== "InvalidStateError") {
				this.onStatus("disconnected");
				throw err;
			}
		}
		this.writer = this.port.writable.getWriter();
		this.#readStatus();
	}

	async #readStatus() {
		const reader = this.port.readable.getReader();
		this.reader = reader;
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				this.heard(value);
			}
		} catch {
			// The port went away (printer off, out of range); the writer notices on next use.
		} finally {
			reader.releaseLock();
			if (this.reader === reader) {
				this.writer?.releaseLock();
				this.writer = null;
				this.reader = null;
				this.lost();
			}
		}
	}

	write(bytes) {
		return this.writer.write(bytes);
	}

	async forget() {
		const { port, reader } = this;
		this.reader = null;
		await reader?.cancel().catch(() => {});
		this.writer?.releaseLock();
		this.writer = null;
		await port?.close().catch(() => {});
		this.port = null;
		this.lost();
	}
}

// ---------------------------------------------------------------------------
// Virtual printer

/**
 * Stands in for the printer: decodes what's written to it as the firmware would, and answers
 * status queries the way the real one does. It goes through the same send path as the real
 * connections. `simulate` lets tests (and the console) put it into states like "out of paper".
 */
export class VirtualPrinter extends Connection {
	/** @type {import("./printers/index.js").SimulatedPrinter} */
	simulate = {
		battery: 87,
		charging: false,
		paper: true,
		coverOpen: false,
		firmware: [1, 0, 0],
		autoPowerOff: 30,
	};
	/** @type {{labels: any[], events: any[]} | null} what the current send produced */
	#job = null;
	#decoder = this.#newDecoder();

	get name() {
		return "virtual printer";
	}

	get connected() {
		return true;
	}

	#newDecoder() {
		return this.driver.decoder({
			onLabel: (l) => this.#job?.labels.push(l),
			onEvent: (e) => {
				this.#job?.events.push(e);
				for (const r of this.driver.simulator.reply(e, this.simulate)) this.heard(r);
				if (e.type === "autoPowerOff") this.simulate.autoPowerOff = e.minutes;
			},
		});
	}

	async write(bytes) {
		this.#decoder.feed(bytes);
	}

	// Yield now and then so the progress bar is visible, like a real (slow) transfer.
	async pace(index) {
		if (index % 8 === 7) await sleep(4);
	}

	/**
	 * @param {Uint8Array} bytes
	 * @param {OnProgress} [onProgress]
	 */
	async send(bytes, onProgress) {
		this.#job = { labels: [], events: [] };
		this.#decoder = this.#newDecoder();
		const sent = await super.send(bytes, onProgress);
		const { labels, events } = this.#job;
		this.#job = null;
		const leftover = this.#decoder.leftover;
		if (leftover) throw new Error(`virtual printer: ${leftover} bytes of an incomplete command`);
		// A real printer with no paper or an open cover prints nothing and says why.
		const s = this.simulate;
		const blocked = !s.paper || s.coverOpen;
		for (const r of this.driver.simulator.afterJob(s, labels.length > 0)) this.heard(r);
		return { ...sent, labels: blocked ? [] : labels, events };
	}
}
