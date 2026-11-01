// Icons from Material Design Icons, an icon font: in text they're characters like emoji, so
// they wrap, size and invert with it. The font and its table of names (fonts/mdi.woff2 and
// mdi.json, from tools/fetch-fonts.mjs) are only fetched once something needs them.
export const ICON_FONT = "Material Design Icons";

// The font's icons are all in Supplementary Private Use Area-A, which nothing else draws.
const ICON_RE = /[\u{F0000}-\u{FFFFD}]/u;
export const hasIcon = (s) => ICON_RE.test(s);

/** @typedef {{char: string, name: string, words: string}} Icon */

/** @param {[number, string, string][]} table */
export const iconsFromTable = (table) =>
	table.map(([cp, name, words]) => ({ char: String.fromCodePoint(cp), name, words }));

/** @type {Promise<Icon[]> | null} */
let loading = null;
/** The picker's icons, fetched once; empty if they can't be (offline before they were cached). */
export const loadIcons = () =>
	(loading ??= fetch("fonts/mdi.json")
		.then((res) => (res.ok ? res.json() : []))
		.then(iconsFromTable)
		.catch(() => {
			loading = null;
			return [];
		}));

/**
 * A search word and what it might be in the singular, which is how MDI names things: "boxes"
 * looks for box, "batteries" for battery. English is irregular ("cookies", "glasses"), so every
 * likely form is tried rather than one guessed.
 */
const singulars = (t) => {
	if (t.length < 4) return [t];
	const forms = [t];
	if (t.endsWith("ies")) forms.push(t.slice(0, -3) + "y");
	if (/(s|x|z|ch|sh)es$/.test(t)) forms.push(t.slice(0, -2));
	if (t.endsWith("s") && !t.endsWith("ss")) forms.push(t.slice(0, -1));
	return forms;
};

/**
 * Icons whose words start with every word of the query (or its singular), best first: names
 * that start with it, then those it names outright (an alias or category word), then the rest
 * of the names (MDI names styles after the thing: "account box" is an account in a box, so
 * "box" finds the package before it), then anything else. Within each, the shortest names, which are the
 * plainest ("carrot" before "carrot off"), with outline versions after the filled ones.
 * @param {Icon[]} icons
 */
export const searchIcons = (icons, query) => {
	const terms = query.toLowerCase().split(/\s+/).filter(Boolean).map(singulars);
	if (!terms.length) return [];
	const starts = (w, forms) => forms.some((f) => w.startsWith(f));
	const scored = [];
	for (const icon of icons) {
		const name = icon.name.split(" ");
		const other = icon.words ? icon.words.split(" ") : [];
		const all = [...name, ...other];
		if (!terms.every((forms) => all.some((w) => starts(w, forms)))) continue;
		const first = terms[0];
		const tier = starts(name[0], first)
			? 0
			: first.some((f) => other.includes(f))
				? 1
				: name.some((w) => starts(w, first))
					? 2
					: 3;
		// Filled icons print better than outlines, whose thin lines break up at 8 dots a mm.
		const outline = name.includes("outline") && !terms.some((forms) => starts("outline", forms));
		scored.push({ icon, rank: tier * 1000 + (outline ? 100 : 0) + name.length });
	}
	return scored.sort((a, b) => a.rank - b.rank).map((s) => s.icon);
};
