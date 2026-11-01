import { stylesIn, textOf } from "./richtext.js";
import { ICON_FONT, hasIcon } from "./icons.js";

// A short curated list beats a giant picker: on a 9 mm tall label only a few faces read well.
export const FONTS = [
	{
		family: "Inter",
		weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
		italic: true,
		google: "Inter:ital,wght@0,100..900;1,100..900",
	},
	{
		family: "Roboto Condensed",
		weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
		italic: true,
		google: "Roboto+Condensed:ital,wght@0,100..900;1,100..900",
	},
	{
		family: "Oswald",
		weights: [200, 300, 400, 500, 600, 700],
		italic: false,
		google: "Oswald:wght@200..700",
	},
	{
		family: "Bebas Neue",
		weights: [400],
		italic: false,
		google: "Bebas+Neue",
	},
	{
		family: "Roboto Slab",
		weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
		italic: false,
		google: "Roboto+Slab:wght@100..900",
	},
	{
		family: "Lora",
		weights: [400, 500, 600, 700],
		italic: true,
		google: "Lora:ital,wght@0,400..700;1,400..700",
	},
	{
		family: "Roboto Mono",
		weights: [100, 200, 300, 400, 500, 600, 700],
		italic: true,
		google: "Roboto+Mono:ital,wght@0,100..700;1,100..700",
	},
	{
		family: "Permanent Marker",
		weights: [400],
		italic: false,
		google: "Permanent+Marker",
	},
	{
		family: "Pacifico",
		weights: [400],
		italic: false,
		google: "Pacifico",
	},
	// The system's own faces are named for what they are; a listed font is its family name.
	{ family: "sans-serif", label: "System sans-serif", weights: [400, 700], italic: true },
	{ family: "serif", label: "System serif", weights: [400, 700], italic: true },
	{ family: "monospace", label: "System monospace", weights: [400, 700], italic: true },
];

const EMOJI_MONO_FONT = "Noto Emoji";
export const EMOJI_MONO_GOOGLE = "Noto+Emoji:wght@300..700";

// From semibold up a weight reads as bold, so B shows pressed and pressing it unbolds.
export const BOLD = 600;

export const WEIGHT_NAMES = {
	100: "Thin",
	200: "Extra light",
	300: "Light",
	400: "Regular",
	500: "Medium",
	600: "Semibold",
	700: "Bold",
	800: "Extra bold",
	900: "Black",
};

const GENERIC = new Set(["sans-serif", "serif", "monospace"]);

export const fontInfo = (family) => FONTS.find((f) => f.family === family);

/**
 * Families saved in a file may not be in our list (hand-edited, or removed later); treat as
 * system fonts.
 */
export const weightsFor = (family) => fontInfo(family)?.weights ?? [400, 700];

export const nearestWeight = (family, weight) =>
	weightsFor(family).reduce((best, w) =>
		Math.abs(w - weight) < Math.abs(best - weight) ? w : best,
	);

// Emoji in text come from the outline font: colour emoji glyphs fall apart when thresholded
// to black and white (light ones like ❄️ vanish). Listed after the text face so it only
// supplies what that face lacks. The icon font can go first: its unicode-range (styles.css)
// is only its own characters, so it's never fetched for, or measured by, anything else.
const ICONS = `"${ICON_FONT}"`;
export const cssFamily = (family) =>
	`${ICONS}, ${GENERIC.has(family) ? family : `"${family}", sans-serif`}, "${EMOJI_MONO_FONT}"`;

// Colour emoji, for text set to dither them: whichever colour emoji font the system has.
// They come before the generic family, which on some systems has monochrome symbols (❤).
const COLOR_EMOJI_FONTS = `"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"`;
const colorFamily = (family) =>
	GENERIC.has(family)
		? `${ICONS}, ${COLOR_EMOJI_FONTS}, ${family}`
		: `${ICONS}, "${family}", ${COLOR_EMOJI_FONTS}, sans-serif`;

const EMOJI_RE = /\p{Extended_Pictographic}/u;
export const hasEmoji = (s) => EMOJI_RE.test(s);

/**
 * The CSS font for a text element at a size in px. Everything that lays the text out or
 * measures it goes through here, so the dithered-emoji setting changes them all alike.
 */
export const cssFont = ({ fontFamily, fontWeight, italic, ditherEmoji = false }, px) =>
	`${italic ? "italic " : ""}${fontWeight} ${px}px ${ditherEmoji ? colorFamily(fontFamily) : cssFamily(fontFamily)}`;

/** Fonts are self-hosted (see tools/fetch-fonts.mjs) so the app works offline. */
export const installFontStylesheet = () => {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = "fonts/fonts.css";
	document.head.append(link);
	return new Promise((resolve) => {
		link.onload = resolve;
		// Missing stylesheet: carry on with fallback fonts rather than hanging the app.
		link.onerror = resolve;
	});
};

/**
 * Loads every listed face once the page is idle: the font list shows each name in its own
 * face, and would otherwise open with them still loading. Only the letters of its name, in
 * its regular weight, so it's a small download each, and after the first paint.
 */
export const preloadFontList = () => {
	const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 500));
	idle(() => {
		for (const f of FONTS)
			if (!GENERIC.has(f.family))
				document.fonts.load(`400 16px ${cssFamily(f.family)}`, f.family).catch(() => {});
	});
};

/**
 * Canvas text never triggers a webfont download by itself, so explicitly load each face
 * the document uses before drawing; otherwise the first render silently uses a fallback.
 */
export const ensureFontsFor = async (doc) => {
	const loads = [];
	for (const e of doc.elements) {
		if (e.type === "text") {
			const text = textOf(e.text);
			// Each style is its own face: a bold word needs the bold one.
			if (!GENERIC.has(e.fontFamily))
				for (const style of stylesIn(e.text))
					loads.push(document.fonts.load(cssFont({ ...e, ...style }, 20), text || "A"));
			if (hasEmoji(text)) loads.push(document.fonts.load(`400 20px "${EMOJI_MONO_FONT}"`, text));
			if (hasIcon(text)) loads.push(document.fonts.load(`400 20px ${ICONS}`, text));
		} else if (e.type === "barcode" && e.showText && !GENERIC.has(e.textFont)) {
			loads.push(document.fonts.load(`600 20px "${e.textFont}"`, e.data || "0123456789"));
		}
	}
	await Promise.allSettled(loads);
};
