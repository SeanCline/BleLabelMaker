// A node:test reporter that turns each failing test into a GitHub Actions error annotation,
// so failures show on the commit and pull request (and through the API without signing in,
// unlike the job log). CI runs it alongside the usual spec reporter.
import { relative } from "node:path";

const data = (s) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const prop = (s) => data(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

export default async function* githubReporter(source) {
	for await (const event of source) {
		if (event.type !== "test:fail") continue;
		const { name, details, file, line } = event.data;
		const error = details?.error;
		// A suite fails when a test in it does; that test has its own annotation.
		if (error?.failureType === "subtestsFailed") continue;
		const cause = error?.cause ?? error;
		const message = String(cause?.stack ?? cause?.message ?? cause).slice(0, 6000);
		const where = file ? `file=app/${relative(process.cwd(), file).replace(/\\/g, "/")},` : "";
		yield `::error ${where}line=${line ?? 1},title=${prop(name)}::${data(message)}\n`;
	}
}
