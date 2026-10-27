import {
	ALIGN,
	BARCODE_TYPES,
	IMAGE_MODES,
	IMAGE_FITS,
	FIRST_LINE_SCALES,
	LIMITS,
	QR_LEVELS,
	ROTATIONS,
	SHAPES,
	VALIGN,
	WEIGHTS,
	createText,
	createShape,
	createBarcode,
	createQr,
	createImage,
	normalizeText,
} from "./model.js";
import { STORAGE_ID, REPO_URL } from "./app-info.js";
import { STYLE_PROPS } from "./richtext.js";

export const FORMAT_ID = `${STORAGE_ID}-label`;
export const CURRENT_VERSION = 1;
export const FILE_EXTENSION = ".label";

export class LabelFileError extends Error {}

/**
 * @param {import("./model.js").Doc} doc
 * @param {{selectedIds?: string[]}} [editor]
 * @returns {string} pretty JSON, so files diff and hand-edit nicely
 */
export const serialize = (doc, editor = {}) =>
	JSON.stringify(
		{
			format: FORMAT_ID,
			// Says what made the file, for anyone who finds one; never read back.
			app: REPO_URL,
			version: CURRENT_VERSION,
			label: doc.label,
			elements: doc.elements,
			editor: { selectedIds: editor.selectedIds ?? [] },
		},
		null,
		"\t",
	);

export const TOO_LARGE = `This is bigger than any label can be (over ${LIMITS.fileChars / 1e6} MB).`;

/**
 * Validates and normalizes a .label file.
 * @returns {{doc: import("./model.js").Doc, editor: {selectedIds: string[]}}}
 */
export const parse = (text) => {
	if (text.length > LIMITS.fileChars) throw new LabelFileError(TOO_LARGE);
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new LabelFileError("This file isn't valid JSON, so it can't be a .label file.");
	}
	if (!isObject(raw) || raw.format !== FORMAT_ID) {
		throw new LabelFileError("This doesn't look like a label file (missing format marker).");
	}
	if (!Number.isInteger(raw.version) || raw.version < 1) {
		throw new LabelFileError("The label file has no valid version number.");
	}
	// Files from older versions get migrated here, one step per version, once there are any.
	if (raw.version > CURRENT_VERSION) {
		throw new LabelFileError(
			`This label was saved by a newer version of the app (file v${raw.version}, app supports v${CURRENT_VERSION}).`,
		);
	}
	const label = checkLabel(raw.label);
	const elements = checkElements(raw.elements);
	const ids = new Set(elements.map((e) => e.id));

	const ed = isObject(raw.editor) ? raw.editor : {};
	const selectedIds = Array.isArray(ed.selectedIds)
		? [...new Set(ed.selectedIds.filter((id) => typeof id === "string" && ids.has(id)))]
		: [];
	return { doc: { label, elements }, editor: { selectedIds } };
};

/** @returns {import("./model.js").Element[]} */
const checkElements = (list) => {
	if (!Array.isArray(list)) throw new LabelFileError("“elements” must be a list.");
	const elements = list.map((e, i) => checkElement(e, `element ${i + 1}`));
	const ids = new Set();
	for (const e of elements) {
		if (ids.has(e.id)) throw new LabelFileError(`Two elements share the id “${e.id}”.`);
		ids.add(e.id);
	}
	return elements;
};

// Copied elements on the clipboard, so they can be pasted into another label or tab.
const ELEMENTS_FORMAT = `${STORAGE_ID}-elements`;

/** @param {import("./model.js").Element[]} elements */
export const serializeElements = (elements) =>
	JSON.stringify({ format: ELEMENTS_FORMAT, version: CURRENT_VERSION, elements });

/**
 * Elements copied from this app, validated like a file's; null if the text is anything else
 * (so it can be pasted as plain text instead).
 * @returns {import("./model.js").Element[] | null}
 */
export const parseElements = (text) => {
	let raw;
	try {
		raw = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isObject(raw) || raw.format !== ELEMENTS_FORMAT) return null;
	if (!Number.isInteger(raw.version) || raw.version < 1 || raw.version > CURRENT_VERSION) {
		throw new LabelFileError("These elements were copied from a newer version of the app.");
	}
	return checkElements(raw.elements);
};

const checkLabel = (l) => {
	if (!isObject(l)) throw new LabelFileError("The label size is missing.");
	return {
		widthMm: num(l.widthMm, "label width", LIMITS.labelWidthMm),
		heightMm: num(l.heightMm, "label height", LIMITS.labelHeightMm),
		continuous: bool(l.continuous ?? false, "continuous label"),
		// Only present when on, and only on continuous rolls.
		...(l.continuous && bool(l.autoLength ?? false, "auto length") ? { autoLength: true } : {}),
	};
};

/**
 * What an element may leave out, and what it means then: the value a new element gets. A
 * property added in a later version then needs no migration, and hand-written files can stay
 * short. Where an element is, how big, and what it shows have to be there.
 */
const OPTIONAL = Object.fromEntries(
	[createText, createShape, createBarcode, createQr, createImage].map((make) => {
		const element = /** @type {Record<string, unknown>} */ (make({ label: null, elements: [] }));
		const { id, type, x, y, w, h, text, data, src, ...rest } = element;
		return [type, rest];
	}),
);

/** @returns {import("./model.js").Element} */
const checkElement = (raw, where) => {
	if (!isObject(raw)) throw new LabelFileError(`${where} is not an object.`);
	const e = { ...OPTIONAL[raw.type], ...raw };
	if (typeof e.id !== "string" || !e.id) throw new LabelFileError(`${where} has no id.`);
	// Key order mirrors model.js so a save → load → save round trip is byte-identical.
	const box = {
		id: e.id,
		type: e.type,
		x: num(e.x, `${where} x`, [-1000, 1000]),
		y: num(e.y, `${where} y`, [-1000, 1000]),
		w: num(e.w, `${where} width`, [LIMITS.elementMinMm, 1000]),
		h: num(e.h, `${where} height`, [LIMITS.elementMinMm, 1000]),
		rotation: oneOf(e.rotation, ROTATIONS, `${where} rotation`),
	};
	if (e.type === "text") {
		const element = /** @type {import("./model.js").TextElement} */ ({
			...box,
			type: "text",
			text: richText(e.text, `${where} text`),
			fontFamily: str(e.fontFamily, `${where} font`) || "sans-serif",
			fontSizePt: num(e.fontSizePt, `${where} font size`, LIMITS.fontSizePt),
			fontWeight: oneOf(e.fontWeight, WEIGHTS, `${where} weight`),
			italic: bool(e.italic, `${where} italic`),
			align: oneOf(e.align, ALIGN, `${where} alignment`),
			vAlign: oneOf(e.vAlign, VALIGN, `${where} vertical alignment`),
			fit: bool(e.fit, `${where} fit`),
			invert: bool(e.invert, `${where} invert`),
			letterSpacingPt: num(e.letterSpacingPt, `${where} letter spacing`, LIMITS.letterSpacingPt),
			underline: bool(e.underline, `${where} underline`),
			outline: bool(e.outline, `${where} outline`),
			stacked: bool(e.stacked, `${where} stacked`),
			firstLineScale: oneOf(e.firstLineScale, FIRST_LINE_SCALES, `${where} first line size`),
			ditherEmoji: bool(e.ditherEmoji, `${where} dithered emoji`),
		});
		// Hand-written runs needn't be in their one written form; saving puts them in it.
		return { ...element, text: normalizeText(element) };
	}
	if (e.type === "shape") {
		return {
			...box,
			shape: oneOf(e.shape, SHAPES, `${where} shape`),
			strokeMm: num(e.strokeMm, `${where} line thickness`, LIMITS.strokeMm),
			fill: bool(e.fill, `${where} fill`),
			radiusMm: num(e.radiusMm, `${where} corner radius`, LIMITS.radiusMm),
		};
	}
	// Code content isn't validated here: a half-typed EAN is a normal editing state, and the
	// renderer shows why it can't be drawn yet.
	if (e.type === "barcode") {
		return {
			...box,
			data: str(e.data, `${where} barcode data`),
			symbology: oneOf(e.symbology, BARCODE_TYPES, `${where} barcode type`),
			showText: bool(e.showText, `${where} show text`),
			textFont: str(e.textFont, `${where} caption font`) || "Roboto Condensed",
		};
	}
	if (e.type === "qr") {
		return {
			...box,
			data: str(e.data, `${where} QR data`),
			level: oneOf(e.level, QR_LEVELS, `${where} error correction`),
		};
	}
	if (e.type === "image") {
		const src = str(e.src, `${where} image`);
		// Embedded data only: a URL would break offline use and could leak when a file is opened.
		if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(src)) {
			throw new LabelFileError(`${where} must contain an embedded PNG, JPEG, WebP or GIF image.`);
		}
		if (src.length > LIMITS.imageSrcChars)
			throw new LabelFileError(`${where} has an image that's too large.`);
		const level = num(e.level, `${where} darkness`, [0, 255]);
		return {
			...box,
			src,
			mode: oneOf(e.mode, IMAGE_MODES, `${where} image mode`),
			level: Math.round(level),
			invert: bool(e.invert, `${where} invert`),
			fit: oneOf(e.fit, IMAGE_FITS, `${where} fit`),
			align: oneOf(e.align, ALIGN, `${where} alignment`),
			vAlign: oneOf(e.vAlign, VALIGN, `${where} vertical alignment`),
		};
	}
	throw new LabelFileError(`${where} has unknown type “${e.type}”.`);
};

/**
 * A text's `text`: a string, or runs, each a string or a [style, string] pair.
 * @returns {import("./richtext.js").RichText}
 */
const richText = (v, what) => {
	if (typeof v === "string") return v;
	if (!Array.isArray(v)) throw new LabelFileError(`${what} must be text, or a list of runs.`);
	return v.map((run, i) => {
		if (typeof run === "string") return run;
		const part = `${what} part ${i + 1}`;
		if (!Array.isArray(run) || run.length !== 2 || !isObject(run[0]))
			throw new LabelFileError(`${part} must be text, or a style and text.`);
		return /** @type {[import("./richtext.js").Style, string]} */ ([
			checkStyle(run[0], part),
			str(run[1], part),
		]);
	});
};

/** @returns {import("./richtext.js").Style} */
const checkStyle = (style, where) => {
	const known = /** @type {readonly string[]} */ (STYLE_PROPS);
	const unknown = Object.keys(style).find((k) => !known.includes(k));
	if (unknown) throw new LabelFileError(`${where} has an unknown style “${unknown}”.`);
	return {
		...("fontWeight" in style && {
			fontWeight: oneOf(style.fontWeight, WEIGHTS, `${where} weight`),
		}),
		...("italic" in style && { italic: bool(style.italic, `${where} italic`) }),
		...("underline" in style && { underline: bool(style.underline, `${where} underline`) }),
	};
};

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** @param {readonly number[]} range [min, max] */
const num = (v, what, range) => {
	const [lo, hi] = range;
	if (typeof v !== "number" || !Number.isFinite(v))
		throw new LabelFileError(`${what} must be a number.`);
	if (v < lo || v > hi)
		throw new LabelFileError(`${what} must be between ${lo} and ${hi} (got ${v}).`);
	return v;
};
const str = (v, what) => {
	if (typeof v !== "string") throw new LabelFileError(`${what} must be text.`);
	return v;
};
const bool = (v, what) => {
	if (typeof v !== "boolean") throw new LabelFileError(`${what} must be true or false.`);
	return v;
};
const oneOf = (v, options, what) => {
	if (!options.includes(v))
		throw new LabelFileError(`${what} must be one of ${options.join(", ")}.`);
	return v;
};
