// Emoji and fields go into text where the cursor was: the emoji picker and the Field menu
// next to each text field.
import { searchEmoji } from "../emoji.js";
import { plainText } from "../layout.js";
import { applyEdit, textOf } from "../richtext.js";
import { $, $$, el } from "./dom.js";
import { state, history, updateElement } from "./store.js";
import { startInlineEdit } from "./stage.js";
import { rememberCaret, takeCaret } from "./caret.js";
import { targetFor } from "./panels.js";

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

// Emoji and fields go into text, where the cursor was. Using the picker or the field menu
// takes focus from whichever editor was open, so the cursor is remembered on blur and that
// editor is reopened afterwards with the cursor after what was inserted.
for (const panel of $$("[data-panel]").filter((p) => $(".insert-emoji", p))) {
	const field = $('[data-prop="text"]', panel);
	field.addEventListener("blur", () => {
		const e = targetFor(panel);
		if (e) rememberCaret(e.id, field, "panel");
	});
	const insert = (e, caret, value) => {
		value = plainText(value);
		const current = state.doc.elements.find((x) => x.id === e.id);
		if (current?.type !== "text") return;
		const length = textOf(current.text).length;
		const start = Math.min(caret.start, length);
		const end = Math.min(caret.end, length);
		updateElement(e.id, {
			text: applyEdit(current.text, { at: start, removed: end - start, inserted: value }),
		});
		history.seal();
		const at = { start: start + value.length, end: start + value.length };
		if (caret.source === "inline") startInlineEdit(e.id, at);
		else {
			field.focus();
			field.setSelectionRange(at.start, at.end);
		}
	};
	const target = () => {
		const e = targetFor(panel);
		if (e?.type !== "text") return null;
		const end = textOf(e.text).length;
		const caret = takeCaret(e.id) ?? { start: end, end, source: "panel" };
		return { e, caret };
	};
	$(".insert-emoji", panel).addEventListener("click", () => {
		const t = target();
		if (t) pickEmoji((char) => insert(t.e, t.caret, char));
	});
	const menu = $(".insert-field", panel);
	menu.addEventListener("change", () => {
		const value = menu.value;
		menu.value = "";
		const t = target();
		if (t && value) insert(t.e, t.caret, value);
	});
}

// Text fields keep their text plain as it's typed or pasted (see plainText), before the app
// reads it: otherwise the field holds characters the label doesn't, and caret positions
// remembered in one stop matching the other.
document.addEventListener(
	"input",
	(ev) => {
		const field = ev.target;
		if (
			!(field instanceof HTMLTextAreaElement) ||
			!field.matches('[data-prop="text"], .inline-edit')
		)
			return;
		const plain = plainText(field.value);
		if (plain === field.value) return;
		const removedBefore = (i) => i - plainText(field.value.slice(0, i)).length;
		const start = field.selectionStart - removedBefore(field.selectionStart);
		const end = field.selectionEnd - removedBefore(field.selectionEnd);
		field.value = plain;
		field.setSelectionRange(start, end);
	},
	{ capture: true },
);
