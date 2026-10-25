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

let toastTimer;
export const toast = (msg, { error = false } = {}) => {
	const t = $("#toast");
	t.textContent = msg;
	t.className = "toast" + (error ? " error" : "");
	// Errors interrupt; confirmations wait their turn.
	t.setAttribute("role", error ? "alert" : "status");
	t.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (t.hidden = true), error ? 7000 : 3000);
};

export const download = (name, text, type = "application/json") => {
	const a = el("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export const isTyping = (target) =>
	target?.matches?.("input, textarea, select, [contenteditable]") ?? false;
