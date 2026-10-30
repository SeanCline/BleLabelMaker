// A thin wrapper over IndexedDB for the print history, which carries whole labels (images
// included) and outgrows localStorage's ~5 MB long before IndexedDB's quota, a share of the
// free disk. Each entry is its own record, so a print writes one entry rather than the
// whole history: quicker, and nothing is lost if the tab closes right after printing.
import { STORAGE_ID } from "../app-info.js";

const DB = STORAGE_ID;
export const HISTORY = "history";

let dbPromise;
const open = () =>
	(dbPromise ??= new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(HISTORY, { keyPath: "id" });
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	}));

const transact = async (store, mode, fn) => {
	const db = await open();
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
