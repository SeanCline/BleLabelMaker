// Where the cursor was in a text element's editor (the panel field or the inline editor).
// Opening the emoji picker takes focus away from the editor, so the position is saved on blur
// and the emoji goes in where the user was typing rather than at the end.

let last = null;

/** @param {"panel"|"inline"} source which editor to return to afterwards */
export const rememberCaret = (id, textarea, source) => {
	last = { id, start: textarea.selectionStart, end: textarea.selectionEnd, source };
};

/** The saved position for this element, if it's the one last edited. */
export const takeCaret = (id) => {
	const c = last?.id === id ? last : null;
	last = null;
	return c;
};
