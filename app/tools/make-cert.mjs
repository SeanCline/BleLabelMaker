// Makes a local CA and an HTTPS certificate for testing from other devices on the LAN:
//   node tools/make-cert.mjs [extra-name-or-ip ...]
// Web Bluetooth and service workers need a secure context, which plain http://<hostname> isn't.
// Output goes to ../../certs (outside the served folder, so the static server can't leak the keys).
//
// The CA is name-constrained to exactly the names on the certificate, so a device that trusts it
// can't be fooled by it for any other site even if the CA key gets out. The flip side is that the
// CA is remade every run, and devices need the new ca.crt installed again.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_NAME } from "../src/app-info.js";

const dir = fileURLToPath(new URL("../../certs/", import.meta.url));
mkdirSync(dir, { recursive: true });

const isIp = (s) => /^\d+\.\d+\.\d+\.\d+$/.test(s);
const lanIps = Object.values(networkInterfaces())
	.flat()
	// 169.254.x.x is only ever a fallback address, nobody browses to it.
	.filter((a) => a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254."))
	.map((a) => a.address);
const names = [
	...new Set([
		"localhost",
		hostname().toLowerCase(),
		"127.0.0.1",
		...lanIps,
		...process.argv.slice(2),
	]),
];
const dns = names.filter((n) => !isIp(n));
const ips = names.filter(isIp);

// Git for Windows ships OpenSSL but only puts it on PATH inside Git Bash.
const openssl = [
	"openssl",
	"C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe",
	"C:\\Program Files\\Git\\usr\\bin\\openssl.exe",
].find((exe) => {
	try {
		execFileSync(exe, ["version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
});
if (!openssl) throw new Error("OpenSSL not found. Install Git for Windows or put openssl on PATH.");
const run = (...args) =>
	execFileSync(openssl, args, { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256", "-nodes"];

const constraints = [
	...dns.map((d) => `permitted;DNS:${d}`),
	...ips.map((ip) => `permitted;IP:${ip}/255.255.255.255`),
].join(",");
writeFileSync(
	join(dir, "ca.cnf"),
	`[req]\ndistinguished_name=dn\n[dn]\n[ext]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nnameConstraints=critical,${constraints}\nsubjectKeyIdentifier=hash\n`,
);
writeFileSync(
	join(dir, "server.ext"),
	`basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=${[...dns.map((d) => `DNS:${d}`), ...ips.map((ip) => `IP:${ip}`)].join(",")}\nauthorityKeyIdentifier=keyid\n`,
);

run(
	"req",
	"-x509",
	...ec,
	"-keyout",
	"ca.key",
	"-out",
	"ca.crt",
	"-days",
	"3650",
	"-subj",
	`/CN=${APP_NAME} test CA (${hostname()})`,
	"-config",
	"ca.cnf",
	"-extensions",
	"ext",
);
run(
	"req",
	...ec,
	"-keyout",
	"server.key",
	"-out",
	"server.csr",
	"-subj",
	`/CN=${dns[1] ?? dns[0]}`,
);
// 397 days is the longest validity Apple devices and Chrome accept for a server certificate.
run(
	"x509",
	"-req",
	"-in",
	"server.csr",
	"-CA",
	"ca.crt",
	"-CAkey",
	"ca.key",
	"-set_serial",
	`0x${Date.now().toString(16)}`,
	"-days",
	"397",
	"-out",
	"server.crt",
	"-extfile",
	"server.ext",
);
for (const f of ["server.csr", "server.ext", "ca.cnf"])
	if (existsSync(join(dir, f))) rmSync(join(dir, f));

console.log(`Certificate for ${names.join(", ")} written to ${dir}`);
console.log("Trust ca.crt on each device (served at /ca.crt once the HTTPS server is running).");
