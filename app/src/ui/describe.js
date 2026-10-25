// Plain-language names for elements, shared by the Elements list, the canvas description
// for screen readers, and announcements.

const SHAPE_NAMES = { rect: "Box", ellipse: "Circle", line: "Line" };
const TYPE_NAMES = {
	text: "Text",
	shape: "Shape",
	barcode: "Barcode",
	qr: "QR code",
	image: "Image",
};

export const typeName = (e) =>
	e.type === "shape" ? SHAPE_NAMES[e.shape] : (TYPE_NAMES[e.type] ?? e.type);

/** Short content summary, e.g. the first line of text or the encoded data. */
export const contentOf = (e) => {
	if (e.type === "text") return e.text.split("\n")[0] || "(empty text)";
	if (e.type === "barcode" || e.type === "qr") return e.data || "(empty)";
	return "";
};

export const describeElement = (e) => {
	const content = contentOf(e);
	const turned = e.rotation ? `, rotated ${e.rotation}°` : "";
	return `${typeName(e)}${content ? ` “${content}”` : ""}${turned}`;
};

export const describeLabel = (doc) => {
	const { widthMm, heightMm, continuous } = doc.label;
	const parts = doc.elements.map(describeElement);
	return `Label preview, ${widthMm} by ${heightMm} mm${continuous ? " continuous" : ""}${parts.length ? `: ${parts.join("; ")}` : ", empty"}`;
};
