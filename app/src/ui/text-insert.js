// The emoji and icon picker, and putting emoji, icons and fields into text.
import { searchEmoji } from "../text/emoji.js";
import { loadIcons, searchIcons } from "../text/icons.js";
import { plainText } from "../text/layout.js";
import { applyEdit, textOf } from "../text/richtext.js";
import { $, el, toast } from "./dom.js";
import { history, selected, updateElement, elementById } from "./store.js";
import { inlineEdit, startInlineEdit } from "./inline-editor.js";
import { rememberCaret, takeCaret } from "./caret.js";

const emojiDialog = $("#emojiDialog");
let emojiCallback = null;
// A few hundred buttons draw at once; past that a search is too broad to scroll through anyway.
const MAX_ICONS = 240;
/** @type {import("../text/icons.js").Icon[] | null} */
let icons = null;
// Enter in the search box submits the form with its first button: the first match.
const renderEmojiGrid = () => {
	const query = $("#emojiSearch").value;
	const found = searchEmoji(query);
	// Shown as they print, in outline: with its emoji selector Chromium draws one in colour.
	$("#emojiGrid").replaceChildren(
		...found.map((e) =>
			el("button", {
				value: e.char,
				textContent: plainText(e.char),
				title: e.words,
				"aria-label": e.words,
			}),
		),
	);
	const iconsFound = icons ? searchIcons(icons, query) : [];
	$("#iconGrid").replaceChildren(
		...iconsFound.slice(0, MAX_ICONS).map((i) =>
			el("button", {
				value: i.char,
				textContent: i.char,
				title: i.name,
				"aria-label": `${i.name} icon`,
			}),
		),
	);
	// Offline before the icons were ever fetched, they're left out rather than promised.
	const hint = $("#iconHint");
	if (!icons) hint.textContent = "Loading icons…";
	else if (!icons.length) hint.textContent = "";
	else if (!query.trim())
		hint.textContent = `Search to find one of ${icons.length.toLocaleString()} icons.`;
	else if (iconsFound.length > MAX_ICONS)
		hint.textContent = `And ${(iconsFound.length - MAX_ICONS).toLocaleString()} more: add a word to narrow it down.`;
	else hint.textContent = "";
	hint.hidden = !hint.textContent;
	$("#emojiHeading").hidden = found.length === 0;
	$("#iconHeading").hidden = hint.hidden && iconsFound.length === 0;
	$("#emojiNone").hidden = found.length + iconsFound.length > 0 || !hint.hidden;
};
$("#emojiSearch").addEventListener("input", renderEmojiGrid);
const pickEmoji = (cb) => {
	emojiCallback = cb;
	$("#emojiSearch").value = "";
	if (!icons?.length) {
		icons = null;
		loadIcons().then((list) => {
			icons = list;
			if (emojiDialog.open) renderEmojiGrid();
		});
	}
	renderEmojiGrid();
	emojiDialog.showModal();
	$("#emojiSearch").focus();
};
emojiDialog.addEventListener("close", () => {
	const v = emojiDialog.returnValue;
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
	if (!t || !value) return;
	insert(t.e, t.caret, value);
	// The menu has a few dates; the rest are a number away.
	if (value.startsWith("{date"))
		toast(
			"Dates can count on: {date+30d} is 30 days after it prints. Use d, w, m or y, and - to go back.",
		);
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
