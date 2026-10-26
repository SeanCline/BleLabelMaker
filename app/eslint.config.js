import js from "@eslint/js";
import globals from "globals";

export default [
	{ ignores: ["node_modules/", "src/vendor/", "_site/", "coverage/"] },
	js.configs.recommended,
	{
		files: ["src/**/*.js", "sw.js", "precache.js"],
		languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } },
	},
	{
		// Tests and tools run in Node, but e2e tests pass functions to page.evaluate, which run
		// in the browser.
		files: ["serve.js", "eslint.config.js", "tools/**/*.mjs", "test/**/*.js", "test/**/*.mjs"],
		languageOptions: { globals: { ...globals.node, ...globals.browser } },
	},
	{
		rules: {
			// Destructuring a key out to drop it ({ id, ...rest }) is the point, not an oversight.
			"no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true },
			],
		},
	},
];
