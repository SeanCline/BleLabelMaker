// The printer: the connections to it, the chip in the header that says how it is, and the
// menu that chooses and sets it up. Printing itself is in printing.js.
import { printerById, PRINTERS } from "../printers/index.js";
import { describeStatus, hasProblem } from "../print.js";
import {
	BluetoothPrinter,
	SerialPrinter,
	VirtualPrinter,
	bluetoothAvailable,
	serialAvailable,
} from "../transport.js";
import { $, el, toast } from "./dom.js";
import {
	settings,
	saveSettings,
	currentPrinter,
	selectPrinter,
	onModelChange,
	validFeed,
} from "./settings.js";
import { signal } from "./signal.js";

/** Tells the user about problems the moment the printer reports them, not just on print. */
const onPrinterStatus = (_status, event) => {
	if (event.type === "paper" && event.present === false)
		toast("The printer is out of labels.", { error: true });
	if (event.type === "cover" && event.open) toast("The printer's cover is open.", { error: true });
	renderPrinterStatus();
};
/** When a printer connects, its name may say it is a different model from the selected one. */
const recognise = (connection) => (state) => {
	if (state === "connected" && connection.model.id !== settings.printer) {
		selectPrinter(connection.model);
	}
	renderPrinterStatus();
};
const bt = new BluetoothPrinter({ onPrinterStatus });
bt.onStatus = recognise(bt);
const serial = new SerialPrinter({ onPrinterStatus });
serial.onStatus = recognise(serial);
const virtual = new VirtualPrinter({ onPrinterStatus });
for (const c of [bt, serial, virtual]) c.model = currentPrinter();
onModelChange((model) => {
	for (const c of [bt, serial, virtual]) c.model = model;
});

/** The real printer for the chosen target, or null for the virtual one. */
export const hardware = () => ({ bluetooth: bt, serial })[settings.target] ?? null;
/** Where a print goes: the real printer, or the virtual one. */
export const connection = () => hardware() ?? virtual;

const printerChanged = signal();
/** Called whenever the printer, its state or the choice of it changes. */
export const onPrinterChange = printerChanged.on;

/** The printer side of a bug report: what's selected, connected and last heard, right now. */
export const printerInfo = () => {
	const real = hardware();
	const t = connection();
	return {
		target: settings.target,
		model: currentPrinter(),
		deviceName: real?.connected ? real.name : null,
		status: t.connected ? { ...t.status } : null,
		messages: [...t.messages],
		settings: { ...settings },
	};
};

/** Closing the device picker is a choice, not a failure; anything else is said. */
export const reportPrintError = (err) => {
	if (err?.name === "NotFoundError" && /cancelled|canceled/i.test(err.message)) return;
	console.error(err);
	toast(`Print failed: ${err.message ?? err}`, { error: true });
};

export const renderPrinterStatus = () => {
	const real = hardware();
	const t = connection();
	$("#target").value = settings.target;
	$("#setPrinter").value = $("#virtualModel").value = currentPrinter().id;
	// The virtual printer's model is picked next to it; a real one names itself, so its model
	// is only an override, under Advanced.
	$("#virtualModelRow").hidden = !!real;
	$("#setPrinterRow").hidden = !real;
	renderFeed();
	$("#btnConnect").hidden = !real || real.connected;
	const s = $("#printerStatus");
	const base = real ? (real.connected ? `Connected to ${real.name}` : "Not connected") : "";
	// A virtual printer's battery is make-believe; only its simulated problems are worth showing.
	const detail = t.connected ? describeStatus(t.status, { battery: !!real }) : "";
	s.textContent = [base, detail].filter(Boolean).join(" · ");
	s.title = t.status.firmware ? `Firmware ${t.status.firmware}` : "";
	s.classList.toggle("ok", !!real && t.connected && !hasProblem(t.status));
	s.classList.toggle("problem", t.connected && hasProblem(t.status));
	renderChip(real, t);
	renderAutoPower(t);
	$("#virtualOut").hidden = !$("#tape").children.length;
	printerChanged.emit();
};

/**
 * The printer chip in the header: which printer, and the one thing worth knowing about it
 * (a problem, or a real one's battery), so the menu only needs opening to change something.
 */
const renderChip = (real, t) => {
	const chip = $("#printerChip");
	const problem = t.connected && hasProblem(t.status);
	const battery = typeof t.status.battery === "number" ? `${t.status.battery}%` : "";
	// What's connected; what the browser can't connect to is in the menu it opens.
	const name = !real ? "Virtual printer" : real.connected ? real.name : "Not connected";
	const detail = problem
		? describeStatus(t.status, { battery: false })
		: real?.connected
			? battery
			: "";
	const text = [name, detail].filter(Boolean).join(" · ");
	$("#printerChipLabel").textContent = text;
	// On a phone the chip is just its dot, so its name says the rest.
	chip.setAttribute("aria-label", `Printer: ${text}`);
	chip.classList.toggle("ok", !!real?.connected && !problem);
	chip.classList.toggle("problem", problem);
};

const powerLabel = (m) =>
	m === 0 ? "never" : m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? "" : "s"}`;
/**
 * The auto power-off choices this model offers, showing what the printer last reported. The
 * setting lives in the printer, so until it says, there's nothing true to show or change.
 */
const renderAutoPower = (t) => {
	const setting = currentPrinter().driver.autoPowerOff;
	const select = $("#setAutoPower");
	$("#setAutoPowerRow").hidden = !setting;
	if (!setting || document.activeElement === select) return;
	const values = setting.minutes.map(String);
	if ([...select.options].map((o) => o.value).join() !== values.join()) {
		select.replaceChildren(...setting.minutes.map((m) => new Option(powerLabel(m), String(m))));
	}
	const minutes = t.connected ? t.status.autoPowerOff : undefined;
	const known = setting.minutes.includes(minutes);
	select.value = known ? String(minutes) : "";
	select.disabled = !known;
	$("#setAutoPowerHint").hidden = known;
};

const renderFeed = () => {
	const model = currentPrinter();
	$("#setFeed").value = String(settings.feedLines);
	$("#setFeedDefault").textContent = `${model.name} default: ${model.feedLines}`;
	$("#setFeedReset").hidden = settings.feedLines === model.feedLines;
};

/** A setting that's saved as it changes, read from its control by `read`. */
const bindSetting = (selector, key, read = (input) => input.value) => {
	$(selector).addEventListener("change", (ev) => {
		settings[key] = read(ev.target);
		saveSettings();
		renderPrinterStatus();
	});
};

const unsupported = (target, why) => {
	const option = $(`#target option[value="${target}"]`);
	option.disabled = true;
	option.textContent = why;
};
if (!bluetoothAvailable()) {
	$("#noBluetooth").hidden = false;
	unsupported("bluetooth", "Bluetooth (browser lacks support)");
}
if (!serialAvailable()) unsupported("serial", "Serial port (browser lacks support)");

const vendors = [...new Set(PRINTERS.map((p) => p.vendor))];
for (const select of [$("#setPrinter"), $("#virtualModel")]) {
	select.append(
		...vendors.map((vendor) => {
			const models = PRINTERS.filter((p) => p.vendor === vendor);
			const options = models.map(
				(p) => new Option(p.tested ? p.name : `${p.name} (untested)`, p.id),
			);
			return el("optgroup", { label: vendor }, ...options);
		}),
	);
	select.addEventListener("change", (ev) => {
		selectPrinter(printerById(ev.target.value));
		renderPrinterStatus();
	});
}

$("#setFlip").checked = settings.flip180;
$("#setAllDevices").checked = settings.showAllDevices;
$("#density").value = settings.density;
bindSetting("#target", "target");
bindSetting("#density", "density");
bindSetting("#setFlip", "flip180", (input) => input.checked);
bindSetting("#setAllDevices", "showAllDevices", (input) => input.checked);
$("#setFeed").addEventListener("change", (ev) => {
	const v = ev.target.valueAsNumber;
	if (validFeed(v)) {
		settings.feedLines = v;
		saveSettings();
	}
	renderFeed();
});
$("#setFeedReset").addEventListener("click", () => {
	settings.feedLines = currentPrinter().feedLines;
	saveSettings();
	renderFeed();
});
// A printer setting, not an app one: it's sent to the printer, which keeps it.
$("#setAutoPower").addEventListener("change", async (ev) => {
	const setting = currentPrinter().driver.autoPowerOff;
	if (!setting) return;
	const minutes = Number(ev.target.value);
	const t = connection();
	try {
		await t.send(setting.command(minutes));
		await t.refreshStatus();
		toast(`The printer will turn itself off after ${powerLabel(minutes)}.`);
	} catch (err) {
		reportPrintError(err);
	}
});
$("#btnForget").addEventListener("click", () => {
	hardware()?.forget();
	toast("Printer forgotten. The next print will ask you to pick one.");
});
$("#btnConnect").addEventListener("click", () =>
	hardware()?.connect({ showAllDevices: settings.showAllDevices }).catch(reportPrintError),
);
$("#btnClearVirtual").addEventListener("click", () => {
	$("#tape").replaceChildren();
	renderPrinterStatus();
});
renderPrinterStatus();
virtual.refreshStatus();

/** Test/console hook: put the virtual printer into a state ("out of paper", low battery…). */
export const simulateVirtual = (patch) => {
	Object.assign(virtual.simulate, patch);
	return virtual.refreshStatus();
};
