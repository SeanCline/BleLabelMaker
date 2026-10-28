// The virtual printer: a connection with the printer's firmware simulated on the other end.
import { Connection, sleep } from "./connection.js";

/**
 * Stands in for the printer: decodes what's written to it as the firmware would, and answers
 * status queries the way the real one does. It goes through the same send path as the real
 * connections. `simulate` lets tests (and the console) put it into states like "out of paper".
 */
export class VirtualPrinter extends Connection {
	/** @type {import("../printers/index.js").SimulatedPrinter} */
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
	 * @param {import("./connection.js").OnProgress} [onProgress]
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
