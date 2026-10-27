// A first-visit hint on the label, where the first thing to do is: type on it. It goes for
// good once someone does, dismisses it, or prints.
import { storageKey } from "../app-info.js";
import { $, loadJson, storeJson } from "./dom.js";
import { onPrinted } from "./printing.js";
import { inlineEdit, onInlineChange } from "./stage.js";

const KEY = storageKey("welcomed");
const tip = $("#welcome");

const dismiss = () => {
	if (tip.hidden) return;
	tip.hidden = true;
	storeJson(KEY, true);
};

tip.hidden = loadJson(KEY) === true;
$("#welcomeClose").addEventListener("click", dismiss);
onPrinted(dismiss);
onInlineChange(() => inlineEdit() && dismiss());
