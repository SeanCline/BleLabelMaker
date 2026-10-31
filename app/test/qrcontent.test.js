import { test } from "node:test";
import assert from "node:assert/strict";
import {
	QR_KIND_NAMES,
	convertContent,
	decodeContent,
	detectKind,
	encodeContent,
	summarise,
} from "../src/qrcontent.js";
import { fitQr } from "../src/qr.js";

test("each kind writes the format phones act on", () => {
	assert.equal(encodeContent("link", { url: "example.com/a" }), "https://example.com/a");
	assert.equal(encodeContent("link", { url: "ftp://x" }), "ftp://x", "a scheme is kept");
	assert.equal(
		encodeContent("wifi", { ssid: "Home", password: "pw", security: "WPA", hidden: false }),
		"WIFI:T:WPA;S:Home;P:pw;;",
	);
	assert.equal(
		encodeContent("wifi", { ssid: "Café", security: "nopass", hidden: true }),
		"WIFI:T:nopass;S:Café;H:true;;",
	);
	assert.equal(encodeContent("phone", { number: "+1 555 123" }), "tel:+1555123");
	assert.equal(
		encodeContent("sms", { number: "555", message: "Hi: there" }),
		"SMSTO:555:Hi: there",
	);
	assert.equal(
		encodeContent("email", { to: "a@b.com", subject: "Bin 3 & 4", body: "" }),
		"mailto:a@b.com?subject=Bin%203%20%26%204",
	);
	assert.equal(
		encodeContent("contact", { name: "Ada King Lovelace", phone: "+44 1", org: "Engines, Ltd" }),
		[
			"BEGIN:VCARD",
			"VERSION:3.0",
			"N:Lovelace;Ada King",
			"FN:Ada King Lovelace",
			"ORG:Engines\\, Ltd",
			"TEL:+44 1",
			"END:VCARD",
		].join("\n"),
	);
});

test("Wi-Fi escapes its separators, and reads them back", () => {
	const values = { ssid: 'My;Net:"5G"', password: "a\\b,c", security: "WPA", hidden: false };
	const data = encodeContent("wifi", values);
	assert.equal(data, 'WIFI:T:WPA;S:My\\;Net\\:\\"5G\\";P:a\\\\b\\,c;;');
	assert.deepEqual(decodeContent("wifi", data), values);
	// Other apps put the fields in any order, and leave out T for an open network.
	assert.deepEqual(decodeContent("wifi", "WIFI:S:Cafe;;"), {
		ssid: "Cafe",
		password: "",
		security: "nopass",
		hidden: false,
	});
});

test("fields like {1} and {date:iso} survive escaping, so batches work in every kind", () => {
	assert.equal(
		encodeContent("wifi", { ssid: "{1}", password: "{Pass word}", security: "WPA" }),
		"WIFI:T:WPA;S:{1};P:{Pass word};;",
	);
	assert.equal(
		encodeContent("email", { to: "{2}", subject: "Due {date+7d:iso}", body: "" }),
		"mailto:{2}?subject=Due%20{date+7d:iso}",
	);
	assert.match(
		encodeContent("contact", { name: "{Name}", org: "{Company}" }),
		/^ORG:\{Company\}$/m,
	);
	assert.equal(encodeContent("link", { url: "{1}" }), "{1}", "a field may be the whole link");
});

test("every kind reads back what it wrote", () => {
	const samples = {
		text: { text: "Shelf 3\nTop" },
		link: { url: "https://example.com/?a=1&b=2" },
		wifi: { ssid: "Home", password: "p;w", security: "WEP", hidden: true },
		phone: { number: "+15551234" },
		sms: { number: "+15551234", message: "On my way: 5 min" },
		email: { to: "a@b.com", subject: "Hi?", body: "Line 1\nLine 2 & more" },
		contact: {
			name: "Grace Hopper",
			org: "Navy",
			title: "Rear Admiral",
			phone: "+1 555",
			email: "g@navy.mil",
			url: "https://navy.mil",
			address: "1 Main St\nArlington, VA",
		},
	};
	for (const kind of QR_KIND_NAMES) {
		const data = encodeContent(kind, samples[kind]);
		assert.deepEqual(decodeContent(kind, data), samples[kind], kind);
		assert.equal(detectKind(data), kind, `${kind} is recognised in an old file`);
	}
});

test("switching kinds keeps what means the same, and starts the rest empty", () => {
	assert.equal(convertContent("text", "example.com", "link"), "https://example.com");
	assert.equal(convertContent("phone", "tel:555", "sms"), "SMSTO:555:");
	assert.equal(convertContent("link", "https://x.com", "wifi"), "WIFI:T:WPA;S:;P:;;");
	assert.equal(summarise("wifi", "WIFI:T:WPA;S:Home;P:x;;"), "Wi-Fi: Home");
	assert.equal(summarise("link", "https://x.com"), "https://x.com");
});

test("auto error correction keeps the squares big, then adds what correction still fits", () => {
	// Plenty of room: the squares reach the 4 dots that are enough, and High fits at that.
	assert.equal(fitQr("https://example.com", "auto", 200, 4).level, "H");
	// A 12 mm head (96 dots): Low gets 3-dot squares, anything more only 2, so it stays Low.
	const tight = fitQr("https://example.com/shelf/3", "auto", 96, 4);
	assert.deepEqual([tight.level, tight.unit], ["L", 3]);
	// Where every level makes 2-dot squares anyway, it takes High for free.
	assert.equal(fitQr("https://example.com/a/longer/path", "auto", 96, 4).level, "H");
	// A level that's set is kept, even when it makes the squares smaller.
	assert.equal(fitQr("https://example.com/shelf/3", "H", 96, 4).unit, 2);
});
