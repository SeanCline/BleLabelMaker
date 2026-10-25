/**
 * Parses the D30's status notifications. Each record is an optional 0x1A prefix, a type
 * byte and a value.
 *
 *   1A 03 A8|A9      charging: no | yes
 *   1A 04 nn         battery: percent, or A1/A2/A3 = 10/5/3 %, A4 = unknown
 *   1A 05 98|99      cover: closed | open
 *   1A 06 88|89      paper: out | present
 *   1A 07 x y z      firmware version x.y.z
 *   1A 09 nn         auto power-off after nn × 5 minutes (0 = never)
 *   1A 0F 0C         print finished
 */
const BATTERY_CODES = { 0xa1: 10, 0xa2: 5, 0xa3: 3, 0xa4: null };

export class StatusParser {
	/** @param {(event: {type: string, [detail: string]: any}) => void} onEvent */
	constructor(onEvent) {
		this.onEvent = onEvent;
		this.buffer = [];
	}

	feed(bytes) {
		this.buffer.push(...bytes);
		for (;;) {
			const i = this.buffer[0] === 0x1a ? 1 : 0;
			const type = this.buffer[i];
			if (type === undefined) return;
			const size = type === 0x07 ? 3 : 1;
			if (this.buffer.length < i + 1 + size) return;
			const value = this.buffer.slice(i + 1, i + 1 + size);
			this.buffer.splice(0, i + 1 + size);
			const event = decode(type, value);
			if (event) this.onEvent(event);
		}
	}
}

/**
 * @param {number} type
 * @param {number[]} value
 */
const decode = (type, [v, ...rest]) => {
	switch (type) {
		case 0x03:
			return v === 0xa9
				? { type: "charging", charging: true }
				: v === 0xa8
					? { type: "charging", charging: false }
					: null;
		case 0x04:
			if (v in BATTERY_CODES) return { type: "battery", percent: BATTERY_CODES[v] };
			return v <= 100 ? { type: "battery", percent: v } : null;
		case 0x05:
			return v === 0x99
				? { type: "cover", open: true }
				: v === 0x98
					? { type: "cover", open: false }
					: null;
		case 0x06:
			return v === 0x88
				? { type: "paper", present: false }
				: v === 0x89
					? { type: "paper", present: true }
					: null;
		case 0x07:
			return { type: "firmware", version: [v, ...rest].join(".") };
		case 0x09:
			return { type: "autoPowerOff", minutes: v * 5 };
		case 0x0f:
			return v === 0x0c ? { type: "printed" } : null;
		default:
			// Other models send more record types; keep them visible for debugging only.
			return { type: "unknown", code: type, value: v };
	}
};

/** Builds a status record, for the virtual printer and tests. */
export const statusRecord = {
	battery: (percent) => Uint8Array.of(0x1a, 0x04, percent),
	charging: (yes) => Uint8Array.of(0x1a, 0x03, yes ? 0xa9 : 0xa8),
	cover: (open) => Uint8Array.of(0x1a, 0x05, open ? 0x99 : 0x98),
	paper: (present) => Uint8Array.of(0x1a, 0x06, present ? 0x89 : 0x88),
	firmware: (a, b, c) => Uint8Array.of(0x1a, 0x07, a, b, c),
	printed: () => Uint8Array.of(0x1a, 0x0f, 0x0c),
	autoPowerOff: (minutes) => Uint8Array.of(0x1a, 0x09, Math.round(minutes / 5)),
};

/**
 * What a D30 in state `s` notifies in reply to a status query. Shared by the virtual printer
 * and the fake Bluetooth device in the e2e tests, so the two can't drift apart.
 * @param {"battery"|"paper"|"firmware"|"autoPowerOff"} query
 * @param {import("../index.js").SimulatedPrinter} s
 * @returns {Uint8Array[]} one record per notification
 */
export const answerQuery = (query, s) => {
	if (query === "battery")
		return [statusRecord.battery(s.battery), statusRecord.charging(s.charging)];
	// A paper query reports the cover too, as the printer does.
	if (query === "paper") return [statusRecord.cover(s.coverOpen), statusRecord.paper(s.paper)];
	if (query === "firmware") return [statusRecord.firmware(...s.firmware)];
	if (query === "autoPowerOff") return [statusRecord.autoPowerOff(s.autoPowerOff)];
	return [];
};
