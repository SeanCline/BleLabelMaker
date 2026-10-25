// Builds the deployable site: exactly the files the app loads (the service worker's list),
// the worker itself, the license files and CNAME. Tests, tools and docs stay behind.
//   node tools/make-site.mjs [out-dir]     (default: _site)
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { appFiles } from "./make-precache.mjs";

const root = new URL("../", import.meta.url);

/** Published path → source, relative to app/. */
export const siteFiles = async () => {
	const files = new Map();
	for (const f of await appFiles()) if (f !== "./") files.set(f, f);
	for (const f of ["sw.js", "precache.js", "CNAME", "src/vendor/LICENSE.txt"]) files.set(f, f);
	// The app's own license lives at the repository root, where GitHub looks for it.
	files.set("LICENSE.txt", "../LICENSE.txt");
	return files;
};

export const buildSite = async (out) => {
	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	const files = await siteFiles();
	for (const [to, from] of files) await cp(new URL(from, root), new URL(to, out));
	return files.size;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const out = new URL(`${process.argv[2] ?? "_site"}/`, root);
	console.log(`${await buildSite(out)} files in ${fileURLToPath(out)}`);
}
