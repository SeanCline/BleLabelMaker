// Text: laid out the way the inline editor's caret expects (layoutTextBox), and drawn run by
// run so formatted words, a larger first line and dithered emoji all line up with it.
import { dotScale } from "../units.js";
import { alignOffset, layoutText, stackLetters, graphemes, LINE_HEIGHT } from "../layout.js";
import { toOneBit } from "../raster.js";
import { cssFont, hasEmoji } from "../fonts.js";
import { textOf, unitStyles } from "../richtext.js";
import { makeCanvas } from "./common.js";

/**
 * Where a text element's lines go inside its (unrotated) box, in dots. Shared with the inline
 * editor so its caret sits on the rendered text rather than on its own idea of the layout.
 * Leaves ctx.font set to the chosen size.
 *
 * Text with formatted parts is measured a style at a time, each in its own font, and the
 * widths added up; drawText draws it the same way, so layout, caret and print agree to the dot.
 * `measure` and `spans` work in offsets into the text as laid out (stacking adds line breaks).
 */
export const layoutTextBox = (ctx, e, box, dots = dotScale()) => {
	const spacing = `${dots.pt(e.letterSpacingPt ?? 0)}px`;
	const plain = textOf(e.text);
	const stacked = e.stacked ? stackLetters(plain) : null;
	const text = stacked ? stacked.text : plain;
	const spans = spansIn(e, stacked);
	// Fit tries many sizes over the same words.
	const widths = new Map();
	const width = (look, from, to, px) => {
		const font = cssFont(look, px);
		const s = text.slice(from, to);
		const key = `${font}\n${s}`;
		let w = widths.get(key);
		if (w === undefined) {
			ctx.font = font;
			ctx.letterSpacing = spacing;
			w = ctx.measureText(s).width;
			widths.set(key, w);
		}
		return w;
	};
	const measure = (from, to, px) => {
		let w = 0;
		for (const s of spans) {
			const a = Math.max(from, s.from);
			const b = Math.min(to, s.to);
			if (a < b) w += width(s.look, a, b, px);
		}
		return w;
	};
	const layout = layoutText({
		text,
		width: box.w,
		height: box.h,
		fontSize: dots.pt(e.fontSizePt),
		fit: e.fit,
		measure,
		firstScale: e.firstLineScale ?? 1,
	});
	ctx.font = cssFont(e, layout.fontSize);
	ctx.letterSpacing = spacing;
	// Centre the font's ascent+descent inside each line box so vertical alignment looks even.
	const m = ctx.measureText("Hg");
	const ascent = m.fontBoundingBoxAscent ?? layout.fontSize * 0.8;
	const descent = m.fontBoundingBoxDescent ?? layout.fontSize * 0.2;
	let top = 0;
	if (e.vAlign === "middle") top = (box.h - layout.height) / 2;
	else if (e.vAlign === "bottom") top = box.h - layout.height;
	// Where each line starts in the element's own text, which stacking rearranges.
	const starts = stacked ? layout.starts.map((i) => stacked.source[i]) : layout.starts;
	return { ...layout, starts, top, ascent, descent, measure, spans, text: stacked ? null : text };
};

/**
 * The text's runs as offsets into the text as laid out, each with the element as it looks in
 * that run (its style over the box's). Stacking moves letters apart, so each keeps its style.
 * @returns {{from: number, to: number, look: import("../model.js").TextElement}[]}
 */
const spansIn = (e, stacked) => {
	let styles = unitStyles(e.text);
	if (stacked) {
		const units = styles;
		styles = [];
		let at = 0;
		for (let i = 0; i < stacked.text.length; i++) {
			// A letter's first unit says where it came from; the rest follow it. The line breaks
			// stacking adds are never drawn, so they keep the letter before's style.
			if (stacked.source[i] !== undefined) at = stacked.source[i];
			else if (stacked.text[i] !== "\n") at++;
			styles.push(units[at]);
		}
	}
	const spans = [];
	styles.forEach((style, i) => {
		const last = spans.at(-1);
		if (last?.style === style) last.to = i + 1;
		else spans.push({ from: i, to: i + 1, style });
	});
	return spans.map((s) => ({ from: s.from, to: s.to, look: { ...e, ...s.style } }));
};

/** A transparent canvas the size of ctx's, drawing in the same (rotated) frame, clipped to box. */
const layerLike = (ctx, box) => {
	const layer = makeCanvas(ctx.canvas.width, ctx.canvas.height).getContext("2d", {
		willReadFrequently: true,
	});
	layer.setTransform(ctx.getTransform());
	layer.beginPath();
	layer.rect(0, 0, box.w, box.h);
	layer.clip();
	layer.textBaseline = "alphabetic";
	return layer;
};

/** A line split into runs of emoji and of everything else. */
const emojiRuns = (line) => {
	const runs = [];
	for (const g of graphemes(line)) {
		const emoji = hasEmoji(g);
		const last = runs.at(-1);
		if (last && last.emoji === emoji) last.text += g;
		else runs.push({ text: g, emoji });
	}
	return runs;
};

export const drawText = (ctx, e, box, dots) => {
	const { fontSize, lines, sizes, offsets, top, ascent, descent, measure, spans } = layoutTextBox(
		ctx,
		e,
		box,
		dots,
	);

	if (e.invert) {
		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, box.w, box.h);
	}
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, box.w, box.h);
	ctx.clip();
	ctx.fillStyle = e.invert ? "#fff" : "#000";
	ctx.textBaseline = "alphabetic";
	ctx.lineJoin = "round";
	ctx.strokeStyle = ctx.fillStyle;
	// Dithered emoji go on a layer of their own, drawn in colour and dithered like a photo,
	// while the letters around them stay a crisp threshold.
	const emojiLayer = e.ditherEmoji && hasEmoji(textOf(e.text)) ? layerLike(ctx, box) : null;
	const paint = (target, s, x, y) =>
		e.outline && target === ctx ? ctx.strokeText(s, x, y) : target.fillText(s, x, y);
	let y = top;
	lines.forEach((line, i) => {
		// Each line at its own size (a larger first line), its metrics scaled to match.
		const size = sizes[i];
		const k = size / fontSize;
		const lineHeight = size * LINE_HEIGHT;
		const baseline = y + (lineHeight - (ascent + descent) * k) / 2 + ascent * k;
		y += lineHeight;
		// Lines in whole dots, scaled to the text. An outline is thinner than an underline: on
		// small text a heavier one fills the letters back in. Outlines read well from about 20 pt.
		const stroke = Math.max(1, Math.round(size / 16));
		ctx.lineWidth = Math.max(1, Math.round(size / 24));
		const from = offsets[i];
		const width = measure(from, from + line.length, size);
		const left = alignOffset(e.align, box.w - width);
		const parts = spans
			.filter((s) => s.from < from + line.length && s.to > from)
			.map((s) => ({
				look: s.look,
				from: Math.max(s.from, from),
				text: line.slice(Math.max(s.from, from) - from, Math.min(s.to, from + line.length) - from),
			}));
		// Each part starts where the measured layout puts it, so spacing matches the layout.
		const xOf = (at) => left + measure(from, at, size);
		const underlined = [];
		for (const part of parts) {
			const font = cssFont(part.look, size);
			if (parts.length === 1 && !(emojiLayer && hasEmoji(line))) {
				ctx.font = font;
				ctx.textAlign = e.align;
				// Anchored where textAlign measures from: the box's left, middle or right.
				paint(ctx, line, alignOffset(e.align, box.w), baseline);
			} else {
				ctx.textAlign = "left";
				let at = part.from;
				for (const run of emojiLayer ? emojiRuns(part.text) : [{ text: part.text, emoji: false }]) {
					// Measuring sets the font, so it's set again for drawing.
					const x = xOf(at);
					const target = run.emoji ? emojiLayer : ctx;
					target.font = font;
					target.letterSpacing = ctx.letterSpacing;
					paint(target, run.text, x, baseline);
					at += run.text.length;
				}
			}
			if (!part.look.underline) continue;
			const x0 = xOf(part.from);
			const x1 = xOf(part.from + part.text.length);
			// Underlined neighbours share one line, so no gap opens where their styles meet.
			const last = underlined.at(-1);
			if (last && Math.abs(last[1] - x0) < 0.01) last[1] = x1;
			else underlined.push([x0, x1]);
		}
		const under = Math.round(baseline + Math.max(1, descent * k * 0.3));
		for (const [x0, x1] of underlined)
			ctx.fillRect(Math.round(x0), under, Math.round(x1 - x0), stroke);
	});
	ctx.restore();
	if (!emojiLayer) return { fittedPx: fontSize };
	return {
		fittedPx: fontSize,
		process: (image) => {
			const { width, height } = image;
			const dots = toOneBit(emojiLayer.getImageData(0, 0, width, height), { mode: "dither" });
			// On white-on-black text the emoji print as a negative, like the letters.
			const ink = e.invert ? 255 : 0;
			for (let i = 0; i < dots.data.length; i += 4) {
				if (dots.data[i + 3] === 0) continue;
				image.data[i] = image.data[i + 1] = image.data[i + 2] = ink;
				image.data[i + 3] = 255;
			}
			return image;
		},
	};
};
