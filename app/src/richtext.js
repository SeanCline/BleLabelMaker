// Text with part of it formatted: a word in bold, a letter underlined. A text element's `text`
// is a plain string while none of it is, and otherwise a list of runs, each a bare string in
// the box's own style or a [style, string] pair that overrides it:
//
//   ["Te", [{"fontWeight": 700}, "x"], "t"]
//
// The text and its formatting are one value, so nothing can change one and forget the other,
// and a file holds no positions that could point past the end of its text. Editing still
// happens at positions (a textarea's selection), so the functions here take them, splitting
// and joining runs as they go.
import { graphemes } from "./layout.js";

/**
 * @typedef {{fontWeight?: number, italic?: boolean, underline?: boolean}} Style
 * @typedef {string | [Style, string]} Run
 * @typedef {string | Run[]} RichText
 * @typedef {{style: Style, text: string}} Span a run, spelled out
 */

/** What a run can set, in the order a file writes them. */
export const STYLE_PROPS = /** @type {const} */ (["fontWeight", "italic", "underline"]);

/** @param {RichText} text @returns {Span[]} */
const spansOf = (text) =>
	typeof text === "string"
		? [{ style: {}, text }]
		: text.map((r) =>
				typeof r === "string" ? { style: {}, text: r } : { style: r[0], text: r[1] },
			);

/** @param {Span[]} spans @returns {RichText} not normalized */
export const fromSpans = (spans) =>
	spans.map((s) => (isPlain(s.style) ? s.text : [s.style, s.text]));

const isPlain = (style) => STYLE_PROPS.every((p) => style[p] === undefined);
const sameStyle = (a, b) => STYLE_PROPS.every((p) => a[p] === b[p]);

/** The words, without their formatting. @param {RichText} text */
export const textOf = (text) =>
	typeof text === "string"
		? text
		: spansOf(text)
				.map((s) => s.text)
				.join("");

/** Applies `fn` to the words of each run, keeping their formatting. */
export const mapText = (/** @type {RichText} */ text, /** @type {(s: string) => string} */ fn) =>
	typeof text === "string"
		? fn(text)
		: fromSpans(spansOf(text).map((s) => ({ style: s.style, text: fn(s.text) })));

/** Applies `fn` to each run's style. */
export const mapStyles = (/** @type {RichText} */ text, /** @type {(s: Style) => Style} */ fn) =>
	typeof text === "string"
		? text
		: fromSpans(spansOf(text).map((s) => ({ style: fn(s.style), text: s.text })));

/** Every style the text uses, the box's own (an empty style) included when any of it is plain. */
export const stylesIn = (/** @type {RichText} */ text) => {
	const found = [];
	for (const { style } of spansOf(text))
		if (!found.some((f) => sameStyle(f, style))) found.push(style);
	return found;
};

/** One style per UTF-16 unit of the text, for work that goes letter by letter. */
export const unitStyles = (/** @type {RichText} */ text) =>
	spansOf(text).flatMap((s) => Array(s.text.length).fill(s.style));

/**
 * The one way of writing a text, so files round-trip byte for byte and history can tell when
 * nothing changed: neighbouring runs with the same style are joined, empty runs dropped, a
 * style keeps only what differs from the box, unstyled runs are bare strings, and text with no
 * formatting at all is a plain string. A run never starts inside a grapheme (an emoji
 * sequence, a letter and its accent), nor inside a match of `together` (fields, which then
 * fill in run by run): those take the style of their first unit.
 * @param {RichText} text
 * @param {{base?: Style, together?: RegExp | null}} [options] base: the box's own style;
 *   together: a global pattern whose matches keep one style
 * @returns {RichText}
 */
export const normalize = (text, { base = {}, together = null } = {}) => {
	if (typeof text === "string") return text;
	const plain = textOf(text);
	const styles = spansOf(text).flatMap((s) => Array(s.text.length).fill(own(s.style, base)));
	let at = 0;
	for (const g of graphemes(plain)) {
		styles.fill(styles[at], at + 1, at + g.length);
		at += g.length;
	}
	for (const m of together ? plain.matchAll(together) : [])
		styles.fill(styles[m.index], m.index + 1, m.index + m[0].length);
	/** @type {Span[]} */
	const spans = [];
	for (let i = 0; i < plain.length; i++) {
		const last = spans.at(-1);
		if (last && sameStyle(last.style, styles[i])) last.text += plain[i];
		else spans.push({ style: styles[i], text: plain[i] });
	}
	if (spans.every((s) => isPlain(s.style))) return plain;
	return fromSpans(spans);
};

/** What a style sets that the box doesn't already, in file order. */
const own = (style, base) =>
	Object.fromEntries(
		STYLE_PROPS.filter((p) => style[p] !== undefined && style[p] !== base[p]).map((p) => [
			p,
			style[p],
		]),
	);

/** The spans between two positions, for copying part of a text. @param {RichText} text */
export const spansBetween = (text, from, to) => slice(spansOf(text), from, to);

/** @param {Span[]} spans */
const slice = (spans, from, to) => {
	const out = [];
	let at = 0;
	for (const s of spans) {
		const a = Math.max(from, at);
		const b = Math.min(to, at + s.text.length);
		if (a < b) out.push({ style: s.style, text: s.text.slice(a - at, b - at) });
		at += s.text.length;
	}
	return out;
};

/** The style of the unit at `i`, or {} past the end. */
const styleAt = (spans, i) => {
	let at = 0;
	for (const s of spans) {
		if (i < at + s.text.length) return s.style;
		at += s.text.length;
	}
	return {};
};

/**
 * The style what's typed at `at` gets: the letter before it, as in word processors, or what it
 * replaces, or the first letter's when typing at the very start.
 * @param {RichText} text
 */
export const typingStyle = (text, at, removed = 0) => {
	const spans = spansOf(text);
	const length = textOf(text).length;
	if (removed || at === 0) return styleAt(spans, Math.min(at, length - 1));
	return styleAt(spans, at - 1);
};

/**
 * The text with `removed` units at `at` replaced by `inserted`.
 * @param {RichText} text
 * @param {{at: number, removed: number, inserted: string}} edit
 * @param {Style} [style] for what's inserted; by default, typingStyle's
 * @returns {RichText} not normalized
 */
export const applyEdit = (text, { at, removed, inserted }, style) => {
	if (typeof text === "string" && !style)
		return text.slice(0, at) + inserted + text.slice(at + removed);
	return spliceSpans(text, at, removed, [
		{ style: style ?? typingStyle(text, at, removed), text: inserted },
	]);
};

/**
 * The text with `removed` units at `at` replaced by formatted text, as pasted.
 * @param {RichText} text
 * @param {Span[]} inserted
 * @returns {RichText} not normalized
 */
export const spliceSpans = (text, at, removed, inserted) => {
	const spans = spansOf(text);
	return fromSpans([
		...slice(spans, 0, at),
		...inserted,
		...slice(spans, at + removed, textOf(text).length),
	]);
};

/**
 * The edit that turns one string into another: what's common at the start and the end is
 * kept. Where that's ambiguous (typing "a" into "aa"), the caret settles it: an edit ends
 * where the textarea's caret is after it.
 * @param {number} [caret] the caret in `after`
 */
export const diffText = (/** @type {string} */ before, /** @type {string} */ after, caret) => {
	const most = Math.min(before.length, after.length);
	const sameFromEnd = (n) => before[before.length - 1 - n] === after[after.length - 1 - n];
	let prefix = 0;
	let suffix = 0;
	if (caret === undefined) {
		while (prefix < most && before[prefix] === after[prefix]) prefix++;
		while (suffix < most - prefix && sameFromEnd(suffix)) suffix++;
	} else {
		while (suffix < Math.min(most, after.length - caret) && sameFromEnd(suffix)) suffix++;
		while (prefix < most - suffix && before[prefix] === after[prefix]) prefix++;
	}
	return {
		at: prefix,
		removed: before.length - prefix - suffix,
		inserted: after.slice(prefix, after.length - suffix),
	};
};

/**
 * The text changed to `value`, a plain string as a textarea has it, with the formatting kept
 * on the letters it was on.
 * @param {RichText} text
 * @param {string} value
 * @param {{caret?: number, style?: Style}} [options] see diffText and applyEdit
 */
export const retext = (text, value, { caret, style } = {}) =>
	typeof text === "string" ? value : applyEdit(text, diffText(textOf(text), value, caret), style);

/**
 * The text with one property set between two positions.
 * @param {RichText} text
 * @returns {RichText} not normalized
 */
export const setStyle = (text, from, to, prop, value) => {
	const spans = spansOf(text);
	const length = textOf(text).length;
	return fromSpans([
		...slice(spans, 0, from),
		...slice(spans, from, to).map((s) => ({ style: { ...s.style, [prop]: value }, text: s.text })),
		...slice(spans, to, length),
	]);
};

/**
 * The text with a property taken off every run, for when the whole box is given it.
 * @param {RichText} text
 * @param {keyof Style} prop
 */
export const clearStyle = (text, prop) => mapStyles(text, ({ [prop]: _, ...rest }) => rest);

/**
 * The styles of the letters between two positions, each with the box's values filled in; the
 * style typing would get when nothing is selected.
 * @param {RichText} text
 * @param {Style} base the box's own style
 * @returns {Required<Style>[]}
 */
export const stylesBetween = (text, from, to, base) => {
	const looks =
		from === to ? [typingStyle(text, from)] : slice(spansOf(text), from, to).map((s) => s.style);
	return looks.map(
		(s) =>
			/** @type {Required<Style>} */ (
				Object.fromEntries(STYLE_PROPS.map((p) => [p, s[p] ?? base[p]]))
			),
	);
};
