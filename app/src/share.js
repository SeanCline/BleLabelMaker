// Labels as links: the .label JSON, deflated and base64url-encoded into the URL fragment.
// The fragment never leaves the browser (it isn't sent to the server), so sharing a label
// still needs no server at all.
import { concat } from "./bytes.js";
import { LIMITS } from "./model.js";
import { TOO_LARGE } from "./fileformat.js";

export const SHARE_PREFIX = "#label=";

const toBase64Url = (bytes) => {
	let bin = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (s) => {
	const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const pipe = async (bytes, stream) =>
	new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

/** @param {string} labelText a serialized .label file */
export const encodeShare = async (labelText) =>
	SHARE_PREFIX +
	toBase64Url(
		await pipe(new TextEncoder().encode(labelText), new CompressionStream("deflate-raw")),
	);

/**
 * Inflates at most `max` bytes. Deflate packs repetitive data a thousandfold, so a short link
 * could otherwise expand to gigabytes and hang the tab.
 */
const inflate = async (bytes, max) => {
	const reader = new Blob([bytes])
		.stream()
		.pipeThrough(new DecompressionStream("deflate-raw"))
		.getReader();
	const chunks = [];
	let total = 0;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) return concat(...chunks);
		total += value.length;
		if (total > max) {
			await reader.cancel();
			throw new ShareTooLarge(TOO_LARGE);
		}
		chunks.push(value);
	}
};

class ShareTooLarge extends Error {}

/**
 * @param {string} hash location.hash
 * @returns {Promise<string | null>} the .label text, or null if the hash isn't a shared label
 * @throws if it is one but can't be read (cut off by a chat app, say)
 */
export const decodeShare = async (hash) => {
	if (!hash.startsWith(SHARE_PREFIX)) return null;
	try {
		const bytes = fromBase64Url(hash.slice(SHARE_PREFIX.length));
		// fileChars counts UTF-16 units, and UTF-8 takes at most three bytes for each (a pair
		// that makes one emoji is four), so this many bytes covers the largest label.
		return new TextDecoder().decode(await inflate(bytes, LIMITS.fileChars * 3));
	} catch (err) {
		if (err instanceof ShareTooLarge) throw err;
		throw new Error(
			"This label link is damaged or incomplete. It may have been cut off when it was sent.",
			{ cause: err },
		);
	}
};
