import { test } from "node:test";
import assert from "node:assert/strict";
import {
	faceFromFileName,
	googleCssUrl,
	googleFamily,
	parseGoogleCss,
	weightsOf,
} from "../src/text/fontfiles.js";

test("a font file's name says its family, weight and style, as font makers name them", () => {
	const face = (name) => Object.values(faceFromFileName(name)).join(" ");
	assert.equal(face("Montserrat-Regular.ttf"), "Montserrat 400 normal");
	assert.equal(face("Montserrat-BoldItalic.ttf"), "Montserrat 700 italic");
	assert.equal(face("Roboto-ExtraBold.otf"), "Roboto 800 normal");
	assert.equal(face("PlayfairDisplay-SemiBold.woff2"), "Playfair Display 600 normal");
	assert.equal(face("Open Sans Light Italic.ttf"), "Open Sans 300 italic");
	assert.equal(face("Inter[wght].ttf"), "Inter 400 normal");
	assert.equal(face("Roboto-VariableFont_wdth,wght.ttf"), "Roboto 400 normal");
	assert.equal(face("Lobster.otf"), "Lobster 400 normal");
	// A family named for a weight keeps its name.
	assert.equal(face("Black.ttf"), "Black 400 normal");
});

test("a Google Fonts family from its name, its page or its stylesheet link", () => {
	assert.equal(googleFamily("Playfair Display"), "Playfair Display");
	assert.equal(googleFamily("  Roboto   Slab "), "Roboto Slab");
	assert.equal(
		googleFamily("https://fonts.google.com/specimen/Playfair+Display"),
		"Playfair Display",
	);
	assert.equal(googleFamily("https://fonts.google.com/specimen/Fira+Code?query=fira"), "Fira Code");
	assert.equal(
		googleFamily("https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap"),
		"Roboto Mono",
	);
	assert.equal(googleFamily("https://example.com/specimen/Evil"), null, "only Google's");
	assert.equal(googleFamily("<script>"), null);
	assert.equal(googleFamily(""), null);
	assert.equal(
		googleCssUrl("Playfair Display"),
		"https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=block",
	);
});

test("Google's stylesheet becomes its Latin faces, and their weights", () => {
	const css = `
/* cyrillic */
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url(https://fonts.gstatic.com/s/lora/v1/cyr.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F;
}
/* latin-ext */
@font-face {
  font-family: 'Lora';
  font-style: italic;
  font-weight: 400 700;
  src: url(https://fonts.gstatic.com/s/lora/v1/ext.woff2) format('woff2');
  unicode-range: U+0100-02BA;
}
/* latin */
@font-face {
  font-family: 'Lora';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/lora/v1/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}`;
	const faces = parseGoogleCss(css);
	assert.deepEqual(
		faces.map((f) => [f.family, f.style, f.weight, f.subset, f.url.split("/").at(-1)]),
		[
			["Lora", "italic", "400 700", "latin-ext", "ext.woff2"],
			["Lora", "normal", "700", "latin", "latin.woff2"],
		],
	);
	assert.equal(faces[1].unicodeRange, "U+0000-00FF, U+0131");
	assert.deepEqual(weightsOf(faces), [400, 500, 600, 700]);
	// A font with one subset and no comments keeps it.
	assert.equal(
		parseGoogleCss("@font-face { font-family: 'X'; src: url(https://a/x.woff2); }").length,
		1,
	);
});
