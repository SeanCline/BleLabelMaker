// A thin wrapper over IndexedDB for the print history, which carries whole labels (images
// included) and outgrows localStorage's ~5 MB long before IndexedDB's quota, a share of the
// free disk. Each entry is its own record, so a print writes one entry rather than the
// whole history: quicker, and nothing is lost if the tab closes right after printing.
// An autosave too big for localStorage goes here too, in a database of its own.
import { STORAGE_ID, storageKey } from "../app-info.js";

const DB = STORAGE_ID;
export const HISTORY = "history";

// Its own database rather than a store in the history's: adding a store means a new version,
// which a tab still open on the old one blocks until it closes.
const VALUES_DB = storageKey("values");
const VALUES = "values";

/** @type {Map<string, Promise<IDBDatabase>>} */
const opened = new Map();
/**
 * @param {string} name
 * @param {(db: IDBDatabase) => void} create
 * @returns {Promise<IDBDatabase>}
 */
const open = (name, create) => {
	if (!opened.has(name)) {
		const db = new Promise((resolve, reject) => {
			const req = indexedDB.open(name, 1);
			req.onupgradeneeded = () => create(req.result);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
		// A failed open is tried again next time, not remembered.
		db.catch(() => opened.delete(name));
		opened.set(name, db);
	}
	return /** @type {Promise<IDBDatabase>} */ (opened.get(name));
};

/** @type {Record<string, [string, (db: IDBDatabase) => void]>} */
const DATABASES = {
	[HISTORY]: [DB, (db) => db.createObjectStore(HISTORY, { keyPath: "id" })],
	[VALUES]: [VALUES_DB, (db) => db.createObjectStore(VALUES)],
};

const transact = async (store, mode, fn) => {
	const db = await open(...DATABASES[store]);
	return new Promise((resolve, reject) => {
		const tx = db.transaction(store, mode);
		const result = fn(tx.objectStore(store));
		tx.oncomplete = () => resolve(result?.result);
		tx.onerror = tx.onabort = () => reject(tx.error);
	});
};

/** @returns {Promise<any[]>} every record in the store */
export const idbAll = (store) => transact(store, "readonly", (s) => s.getAll());

/**
 * Applies several changes in one transaction: all of them land, or none do.
 * @param {string} store
 * @param {{put?: object[], remove?: string[]}} changes
 */
export const idbWrite = (store, { put = [], remove = [] }) =>
	transact(store, "readwrite", (s) => {
		for (const id of remove) s.delete(id);
		for (const record of put) s.put(record);
	});

let askedToKeep = false;
/**
 * Asks the browser not to clear the history and autosave when disk space runs low. Asked once
 * there's something worth keeping (a print or a save), not on a first visit. Chrome and Edge
 * decide quietly from how much the site is used; Firefox asks the user.
 */
export const keepStorage = async () => {
	if (askedToKeep || !navigator.storage?.persist) return;
	askedToKeep = true;
	try {
		if (!(await navigator.storage.persisted())) await navigator.storage.persist();
	} catch (err) {
		console.warn("couldn't ask to keep storage:", err);
	}
};

/** @returns {Promise<any>} what's kept under `key`, or undefined */
export const idbGet = (key) => transact(VALUES, "readonly", (s) => s.get(key));
/** Resolves once it's stored, not just asked for. */
export const idbPut = (key, value) => transact(VALUES, "readwrite", (s) => s.put(value, key));
export const idbDelete = (key) => transact(VALUES, "readwrite", (s) => s.delete(key));
