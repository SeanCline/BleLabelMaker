// A serial port (Web Serial): USB adapters, and classic Bluetooth's serial profile.
import { Connection } from "./connection.js";

export const serialAvailable = () => typeof navigator !== "undefined" && "serial" in navigator;

// Classic Bluetooth's Serial Port Profile, the link many label printers' own apps use. Listing
// it lets Chrome offer a printer's Bluetooth serial service as well as plain COM ports.
const SPP = "00001101-0000-1000-8000-00805f9b34fb";

/**
 * The printer as a serial port (Web Serial; Chrome, Edge and Firefox on desktop). On Windows a
 * paired printer shows up as "Standard Serial over Bluetooth link" COM ports, which gives a
 * second route if Bluetooth LE misbehaves, and the only one in Firefox. Same bytes, same status
 * records as BLE.
 */
export class SerialPrinter extends Connection {
	// Paced at about 50 KB/s, as a margin rather than a need: the printer maker's own app
	// prints over this same Bluetooth serial link with each job in one unpaced write, leaving
	// it to the link's flow control (see DESIGN.md). It costs ~80 ms on a typical label.
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
			throw new Error(
				"This browser can't use serial ports. Use Chrome, Edge or Firefox on a computer.",
			);
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

	async disconnect() {
		const { port, reader } = this;
		// Cleared first, so the read loop ending doesn't report the link as lost a second time.
		this.reader = null;
		await reader?.cancel().catch(() => {});
		this.writer?.releaseLock();
		this.writer = null;
		await port?.close().catch(() => {});
		this.lost();
	}

	async forget() {
		await this.disconnect();
		this.port = null;
	}
}
