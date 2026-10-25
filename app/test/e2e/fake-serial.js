/**
 * Installed into the page before the app loads (page.evaluateOnNewDocument). Emulates a D30
 * reached as a serial port through Web Serial: the port picker, open/close, a writable
 * stream the printer reads from, and a readable stream carrying its status records. Writes
 * are decoded with the app's own decoder and answered by the shared status emulator.
 *
 * Exposes window.fakeSerial for tests to inspect writes and change printer state.
 */
export const installFakeSerial = () => {
	const fake = {
		writes: [],
		labels: [],
		state: {
			battery: 72,
			charging: false,
			paper: true,
			coverOpen: false,
			firmware: [2, 1, 7],
			autoPowerOff: 60,
		},
		requestOptions: null,
		openOptions: null,
		pickerCount: 0,
	};
	window.fakeSerial = fake;

	let incoming = null;
	// Real printers send each status record as it happens.
	const notify = (...records) => {
		for (const r of records) setTimeout(() => incoming?.enqueue(Uint8Array.from(r)), 5);
	};
	fake.notify = notify;

	let decoderPromise;
	const decoder = () =>
		(decoderPromise ??= Promise.all([
			import("/src/printers/phomemo/decoder.js"),
			import("/src/printers/phomemo/status.js"),
		]).then(
			([{ PrinterDecoder }, { answerQuery }]) =>
				new PrinterDecoder({
					onLabel: (l) => fake.labels.push(l),
					onEvent: (e) => {
						if (e.type === "query") notify(...answerQuery(e.query, fake.state));
						if (e.type === "autoPowerOff") fake.state.autoPowerOff = e.minutes;
					},
				}),
		));

	const port = {
		readable: null,
		writable: null,
		async open(options) {
			if (port.readable) throw new DOMException("The port is already open.", "InvalidStateError");
			fake.openOptions = options;
			port.readable = new ReadableStream({ start: (c) => (incoming = c) });
			port.writable = new WritableStream({
				async write(chunk) {
					const copy = Uint8Array.from(chunk);
					fake.writes.push(copy);
					(await decoder()).feed(copy);
				},
			});
		},
		async close() {
			incoming = null;
			port.readable = port.writable = null;
		},
	};
	fake.port = port;

	Object.defineProperty(Navigator.prototype, "serial", {
		configurable: true,
		get: () => ({
			requestPort: async (options) => {
				fake.requestOptions = options;
				fake.pickerCount++;
				return port;
			},
		}),
	});
};
