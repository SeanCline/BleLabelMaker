// Emoji and fields go into text where the cursor was, from the emoji picker and the Field menu
// on the bar over the label.
import { searchEmoji } from "../emoji.js";
import { plainText } from "../layout.js";
import { applyEdit, textOf } from "../richtext.js";
import { $, el } from "./dom.js";
import { history, selected, updateElement, elementById } from "./store.js";
import { inlineEdit, startInlineEdit } from "./inline-editor.js";
import { rememberCaret, takeCaret } from "./caret.js";

const emojiDialog = $("#emojiDialog");
let emojiCallback = null;
// Enter in the search box submits the form with its first button: the first match.
const renderEmojiGrid = () => {
	const found = searchEmoji($("#emojiSearch").value);
	$("#emojiGrid").replaceChildren(
		...found.map((e) =>
			el("button", { value: e.char, textContent: e.char, title: e.words, "aria-label": e.words }),
		),
	);
	$("#emojiNone").hidden = found.length > 0;
};
$("#emojiSearch").addEventListener("input", renderEmojiGrid);
const pickEmoji = (cb) => {
	emojiCallback = cb;
	$("#emojiCustom").value = "";
	$("#emojiSearch").value = "";
	renderEmojiGrid();
	emojiDialog.showModal();
	$("#emojiSearch").focus();
};
emojiDialog.addEventListener("close", () => {
	let v = emojiDialog.returnValue;
	if (v === "custom") v = $("#emojiCustom").value.trim();
	if (v && v !== "cancel" && emojiCallback) emojiCallback(v);
	emojiCallback = null;
});

// Emoji and fields go into text, where the cursor was: on the label, or in the settings' copy
// of the text, which the bar stays over. Using the picker or the field menu takes focus from
// that editor, so the cursor is remembered on blur and the editor is reopened afterwards with
// the cursor after what was inserted.
const bar = $("#quickbar");
const field = /** @type {HTMLTextAreaElement} */ ($("#designText"));
field.addEventListener("blur", () => {
	const e = selected();
	if (e) rememberCaret(e.id, field, "panel");
});
const insert = (e, caret, value) => {
	value = plainText(value);
	const current = elementById(e.id);
	if (current?.type !== "text") return;
	const length = textOf(current.text).length;
	const start = Math.min(caret.start, length);
	const end = Math.min(caret.end, length);
	updateElement(e.id, {
		text: applyEdit(current.text, { at: start, removed: end - start, inserted: value }),
	});
	history.seal();
	const at = { start: start + value.length, end: start + value.length };
	if (caret.source === "panel") {
		field.focus();
		field.setSelectionRange(at.start, at.end);
	} else startInlineEdit(e.id, at);
};
const target = () => {
	const e = selected();
	if (e?.type !== "text") return null;
	const end = textOf(e.text).length;
	// Still typing on the label (the menu needn't take the focus): its cursor, as it is now.
	const typing = inlineEdit();
	const live = typing?.id === e.id && { start: typing.from, end: typing.to, source: "inline" };
	// The settings' field only while it's showing: they may have closed since it was typed in.
	const remembered = takeCaret(e.id);
	const usable = remembered?.source === "inline" || field.getClientRects().length > 0;
	const caret = live || (remembered && usable ? remembered : { start: end, end, source: "inline" });
	return { e, caret };
};
$(".insert-emoji", bar).addEventListener("click", () => {
	const t = target();
	if (t) pickEmoji((char) => insert(t.e, t.caret, char));
});
const menu = /** @type {HTMLSelectElement} */ ($(".insert-field", bar));
menu.addEventListener("change", () => {
	const value = menu.value;
	menu.value = "";
	const t = target();
	if (t && value) insert(t.e, t.caret, value);
});

// Text fields keep their text plain as it's typed or pasted (see plainText), before the app
// reads it: otherwise the field holds characters the label doesn't, and caret positions
// remembered in one stop matching the other.
document.addEventListener(
	"input",
	(ev) => {
		const area = ev.target;
		if (!(area instanceof HTMLTextAreaElement) || !area.matches('[data-prop="text"], .inline-edit'))
			return;
		const plain = plainText(area.value);
		if (plain === area.value) return;
		const removedBefore = (i) => i - plainText(area.value.slice(0, i)).length;
		const start = area.selectionStart - removedBefore(area.selectionStart);
		const end = area.selectionEnd - removedBefore(area.selectionEnd);
		area.value = plain;
		area.setSelectionRange(start, end);
	},
	{ capture: true },
);
