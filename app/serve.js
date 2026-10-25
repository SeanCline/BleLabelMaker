// Zero-dependency static server. Web Bluetooth only works in a secure context, and
// http://localhost counts as one, so plain HTTP is all that's needed for printing from this
// machine. Other devices on the network need HTTPS: run tools/make-cert.mjs, then HTTPS=1.
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME } from "./src/app-info.js";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
// Outside root on purpose: everything under root is served, and that must never include a key.
const certDir = resolve(root, "..", "certs");
const types = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".webmanifest": "application/manifest+json",
	".label": "application/json",
	".svg": "image/svg+xml",
	".png": "image/png",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
};

const serveFile = async (req, res, extra) => {
	const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
	if (extra[path]) {
		res
			.writeHead(200, { "content-type": extra[path].type, "cache-control": "no-cache" })
			.end(extra[path].body);
		return;
	}
	const file = normalize(join(root, path.endsWith("/") ? path + "index.html" : path));
	if (file !== root && !file.startsWith(root + sep)) {
		res.writeHead(403).end();
		return;
	}
	try {
		const body = await readFile(file);
		res.writeHead(200, {
			"content-type": types[extname(file)] ?? "application/octet-stream",
			"cache-control": "no-cache",
		});
		res.end(body);
	} catch {
		res.writeHead(404).end("not found");
	}
};

/** Reads the certificate made by tools/make-cert.mjs. */
export const loadCert = () => {
	try {
		return {
			key: readFileSync(join(certDir, "server.key")),
			cert: readFileSync(join(certDir, "server.crt")),
			ca: readFileSync(join(certDir, "ca.crt")),
		};
	} catch {
		throw new Error(`No certificate in ${certDir}. Run: node tools/make-cert.mjs`);
	}
};

/**
 * @param {number} port 0 picks a free one
 * @param {{host?: string, tls?: {key: Buffer, cert: Buffer, ca?: Buffer}}} options
 * @returns {Promise<{server: import("node:http").Server, url: string}>}
 */
export const startServer = (port = 8080, { host = "127.0.0.1", tls } = {}) =>
	new Promise((done) => {
		// Devices have to trust the CA before HTTPS works, so make it easy to fetch from them.
		const extra = {
			// The app's license sits at the repository root; the deployed site has it at its own.
			"/LICENSE.txt": { type: types[".txt"], body: readFileSync(join(root, "..", "LICENSE.txt")) },
			...(tls?.ca && { "/ca.crt": { type: "application/x-x509-ca-cert", body: tls.ca } }),
		};
		const handler = (req, res) => serveFile(req, res, extra);
		const server = tls
			? createSecureServer({ key: tls.key, cert: tls.cert }, handler)
			: createServer(handler);
		const scheme = tls ? "https" : "http";
		server.listen(port, host, () =>
			done({
				server,
				url: `${scheme}://localhost:${/** @type {import("node:net").AddressInfo} */ (server.address()).port}/`,
			}),
		);
	});

/**
 * Sends plain-HTTP visitors to the HTTPS site, so old http:// bookmarks keep working. The CA is
 * the exception: a device fetches it before it trusts the HTTPS site, so it has to come over HTTP.
 */
const startRedirect = (port, host, httpsPort, ca) =>
	new Promise((done) => {
		const server = createServer((req, res) => {
			if (ca && req.url === "/ca.crt") {
				res.writeHead(200, { "content-type": "application/x-x509-ca-cert" }).end(ca);
				return;
			}
			const name = (req.headers.host ?? "localhost").replace(/:\d+$/, "");
			res
				.writeHead(301, {
					location: `https://${name}${httpsPort === 443 ? "" : `:${httpsPort}`}${req.url}`,
				})
				.end();
		});
		server.listen(port, host, () => done(server));
	});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	// --lan is the usual setup for testing from a phone, spelled out so it works in npm scripts on
	// Windows, where VAR=value prefixes don't.
	const lan = process.argv.includes("--lan")
		? { HTTPS: "1", HOST: "0.0.0.0", REDIRECT_PORT: "80" }
		: {};
	/** @type {Record<string, string | undefined>} */
	const env = { ...lan, ...process.env };
	const tls = env.HTTPS ? loadCert() : undefined;
	// HOST=0.0.0.0 opens it to the network; the default keeps it private to this machine.
	const host = env.HOST || "127.0.0.1";
	const port = Number(env.PORT) || (tls ? 443 : 8080);
	await startServer(port, { host, tls });
	const shown = host === "127.0.0.1" ? "localhost" : hostname().toLowerCase();
	const scheme = tls ? "https" : "http";
	console.log(
		`${APP_NAME}: ${scheme}://${shown}${(tls ? port === 443 : port === 80) ? "" : `:${port}`}/`,
	);
	if (tls && env.REDIRECT_PORT) {
		await startRedirect(Number(env.REDIRECT_PORT), host, port, tls.ca);
		console.log(`Redirecting http on port ${env.REDIRECT_PORT} to HTTPS`);
		const portSuffix = env.REDIRECT_PORT === "80" ? "" : `:${env.REDIRECT_PORT}`;
		console.log(`Trust the CA on other devices: http://${shown}${portSuffix}/ca.crt`);
	} else if (tls) console.log(`Trust the CA on other devices: ${scheme}://${shown}/ca.crt`);
}
