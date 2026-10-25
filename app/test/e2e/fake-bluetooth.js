/**
 * Installed into the page before the app loads (page.evaluateOnNewDocument). Emulates a D30
 * over the Web Bluetooth API closely enough to exercise BluetoothPrinter for real: device
 * picker, GATT connect, service/characteristic lookup, notifications, chunked writes with
 * responses, and disconnects. Writes are decoded with the app's own decoder.
 *
 * Exposes window.fakeD30 for tests to inspect writes and change printer state.
 */
export const installFakeBluetooth = () => {
	const SERVICE = "0000ff00-0000-1000-8000-00805f9b34fb";
	const NOTIFY = "0000ff01-0000-1000-8000-00805f9b34fb";
	const WRITE = "0000ff02-0000-1000-8000-00805f9b34fb";

	const fake = {
		name: "D30-FAKE",
		writes: [],
		requestOptions: null,
		labels: [],
		state: {
			battery: 64,
			charging: false,
			paper: true,
			coverOpen: false,
			firmware: [2, 1, 7],
			autoPowerOff: 60,
		},
		pickerCancels: false,
		/** Set to a write count to have the link drop on that write, as out of range would. */
		dropAtWrite: Infinity,
	};
	window.fakeD30 = fake;

	// Decodes writes with the app's own decoder and answers queries with the same emulator as
	// the virtual printer.
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

	const notifyChar = new EventTarget();
	Object.assign(notifyChar, {
		uuid: NOTIFY,
		properties: { notify: true, write: false },
		notifying: false,
		startNotifications: async () => {
			notifyChar.notifying = true;
			return notifyChar;
		},
	});
	// Real printers send each status record as its own notification.
	const notify = (...records) => {
		for (const r of records) {
			if (!notifyChar.notifying) continue;
			setTimeout(() => {
				notifyChar.value = new DataView(Uint8Array.from(r).buffer);
				const ev = new Event("characteristicvaluechanged");
				Object.defineProperty(ev, "target", { value: notifyChar });
				notifyChar.dispatchEvent(ev);
			}, 5);
		}
	};
	fake.notify = notify;

	const writeChar = {
		uuid: WRITE,
		properties: { notify: false, write: true },
		writeValueWithResponse: async (bytes) => {
			if (!device.gatt.connected)
				throw new DOMException("GATT Server is disconnected.", "NetworkError");
			const copy = new Uint8Array(
				bytes.buffer
					? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
					: bytes,
			);
			if (copy.length > 512) throw new DOMException("Value too long", "InvalidModificationError");
			if (fake.writes.length >= fake.dropAtWrite) {
				device.gatt.disconnect();
				throw new DOMException("GATT Server is disconnected.", "NetworkError");
			}
			fake.writes.push(copy);
			(await decoder()).feed(copy);
		},
	};

	const service = {
		uuid: SERVICE,
		getCharacteristic: async (uuid) => {
			if (uuid === WRITE) return writeChar;
			if (uuid === NOTIFY) return notifyChar;
			throw new DOMException("No Characteristics matching UUID found", "NotFoundError");
		},
		getCharacteristics: async () => [notifyChar, writeChar],
	};

	const device = new EventTarget();
	// A getter, so a test can make it another model by renaming it before connecting.
	Object.defineProperty(device, "name", { get: () => fake.name });
	Object.assign(device, {
		id: "fake-d30",
		gatt: {
			connected: false,
			connect: async () => {
				device.gatt.connected = true;
				return device.gatt;
			},
			disconnect: () => {
				if (!device.gatt.connected) return;
				device.gatt.connected = false;
				notifyChar.notifying = false;
				device.dispatchEvent(new Event("gattserverdisconnected"));
			},
			getPrimaryService: async (uuid) => {
				if (!device.gatt.connected)
					throw new DOMException("GATT Server is disconnected.", "NetworkError");
				if (uuid !== SERVICE)
					throw new DOMException("No Services matching UUID found", "NotFoundError");
				return service;
			},
		},
	});
	fake.device = device;

	Object.defineProperty(Navigator.prototype, "bluetooth", {
		configurable: true,
		get: () => ({
			requestDevice: async (options) => {
				fake.requestOptions = options;
				fake.pickerCount = (fake.pickerCount ?? 0) + 1;
				if (fake.pickerCancels)
					throw new DOMException("User cancelled the requestDevice() chooser.", "NotFoundError");
				return device;
			},
		}),
	});
};
