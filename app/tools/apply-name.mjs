// Stamps the name from src/app-info.js into the files that can't import it: the page title,
// heading, disclaimer and source link in index.html, the web app manifest, and the generated
// parts of the repository's README.md (title, site link, supported printers, disclaimer).
//   npm run name
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { PRINTERS } from "../src/printers/index.js";
import {
	APP_NAME,
	APP_SHORT_NAME,
	APP_DESCRIPTION,
	DISCLAIMER,
	REPO_URL,
} from "../src/app-info.js";

const root = new URL("../", import.meta.url);
export const README = new URL("../README.md", root);

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * index.html with the name in place. Elements with data-app="name" get the name, and links
 * with data-app="repo" point at the repository.
 */
export const stampPage = (html) =>
	html
		.replace(/(<a [^>]*data-app="repo"[^>]*>)/g, (tag) =>
			tag.replace(/href="[^"]*"/, `href="${escapeHtml(REPO_URL)}"`),
		)
		.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(APP_NAME)}</title>`)
		.replace(
			/(<meta\s+name="description"\s+content=")[^"]*(")/,
			(_, a, b) => a + escapeHtml(APP_DESCRIPTION) + b,
		)
		.replace(
			/(<[a-z0-9]+ [^>]*data-app="(name|disclaimer)"[^>]*>)[^<]*(<)/g,
			(_, open, which, close) =>
				open + escapeHtml(which === "name" ? APP_NAME : DISCLAIMER) + close,
		);

/** The manifest with the name in place, keeping its layout. */
export const stampManifest = (text) => {
	const fields = { name: APP_NAME, short_name: APP_SHORT_NAME, description: APP_DESCRIPTION };
	for (const [key, value] of Object.entries(fields)) {
		text = text.replace(new RegExp(`("${key}": )"[^"]*"`), (_, a) => a + JSON.stringify(value));
	}
	return text;
};

/** Where the site is published, from the CNAME GitHub Pages serves it under. */
const siteUrl = async () => `https://${(await readFile(new URL("CNAME", root), "utf8")).trim()}/`;

/** The supported printers as a Markdown table, from the printer registry. */
const printerTable = () => {
	const rows = PRINTERS.map((p) => {
		const widths = [...new Set(p.presets.map((l) => l.heightMm))].sort((a, b) => a - b);
		const labels = `${widths.join(", ")} mm pre-cut; ${p.continuousHeightMm} mm continuous`;
		const status = p.tested ? "Tested" : "Untested (should work)";
		return `| ${p.vendor} ${p.name} | ${labels} | ${status} |`;
	});
	return ["| Label maker | Labels | Status |", "| --- | --- | --- |", ...rows].join("\n");
};

/**
 * README.md with its generated blocks filled in. Each sits between
 * `<!-- generated:NAME -->` and `<!-- /generated:NAME -->`; the rest is written by hand.
 */
export const stampReadme = async (text) => {
	const blocks = {
		intro: [`# ${APP_NAME}`, "", APP_DESCRIPTION, "", `**Live site: ${await siteUrl()}**`].join(
			"\n",
		),
		printers: [
			printerTable(),
			"",
			'"Untested" models use the same commands as a tested one, so they should work, but nobody',
			"has confirmed it yet. If you have one, please try it: after its first print, the app asks",
			"whether it came out right, so you can confirm it works or report a problem. You can also",
			`open an [issue](${REPO_URL}/issues).`,
		].join("\n"),
		disclaimer: `_${DISCLAIMER}_`,
	};
	for (const [name, content] of Object.entries(blocks)) {
		const re = new RegExp(`(<!-- generated:${name} -->)[\\s\\S]*?(<!-- /generated:${name} -->)`);
		if (!re.test(text)) throw new Error(`README.md has no generated:${name} block`);
		text = text.replace(re, (_, open, close) => `${open}\n\n${content}\n\n${close}`);
	}
	return format(text, { ...(await resolveConfig(fileURLToPath(README))), parser: "markdown" });
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const page = new URL("index.html", root);
	await writeFile(page, stampPage(await readFile(page, "utf8")));
	const manifest = new URL("manifest.webmanifest", root);
	await writeFile(manifest, stampManifest(await readFile(manifest, "utf8")));
	await writeFile(README, await stampReadme(await readFile(README, "utf8")));
	console.log(`index.html, manifest.webmanifest and README.md now say "${APP_NAME}"`);
}
