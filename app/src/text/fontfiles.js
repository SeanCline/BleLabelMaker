// Fonts added by the user, worked out from what they give: a font file's name, or a Google
// Fonts family (its name or a link to it) and the stylesheet Google serves for it. No DOM, so
// it's testable; ui/custom-fonts.js does the fetching, storing and loading.

// The weights a style word in a file name stands for, as font makers name their files.
const WEIGHT_WORDS = {
	hairline: 100,
	thin: 100,
	extralight: 200,
	ultralight: 200,
	light: 300,
	regular: 400,
	normal: 400,
	book: 400,
	medium: 500,
	semibold: 600,
	demibold: 600,
	bold: 700,
	extrabold: 800,
	ultrabold: 800,
	black: 900,
	heavy: 900,
};

/**
 * The family, weight and style a font file's name says it is: "Montserrat-BoldItalic.ttf" is
 * Montserrat, 700, italic. A name without style words is the family's regular face.
 * @param {string} fileName
 * @returns {{family: string, weight: number, style: "normal" | "italic"}}
 */
export const faceFromFileName = (fileName) => {
	// "Inter[wght].ttf" and "Roboto-VariableFont_wght.ttf" are whole families in one file.
	const base = fileName
		.replace(/\.(ttf|otf|woff2?)$/i, "")
		.replace(/\[[^\]]*\]/g, "")
		.replace(/[-_ ]?VariableFont.*$/i, "");
	const words = base.split(/[-_ ]+|(?<=[a-z])(?=[A-Z])/).filter(Boolean);
	let weight = 400;
	let style = /** @type {"normal" | "italic"} */ ("normal");
	// Style words come last: strip them off the end, longest compound first ("ExtraBold").
	while (words.length > 1) {
		const last = words.at(-1).toLowerCase();
		const pair = (words.at(-2) + words.at(-1)).toLowerCase();
		if (last === "italic" || last === "oblique") style = "italic";
		else if (WEIGHT_WORDS[pair]) {
			weight = WEIGHT_WORDS[pair];
			words.pop();
		} else if (WEIGHT_WORDS[last]) weight = WEIGHT_WORDS[last];
		else break;
		words.pop();
	}
	return { family: words.join(" ").trim() || fileName, weight, style };
};

/**
 * The Google Fonts family someone means: a name ("Playfair Display"), or a link to its page or
 * stylesheet. Null if it isn't one.
 * @param {string} input
 */
export const googleFamily = (input) => {
	const text = input.trim();
	if (!text) return null;
	let url;
	try {
		url = new URL(text);
	} catch {
		// Not a link: a family name, as Google writes them.
		return /^[\p{L}\p{N} ]+$/u.test(text) ? text.replace(/\s+/g, " ") : null;
	}
	if (!/(^|\.)google(apis)?\.com$/.test(url.hostname)) return null;
	const param = url.searchParams.get("family");
	const path = /\/specimen\/([^/?#]+)/.exec(url.pathname)?.[1];
	const name = (param ?? path ?? "").split(":")[0].replace(/\+/g, " ");
	return name ? decodeURIComponent(name).trim() : null;
};

/**
 * The stylesheet for a family's regular and bold, upright and italic. Google serves the ones
 * the family has and leaves out the rest, so asking for all four works for any family.
 * @param {string} family
 */
export const googleCssUrl = (family) =>
	`https://fonts.googleapis.com/css2?family=${family.trim().replace(/ /g, "+")}:ital,wght@0,400;0,700;1,400;1,700&display=block`;

/**
 * @typedef {{family: string, weight: string, style: string, unicodeRange: string | null,
 *   url: string, subset: string | null}} GoogleFace
 */

/**
 * The faces in a Google Fonts stylesheet: one per weight, style and character subset. Only
 * the Latin subsets are kept: labels are Latin-script text, and the rest would be most of the
 * download.
 * @param {string} css
 * @returns {GoogleFace[]}
 */
export const parseGoogleCss = (css) => {
	const faces = [];
	for (const m of css.matchAll(/(?:\/\*\s*([\w-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g)) {
		const [, subset = null, body] = m;
		const prop = (name) => new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(body)?.[1].trim() ?? null;
		const url = /url\(([^)]+)\)/.exec(prop("src") ?? "")?.[1].replace(/["']/g, "");
		if (!url) continue;
		if (subset && subset !== "latin" && subset !== "latin-ext") continue;
		faces.push({
			family: (prop("font-family") ?? "").replace(/["']/g, ""),
			weight: prop("font-weight") ?? "400",
			style: prop("font-style") ?? "normal",
			unicodeRange: prop("unicode-range"),
			url,
			subset,
		});
	}
	return faces;
};

/**
 * The weights a family's faces cover, as the weight list offers them: a variable face's range
 * ("100 900") is every hundred in it.
 * @param {{weight: string | number}[]} faces
 */
export const weightsOf = (faces) => {
	const weights = new Set();
	for (const f of faces) {
		const [lo, hi = lo] = String(f.weight).split(/\s+/).map(Number);
		for (let w = Math.ceil(lo / 100) * 100; w <= hi; w += 100) weights.add(w);
	}
	return [...weights].sort((a, b) => a - b);
};
