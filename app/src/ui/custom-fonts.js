// Fonts the user adds, from a file or from Google Fonts. They're kept in this browser
// (IndexedDB), so they work offline once added; loaded into the page with FontFace, so the
// preview and prints use them like ours; and listed in every font menu after ours. A label
// that uses one opens elsewhere with it shown "(from file)", printing in the fallback face.
import { CUSTOM_FONTS, FONTS, cssFamily } from "../text/fonts.js";
import {
	faceFromFileName,
	googleCssUrl,
	googleFamily,
	parseGoogleCss,
	weightsOf,
} from "../text/fontfiles.js";
import { clearRenderCache } from "../render.js";
import { $, $$, el, icon } from "./dom.js";
import { FONT_FILES, idbAll, idbWrite } from "./idb.js";
import { scheduleCanvas } from "./canvas.js";

/** The font menus' last entries: not fonts, but ways to get one. */
export const ADD_FONT = "add-font";
export const REQUEST_FONT = "request-font";

// A whole family of files is a few hundred KB; anything near this isn't a label font.
const MAX_FILE_BYTES = 10_000_000;

/**
 * @typedef {{weight: string, style: string, unicodeRange: string | null, data: ArrayBuffer}} StoredFace
 * @typedef {{id: string, family: string, source: "file" | "google", faces: StoredFace[]}} StoredFont
 */
/** @type {StoredFont[]} */
let stored = [];
/** The faces in the page for each family, to take out again when it changes. */
const inPage = new Map();

const fontFace = (family, f) =>
	new FontFace(family, f.data, {
		weight: f.weight,
		style: f.style,
		...(f.unicodeRange && { unicodeRange: f.unicodeRange }),
	});

/** @param {StoredFont} font */
const putInPage = (font) => {
	for (const face of inPage.get(font.family) ?? []) document.fonts.delete(face);
	const faces = font.faces.map((f) => fontFace(font.family, f));
	for (const face of faces) document.fonts.add(face);
	inPage.set(font.family, faces);
};

/** Every font menu: our fonts in their own faces, then the user's, then how to get more. */
export const fillFontLists = () => {
	for (const sel of /** @type {HTMLSelectElement[]} */ ($$(".font-select"))) {
		const value = sel.value;
		const option = (family, label = family) => {
			const o = new Option(label, family);
			o.style.fontFamily = cssFamily(family);
			return o;
		};
		sel.replaceChildren(
			// Each name in its own face, so the list shows how they look without picking each one.
			...FONTS.map((f) => option(f.family, f.label)),
			...(CUSTOM_FONTS.length
				? [el("optgroup", { label: "Your fonts" }, ...CUSTOM_FONTS.map((f) => option(f.family)))]
				: []),
			document.createElement("hr"),
			el("option", { value: ADD_FONT, dataset: { icon: "plus" } }, "Add a font…"),
			// Not a font: it opens a request on GitHub, and its icon says it goes elsewhere.
			el(
				"option",
				{ value: REQUEST_FONT, dataset: { icon: "message-square-share" } },
				"Request a font…",
			),
		);
		if (value) sel.value = value;
	}
};

const changed = () => {
	CUSTOM_FONTS.splice(
		0,
		CUSTOM_FONTS.length,
		...stored.map((f) => ({
			family: f.family,
			weights: weightsOf(f.faces),
			italic: f.faces.some((x) => x.style === "italic"),
		})),
	);
	fillFontLists();
	renderList();
	// Text drawn before a font arrived used the fallback face.
	clearRenderCache();
	scheduleCanvas();
};

/**
 * Keeps faces of a family, with any it already had that these don't replace.
 * @param {string} family
 * @param {"file" | "google"} source
 * @param {StoredFace[]} faces
 */
const keep = async (family, source, faces) => {
	if (FONTS.some((f) => f.family.toLowerCase() === family.toLowerCase()))
		throw new Error(`${family} is already in the list.`);
	const had = stored.find((f) => f.family === family);
	const same = (a, b) =>
		a.weight === b.weight && a.style === b.style && a.unicodeRange === b.unicodeRange;
	/** @type {StoredFont} */
	const font = {
		id: family,
		family,
		source,
		faces: [...(had?.faces ?? []).filter((f) => !faces.some((n) => same(f, n))), ...faces],
	};
	await idbWrite(FONT_FILES, { put: [font] });
	stored = [...stored.filter((f) => f.family !== family), font];
	putInPage(font);
	changed();
	return family;
};

/**
 * Adds font files; files named for a family's styles (Montserrat-Bold.ttf) join that family.
 * @param {File[]} files
 * @returns {Promise<string[]>} the families added
 */
export const addFontFiles = async (files) => {
	/** @type {Map<string, StoredFace[]>} */
	const families = new Map();
	for (const file of files) {
		if (!/\.(ttf|otf|woff2?)$/i.test(file.name))
			throw new Error(`${file.name} isn't a font file (TTF, OTF or WOFF).`);
		if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is too big for a font.`);
		const { family, weight, style } = faceFromFileName(file.name);
		const data = await file.arrayBuffer();
		const face = { weight: String(weight), style, unicodeRange: null, data };
		// Loading it is the only way to know it's a font the browser can draw.
		try {
			await fontFace(family, face).load();
		} catch {
			throw new Error(`${file.name} couldn't be read as a font.`);
		}
		families.set(family, [...(families.get(family) ?? []), face]);
	}
	const added = [];
	for (const [family, faces] of families) added.push(await keep(family, "file", faces));
	return added;
};

/**
 * Downloads a Google Fonts family (its regular and bold, upright and italic, as far as it has
 * them), Latin letters only.
 * @param {string} input its name, or a link to it
 * @returns {Promise<string>} the family added
 */
export const addGoogleFont = async (input) => {
	const wanted = googleFamily(input);
	if (!wanted) throw new Error("That isn't a Google Fonts name or link.");
	let css = null;
	try {
		const res = await fetch(googleCssUrl(wanted));
		if (res.ok) css = await res.text();
	} catch {
		// Google answers a family it doesn't have without the header that lets the page read the
		// answer, so it fails just as no connection does.
	}
	if (css === null)
		throw new Error(
			navigator.onLine
				? `Google Fonts has no font called “${wanted}”, or couldn't be reached.`
				: "Couldn't reach Google Fonts. Check the connection and try again.",
		);
	const faces = css ? parseGoogleCss(css) : [];
	if (!faces.length) throw new Error(`Google Fonts has no font called “${wanted}”.`);
	const downloaded = await Promise.all(
		faces.map(async (f) => {
			const res = await fetch(f.url);
			if (!res.ok) throw new Error(`Couldn't download ${f.family}.`);
			return {
				weight: f.weight,
				style: f.style,
				unicodeRange: f.unicodeRange,
				data: await res.arrayBuffer(),
			};
		}),
	);
	return keep(faces[0].family, "google", downloaded);
};

/** @param {string} family */
export const removeFont = async (family) => {
	await idbWrite(FONT_FILES, { remove: [family] });
	stored = stored.filter((f) => f.family !== family);
	for (const face of inPage.get(family) ?? []) document.fonts.delete(face);
	inPage.delete(family);
	changed();
};

// ---------------------------------------------------------------------------
// The dialog: add from Google Fonts or a file, and the list of what's been added.

const dialog = /** @type {HTMLDialogElement} */ ($("#fontDialog"));
const status = $("#fontStatus");
/** @type {((family: string) => void) | null} */
let picked = null;

const say = (text, error = false) => {
	status.textContent = text;
	status.classList.toggle("problem", error);
};

const renderList = () => {
	$("#customFontList").replaceChildren(
		...stored.map((f) => {
			const remove = el(
				"button",
				{
					type: "button",
					className: "icon-button",
					title: "Remove",
					"aria-label": `Remove ${f.family}`,
				},
				icon("trash-2"),
			);
			remove.addEventListener("click", () => removeFont(f.family));
			return el(
				"li",
				{},
				el(
					"span",
					{ className: "font-name", style: { fontFamily: cssFamily(f.family) } },
					f.family,
				),
				el("span", { className: "hint" }, f.source === "google" ? "Google Fonts" : "File"),
				remove,
			);
		}),
	);
	$("#noCustomFonts").hidden = stored.length > 0;
};

/**
 * Runs an add, saying how it went; a font added from a font menu is then that text's font.
 * @param {() => Promise<string | string[]>} add
 */
const adding = async (add) => {
	say("Adding…");
	try {
		const added = [await add()].flat();
		say(`Added ${added.join(", ")}.`);
		if (added.length && picked) picked(added[0]);
		picked = null;
	} catch (err) {
		say(err.message, true);
	}
};

$("#addGoogleFont").addEventListener("click", () =>
	adding(() => addGoogleFont($("#googleFont").value)),
);
// Enter adds it, rather than closing the dialog.
$("#googleFont").addEventListener("keydown", (ev) => {
	if (ev.key !== "Enter") return;
	ev.preventDefault();
	$("#addGoogleFont").click();
});
$("#addFontFile").addEventListener("click", () => $("#fontFile").click());
$("#fontFile").addEventListener("change", (ev) => {
	const input = /** @type {HTMLInputElement} */ (ev.target);
	const files = [...input.files];
	input.value = "";
	if (files.length) adding(() => addFontFiles(files));
});

/**
 * Opens the dialog. `onPicked` gets the first family added, so a font menu can switch to it.
 * @param {(family: string) => void} [onPicked]
 */
export const openFontDialog = (onPicked) => {
	picked = onPicked ?? null;
	say("");
	$("#googleFont").value = "";
	dialog.showModal();
	$("#googleFont").focus();
};

/** Loads the fonts added before, once the page is up. */
export const customFontsReady = idbAll(FONT_FILES)
	.then((fonts) => {
		stored = fonts;
		for (const font of stored) putInPage(font);
		changed();
	})
	.catch((err) => console.warn("couldn't load added fonts:", err));

fillFontLists();
