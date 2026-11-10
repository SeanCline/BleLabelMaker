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
	/**
	 * What the current print produced, and what it took to send.
	 * @type {{labels: any[], events: any[], bytes: number, packets: number} | null}
	 */
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
		if (this.#job) {
			this.#job.bytes += bytes.length;
			this.#job.packets++;
		}
		this.#decoder.feed(bytes);
	}

	// Yield now and then so the progress bar is visible, like a real (slow) transfer.
	async pace(index) {
		if (index % 8 === 7) await sleep(4);
	}

	/**
	 * Prints through the model's driver like a real connection, decoding what it's sent.
	 * @param {import("../printers/index.js").RasterLabel[]} labels
	 * @param {Omit<import("../printers/index.js").PrintOptions, "printer">} opts
	 */
	async print(labels, opts) {
		this.#job = { labels: [], events: [], bytes: 0, packets: 0 };
		this.#decoder = this.#newDecoder();
		let job;
		try {
			await super.print(labels, opts);
		} finally {
			job = this.#job;
			this.#job = null;
		}
		const leftover = this.#decoder.leftover;
		if (leftover) throw new Error(`virtual printer: ${leftover} bytes of an incomplete command`);
		// As a real printer would, one that can't print prints nothing, and says why.
		const s = this.simulate;
		for (const r of this.driver.simulator.afterJob(s, job.labels.length > 0)) this.heard(r);
		if (this.driver.simulator.blocks(s)) {
			const why = [s.coverOpen && "cover open", !s.paper && "out of labels"].filter(Boolean);
			throw new Error(`the printer reports ${why.join(" · ")}`);
		}
		return { decoded: job };
	}
}
