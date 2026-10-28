import { LIMITS } from "../model.js";
import { parse, FILE_EXTENSION, TOO_LARGE } from "../fileformat.js";
import { encodeShare, decodeShare } from "../share.js";
import { $, toast, download } from "./dom.js";
import { state, loadState, currentFile } from "./store.js";
import { addImageFile } from "./actions.js";
import { keepStorage } from "./idb.js";
import { textOf } from "../richtext.js";

export const slugFor = (doc) => {
	const text = doc.elements.find((e) => e.type === "text")?.text ?? "";
	const first = textOf(text).split("\n")[0];
	return (
		first
			.normalize("NFKD")
			.replace(/[^\w\s-]/g, "")
			.trim()
			.replace(/\s+/g, "-")
			.toLowerCase()
			.slice(0, 40) || "label"
	);
};

export const save = () => {
	const name = slugFor(state.doc) + FILE_EXTENSION;
	download(name, currentFile());
	toast(`Saved ${name}`);
	keepStorage();
};

export const loadFile = async (file) => {
	try {
		// Before reading: a multi-gigabyte file would exhaust memory just becoming a string.
		if (file.size > LIMITS.fileChars * 4) throw new Error(TOO_LARGE);
		loadState(parse(await file.text()));
		toast(`Opened ${file.name}`);
	} catch (err) {
		// The current label is untouched: parse() throws before any state changes.
		toast(`Couldn't open ${file.name}: ${err.message}`, { error: true });
	}
};

export const openPicker = () => $("#fileInput").click();

// Past this, some chat apps and mail clients cut links off. Pictures are what make them long.
const LONG_LINK = 8000;

/** Copies a link that opens this label, design and all. */
export const shareLink = async () => {
	const url = location.origin + location.pathname + (await encodeShare(currentFile()));
	const note =
		url.length > LONG_LINK
			? ` It's long (${url.length.toLocaleString()} characters), mostly the picture, so some apps may cut it off; sending the .label file is safer.`
			: "";
	try {
		await navigator.clipboard.writeText(url);
		toast(`Link copied. Anyone who opens it gets this label.${note}`);
	} catch {
		// Clipboard access can be refused; the link is still worth having.
		prompt(`Copy this link.${note}`, url);
	}
};

/** Opens the label in a shared link, if the page was opened with one. */
const openShared = async () => {
	let text;
	try {
		text = await decodeShare(location.hash);
		if (text === null) return;
		loadState(parse(text));
		toast("Opened a shared label. Undo (Ctrl+Z) brings back what you had.");
	} catch (err) {
		toast(err.message, { error: true });
	}
	// So a reload doesn't open it again over later edits.
	window.history.replaceState(null, "", location.pathname + location.search);
};
export const sharedReady = openShared();
addEventListener("hashchange", openShared);

$("#btnSave").addEventListener("click", save);
$("#btnShare").addEventListener("click", shareLink);
$("#btnOpen").addEventListener("click", openPicker);
$("#fileInput").addEventListener("change", (ev) => {
	const f = ev.target.files[0];
	ev.target.value = ""; // so re-opening the same file still fires change
	if (f) loadFile(f);
});
document.addEventListener("dragover", (ev) => ev.preventDefault());
document.addEventListener("drop", (ev) => {
	ev.preventDefault();
	const f = ev.dataTransfer?.files?.[0];
	if (!f) return;
	// Pictures dropped on the page become image elements; anything else is treated as a .label.
	if (f.type.startsWith("image/")) addImageFile(f);
	else loadFile(f);
});
