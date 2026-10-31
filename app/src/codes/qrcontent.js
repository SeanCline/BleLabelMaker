// What a QR code holds. A QR code has no content type: phones decide what to offer from the
// text's format (https:// opens a page, WIFI: joins a network, BEGIN:VCARD adds a contact).
// Each kind here is a few fields that write that format, and read it back to edit.
import { FIELD } from "../fields.js";

/** @typedef {"text"|"link"|"wifi"|"phone"|"sms"|"email"|"contact"} QrKind */

/**
 * @typedef {object} QrField
 * @property {string} key
 * @property {string} label
 * @property {"text"|"textarea"|"select"|"choice"} [input] a one-line text box by default;
 *   a choice is buttons, for a few options with icons
 * @property {"url"|"tel"|"email"} [inputType] for the phone's keyboard
 * @property {string} [placeholder]
 * @property {[string | boolean, string, string?][]} [options] a select's or choice's values,
 *   names and (a choice's) icons
 * @property {(values: Record<string, string | boolean>) => boolean} [when] shown only then
 */

/** @type {Record<QrKind, {name: string, icon: string, hint: string, fields: QrField[]}>} */
export const QR_KINDS = {
	text: {
		name: "Text",
		icon: "text",
		hint: "Shown as text. Phones may offer to search for it.",
		fields: [{ key: "text", label: "Text", input: "textarea", placeholder: "Any text" }],
	},
	link: {
		name: "Link",
		icon: "link",
		hint: "Opens the page. https:// is added if there's no scheme.",
		fields: [{ key: "url", label: "Address", inputType: "url", placeholder: "example.com/page" }],
	},
	wifi: {
		name: "Wi-Fi",
		icon: "wifi",
		hint: "Phones offer to join the network.",
		fields: [
			{ key: "ssid", label: "Network", placeholder: "Network name" },
			{ key: "password", label: "Password", when: (v) => v.security !== "nopass" },
			{
				key: "security",
				label: "Security",
				input: "select",
				options: [
					["WPA", "WPA/WPA2/WPA3"],
					["WEP", "WEP"],
					["nopass", "None"],
				],
			},
			{
				key: "hidden",
				label: "Visibility",
				input: "choice",
				options: [
					[false, "Visible", "eye"],
					[true, "Hidden", "eye-off"],
				],
			},
		],
	},
	phone: {
		name: "Phone",
		icon: "phone",
		hint: "Phones offer to call the number.",
		fields: [{ key: "number", label: "Number", inputType: "tel", placeholder: "+1 555 123 4567" }],
	},
	sms: {
		name: "SMS",
		icon: "message-square-text",
		hint: "Phones start a text message to the number, with the message already filled in.",
		fields: [
			{ key: "number", label: "Number", inputType: "tel", placeholder: "+1 555 123 4567" },
			{ key: "message", label: "Message", input: "textarea" },
		],
	},
	email: {
		name: "Email",
		icon: "mail",
		hint: "Phones start an email, with the subject and text filled in.",
		fields: [
			{ key: "to", label: "To", inputType: "email", placeholder: "name@example.com" },
			{ key: "subject", label: "Subject" },
			{ key: "body", label: "Text", input: "textarea" },
		],
	},
	contact: {
		name: "Contact",
		icon: "contact-round",
		hint: "Phones offer to add the contact. Every field makes the code bigger.",
		fields: [
			{ key: "name", label: "Name" },
			{ key: "org", label: "Company" },
			{ key: "title", label: "Job title" },
			{ key: "phone", label: "Phone", inputType: "tel" },
			{ key: "email", label: "Email", inputType: "email" },
			{ key: "url", label: "Website", inputType: "url" },
			{ key: "address", label: "Address", input: "textarea" },
		],
	},
};
export const QR_KIND_NAMES = /** @type {QrKind[]} */ (Object.keys(QR_KINDS));

/** The field the bar edits: the one that says what the code is. */
export const primaryField = (kind) => QR_KINDS[kind].fields[0].key;

/**
 * Applies `fn` to the text between fields, so {1} or {date:iso} still work once escaped.
 * @param {string} s
 * @param {(part: string) => string} fn
 */
const outsideFields = (s, fn) => {
	let out = "";
	let last = 0;
	for (const m of s.matchAll(FIELD)) {
		out += fn(s.slice(last, m.index)) + m[0];
		last = m.index + m[0].length;
	}
	return out + fn(s.slice(last));
};

// Wi-Fi and contact values escape their separators with a backslash.
const escapeWith = (chars) => (s) =>
	outsideFields(s, (part) => part.replace(new RegExp(`[${chars}]`, "g"), (c) => `\\${c}`));
const wifiEscape = escapeWith('\\\\;,:"');
const vcardEscape = (s) => escapeWith("\\\\;,")(s).replace(/\r?\n/g, "\\n");
const uriEncode = (s) => outsideFields(s, encodeURIComponent);
const uriDecode = (s) => {
	try {
		return decodeURIComponent(s);
	} catch {
		return s;
	}
};

const unescape = (s) => s.replace(/\\([\s\S])/g, "$1");

/** Splits on `sep` where it isn't escaped, and drops the escapes. */
const splitEscaped = (s, sep) => {
	const parts = [""];
	for (let i = 0; i < s.length; i++) {
		if (s[i] === "\\" && i + 1 < s.length) parts[parts.length - 1] += s[++i];
		else if (s[i] === sep) parts.push("");
		else parts[parts.length - 1] += s[i];
	}
	return parts;
};

// Wi-Fi's fields are K:value pairs; a value's own colons are escaped, so the first one splits.
const wifiPairs = (body) => {
	const pairs = {};
	let rest = body;
	while (rest) {
		let i = 0;
		while (i < rest.length && rest[i] !== ";") i += rest[i] === "\\" ? 2 : 1;
		const pair = rest.slice(0, i);
		rest = rest.slice(i + 1);
		const colon = pair.indexOf(":");
		if (colon > 0) pairs[pair.slice(0, colon).toUpperCase()] = unescape(pair.slice(colon + 1));
	}
	return pairs;
};

// A full name in one box: the last word is the family name, as most contact apps guess.
const splitName = (name) => {
	const words = name.trim().split(/\s+/);
	return words.length < 2 ? [name.trim(), ""] : [words.pop(), words.join(" ")];
};

/**
 * The text a kind's fields make.
 * @param {QrKind} kind
 * @param {Record<string, string | boolean>} v
 */
export const encodeContent = (kind, v) => {
	const s = (key) => String(v[key] ?? "");
	switch (kind) {
		case "link": {
			const url = s("url").trim();
			// "example.com" is a page, but a phone reads it as text without the scheme.
			return !url || /^[a-z][a-z\d+.-]*:|^\{/i.test(url) ? url : `https://${url}`;
		}
		case "wifi": {
			const security = s("security") || "WPA";
			const password = security === "nopass" ? "" : `P:${wifiEscape(s("password"))};`;
			const hidden = v.hidden ? "H:true;" : "";
			return `WIFI:T:${security};S:${wifiEscape(s("ssid"))};${password}${hidden};`;
		}
		case "phone":
			return `tel:${s("number").replace(/\s+/g, "")}`;
		case "sms":
			return `SMSTO:${s("number").replace(/\s+/g, "")}:${s("message")}`;
		case "email": {
			const query = ["subject", "body"]
				.filter((k) => s(k))
				.map((k) => `${k}=${uriEncode(s(k))}`)
				.join("&");
			return `mailto:${s("to").trim()}${query ? `?${query}` : ""}`;
		}
		case "contact": {
			const name = s("name").trim();
			const [family, given] = splitName(name);
			const lines = [
				"BEGIN:VCARD",
				"VERSION:3.0",
				name && `N:${vcardEscape(family)};${vcardEscape(given)}`,
				name && `FN:${vcardEscape(name)}`,
				s("org") && `ORG:${vcardEscape(s("org"))}`,
				s("title") && `TITLE:${vcardEscape(s("title"))}`,
				s("phone") && `TEL:${s("phone").trim()}`,
				s("email") && `EMAIL:${s("email").trim()}`,
				s("url") && `URL:${s("url").trim()}`,
				s("address") && `ADR:;;${vcardEscape(s("address"))};;;;`,
				"END:VCARD",
			];
			return lines.filter(Boolean).join("\n");
		}
		default:
			return s("text");
	}
};

/**
 * The fields that make `data`, read as `kind`. Text that isn't in the kind's format reads as
 * empty fields, except for its first, which gets the text as it is.
 * @param {QrKind} kind
 * @param {string} data
 * @returns {Record<string, string | boolean>}
 */
export const decodeContent = (kind, data) => {
	switch (kind) {
		case "link":
			return { url: data };
		case "wifi": {
			if (!/^WIFI:/i.test(data))
				return { ssid: data, password: "", security: "WPA", hidden: false };
			const p = wifiPairs(data.slice(5));
			const t = (p.T ?? "").toUpperCase();
			const security = t === "WEP" ? "WEP" : t === "NOPASS" || (!t && !p.P) ? "nopass" : "WPA";
			return { ssid: p.S ?? "", password: p.P ?? "", security, hidden: /^true$/i.test(p.H ?? "") };
		}
		case "phone":
			return { number: data.replace(/^tel:/i, "") };
		case "sms": {
			const m = /^smsto:([^:]*):?([\s\S]*)$/i.exec(data);
			if (m) return { number: m[1], message: m[2] };
			const uri = /^sms:([^?]*)(?:\?body=([\s\S]*))?$/i.exec(data);
			if (uri) return { number: uri[1], message: uriDecode(uri[2] ?? "") };
			return { number: data, message: "" };
		}
		case "email": {
			const m = /^mailto:([^?]*)(?:\?([\s\S]*))?$/i.exec(data);
			if (!m) return { to: data, subject: "", body: "" };
			const query = new Map(
				(m[2] ?? "")
					.split("&")
					.filter(Boolean)
					.map((pair) => {
						const [k, ...rest] = pair.split("=");
						return [k.toLowerCase(), uriDecode(rest.join("="))];
					}),
			);
			return {
				to: uriDecode(m[1]),
				subject: query.get("subject") ?? "",
				body: query.get("body") ?? "",
			};
		}
		case "contact": {
			if (!/^BEGIN:VCARD/i.test(data)) return { name: data };
			const v = {};
			// Folded lines (a newline and a space) continue the one before.
			for (const line of data.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
				const colon = line.indexOf(":");
				if (colon < 0) continue;
				const key = line.slice(0, colon).split(";")[0].toUpperCase();
				const value = line.slice(colon + 1).replace(/\\n/gi, "\n");
				if (key === "FN") v.name = unescape(value);
				else if (key === "N" && !v.name) {
					const [family = "", given = ""] = splitEscaped(value, ";");
					v.name = [given, family].filter(Boolean).join(" ");
				} else if (key === "ORG") v.org = splitEscaped(value, ";").filter(Boolean).join(", ");
				else if (key === "TITLE") v.title = unescape(value);
				else if (key === "TEL") v.phone ??= value;
				else if (key === "EMAIL") v.email ??= value;
				else if (key === "URL") v.url ??= value;
				else if (key === "ADR") v.address ??= splitEscaped(value, ";").filter(Boolean).join(", ");
			}
			return v;
		}
		default:
			return { text: data };
	}
};

/**
 * The kind that wrote `data`, for a file saved before codes had kinds.
 * @param {string} data
 * @returns {QrKind}
 */
export const detectKind = (data) => {
	if (/^https?:\/\//i.test(data)) return "link";
	if (/^WIFI:/i.test(data)) return "wifi";
	if (/^tel:/i.test(data)) return "phone";
	if (/^(smsto|sms):/i.test(data)) return "sms";
	if (/^mailto:/i.test(data)) return "email";
	if (/^BEGIN:VCARD/i.test(data)) return "contact";
	return "text";
};

/**
 * Switching kinds keeps what still means the same: a text becoming a link, a number moving
 * between a call and a message. Anything else starts empty.
 * @param {QrKind} from
 * @param {string} data
 * @param {QrKind} to
 */
export const convertContent = (from, data, to) => {
	const old = decodeContent(from, data);
	const carried =
		(from === "text" || from === "link") && (to === "text" || to === "link")
			? { [primaryField(to)]: old[primaryField(from)] }
			: (from === "phone" || from === "sms") && (to === "phone" || to === "sms")
				? { number: old.number }
				: {};
	return encodeContent(to, carried);
};

/** A short summary for lists and screen readers: the link, or "Wi-Fi: Home". */
export const summarise = (kind, data) => {
	if (kind === "text" || kind === "link") return data;
	const main = String(decodeContent(kind, data)[primaryField(kind)] ?? "");
	return main ? `${QR_KINDS[kind].name}: ${main}` : QR_KINDS[kind].name;
};
