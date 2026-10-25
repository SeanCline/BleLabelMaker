import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
	APP_NAME,
	APP_SHORT_NAME,
	APP_DESCRIPTION,
	APP_VERSION,
	DISCLAIMER,
	REPO_URL,
} from "../src/app-info.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const text = (html) => html.replace(/\s+/g, " ").trim();

test("the page and manifest carry the name from app-info.js (npm run name)", async () => {
	const html = await read("index.html");
	assert.equal(text(html.match(/<title>([^<]*)<\/title>/)[1]), APP_NAME);
	assert.match(html, new RegExp(`<meta\\s+name="description"\\s+content="${APP_DESCRIPTION}"`));
	const stamped = [...html.matchAll(/data-app="(name|disclaimer)"[^>]*>([^<]*)</g)];
	assert.ok(stamped.length >= 2);
	for (const [, which, content] of stamped) {
		assert.equal(text(content), which === "name" ? APP_NAME : DISCLAIMER, which);
	}
	const manifest = JSON.parse(await read("manifest.webmanifest"));
	assert.deepEqual(
		[manifest.name, manifest.short_name, manifest.description],
		[APP_NAME, APP_SHORT_NAME, APP_DESCRIPTION],
	);
	const repoLinks = [...html.matchAll(/<a [^>]*data-app="repo"[^>]*>/g)];
	assert.ok(repoLinks.length >= 1);
	for (const [tag] of repoLinks) assert.match(tag, new RegExp(`href="${REPO_URL}"`));
});

test("the repository's README.md is up to date (npm run name)", async () => {
	const { stampReadme, README } = await import("../tools/apply-name.mjs");
	const readme = await readFile(README, "utf8");
	assert.equal(await stampReadme(readme), readme);
});

test("the version bug reports give is package.json's", async () => {
	assert.equal(APP_VERSION, JSON.parse(await read("package.json")).version);
});

test("outside the printer drivers, nothing names a printer brand", async () => {
	const { execFileSync } = await import("node:child_process");
	const files = execFileSync("git", ["ls-files", "src", "index.html", "styles.css"], {
		cwd: new URL("..", import.meta.url),
		encoding: "utf8",
	})
		.split("\n")
		.filter((f) => f && !f.startsWith("src/printers/") && !f.startsWith("src/vendor/"));
	for (const f of files) {
		assert.doesNotMatch(await read(f), /phomemo|\bd30\b/i, f);
	}
});
