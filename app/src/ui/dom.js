export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const el = (tag, props = {}, ...children) => {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === "dataset") Object.assign(node.dataset, v);
		else if (k === "style") Object.assign(node.style, v);
		else if (k.startsWith("aria-") || k === "role") node.setAttribute(k, v);
		else node[k] = v;
	}
	node.append(...children);
	return node;
};

// Storage can throw (private windows, blocked site data); every caller treats it as best-effort.
export const loadJson = (key) => {
	try {
		return JSON.parse(localStorage.getItem(key));
	} catch {
		return null;
	}
};
export const loadText = (key) => {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
};
export const storeJson = (key, value) => {
	try {
		localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
};

/** Speaks a short message to screen readers without showing anything. */
export const announce = (msg) => {
	const a = $("#announcer");
	// Clearing first makes repeated identical messages ("Rotated to 90°") announce again.
	a.textContent = "";
	requestAnimationFrame(() => (a.textContent = msg));
};

// How far a press can wander, in screen pixels, and still be a tap or a hold rather than a drag.
export const DRAG_SLACK_PX = 4;

let toastTimer;
/**
 * A short message at the bottom of the page. With an action, it carries a button for it and
 * stays long enough to reach.
 * @param {string} msg
 * @param {{error?: boolean, action?: {label: string, run: () => void}}} [options]
 */
export const toast = (msg, { error = false, action = null } = {}) => {
	const t = $("#toast");
	const hide = () => (t.hidden = true);
	t.replaceChildren(msg);
	if (action) {
		const button = el("button", { type: "button" }, action.label);
		button.addEventListener("click", () => {
			hide();
			action.run();
		});
		t.append(" ", button);
	}
	t.className = "toast" + (error ? " error" : "") + (action ? " with-action" : "");
	// Errors interrupt; confirmations wait their turn.
	t.setAttribute("role", error ? "alert" : "status");
	t.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(hide, error || action ? 8000 : 3000);
};

export const download = (name, text, type = "application/json") => {
	const a = el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export const isTyping = (target) =>
	target?.matches?.("input, textarea, select, [contenteditable]") ?? false;
