import { planLabels, buildJobs, sentPart } from "../printjob.js";
import { DEFAULT_PRINTER, printerById, PRINTERS } from "../printers/index.js";
import { renderLabel, withAutoLength } from "../render.js";
import { ensureFontsFor } from "../fonts.js";
import { fieldsUsed } from "../fields.js";
import {
	SendError,
	BluetoothPrinter,
	SerialPrinter,
	VirtualPrinter,
	bluetoothAvailable,
	serialAvailable,
} from "../transport.js";
import { clamp } from "../units.js";
import { $, el, loadJson, storeJson, toast } from "./dom.js";
import { showVirtualOutput } from "./virtual-output.js";
import { setFieldContext } from "./stage.js";
import { state, subscribe } from "./store.js";
import { batchData, previewRow, onBatchChange } from "./batch.js";
import { storageKey } from "../app-info.js";

const SETTINGS_KEY = storageKey("settings");

export const settings = {
	// A real printer is what most visitors came for; the virtual one is the fallback where the
	// browser can't reach one, and stays a choice for trying the app out.
	target: bluetoothAvailable() ? "bluetooth" : "virtual",
	flip180: false,
	// Which model to print for; picked up from the Bluetooth name when one connects.
	printer: DEFAULT_PRINTER.id,
	// Dot lines fed after a continuous label. Starts at the model's value and goes back to it
	// whenever the model changes, so it is only ever a deliberate override of that model.
	feedLines: DEFAULT_PRINTER.feedLines,
	showAllDevices: false,
	density: "normal",
	// The next value {n} prints; it moves on after every print so serials don't repeat.
	counterStart: 1,
	...loadJson(SETTINGS_KEY),
};
if (settings.target === "bluetooth" && !bluetoothAvailable()) settings.target = "virtual";
if (settings.target === "serial" && !serialAvailable()) settings.target = "virtual";
const saveSettings = () => storeJson(SETTINGS_KEY, settings);
/** Switches model, taking its defaults. */
const selectPrinter = (model) => {
	settings.printer = model.id;
	settings.feedLines = model.feedLines;
	saveSettings();
	for (const c of [bt, serial, virtual]) c.model = model;
};

let busy = false;
/** Tells the user about problems the moment the printer reports them, not just on print. */
const onPrinterStatus = (status, event) => {
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
const virtual = new VirtualPrinter({ onPrinterStatus });
const serial = new SerialPrinter({ onPrinterStatus });
serial.onStatus = recognise(serial);
for (const c of [bt, serial, virtual]) c.model = printerById(settings.printer);
/** The real printer for the chosen target, or null for the virtual one. */
const hardware = () => ({ bluetooth: bt, serial })[settings.target] ?? null;
const transport = () => hardware() ?? virtual;
const printListeners = new Set();
const printerListeners = new Set();

/** Called whenever the connected printer (or the choice of printer) changes. */
export const onPrinterChange = (fn) => printerListeners.add(fn);
/** The model being printed for: its label sizes, head and commands. */
export const currentPrinter = () => printerById(settings.printer);

/** The printer side of a bug report: what's selected, connected and last heard, right now. */
export const printerInfo = () => {
	const real = hardware();
	const t = transport();
	return {
		target: settings.target,
		model: currentPrinter(),
		deviceName: real?.connected ? real.name : null,
		status: t.connected ? { ...t.status } : null,
		messages: [...t.messages],
		settings: { ...settings },
	};
};

/** Called after every successful print with { doc, copies, target, bitmap }. */
export const onPrinted = (fn) => printListeners.add(fn);

/**
 * What's worth knowing about the printer: problems ("cover open · out of labels") and, for a
 * real one, its battery. Loaded labels are the normal case, so they go unmentioned.
 */
export const describeStatus = (st, { battery = true } = {}) => {
	const parts = [];
	if (st.coverOpen) parts.push("cover open");
	if (st.paper === false) parts.push("out of labels");
	if (battery && typeof st.battery === "number")
		parts.push(`battery ${st.battery}%${st.charging ? " (charging)" : ""}`);
	return parts.join(" · ");
};
const hasProblem = (st) => st.coverOpen === true || st.paper === false;

const renderPrinterStatus = () => {
	const real = hardware();
	const t = transport();
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
	$("#btnPrint").disabled = busy;
	renderPrintButton();
	// Show what the printer reports; until it says, the choice reads "as set on the printer".
	renderAutoPower(t);
	$("#virtualOut").hidden = !$("#tape").children.length;
	for (const fn of printerListeners) fn();
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

const reportPrintError = (err) => {
	// Closing the device picker is a choice, not a failure.
	if (err?.name === "NotFoundError" && /cancelled|canceled/i.test(err.message)) return;
	console.error(err);
	toast(`Print failed: ${err.message ?? err}`, { error: true });
};

/**
 * The pixels for one label, rendered off-screen the same way the preview is. With auto length,
 * each label is as long as its own text, so batch rows can differ.
 */
const renderForPrint = async (doc) => {
	await ensureFontsFor(doc);
	const canvas = document.createElement("canvas");
	await renderLabel(withAutoLength(doc), canvas);
	return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
};

const currentCopies = () => clamp(Math.round(Number($("#copies").valueAsNumber) || 1), 1, 99);

/** Prints the current design: each batch row, each copy, with its fields filled in. */
export const print = async ({ copies = currentCopies() } = {}) => {
	if (busy) return false;
	copies = clamp(Math.round(copies), 1, 99);
	$("#copies").value = copies;
	const plan = planLabels(state.doc, {
		copies,
		batch: batchData(),
		counterStart: settings.counterStart,
		now: new Date(),
	});
	// A long batch uses a lot of labels; make sure it's meant.
	if (plan.total > 20 && !confirm(`Print ${plan.total} labels?`)) return false;
	const t = transport();
	busy = true;
	renderPrinterStatus();
	const progress = $("#progress");
	try {
		// Ask for the device first: the picker needs the click's user activation, which awaiting
		// fonts and rendering could use up.
		if (!t.connected) await t.connect({ showAllDevices: settings.showAllDevices });
		// The status mapping is reverse-engineered, so a reported problem asks rather than blocks.
		if (
			hasProblem(t.status) &&
			!confirm(`The printer reports: ${describeStatus(t.status)}. Print anyway?`)
		)
			return false;
		const {
			bytes: job,
			firstImage: image,
			ends,
		} = await buildJobs(plan, {
			render: renderForPrint,
			printer: currentPrinter(),
			paper: state.doc.label.continuous ? "continuous" : "gaps",
			density: currentPrinter().driver.densities[settings.density],
			flip180: settings.flip180,
			feedLines: settings.feedLines,
		});
		progress.hidden = false;
		const onProgress = (done, total) => (progress.value = done / total);
		if (t === virtual) {
			const result = await virtual.send(job, onProgress);
			// A virtual printer told to be out of paper prints nothing, like the real one.
			if (!result.labels.length) throw new Error(`the printer reports ${describeStatus(t.status)}`);
			showVirtualOutput(result, plan.total, settings, currentPrinter());
		} else {
			try {
				await t.send(job, onProgress);
			} catch (err) {
				if (!(err instanceof SendError)) throw err;
				const part = sentPart(plan, ends, err.sent, settings.counterStart);
				// The labels that did go out are printed: keep their serials used and their history.
				if (part.labels) finishPrint(part.labels, part.nextCounter, image);
				reportBrokenSend(err, part, plan.total);
				return false;
			}
			toast(`Sent ${plan.total} label${plan.total === 1 ? "" : "s"} to ${t.name}`);
			t.refreshStatus();
		}
		finishPrint(plan.total, plan.nextCounter, image);
		return true;
	} catch (err) {
		reportPrintError(err);
		return false;
	} finally {
		busy = false;
		progress.hidden = true;
		progress.value = 0;
		renderPrinterStatus();
	}
};

/** After labels went out: the counter moves past the values they used, and listeners hear. */
const finishPrint = (copies, nextCounter, image) => {
	if (nextCounter !== settings.counterStart) {
		settings.counterStart = nextCounter;
		saveSettings();
		renderPrintBar();
		refreshPreview();
	}
	for (const fn of printListeners) fn({ copies, target: settings.target, image });
};

/** Says how far a print got before the connection broke, and what's left to print. */
const reportBrokenSend = (err, part, total) => {
	console.error(err);
	const of = `${part.labels} of ${total} label${total === 1 ? "" : "s"}`;
	const rest =
		part.firstUnsentRow !== null
			? ` Rows from ${part.firstUnsentRow + 1} on weren't sent.`
			: part.labels
				? " Print again for the rest."
				: "";
	toast(`The connection to the printer broke off after ${of} (${err.message}).${rest}`, {
		error: true,
	});
};

/** The print button says how many labels a batch will make; the counter shows when used. */
const renderPrintBar = () => {
	const used = fieldsUsed(state.doc);
	$("#counterRow").hidden = !used.counter;
	if (document.activeElement !== $("#counterStart")) {
		$("#counterStart").value = String(settings.counterStart);
	}
	renderPrintButton();
	$("#batchUnused").hidden = !batchData() || used.columns;
};

/**
 * The print button says what a click will do: how many labels a batch makes, and for a real
 * printer, whether it connects first. Which printer it is, the chip beside it says.
 */
const renderPrintButton = () => {
	const batch = batchData();
	const total = (batch?.rows.length ?? 1) * currentCopies();
	const what = batch ? `${total} labels` : "";
	const real = hardware();
	const button = $("#btnPrint .print-label");
	if (!real) button.textContent = ["Print", what].filter(Boolean).join(" ");
	else if (!real.connected)
		button.textContent = ["Connect & Print", what].filter(Boolean).join(" ");
	else button.textContent = ["Print", what].filter(Boolean).join(" ");
};

// The preview shows the batch row being looked at and the next counter value.
const refreshPreview = () =>
	setFieldContext(() => {
		const batch = batchData();
		return {
			now: new Date(),
			n: settings.counterStart,
			row: batch ? batch.rows[previewRow()] : null,
			columns: batch?.columns ?? null,
		};
	});
refreshPreview();
onBatchChange(() => {
	refreshPreview();
	renderPrintBar();
});
subscribe(renderPrintBar);

const powerLabel = (m) =>
	m === 0 ? "never" : m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? "" : "s"}`;
/** The auto power-off choices this model offers, showing what the printer last reported. */
const renderAutoPower = (t) => {
	const setting = currentPrinter().driver.autoPowerOff;
	const select = $("#setAutoPower");
	$("#setAutoPowerRow").hidden = !setting;
	if (!setting || document.activeElement === select) return;
	const values = setting.minutes.map(String);
	const shown = [...select.options].slice(1).map((o) => o.value);
	if (shown.join() !== values.join()) {
		select.replaceChildren(
			select.options[0],
			...setting.minutes.map((m) => new Option(powerLabel(m), String(m))),
		);
	}
	const minutes = t.connected ? t.status.autoPowerOff : undefined;
	select.value = setting.minutes.includes(minutes) ? String(minutes) : "";
};

const validFeed = (v) => Number.isInteger(v) && v >= 0 && v <= 255;
const renderFeed = () => {
	const model = currentPrinter();
	$("#setFeed").value = String(settings.feedLines);
	$("#setFeedDefault").textContent = `${model.name} default: ${model.feedLines}`;
	$("#setFeedReset").hidden = settings.feedLines === model.feedLines;
};

const initSettings = () => {
	if (!bluetoothAvailable()) {
		$("#noBluetooth").hidden = false;
		const option = $('#target option[value="bluetooth"]');
		option.disabled = true;
		option.textContent = "Bluetooth (browser lacks support)";
	}
	if (!serialAvailable()) {
		const option = $('#target option[value="serial"]');
		option.disabled = true;
		option.textContent = "Serial port (browser lacks support)";
	}
	$("#setFlip").checked = settings.flip180;
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
	if (!validFeed(settings.feedLines)) settings.feedLines = currentPrinter().feedLines;
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
	$("#setAllDevices").checked = settings.showAllDevices;
	// A printer setting, not an app one: it's sent to the printer, which keeps it.
	$("#setAutoPower").addEventListener("change", async (ev) => {
		const setting = currentPrinter().driver.autoPowerOff;
		if (ev.target.value === "" || !setting) return;
		const minutes = Number(ev.target.value);
		const t = transport();
		try {
			await t.send(setting.command(minutes));
			await t.refreshStatus();
			toast(`The printer will turn itself off after ${powerLabel(minutes)}.`);
		} catch (err) {
			reportPrintError(err);
		}
	});
	if (!["light", "normal", "dark"].includes(settings.density)) settings.density = "normal";
	$("#density").value = settings.density;
	$("#density").addEventListener("change", (ev) => {
		settings.density = ev.target.value;
		saveSettings();
	});
	$("#target").addEventListener("change", (ev) => {
		settings.target = ev.target.value;
		saveSettings();
		renderPrinterStatus();
	});
	$("#setFlip").addEventListener("change", (ev) => {
		settings.flip180 = ev.target.checked;
		saveSettings();
	});
	$("#setAllDevices").addEventListener("change", (ev) => {
		settings.showAllDevices = ev.target.checked;
		saveSettings();
	});
	$("#btnForget").addEventListener("click", () => {
		hardware()?.forget();
		toast("Printer forgotten. The next print will ask you to pick one.");
	});
	$("#btnConnect").addEventListener("click", () =>
		hardware()?.connect({ showAllDevices: settings.showAllDevices }).catch(reportPrintError),
	);
	$("#btnPrint").addEventListener("click", () => print());
	$("#copies").addEventListener("input", renderPrintBar);
	$("#counterStart").addEventListener("input", (ev) => {
		const v = ev.target.valueAsNumber;
		if (!Number.isInteger(v) || v < 0) return;
		settings.counterStart = v;
		saveSettings();
		refreshPreview();
	});
	$("#btnClearVirtual").addEventListener("click", () => {
		$("#tape").replaceChildren();
		renderPrinterStatus();
	});
	renderPrinterStatus();
	renderPrintBar();
	virtual.refreshStatus();
};
initSettings();

/** Test/console hook: put the virtual printer into a state ("out of paper", low battery…). */
export const simulateVirtual = (patch) => {
	Object.assign(virtual.simulate, patch);
	return virtual.refreshStatus();
};
