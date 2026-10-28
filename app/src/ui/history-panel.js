import {
	recordPrint,
	removeEntry,
	exportHistory,
	importHistory,
	loadStored,
	entryToState,
	matches,
	entryTitle,
} from "../printhistory.js";
import { renderLabel } from "../render.js";
import { currentScale } from "./settings.js";
import { ensureFontsFor } from "../fonts.js";
import { $, el, toast, download } from "./dom.js";
import { idbAll, idbWrite, keepStorage, HISTORY } from "./idb.js";
import { state, loadState } from "./store.js";
import { onPrinted, print } from "./printing.js";

let entries = [];
let storable = true;

/** Resolves once the stored history has been read; prints before then wait for it. */
export const historyReady = idbAll(HISTORY)
	.then((stored) => {
		entries = loadStored(stored);
	})
	.catch((err) => {
		// E.g. storage turned off for this site. History still works until the tab closes.
		storable = false;
		console.warn("print history can't be stored:", err);
	});

let writing = Promise.resolve();
/** Resolves when every change so far has reached storage (for tests). */
export const historySaved = () => writing;

/**
 * Replaces the history and stores only what changed: entries are immutable, so a new or
 * updated one is a new object. Writes are chained, so they land in order. If storage is
 * full, the oldest entries go rather than the new print.
 */
const setEntries = (next) => {
	const before = entries;
	entries = next;
	if (!storable) return;
	const put = next.filter((e) => !before.includes(e));
	const kept = new Set(next.map((e) => e.id));
	const remove = before.filter((e) => !kept.has(e.id)).map((e) => e.id);
	writing = writing
		.then(async () => {
			for (let changes = { put, remove }; ;) {
				try {
					return await idbWrite(HISTORY, changes);
				} catch (err) {
					if (err?.name !== "QuotaExceededError" || entries.length <= 1) throw err;
					const trimmed = entries.slice(0, Math.ceil(entries.length * 0.8));
					const dropped = entries.filter((e) => !trimmed.includes(e)).map((e) => e.id);
					entries = trimmed;
					changes = {
						put: changes.put.filter((e) => trimmed.includes(e)),
						remove: [...changes.remove, ...dropped],
					};
					toast(
						`Storage is full, so the oldest history entries were removed (keeping ${entries.length}).`,
						{ error: true },
					);
				}
			}
		})
		.catch((err) => toast(`Couldn't save the print history: ${err.message}`, { error: true }));
};

onPrinted(async ({ copies, target }) => {
	// Captured now: by the time the stored history has loaded, the design may have changed.
	const print = { doc: state.doc, copies, target };
	await historyReady;
	setEntries(recordPrint(entries, print));
	keepStorage();
	if (dialog.open) renderList();
});

// ---------------------------------------------------------------------------
// Dialog

const dialog = $("#historyDialog");
const list = $("#historyList");

const relativeTime = (iso) => {
	const s = (Date.now() - Date.parse(iso)) / 1000;
	const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
	if (s < 60) return "just now";
	if (s < 3600) return fmt.format(-Math.round(s / 60), "minute");
	if (s < 86400) return fmt.format(-Math.round(s / 3600), "hour");
	if (s < 86400 * 30) return fmt.format(-Math.round(s / 86400), "day");
	return new Date(iso).toLocaleDateString();
};

// Thumbnails render one at a time after the list is on screen, so opening a long history
// is instant and each preview pops in as it's drawn.
let thumbToken = 0;
const renderThumbs = async (jobs) => {
	const token = ++thumbToken;
	for (const [canvas, entry] of jobs) {
		const { doc } = entryToState(entry);
		await ensureFontsFor(doc);
		if (token !== thumbToken) return;
		await renderLabel(doc, canvas, { dots: currentScale() });
	}
};

const renderList = () => {
	const q = $("#historySearch").value;
	const shown = entries.filter((e) => matches(e, q));
	const jobs = [];
	list.replaceChildren(
		...shown.map((entry) => {
			const thumb = el("canvas", { className: "thumb" });
			jobs.push([thumb, entry]);
			const { widthMm, heightMm } = entry.file.label;
			const copies = entry.copies === 1 ? "1 copy" : `${entry.copies} copies`;
			const times = entry.prints === 1 ? "" : ` over ${entry.prints} prints`;
			return el(
				"li",
				{ dataset: { id: entry.id } },
				el(
					"button",
					{ className: "thumb-btn", title: "Open in editor", dataset: { action: "open" } },
					thumb,
				),
				el(
					"div",
					{ className: "entry-meta" },
					el("strong", {}, entryTitle(entry)),
					el(
						"span",
						{ className: "hint" },
						`${widthMm}×${heightMm} mm · ${copies}${times} · ${relativeTime(entry.lastPrintedAt)}`,
						entry.target === "virtual" ? el("span", { className: "tag" }, "virtual") : "",
					),
				),
				el(
					"div",
					{ className: "entry-actions" },
					el("button", { dataset: { action: "open" } }, "Open"),
					el(
						"button",
						{
							dataset: { action: "print" },
							title: "Open and print with the current copies setting",
						},
						"Print again",
					),
					el(
						"button",
						{
							dataset: { action: "delete" },
							title: "Remove from history",
							"aria-label": "Remove from history",
						},
						"✕",
					),
				),
			);
		}),
	);
	$("#historyEmpty").hidden = shown.length > 0;
	$("#historyEmpty").textContent = entries.length
		? "Nothing matches that search."
		: "Nothing printed yet. Every label you print shows up here, so you can reprint it in two clicks.";
	$("#historyCount").textContent = entries.length
		? `${entries.length} label${entries.length === 1 ? "" : "s"}`
		: "";
	$("#btnHistoryExport").disabled = !entries.length;
	$("#btnHistoryClear").disabled = !entries.length;
	renderThumbs(jobs);
};

const openEntry = (entry) => {
	loadState(entryToState(entry));
	dialog.close();
};

list.addEventListener("click", (ev) => {
	const action = ev.target.closest("[data-action]")?.dataset.action;
	const id = ev.target.closest("li")?.dataset.id;
	const entry = entries.find((e) => e.id === id);
	if (!action || !entry) return;
	if (action === "open") {
		openEntry(entry);
		toast(`Opened “${entryTitle(entry)}”. Undo (Ctrl+Z) brings back what you had.`);
	} else if (action === "print") {
		openEntry(entry);
		print();
	} else if (action === "delete") {
		setEntries(removeEntry(entries, id));
		renderList();
	}
});

$("#btnHistory").addEventListener("click", () => {
	$("#historySearch").value = "";
	renderList();
	dialog.showModal();
	$("#historySearch").focus();
});
$("#historySearch").addEventListener("input", renderList);

$("#btnHistoryExport").addEventListener("click", () => {
	download(`label-history-${new Date().toISOString().slice(0, 10)}.json`, exportHistory(entries));
});
$("#btnHistoryImport").addEventListener("click", () => $("#historyFile").click());
$("#historyFile").addEventListener("change", async (ev) => {
	const file = ev.target.files[0];
	ev.target.value = "";
	if (!file) return;
	try {
		const result = importHistory(await file.text(), entries);
		setEntries(result.entries);
		renderList();
		toast(
			`Imported ${result.added} new label${result.added === 1 ? "" : "s"}${result.merged ? `, merged ${result.merged} already here` : ""}.`,
		);
	} catch (err) {
		toast(`Couldn't import ${file.name}: ${err.message}`, { error: true });
	}
});
$("#btnHistoryClear").addEventListener("click", () => {
	if (
		!confirm(
			`Remove all ${entries.length} labels from the print history? Export first if you want a backup.`,
		)
	)
		return;
	setEntries([]);
	renderList();
});

/** For tests and the console. */
export const historyEntries = () => entries;
