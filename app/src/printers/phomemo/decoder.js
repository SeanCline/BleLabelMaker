/** @typedef {import("../../raster.js").Raster} Raster */
/** @typedef {{type: string, [detail: string]: any}} PrinterEvent */

/**
 * Streaming parser for the subset of ESC/POS Phomemo D-series printers understand. It is fed BLE packets
 * exactly as the printer would receive them, so commands may straddle packet boundaries.
 */
export class PrinterDecoder {
	/**
	 * @param {object} [handlers]
	 * @param {(raster: Raster) => void} [handlers.onLabel] once per label that comes out
	 * @param {(event: PrinterEvent) => void} [handlers.onEvent] every command, as it is parsed
	 */
	constructor({ onLabel = () => {}, onEvent = () => {} } = {}) {
		this.onLabel = onLabel;
		this.onEvent = onEvent;
		this.buffer = new Uint8Array(0);
		this.labels = [];
		this.pending = null;
		this.copies = 1;
	}

	feed(packet) {
		const merged = new Uint8Array(this.buffer.length + packet.length);
		merged.set(this.buffer);
		merged.set(packet, this.buffer.length);
		this.buffer = merged;
		let pos = 0;
		for (;;) {
			const used = this.#step(this.buffer, pos);
			if (used === 0) break;
			pos += used;
		}
		this.buffer = this.buffer.slice(pos);
	}

	/** Bytes left over after the stream ends; a non-empty value means a truncated command. */
	get leftover() {
		return this.buffer.length;
	}

	// Returns bytes consumed, or 0 if more input is needed.
	#step(b, pos) {
		const n = b.length - pos;
		if (n === 0) return 0;
		const op = b[pos];
		if (op === 0x1b) {
			if (n < 2) return 0;
			if (b[pos + 1] === 0x40) {
				this.copies = 1;
				this.onEvent({ type: "init" });
				return 2;
			}
			if (b[pos + 1] === 0x64) {
				if (n < 3) return 0;
				this.onEvent({ type: "feed", lines: b[pos + 2] });
				return 3;
			}
			if (b[pos + 1] === 0x4e) {
				if (n < 4) return 0;
				if (b[pos + 2] !== 0x07)
					throw new DecodeError(`unknown ESC N command 0x${hex(b[pos + 2])}`);
				this.onEvent({ type: "autoPowerOff", minutes: b[pos + 3] * 5 });
				return 4;
			}
		}
		if (op === 0x1f) {
			if (n < 3) return 0;
			if (b[pos + 1] !== 0x11) throw new DecodeError(`unknown 0x1f command 0x${hex(b[pos + 1])}`);
			const sub = b[pos + 2];
			const withValue = { 0x02: "density", 0x21: "copies", 0x24: "offset" }[sub];
			if (withValue) {
				if (n < 4) return 0;
				if (withValue === "copies") this.copies = b[pos + 3];
				this.onEvent({ type: withValue, value: b[pos + 3] });
				return 4;
			}
			const paperType = { 0x0a: "gaps", 0x0b: "continuous" }[sub];
			if (paperType) {
				this.onEvent({ type: "paperType", value: paperType });
				return 3;
			}
			const query = { 0x08: "battery", 0x11: "paper", 0x07: "firmware", 0x0e: "autoPowerOff" }[sub];
			if (!query) throw new DecodeError(`unknown 1f 11 command 0x${hex(sub)}`);
			this.onEvent({ type: "query", query });
			return 3;
		}
		if (op === 0x1d) {
			if (n < 2) return 0;
			if (b[pos + 1] !== 0x76) throw new DecodeError(`unknown GS command 0x${hex(b[pos + 1])}`);
			if (n < 8) return 0;
			if (b[pos + 2] !== 0x30) throw new DecodeError(`unsupported GS v mode 0x${hex(b[pos + 2])}`);
			const bytesPerRow = b[pos + 4] | (b[pos + 5] << 8);
			const rows = b[pos + 6] | (b[pos + 7] << 8);
			const size = bytesPerRow * rows;
			if (n < 8 + size) return 0;
			const raster = { bytesPerRow, rows, data: b.slice(pos + 8, pos + 8 + size) };
			this.onEvent({ type: "raster", bytesPerRow, rows, copies: this.copies });
			// `labels` is what comes out of the printer, so a copy count multiplies the image.
			for (let i = 0; i < this.copies; i++) {
				this.labels.push(raster);
				this.onLabel(raster);
			}
			return 8 + size;
		}
		throw new DecodeError(`unknown command byte 0x${hex(op)} at offset ${pos}`);
	}
}

export class DecodeError extends Error {}

const hex = (v) => v.toString(16).padStart(2, "0");
