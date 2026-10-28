import { mapText, textOf } from "./richtext.js";

// Fields in text, barcode and QR data: {date}, {date+30d:iso}, {time}, {n}, {n:000}, {1},
// {Column name}, and {0} for a batch row's whole line. The document keeps the template; each printed label gets its own values.
// {{ and }} stand for literal braces.

/**
 * @typedef {object} FieldContext
 * @property {Date} now
 * @property {number} n counter value for this label
 * @property {string[] | null} row batch row, or null when not printing a batch
 * @property {string} [line] the batch row's line as typed, for {0}; else its values joined
 * @property {string[] | null} columns column names (first row of the batch), if any
 */

export const FIELD = /\{\{|\}\}|\{([^{}]+)\}/g;
const DATE = /^date(?:([+-])(\d+)([dwmy]))?(?::(iso|num))?$/i;
const COUNTER = /^n(?::(0+))?$/i;

/** Calendar arithmetic, so "+1m" on 31 January lands on the last day of February. */
const shiftDate = (date, sign, amount, unit) => {
	const d = new Date(date);
	const k = sign === "-" ? -amount : amount;
	if (unit === "d") d.setDate(d.getDate() + k);
	else if (unit === "w") d.setDate(d.getDate() + 7 * k);
	else {
		const day = d.getDate();
		d.setDate(1);
		if (unit === "m") d.setMonth(d.getMonth() + k);
		else d.setFullYear(d.getFullYear() + k);
		const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
		d.setDate(Math.min(day, last));
	}
	return d;
};

const pad = (v) => String(v).padStart(2, "0");
const formatDate = (d, format) => {
	if (format === "iso") return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	if (format === "num") return d.toLocaleDateString();
	return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

/**
 * Looks up one field. Returns null for anything unknown, which is left as typed so a
 * misspelled field shows up on the preview instead of silently vanishing.
 * @param {string} name what's inside the braces
 * @param {FieldContext} ctx
 */
const valueOf = (name, ctx) => {
	const key = name.trim();
	const date = DATE.exec(key);
	if (date) {
		const [, sign, amount, unit, format] = date;
		const d = sign ? shiftDate(ctx.now, sign, Number(amount), unit.toLowerCase()) : ctx.now;
		return formatDate(d, format?.toLowerCase());
	}
	if (/^time$/i.test(key))
		return ctx.now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	const counter = COUNTER.exec(key);
	if (counter) return String(ctx.n).padStart(counter[1]?.length ?? 0, "0");
	if (!ctx.row) return null;
	if (key === "0") return ctx.line ?? ctx.row.join(", ");
	if (/^\d+$/.test(key)) return ctx.row[Number(key) - 1] ?? "";
	const col = ctx.columns?.findIndex((c) => c.trim().toLowerCase() === key.toLowerCase()) ?? -1;
	return col >= 0 ? (ctx.row[col] ?? "") : null;
};

/** @param {string} text @param {FieldContext} ctx */
export const fillFields = (text, ctx) =>
	text.replace(FIELD, (m, name) => {
		if (m === "{{") return "{";
		if (m === "}}") return "}";
		return valueOf(name, ctx) ?? m;
	});

// The element properties that can hold fields.
const TEMPLATED = { text: "text", barcode: "data", qr: "data" };

/**
 * The document as it prints for one label.
 * @param {import("./model.js").Doc} doc
 * @param {FieldContext} ctx
 * @param {{except?: string|null}} [options] an element to leave as typed (the one being edited)
 * @returns {import("./model.js").Doc}
 */
export const fillDocument = (doc, ctx, { except = null } = {}) => ({
	...doc,
	elements: doc.elements.map((e) => {
		const prop = TEMPLATED[e.type];
		if (!prop || e.id === except || !textOf(e[prop]).includes("{")) return e;
		// Run by run: a field never spans two (see normalizeText).
		return { ...e, [prop]: mapText(e[prop], (s) => fillFields(s, ctx)) };
	}),
});

/**
 * Which kinds of field a document uses, to decide what the print bar offers: a counter start,
 * per-label rendering, batch columns.
 * @param {import("./model.js").Doc} doc
 */
export const fieldsUsed = (doc) => {
	const used = { counter: false, date: false, columns: false, any: false };
	for (const e of doc.elements) {
		const prop = TEMPLATED[e.type];
		if (!prop) continue;
		for (const [, name] of textOf(e[prop]).matchAll(FIELD)) {
			if (!name) continue; // {{ or }}
			const key = name.trim();
			used.any = true;
			if (COUNTER.test(key)) used.counter = true;
			else if (DATE.test(key) || /^time$/i.test(key)) used.date = true;
			else used.columns = true;
		}
	}
	return used;
};
