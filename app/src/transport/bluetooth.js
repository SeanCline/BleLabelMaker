// Bluetooth LE (Web Bluetooth): the way most label printers are reached.
import { bluetoothPrefixes, bluetoothServices, printerForName } from "../printers/index.js";
import { Connection } from "./connection.js";

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
