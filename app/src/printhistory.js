import { parse, serialize, LabelFileError } from "./fileformat.js";
import { STORAGE_ID, REPO_URL } from "./app-info.js";
import { plainText } from "./layout.js";

export const HISTORY_FORMAT = `${STORAGE_ID}-history`;
export const HISTORY_VERSION = 1;
export const HISTORY_LIMIT = 300;

/**
 * An entry is { id, firstPrintedAt, lastPrintedAt, prints, copies, target, file } where
 * `file` is a parsed .label document ({ format, version, label, elements, editor }).
 * Thumbnails are not stored: they are re-rendered from `file`, which keeps storage small
 * and means an imported history can't smuggle in arbitrary image data.
 */

/**
 * Same design → same key. Ids and editor state are ignored: two labels typed up separately
 * get different element ids but are the same label to the person printing them.
 */
export const designKey = (doc) =>
	JSON.stringify({ label: doc.label, elements: doc.elements.map(({ id, ...rest }) => rest) });

const toFile = (doc, editor) => JSON.parse(serialize(doc, { mode: editor.mode, selectedIds: [] }));

/**
 * Records a print. Reprinting an identical design bumps the existing entry to the top
 * instead of adding a duplicate, so history doubles as a "recent labels" list.
 */
export const recordPrint = (
	entries,
	{ doc, editor, copies, target },
	{ now = new Date(), limit = HISTORY_LIMIT } = {},
) => {
	const key = designKey(doc);
	const at = now.toISOString();
	const existing = entries.find((e) => designKey(e.file) === key);
	const rest = entries.filter((e) => e !== existing);
	const entry = existing
		? {
				...existing,
				lastPrintedAt: at,
				prints: existing.prints + 1,
				copies: existing.copies + copies,
				target,
			}
		: {
				id: `h${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
				firstPrintedAt: at,
				lastPrintedAt: at,
				prints: 1,
				copies,
				target,
				file: toFile(doc, editor),
			};
	return [entry, ...rest].slice(0, limit);
};

export const removeEntry = (entries, id) => entries.filter((e) => e.id !== id);

/** Loads an entry into the shape the editor's file loader expects. */
export const entryToState = (entry) => parse(JSON.stringify(entry.file));

export const exportHistory = (entries) =>
	JSON.stringify(
		{
			format: HISTORY_FORMAT,
			app: REPO_URL,
			version: HISTORY_VERSION,
			exportedAt: new Date().toISOString(),
			entries,
		},
		null,
		"\t",
	);

const isoOr = (v, fallback) =>
	typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : fallback;
const countOr = (v, fallback) => (Number.isInteger(v) && v > 0 ? v : fallback);

/** Validates one stored or imported entry; throws LabelFileError if its design is invalid. */
export const checkEntry = (raw, where = "entry") => {
	if (typeof raw !== "object" || raw === null)
		throw new LabelFileError(`${where} is not an object.`);
	let parsed;
	try {
		parsed = parse(JSON.stringify(raw.file));
	} catch (err) {
		throw new LabelFileError(`${where}: ${err.message}`);
	}
	const now = new Date().toISOString();
	const last = isoOr(raw.lastPrintedAt, now);
	return {
		id:
			typeof raw.id === "string" && raw.id ? raw.id : `h${Math.random().toString(36).slice(2, 10)}`,
		firstPrintedAt: isoOr(raw.firstPrintedAt, last),
		lastPrintedAt: last,
		prints: countOr(raw.prints, 1),
		copies: countOr(raw.copies, 1),
		target: ["bluetooth", "serial"].includes(raw.target) ? raw.target : "virtual",
		file: toFile(parsed.doc, parsed.editor),
	};
};

/** Reads what's in storage, dropping (not failing on) entries that no longer validate. */
export const loadStored = (raw) => {
	if (!Array.isArray(raw)) return [];
	const out = [];
	for (const e of raw) {
		try {
			out.push(checkEntry(e));
		} catch {
			// One bad entry (e.g. from a future version) shouldn't hide the rest of the history.
		}
	}
	// Newest first, however storage happened to order them.
	return out.sort((a, b) => b.lastPrintedAt.localeCompare(a.lastPrintedAt));
};

/**
 * Merges an exported history into the current one. Entries for the same design are combined
 * (counts added, earliest/latest dates kept); the result is sorted newest first.
 * @returns {{entries, added: number, merged: number}}
 */
export const importHistory = (text, current, { limit = HISTORY_LIMIT } = {}) => {
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new LabelFileError("This file isn't valid JSON.");
	}
	if (raw?.format !== HISTORY_FORMAT)
		throw new LabelFileError("This isn't a print history export.");
	if (!Number.isInteger(raw.version) || raw.version > HISTORY_VERSION) {
		throw new LabelFileError("This history was exported by a newer version of the app.");
	}
	if (!Array.isArray(raw.entries)) throw new LabelFileError("The history has no entries list.");
	const incoming = raw.entries.map((e, i) => checkEntry(e, `Entry ${i + 1}`));

	const byKey = new Map(current.map((e) => [designKey(e.file), e]));
	let added = 0;
	let merged = 0;
	for (const e of incoming) {
		const key = designKey(e.file);
		const mine = byKey.get(key);
		if (!mine) {
			byKey.set(key, e);
			added++;
			continue;
		}
		merged++;
		byKey.set(key, {
			...mine,
			prints: mine.prints + e.prints,
			copies: mine.copies + e.copies,
			firstPrintedAt:
				mine.firstPrintedAt < e.firstPrintedAt ? mine.firstPrintedAt : e.firstPrintedAt,
			lastPrintedAt: mine.lastPrintedAt > e.lastPrintedAt ? mine.lastPrintedAt : e.lastPrintedAt,
		});
	}
	const entries = [...byKey.values()]
		.sort((a, b) => b.lastPrintedAt.localeCompare(a.lastPrintedAt))
		.slice(0, limit);
	return { entries, added, merged };
};

/** Plain-text search over an entry's text (emoji included). */
export const matches = (entry, query) => {
	// Typed or pasted emoji may carry a presentation selector that stored text never has.
	const q = plainText(query).trim().toLowerCase();
	if (!q) return true;
	return entry.file.elements.some((e) =>
		plainText(e.text ?? e.data ?? "")
			.toLowerCase()
			.includes(q),
	);
};

export const entryTitle = (entry) => {
	const text = entry.file.elements.find((e) => e.type === "text" && e.text.trim());
	return text ? text.text.trim().split("\n")[0] : "(empty label)";
};
