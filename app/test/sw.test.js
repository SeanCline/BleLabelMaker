import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildPrecache } from "../tools/make-precache.mjs";

test("precache.js is up to date, so offline loads get every app file", async () => {
	const current = await readFile(new URL("../precache.js", import.meta.url), "utf8");
	assert.equal(current, await buildPrecache(), "run: node tools/make-precache.mjs");
});

test("the precache covers the page, its modules and the fonts", async () => {
	const ctx = {};
	new Function("self", await buildPrecache())(ctx);
	for (const f of ["./", "index.html", "src/app.js", "src/ui/stage.js", "fonts/fonts.css"]) {
		assert.ok(ctx.PRECACHE.includes(f), f);
	}
	assert.ok(ctx.PRECACHE.some((f) => f.endsWith(".woff2")));
	assert.match(ctx.CACHE_NAME, /^labelmaker-[0-9a-f]{12}$/);
});

test("the deployed site has the app, its licenses and CNAME, and no tests or tools", async () => {
	const { siteFiles } = await import("../tools/make-site.mjs");
	const files = [...(await siteFiles()).keys()];
	for (const f of ["index.html", "sw.js", "precache.js", "CNAME", "LICENSE.txt"]) {
		assert.ok(files.includes(f), f);
	}
	for (const f of ["fonts/LICENSE.txt", "src/vendor/LICENSE.txt"]) assert.ok(files.includes(f), f);
	assert.ok(!files.some((f) => /^(test|tools|node_modules)\/|\.md$|serve\.js/.test(f)));
	// Every local link in the page's footer resolves to a published file.
	const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
	const footer = html.slice(html.indexOf("<footer"), html.indexOf("</footer>"));
	for (const [, href] of footer.matchAll(/href="([^"]+)"/g)) {
		if (!/^https:/.test(href)) assert.ok(files.includes(href), href);
	}
});

test("the deployed site's version names the commit it was built from", async () => {
	const { stampCommit } = await import("../tools/make-site.mjs");
	const source = await readFile(new URL("../src/app-info.js", import.meta.url), "utf8");
	const stamped = stampCommit(source, "82a1907");
	// app-info.js imports nothing, so the stamped copy loads on its own.
	const info = await import(`data:text/javascript,${encodeURIComponent(stamped)}`);
	assert.equal(info.BUILD_VERSION, `${info.APP_VERSION}-82a1907`);
	assert.throws(() => stampCommit(stamped, "82a1907"), /APP_COMMIT/);
});

test("the manifest's icons are published, and one is maskable for Android", async () => {
	const { siteFiles } = await import("../tools/make-site.mjs");
	const files = await siteFiles();
	const manifest = JSON.parse(
		await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"),
	);
	for (const { src } of manifest.icons) assert.ok(files.has(src), src);
	assert.ok(manifest.icons.some((i) => i.purpose === "maskable"));
});
