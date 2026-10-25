// A short curated list beats a giant picker: on a 9 mm tall label only a few faces read well.
export const FONTS = [
	{
		family: "Inter",
		label: "Inter (clean sans)",
		weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
		italic: true,
		google: "Inter:ital,wght@0,100..900;1,100..900",
	},
	{
		family: "Roboto Condensed",
		label: "Roboto Condensed (narrow)",
		weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
		italic: true,
		google: "Roboto+Condensed:ital,wght@0,100..900;1,100..900",
	},
	{
		family: "Oswald",
		label: "Oswald (tall, compact)",
		weights: [200, 300, 400, 500, 600, 700],
		italic: false,
		google: "Oswald:wght@200..700",
	},
	{
		family: "Bebas Neue",
		label: "Bebas Neue (all caps)",
		weights: [400],
		italic: false,
		google: "Bebas+Neue",
	},
	{
		family: "Roboto Slab",
		label: "Roboto Slab (serif)",
		weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
		italic: false,
		google: "Roboto+Slab:wght@100..900",
	},
	{
		family: "Lora",
		label: "Lora (book serif)",
		weights: [400, 500, 600, 700],
		italic: true,
		google: "Lora:ital,wght@0,400..700;1,400..700",
	},
	{
		family: "JetBrains Mono",
		label: "JetBrains Mono (code)",
		weights: [100, 200, 300, 400, 500, 600, 700, 800],
		italic: true,
		google: "JetBrains+Mono:ital,wght@0,100..800;1,100..800",
	},
	{
		family: "Permanent Marker",
		label: "Permanent Marker (handwritten)",
		weights: [400],
		italic: false,
		google: "Permanent+Marker",
	},
	{
		family: "Pacifico",
		label: "Pacifico (script)",
		weights: [400],
		italic: false,
		google: "Pacifico",
	},
	{ family: "sans-serif", label: "System sans-serif", weights: [400, 700], italic: true },
	{ family: "serif", label: "System serif", weights: [400, 700], italic: true },
	{ family: "monospace", label: "System monospace", weights: [400, 700], italic: true },
];

export const EMOJI_MONO_FONT = "Noto Emoji";
export const EMOJI_MONO_GOOGLE = "Noto+Emoji:wght@300..700";

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

/** Families saved in a file may not be in our list (hand-edited, or removed later); treat as system fonts. */
export const weightsFor = (family) => fontInfo(family)?.weights ?? [400, 700];

export const nearestWeight = (family, weight) =>
	weightsFor(family).reduce((best, w) =>
		Math.abs(w - weight) < Math.abs(best - weight) ? w : best,
	);

// Emoji in text come from the outline font: colour emoji glyphs fall apart when thresholded
// to black and white (light ones like ❄️ vanish). Listed after the text face so it only
// supplies what that face lacks.
export const cssFamily = (family) =>
	`${GENERIC.has(family) ? family : `"${family}", sans-serif`}, "${EMOJI_MONO_FONT}"`;

// Colour emoji, for text set to dither them: whichever colour emoji font the system has.
// They come before the generic family, which on some systems has monochrome symbols (❤).
const COLOR_EMOJI_FONTS = `"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji"`;
const colorFamily = (family) =>
	GENERIC.has(family)
		? `${COLOR_EMOJI_FONTS}, ${family}`
		: `"${family}", ${COLOR_EMOJI_FONTS}, sans-serif`;

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
 * Canvas text never triggers a webfont download by itself, so explicitly load each face
 * the document uses before drawing; otherwise the first render silently uses a fallback.
 */
export const ensureFontsFor = async (doc) => {
	const loads = [];
	for (const e of doc.elements) {
		if (e.type === "text") {
			if (!GENERIC.has(e.fontFamily))
				loads.push(document.fonts.load(cssFont(e, 20), e.text || "A"));
			if (hasEmoji(e.text))
				loads.push(document.fonts.load(`400 20px "${EMOJI_MONO_FONT}"`, e.text));
		} else if (e.type === "barcode" && e.showText && !GENERIC.has(e.textFont)) {
			loads.push(document.fonts.load(`600 20px "${e.textFont}"`, e.data || "0123456789"));
		}
	}
	await Promise.allSettled(loads);
};
