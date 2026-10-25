// Batch data: the rows a batch print makes one label each from. Text pasted from a
// spreadsheet arrives tab-separated, so tabs split columns; a .csv file is parsed as CSV;
// anything else is one value per line (a comma in "Salt, fine" stays part of the value).

/**
 * Parses CSV per RFC 4180: quoted fields may hold commas, quotes ("") and line breaks.
 * @param {string} text
 * @returns {string[][]}
 */
export const parseCsv = (text) => {
	const rows = [];
	let row = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quoted) {
			if (c === '"' && text[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"' && field === "") quoted = true;
		else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else field += c;
	}
	if (field !== "" || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows;
};

/**
 * @param {string} text
 * @param {{csv?: boolean, headings?: boolean}} [options]
 *   csv: parse as CSV (a .csv file); headings: the first row names the columns
 * @returns {{columns: string[] | null, rows: string[][]}}
 */
export const parseBatch = (text, { csv = false, headings = false } = {}) => {
	let rows;
	if (csv) rows = parseCsv(text);
	else {
		const lines = text.split(/\r?\n/);
		rows = lines.map((l) => (text.includes("\t") ? l.split("\t") : [l]));
	}
	rows = rows.map((r) => r.map((v) => v.trim())).filter((r) => r.some((v) => v !== ""));
	const columns = headings && rows.length ? rows.shift() : null;
	return { columns, rows };
};
