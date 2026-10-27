// Formatted text on the clipboard. Word processors and browsers put HTML there beside the plain
// text, so that's what carries bold, italic and underline both ways. Only those three travel:
// font, size and colour are the label box's own, and a pasted page's would rarely suit it.

import { fontInfo, nearestWeight } from "./fonts.js";

/** @typedef {import("./richtext.js").Style} Style @typedef {import("./richtext.js").Span} Span */

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Spans as HTML for the clipboard, each saying how it looks with the box's style filled in,
 * so a word processor shows what the label does.
 * @param {Span[]} spans
 * @param {Required<Style>} base the box's own style
 */
export const toHtml = (spans, base) =>
	spans
		.map(({ style, text }) => {
			const look = { ...base, ...style };
			const css = [
				look.fontWeight !== 400 && `font-weight:${look.fontWeight}`,
				look.italic && "font-style:italic",
				look.underline && "text-decoration:underline",
			].filter(Boolean);
			const body = escape(text).replace(/\n/g, "<br>");
			return css.length ? `<span style="${css.join(";")}">${body}</span>` : body;
		})
		.join("");

const BLOCK =
	/^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DD|DIV|DL|DT|FIGCAPTION|FIGURE|FOOTER|FORM|H[1-6]|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TR|UL)$/;
const SKIP = /^(HEAD|NOSCRIPT|SCRIPT|STYLE|TEMPLATE|TITLE)$/;
const CELL = /^(TD|TH)$/;

const WEIGHTS = { normal: 400, bold: 700, bolder: 700, lighter: 300 };

/**
 * Clipboard HTML, parsed (DOMParser runs nothing in it). The page's CSP would refuse its style
 * attributes and sheets even there, and say so in the console for each, so they're renamed to
 * be read as text, and sheets (Word's) dropped.
 */
export const parseHtml = (/** @type {string} */ html) =>
	new DOMParser().parseFromString(
		html
			.replace(/<style[\s\S]*?<\/style>/gi, "")
			.replace(/<[^>]+>/g, (tag) => tag.replace(/(\s)style\s*=/gi, "$1data-style=")),
		"text/html",
	);

/** @returns {Record<string, string>} */
const cssOf = (/** @type {Element} */ node) =>
	Object.fromEntries(
		(node.getAttribute("data-style") ?? "")
			.split(";")
			.map((d) => d.split(":"))
			.filter((d) => d.length >= 2)
			.map(([k, ...v]) => [k.trim().toLowerCase(), v.join(":").trim().toLowerCase()]),
	);

/** What an element sets, by its tag and then its own style attribute, over what it's inside. */
const styleOf = (/** @type {HTMLElement} */ node, /** @type {Style} */ outer) => {
	const style = { ...outer };
	const tag = node.tagName;
	if (/^(B|STRONG|TH|H[1-6])$/.test(tag)) style.fontWeight = 700;
	if (/^(I|EM|CITE|VAR|DFN)$/.test(tag)) style.italic = true;
	if (/^(U|INS)$/.test(tag)) style.underline = true;
	const css = cssOf(node);
	const weight = css["font-weight"];
	if (weight) style.fontWeight = WEIGHTS[weight] ?? (Number(weight) || style.fontWeight);
	if (css["font-style"]) style.italic = css["font-style"] !== "normal";
	// An underline can't be taken off inside one in CSS, so "none" doesn't clear it.
	if (/underline/.test(css["text-decoration-line"] ?? css["text-decoration"] ?? ""))
		style.underline = true;
	return style;
};

/**
 * The text and its formatting from clipboard HTML, its lines where the page's blocks and
 * breaks were, and its spaces collapsed as a browser shows them. A style says only what the
 * HTML did; what it leaves out is the box's.
 * @param {Document} doc from parseHtml
 * @returns {Span[]}
 */
export const spansFromHtml = (doc) => {
	/** @type {({style: Style, char: string, keep: boolean} | "break")[]} */
	const units = [];
	const walk = (/** @type {Node} */ node, /** @type {Style} */ style, pre) => {
		if (node.nodeType === 3) {
			const text = pre ? node.textContent : node.textContent.replace(/[\t\n\r ]+/g, " ");
			for (const char of text.replace(/\r\n?/g, "\n"))
				units.push({ style, char: char === " " ? " " : char, keep: pre || char !== " " });
			return;
		}
		if (node.nodeType !== 1) return;
		const el = /** @type {HTMLElement} */ (node);
		const css = cssOf(el);
		if (SKIP.test(el.tagName) || /none/.test(css.display ?? "")) return;
		if (el.tagName === "BR") {
			units.push({ style, char: "\n", keep: true });
			return;
		}
		const block = BLOCK.test(el.tagName);
		if (block) units.push("break");
		if (CELL.test(el.tagName)) units.push({ style, char: " ", keep: false });
		const inner = styleOf(el, style);
		const inPre = pre || el.tagName === "PRE" || /^pre/.test(css["white-space"] ?? "");
		for (const child of el.childNodes) walk(child, inner, inPre);
		if (block) units.push("break");
	};
	walk(doc.body, {}, false);

	/** @type {{style: Style, char: string}[]} */
	const out = [];
	const last = () => out.at(-1)?.char;
	for (const u of units) {
		if (u === "break") {
			// Blocks in a row are one line break, and none comes before the first.
			while (last() === " ") out.pop();
			if (out.length && last() !== "\n") out.push({ style: {}, char: "\n" });
		} else if (u.keep) {
			if (u.char === "\n") while (last() === " ") out.pop();
			out.push(u);
		} else if (out.length && last() !== " " && last() !== "\n") out.push(u);
	}
	while (last() === " " || last() === "\n") out.pop();

	/** @type {Span[]} */
	const spans = [];
	for (const { style, char } of out) {
		const prev = spans.at(-1);
		if (prev?.style === style) prev.text += char;
		else spans.push({ style, text: char });
	}
	return spans;
};

/** Whether any of the pasted text says how it looks, rather than leaving it all to the box. */
export const isFormatted = (/** @type {Span[]} */ spans) =>
	spans.some(({ style }) => Object.keys(style).length > 0);

/**
 * Pasted spans in what a box's font has: the nearest weight it comes in, and no italic where
 * it has none (as the I button won't make one).
 * @param {Span[]} spans
 * @param {{fontFamily: string}} box
 * @returns {Span[]}
 */
export const spansForBox = (spans, { fontFamily }) =>
	spans.map(({ style: { fontWeight, italic, ...rest }, text }) => ({
		style: {
			...rest,
			...(fontWeight !== undefined && { fontWeight: nearestWeight(fontFamily, fontWeight) }),
			...(italic !== undefined && (fontInfo(fontFamily)?.italic ?? true) && { italic }),
		},
		text,
	}));
