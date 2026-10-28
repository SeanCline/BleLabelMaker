// Copy, cut and paste of elements. These use the browser's clipboard events rather than
// keydown: the events can read and write the system clipboard without a permission prompt,
// which is what lets elements travel to another label, tab or window.
import { parseBatch } from "../batch.js";
import { serializeElements, parseElements } from "../fileformat.js";
import { isFormatted, parseHtml, spansForBox, spansFromHtml } from "../htmltext.js";
import { createText, normalizeText, printableArea } from "../model.js";
import { fromSpans } from "../richtext.js";
import { isTyping, toast } from "./dom.js";
import { state, history, selectedElements, updateElement } from "./store.js";
import { openBatch, setBatch } from "./batch.js";
import { addCopies, addElement, addImageFile, centred, deleteSelected } from "./panels.js";

// Text fields and open dialogs keep the normal clipboard behaviour.
const forElements = (ev) => !isTyping(ev.target) && !document.querySelector("dialog[open]");

// Text selected on the page (a status line, a toast, the help) is what the user means to copy,
// even with elements still selected on the label.
const pageTextSelected = () => {
	const sel = document.getSelection();
	return !!sel && !sel.isCollapsed && sel.toString().trim() !== "";
};

const copySelection = (ev) => {
	if (!forElements(ev) || pageTextSelected()) return false;
	const els = selectedElements();
	if (!els.length) return false;
	ev.clipboardData.setData("text/plain", serializeElements(els));
	ev.preventDefault();
	return true;
};

document.addEventListener("copy", copySelection);
document.addEventListener("cut", (ev) => {
	if (copySelection(ev)) deleteSelected();
});

document.addEventListener("paste", (ev) => {
	if (!forElements(ev)) return;
	const image = [...ev.clipboardData.files].find((f) => f.type.startsWith("image/"));
	if (image) {
		ev.preventDefault();
		addImageFile(image);
		return;
	}
	const text = ev.clipboardData.getData("text/plain");
	if (!text) return;
	let elements;
	try {
		elements = parseElements(text);
	} catch (err) {
		ev.preventDefault();
		toast(err.message, { error: true });
		return;
	}
	if (elements) {
		ev.preventDefault();
		addCopies(elements);
		return;
	}
	// Anything else pasted onto the label becomes a new text box, formatted as it was.
	ev.preventDefault();
	const a = printableArea(state.doc.label);
	const box = createText(state.doc, { ...centred(a.w / 2, a.h / 2), text: text.trim(), fit: true });
	const html = ev.clipboardData.getData("text/html");
	const spans = html ? spansFromHtml(parseHtml(html)) : [];
	if (isFormatted(spans))
		box.text = normalizeText({ ...box, text: fromSpans(spansForBox(spans, box)) });
	addElement(box);
	offerBatch(text, box.id);
});

/**
 * A list pasted onto the label is likely meant as many labels, one per line: the batch list
 * is what does that, so this is where it's offered. The text box stays as pasted until the
 * offer is taken, which puts the lines in the batch and the columns in the box.
 */
const offerBatch = (text, id) => {
	const { rows } = parseBatch(text);
	if (rows.length < 2) return;
	const columns = Math.max(...rows.map((r) => r.length));
	toast(`${rows.length} lines pasted.`, {
		action: {
			label: "Make a label for each",
			run: () => {
				const fields = Array.from({ length: columns }, (_, i) => `{${i + 1}}`);
				updateElement(id, { text: fields.join("\n") });
				history.seal();
				setBatch(text);
				openBatch();
			},
		},
	});
};
