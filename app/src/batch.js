// Batch data: the rows a batch print makes one label each from. Text pasted from a
// spreadsheet arrives tab-separated, so tabs split columns; a .csv file is parsed as CSV, and
// so is other text when every line has the same number of values (2 or more) between its
// commas. Anything else is one value per line: a comma in "Salt, fine" beside a "Pepper"
// stays part of the value. Each row keeps its line as typed, for {0}.

/**
 * CSV rows, each with the text it came from.
 * @param {string} text
 * @returns {{cells: string[], line: string}[]}
 */
const csvRows = (text) => {
	const rows = [];
	let row = [];
	let field = "";
	let quoted = false;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"' && field.trim() === "") {
			// "a", "b": the space after a comma doesn't stop the next value being quoted.
			field = "";
			quoted = true;
		} else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\n" || c === "\r") {
			row.push(field);
			rows.push({ cells: row, line: text.slice(start, i) });
			if (c === "\r" && text[i + 1] === "\n") i++;
			start = i + 1;
			row = [];
			field = "";
		} else field += c;
	}
	if (field !== "" || row.length) {
		row.push(field);
		rows.push({ cells: row, line: text.slice(start) });
	}
	return rows;
};

/**
 * Parses CSV per RFC 4180: quoted fields may hold commas, quotes ("") and line breaks.
 * @param {string} text
 * @returns {string[][]}
 */
export const parseCsv = (text) => csvRows(text).map((r) => r.cells);

/**
 * @template {{cells: string[]}} R
 * @param {R[]} rows
 * @returns {R[]}
 */
const nonBlank = (rows) => rows.filter((r) => r.cells.some((v) => v.trim() !== ""));

/** More than one line, with the same number of values on each, and more than one value. */
const looksLikeCsv = (rows) => {
	const counts = new Set(nonBlank(rows).map((r) => r.cells.length));
	return nonBlank(rows).length > 1 && counts.size === 1 && !counts.has(1);
};

/**
 * @param {string} text
 * @param {{csv?: boolean, headings?: boolean}} [options]
 *   csv: parse as CSV (a .csv file); headings: the first row names the columns
 * @returns {{columns: string[] | null, rows: string[][], lines: string[]}} lines: each row as typed
 */
export const parseBatch = (text, { csv = false, headings = false } = {}) => {
	const tabs = text.includes("\t");
	const asCsv = tabs && !csv ? [] : csvRows(text);
	/** @type {{cells: string[], line: string}[]} */
	let rows;
	if (csv || looksLikeCsv(asCsv)) rows = asCsv;
	else {
		const split = tabs ? (l) => l.split("\t") : (l) => [l];
		rows = text.split(/\r?\n/).map((line) => ({ cells: split(line), line }));
	}
	rows = nonBlank(rows).map((r) => ({ cells: r.cells.map((v) => v.trim()), line: r.line.trim() }));
	const columns = headings && rows.length ? rows.shift().cells : null;
	return { columns, rows: rows.map((r) => r.cells), lines: rows.map((r) => r.line) };
};
