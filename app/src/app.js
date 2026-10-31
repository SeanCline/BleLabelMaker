// Entry point. Each ui/ module wires its own part of the page on import; this file only
// boots them in order and exposes a small handle for tests and the console.
import "./ui/errors.js";
import { installFontStylesheet, preloadFontList } from "./fonts.js";
import { clearRenderCache } from "./render.js";
import { state, notify, currentFile, undo, redo } from "./ui/store.js";
import { drawCanvas, scheduleCanvas } from "./ui/stage.js";
import { loadFile, sharedReady } from "./ui/files.js";
import { print } from "./ui/printing.js";
import { simulateVirtual } from "./ui/printer-menu.js";
import "./ui/keyboard.js";
import "./ui/clipboard.js";
import "./ui/labelbar.js";
import "./ui/layers.js";
import "./ui/new-label.js";
import "./ui/welcome.js";
import "./ui/text-insert.js";
import "./ui/quickbar.js";
import "./ui/menus.js";
import "./ui/qr-builder.js";
import { dropdowns } from "./ui/dropdown.js";
import "./ui/ruler.js";
import "./ui/report.js";
import { historyEntries, historyReady, historySaved } from "./ui/history-panel.js";

// Each module has filled its lists by now; they're all drawn by the page from here on.
dropdowns();
notify();

const ready = Promise.all([
	installFontStylesheet().then(() => {
		// Late-arriving font files (stylesheet loaded, binaries still downloading) trigger a redraw.
		document.fonts.addEventListener("loadingdone", () => {
			clearRenderCache();
			scheduleCanvas();
		});
		return drawCanvas();
	}),
	historyReady,
	sharedReady,
]);
// After the label is drawn, so the faces it uses come first.
ready.then(preloadFontList);

// Offline support. Skipped on file:// and in browsers without service workers; the app
// works the same online either way.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
	navigator.serviceWorker
		.register("sw.js")
		.catch((err) => console.warn("offline support unavailable:", err));
}

// Hooks for the e2e tests (browsers set navigator.webdriver under automation) and for poking
// at the app from the console with ?debug. Regular visits don't get them.
if (navigator.webdriver || new URLSearchParams(location.search).has("debug")) {
	window.labelApp = {
		ready,
		state,
		print,
		drawCanvas,
		undo,
		redo,
		serialize: currentFile,
		historyEntries,
		historySaved,
		simulateVirtual,
		loadText: (text, name = "test.label") => loadFile(new File([text], name)),
	};
}
