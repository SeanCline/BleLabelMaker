// Downloads the app's fonts from Google Fonts into fonts/ and writes fonts/fonts.css, so the
// app never needs the network at runtime, and fonts/LICENSE.txt with each family's license
// from the google/fonts repository. Re-run after changing FONTS in src/text/fonts.js:
//   node tools/fetch-fonts.mjs
// or, to rewrite only the licenses:
//   node tools/fetch-fonts.mjs --licenses
// or only the icon font (Material Design Icons, from npm) and its name table:
//   node tools/fetch-fonts.mjs --icons
import { mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { FONTS, EMOJI_MONO_GOOGLE } from "../src/text/fonts.js";
import { ICON_FONT } from "../src/text/icons.js";

const OUT = new URL("../fonts/", import.meta.url);
// Labels are short Latin-script text; skipping Cyrillic/Greek/Vietnamese subsets keeps the
// download small. The emoji font keeps every subset since emoji live across many ranges.
const TEXT_SUBSETS = new Set(["latin", "latin-ext"]);
// Google serves woff2 with unicode-range subsets only to modern browsers.
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const families = [
	...FONTS.filter((f) => f.google).map((f) => ({ spec: f.google, emoji: false })),
	{ spec: EMOJI_MONO_GOOGLE, emoji: true },
];

/**
 * google/fonts keeps each family in ofl/, apache/ or ufl/ under its name without spaces, with
 * the license text (and, for OFL, the copyright line) alongside.
 */
const fetchLicense = async (name) => {
	const dir = name.toLowerCase().replace(/[^a-z0-9]/g, "");
	for (const [folder, file, license] of [
		["ofl", "OFL.txt", "SIL Open Font License 1.1"],
		["apache", "LICENSE.txt", "Apache License 2.0"],
		["ufl", "UFL.txt", "Ubuntu Font Licence 1.0"],
	]) {
		const url = `https://raw.githubusercontent.com/google/fonts/main/${folder}/${dir}/${file}`;
		const res = await fetch(url);
		if (res.ok) return { name, license, url, text: (await res.text()).trim() };
	}
	throw new Error(`no license found for ${name} in google/fonts`);
};

// Pinned: a later major version drops icons, and a label keeps only the character it drew.
const MDI = "https://cdn.jsdelivr.net/npm/@mdi";
const MDI_VERSION = "7.4.47";

const writeLicenses = async () => {
	const names = families.map(({ spec }) =>
		decodeURIComponent(spec.split(":")[0]).replace(/\+/g, " "),
	);
	const found = [];
	for (const name of names) found.push(await fetchLicense(name));
	const mdiLicense = `${MDI}/font@${MDI_VERSION}/LICENSE`;
	found.push({
		name: ICON_FONT,
		license: "Pictogrammers Free License (Apache License 2.0)",
		url: mdiLicense,
		text: (await (await fetch(mdiLicense)).text()).replace(/\r\n/g, "\n").trim(),
	});
	const width = Math.max(...found.map((f) => f.name.length)) + 2;
	const rule = "=".repeat(78);
	let out = `Fonts bundled with this app, downloaded from Google Fonts by tools/fetch-fonts.mjs.
The .woff2 files are named by a hash of their download address; fonts.css says which family
each one is. mdi.woff2 and mdi.json are the icon font and its names, from npm (@mdi/font and
@mdi/svg ${MDI_VERSION}). Every family's license follows in full.

${found.map((f) => `  ${f.name.padEnd(width)} ${f.license}`).join("\n")}
`;
	for (const f of found)
		out += `\n${rule}\n${f.name} (${f.license})\n${f.url}\n${rule}\n\n${f.text}\n`;
	await writeFile(new URL("LICENSE.txt", OUT), out);
	console.log(`fonts/LICENSE.txt: ${found.length} families`);
};

/**
 * The icon font, and the picker's table of it: [codepoint, name, search words] for each icon
 * worth offering. Brand logos are left out (trademarks, and Pictogrammers is dropping them),
 * as are deprecated icons, which the next major version removes.
 */
const fetchIcons = async () => {
	const font = Buffer.from(
		await (
			await fetch(`${MDI}/font@${MDI_VERSION}/fonts/materialdesignicons-webfont.woff2`)
		).arrayBuffer(),
	);
	await writeFile(new URL("mdi.woff2", OUT), font);
	const meta = await (await fetch(`${MDI}/svg@${MDI_VERSION}/meta.json`)).json();
	const words = (s) =>
		s
			.toLowerCase()
			.split(/[^a-z0-9]+/)
			.filter(Boolean);
	const icons = meta
		.filter((i) => !i.deprecated && !i.tags.includes("Brand / Logo"))
		.map((i) => {
			const name = words(i.name);
			// Aliases and categories, so "trash" finds delete and "food" finds the food icons.
			const extra = [...new Set([...i.aliases.flatMap(words), ...i.tags.flatMap(words)])];
			return [
				parseInt(i.codepoint, 16),
				name.join(" "),
				extra.filter((w) => !name.includes(w)).join(" "),
			];
		});
	const json = JSON.stringify(icons);
	await writeFile(new URL("mdi.json", OUT), json);
	console.log(
		`mdi.woff2 ${(font.length / 1024).toFixed(0)} KB, mdi.json ${icons.length} icons, ${(json.length / 1024).toFixed(0)} KB`,
	);
};

if (process.argv.includes("--licenses")) {
	await writeLicenses();
	process.exit(0);
}
if (process.argv.includes("--icons")) {
	await fetchIcons();
	await writeLicenses();
	process.exit(0);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await writeLicenses();
await fetchIcons();

let css = "/* Generated by tools/fetch-fonts.mjs from Google Fonts. Licenses: LICENSE.txt. */\n";
let bytes = 0;
let files = 0;

for (const { spec, emoji } of families) {
	const res = await fetch(`https://fonts.googleapis.com/css2?family=${spec}&display=block`, {
		headers: { "user-agent": UA },
	});
	if (!res.ok) throw new Error(`${spec}: HTTP ${res.status}`);
	const text = await res.text();
	// Text fonts precede each block with a "/* subset */" comment; the emoji font is split into
	// numbered chunks with no comment at all.
	for (const [, subset = "chunk", block] of text.matchAll(
		/(?:\/\* ([\w-]+) \*\/\s*)?(@font-face \{[^}]+\})/g,
	)) {
		if (!emoji && !TEXT_SUBSETS.has(subset)) continue;
		const url = block.match(/url\((https:[^)]+)\)/)[1];
		const font = Buffer.from(await (await fetch(url)).arrayBuffer());
		const name = `${createHash("sha1").update(url).digest("hex").slice(0, 12)}.woff2`;
		await writeFile(new URL(name, OUT), font);
		css += `/* ${subset} */\n${block.replace(url, name)}\n`;
		bytes += font.length;
		files++;
	}
}
await writeFile(new URL("fonts.css", OUT), css);
console.log(`${files} font files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
