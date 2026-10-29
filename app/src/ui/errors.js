// Errors nothing else caught. Without this, an exception in a click handler only reaches the
// console and the button just seems to do nothing.
import { toast } from "./dom.js";

// Harmless browser noise that arrives as an error event.
const IGNORED = /ResizeObserver loop/;
// A failure inside a redraw would otherwise toast once a frame.
const QUIET_MS = 2000;
let lastShown = 0;

/** Tells the user something failed. The label itself is safe: it autosaves on every change. */
const reportUnexpected = (err) => {
	const message = err?.message ?? String(err ?? "unknown error");
	if (IGNORED.test(message)) return;
	const now = Date.now();
	if (now - lastShown < QUIET_MS) return;
	lastShown = now;
	toast(
		`Something went wrong: ${message}. Your label is saved; reload the page if the app misbehaves.`,
		{ error: true },
	);
};

addEventListener("error", (ev) => reportUnexpected(ev.error ?? ev.message));
addEventListener("unhandledrejection", (ev) => reportUnexpected(ev.reason));
