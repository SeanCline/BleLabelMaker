import { test } from "node:test";
import assert from "node:assert/strict";
import { BluetoothPrinter } from "../src/transport/bluetooth.js";

/** A D30 whose gatt.disconnect() fires gattserverdisconnected straight away, as Chrome's does. */
const fakeDevice = () => {
	const device = new EventTarget();
	const characteristic = { properties: {}, writeValueWithResponse: async () => {} };
	const service = {
		getCharacteristic: async () => characteristic,
		getCharacteristics: async () => [],
	};
	const gatt = {
		connected: false,
		async connect() {
			gatt.connected = true;
			return { getPrimaryService: async () => service };
		},
		disconnect() {
			gatt.connected = false;
			device.dispatchEvent(new Event("gattserverdisconnected"));
		},
	};
	return Object.assign(device, { name: "D30", gatt });
};

const connected = async () => {
	const device = fakeDevice();
	Object.defineProperty(globalThis, "navigator", {
		value: { bluetooth: { requestDevice: async () => device } },
		configurable: true,
	});
	const states = [];
	const printer = new BluetoothPrinter({ onStatus: (s) => states.push(s) });
	await printer.connect();
	states.length = 0;
	return { printer, device, states };
};

test("a disconnect is reported once, though the device says so as well", async () => {
	const { printer, states } = await connected();
	await printer.disconnect();
	assert.deepEqual(states, ["disconnected"]);
});

test("a link the printer drops is reported once, and the next connect goes back to it", async () => {
	const { printer, device, states } = await connected();
	device.gatt.disconnect();
	assert.deepEqual(states, ["disconnected"]);
	assert.equal(printer.connected, false);
	await printer.connect();
	assert.equal(printer.connected, true);
	assert.equal(printer.device, device, "no picker: the same device");
});
