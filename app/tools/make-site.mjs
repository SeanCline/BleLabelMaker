// Builds the deployable site: exactly the files the app loads (the service worker's list),
// the worker itself, the license files and CNAME. Tests, tools and docs stay behind.
//   node tools/make-site.mjs [out-dir]     (default: _site)
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

/** The commit being built, short as git shows it; CI says which, else ask git. */
export const currentCommit = () =>
	process.env.GITHUB_SHA?.slice(0, 7) ??
	execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8" }).trim();

/** app-info.js with the commit filled in, so the footer and bug reports name the build. */
export const stampCommit = (source, commit) => {
	const stamped = source.replace(/APP_COMMIT = ""/, `APP_COMMIT = "${commit}"`);
	if (stamped === source) throw new Error("app-info.js has no APP_COMMIT to stamp");
	return stamped;
};

export const buildSite = async (out, commit = currentCommit()) => {
	await rm(out, { recursive: true, force: true });
	await mkdir(out, { recursive: true });
	const files = await siteFiles();
	for (const [to, from] of files) await cp(new URL(from, root), new URL(to, out));
	const info = new URL("src/app-info.js", out);
	await writeFile(info, stampCommit(await readFile(info, "utf8"), commit));
	return files.size;
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const out = new URL(`${process.argv[2] ?? "_site"}/`, root);
	console.log(`${await buildSite(out)} files in ${fileURLToPath(out)}`);
}
