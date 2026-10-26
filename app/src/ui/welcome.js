// A first-visit tip: the controls are spread over the page, and a new visitor's first
// question is where to start. It goes for good when dismissed or after the first print.
import { storageKey } from "../app-info.js";
import { $, loadJson, storeJson } from "./dom.js";
import { onPrinted } from "./printing.js";

const KEY = storageKey("welcomed");
const tip = $("#welcome");

const dismiss = () => {
	tip.hidden = true;
	storeJson(KEY, true);
};

tip.hidden = loadJson(KEY) === true;
$("#welcomeClose").addEventListener("click", dismiss);
onPrinted(() => {
	if (!tip.hidden) dismiss();
});
