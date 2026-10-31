export const LINE_HEIGHT = 1.2;

/** How far in a line starts, aligned in `room` (the box's width less the line's). */
export const alignOffset = (/** @type {"left"|"center"|"right"} */ align, room) =>
	align === "left" ? 0 : align === "right" ? room : room / 2;

/**
 * Greedy word wrap. Explicit newlines are kept; a word wider than the box is broken
 * between characters so text never spills outside its box.
 *
 * @param {string} text
 * @param {number} maxWidth in the same units `measure` returns
 * @param {(s: string) => number} measure
 * @returns {string[]}
 */
export const wrapText = (text, maxWidth, measure) =>
	wrapLines(text, maxWidth, (from, to) => measure(text.slice(from, to))).map((l) => l.text);

/**
 * wrapText, saying where each line starts in `text`. Every line is a slice of it, so the
 * inline editor can map between caret positions and the lines the label draws. It measures
 * by position rather than by string, since parts of a text may be in other fonts.
 * @param {string} text
 * @param {number} maxWidth
 * @param {(from: number, to: number) => number} measure width of text.slice(from, to)
 * @returns {{text: string, start: number}[]}
 */
export const wrapLines = (text, maxWidth, measure) => {
	const lines = [];
	let paraStart = 0;
	for (const para of text.split("\n")) {
		const words = para.split(/(\s+)/).filter((w) => w.length);
		let line = "";
		let start = paraStart;
		let pos = paraStart;
		const push = (s) => lines.push({ text: s, start });
		for (const word of words) {
			if (/^\s+$/.test(word)) {
				// Spaces only matter between words; at a break they are dropped by trimEnd.
				if (line !== "") line += word;
				pos += word.length;
				if (line === "") start = pos;
				continue;
			}
			if (measure(start, pos + word.length) <= maxWidth) {
				line += word;
				pos += word.length;
				continue;
			}
			if (line.trim() !== "") push(line.trimEnd());
			line = "";
			start = pos;
			// Word alone is too wide: hard-break it by grapheme so emoji/combining marks stay whole.
			if (measure(pos, pos + word.length) > maxWidth) {
				for (const g of graphemes(word)) {
					if (line !== "" && measure(start, pos + g.length) > maxWidth) {
						push(line);
						line = "";
						start = pos;
					}
					line += g;
					pos += g.length;
				}
			} else {
				line = word;
				pos += word.length;
			}
		}
		push(line.trimEnd());
		paraStart += para.length + 1;
	}
	return lines;
};

const segmenter =
	typeof Intl !== "undefined" && Intl.Segmenter
		? new Intl.Segmenter(undefined, { granularity: "grapheme" })
		: null;
export const graphemes = (s) =>
	segmenter ? [...segmenter.segment(s)].map((x) => x.segment) : [...s];

/**
 * Stacked text: every letter on its own line, with the text's own spaces and line breaks
 * dropped. `source[i]` is where the letter at `text[i]` came from, for the inline editor.
 * @returns {{text: string, source: number[]}}
 */
export const stackLetters = (s) => {
	const source = [];
	let text = "";
	let at = 0;
	for (const g of graphemes(s)) {
		if (!/^\s+$/.test(g)) {
			if (text) text += "\n";
			source[text.length] = at;
			text += g;
		}
		at += g.length;
	}
	return { text, source };
};

/**
 * Text without emoji presentation selectors (U+FE0E, U+FE0F), which is how text elements keep
 * their text. A label is 1-bit, so colour emoji never print; and with a selector, Chromium
 * takes the glyph from the colour emoji font instead of the outline one, which draws partial
 * or blank shapes on canvas (❄️, ⚠️) and gives the inline editor different widths from the
 * label, so its caret drifts after every such emoji.
 */
export const plainText = (s) => s.replace(/[\uFE0E\uFE0F]/g, "");

/**
 * Lays out text inside a box. With `fit`, finds the largest font size whose wrapped text fits.
 *
 * @param {object} p
 * @param {string} p.text
 * @param {number} p.width
 * @param {number} p.height
 * @param {number} [p.fontSize] requested size (ignored when fit is set)
 * @param {boolean} p.fit
 * @param {(from: number, to: number, size: number) => number} p.measure width of
 *   text.slice(from, to) at a font size
 * @param {number} [p.firstScale] size of the first paragraph relative to the rest (a title)
 * @returns {{fontSize: number, lines: string[], sizes: number[], starts: number[],
 *   offsets: number[], lineHeight: number, height: number}} fontSize is the base size; sizes
 *   holds each line's own size, and starts and offsets where in `text` it begins (the same
 *   here; layoutTextBox maps starts back through stacking)
 */
export const layoutText = ({ text, width, height, fontSize, fit, measure, firstScale = 1 }) => {
	const paragraphs = text.split("\n");
	const paraStarts = [];
	let start = 0;
	for (const p of paragraphs) {
		paraStarts.push(start);
		start += p.length + 1;
	}
	const sizeOf = (i, size) => (i === 0 ? size * firstScale : size);
	const layoutAt = (size) => {
		const lines = [];
		const sizes = [];
		const starts = [];
		paragraphs.forEach((p, i) => {
			const s = sizeOf(i, size);
			const from = paraStarts[i];
			for (const line of wrapLines(p, width, (a, b) => measure(from + a, from + b, s))) {
				lines.push(line.text);
				sizes.push(s);
				starts.push(paraStarts[i] + line.start);
			}
		});
		const total = sizes.reduce((h, s) => h + s * LINE_HEIGHT, 0);
		return {
			fontSize: size,
			lines,
			sizes,
			starts,
			offsets: starts,
			lineHeight: size * LINE_HEIGHT,
			height: total,
		};
	};
	if (!fit) return layoutAt(fontSize);

	const fits = (size) => {
		// A size that only fits by breaking words mid-word reads worse than a smaller one.
		const broken = paragraphs.some((p, i) =>
			[...p.matchAll(/\S+/g)].some((w) => {
				const from = paraStarts[i] + w.index;
				return measure(from, from + w[0].length, sizeOf(i, size)) > width;
			}),
		);
		return !broken && layoutAt(size).height <= height;
	};
	// Binary search over size: fitting is monotonic enough in practice for wrapped text.
	let lo = 1;
	let hi = Math.max(2, height);
	if (!fits(lo)) return layoutAt(lo);
	while (hi - lo > 0.25) {
		const mid = (lo + hi) / 2;
		if (fits(mid)) lo = mid;
		else hi = mid;
	}
	return layoutAt(Math.floor(lo * 4) / 4);
};
