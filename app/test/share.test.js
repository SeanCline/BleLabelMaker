import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeShare, decodeShare, SHARE_PREFIX } from "../src/share.js";
import { LIMITS } from "../src/model.js";
import { serialize, parse } from "../src/fileformat.js";
import { createDocument } from "../src/model.js";

test("a label survives the trip through a link, and the link is URL-safe and compact", async () => {
	const doc = createDocument();
	doc.elements[0].text = "Pantry ❄ {date+30d}\n".repeat(20);
	const text = serialize(doc, { selectedIds: [] });
	const hash = await encodeShare(text);
	assert.ok(hash.startsWith(SHARE_PREFIX));
	assert.match(hash.slice(SHARE_PREFIX.length), /^[A-Za-z0-9_-]+$/);
	assert.ok(hash.length < text.length / 2, `${hash.length} vs ${text.length}`);
	assert.deepEqual(parse(await decodeShare(hash)).doc, doc);
});

test("other hashes are ignored; damaged links fail with a readable message", async () => {
	assert.equal(await decodeShare(""), null);
	assert.equal(await decodeShare("#section"), null);
	const hash = await encodeShare(serialize(createDocument()));
	await assert.rejects(decodeShare(hash.slice(0, hash.length / 2)), /damaged or incomplete/);
});

test("a link that inflates past any real label is refused without inflating it all", async () => {
	// About 100 KB of link that would become 120 MB of zeros.
	const zeros = new Uint8Array(LIMITS.fileChars * 6);
	const bomb = await encodeShare(new TextDecoder().decode(zeros));
	assert.ok(bomb.length < 500_000);
	await assert.rejects(decodeShare(bomb), /bigger than any label/);
});
