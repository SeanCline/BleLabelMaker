// The app's printing settings, kept in local storage: which printer and how to reach it, and
// how it prints. Everything that depends on the printer model (label sizes, the resolution a
// label is drawn at) asks here, so nothing needs the print code to know what's selected.
import { DEFAULT_PRINTER, printerById } from "../printers/index.js";
import { bluetoothAvailable, serialAvailable } from "../transport.js";
import { dotScale } from "../units.js";
import { loadJson, storeJson } from "./dom.js";
import { storageKey } from "../app-info.js";
import { signal } from "./signal.js";

const KEY = storageKey("settings");
const DENSITIES = ["light", "normal", "dark"];
export const validFeed = (v) => Number.isInteger(v) && v >= 0 && v <= 255;

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
	...loadJson(KEY),
};
// What was saved may not suit this browser, or may come from an older version.
if (settings.target === "bluetooth" && !bluetoothAvailable()) settings.target = "virtual";
if (settings.target === "serial" && !serialAvailable()) settings.target = "virtual";
if (!DENSITIES.includes(settings.density)) settings.density = "normal";
if (!validFeed(settings.feedLines)) settings.feedLines = printerById(settings.printer).feedLines;

export const saveSettings = () => storeJson(KEY, settings);

const modelChanged = signal();
/** Called when the model being printed for changes. */
export const onModelChange = modelChanged.on;

/** The model being printed for: its label sizes, head, resolution and commands. */
export const currentPrinter = () => printerById(settings.printer);

/** Millimetres and points to dots, at the selected model's resolution. */
export const currentScale = () => dotScale(currentPrinter().dotsPerMm);

/** Switches model, taking its defaults. */
export const selectPrinter = (model) => {
	if (model.id === settings.printer) return;
	settings.printer = model.id;
	settings.feedLines = model.feedLines;
	saveSettings();
	modelChanged.emit(model);
};
