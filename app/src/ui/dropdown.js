// A dropdown in the page's own look, over a native <select> that stays the source of truth:
// whatever sets its value, or listens for its input and change, works as before. Its options
// can show an icon (data-icon) or their own font (style.fontFamily), which a browser's own list
// may not: Firefox shows every font name in the same face. It's the WAI-ARIA select-only
// combobox: the focus stays on the button, and the list is a popover beside it in the page,
// so a click in it is a click inside whatever holds the select.
import { $$, el, icon } from "./dom.js";

const VALUE = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
let count = 0;

/**
 * @param {HTMLSelectElement} select
 * @param {{className?: string}} [options] a class for the button, for its width where it sits
 */
export const dropdown = (select, { className = "" } = {}) => {
	if (select.dataset.dropdown !== undefined) return select.previousElementSibling;
	select.dataset.dropdown = "";
	const id = `dropdown-${++count}`;
	const face = el("span", { className: "dropdown-face" });
	const button = el(
		"button",
		{
			type: "button",
			className: `dropdown ${className}`.trim(),
			role: "combobox",
			"aria-haspopup": "listbox",
			"aria-expanded": "false",
			"aria-controls": `${id}-list`,
		},
		face,
		icon("chevron-down"),
	);
	const list = el("div", { id: `${id}-list`, className: "dropdown-list", role: "listbox" });
	list.popover = "manual";
	for (const attr of ["aria-label", "aria-labelledby", "title"]) {
		const value = select.getAttribute(attr);
		if (value === null) continue;
		button.setAttribute(attr, value);
		if (attr !== "title") list.setAttribute(attr, value);
	}
	// A select named by a <label> around it names the button the same way (it goes first in the
	// label); the list takes the label's own words, without the options' text.
	const label = select.closest("label");
	if (label && !list.hasAttribute("aria-label")) {
		const words = [...label.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE);
		list.setAttribute(
			"aria-label",
			words
				.map((n) => n.textContent)
				.join(" ")
				.trim(),
		);
	}
	// Before the select, so a <label> around both names and focuses the button.
	select.before(button);
	select.after(list);
	select.hidden = true;

	/** An option as the list or the button shows it. */
	const look = (option, node) => {
		node.replaceChildren(
			...(option?.dataset.icon ? [icon(option.dataset.icon)] : []),
			el("span", { className: "dropdown-text" }, option?.textContent ?? ""),
		);
		node.style.fontFamily = option?.style.fontFamily ?? "";
	};
	// Every option is in the button, unseen but the one picked, so it's as wide as the widest,
	// as a native select is: picking another doesn't move what's beside it.
	const options = () => [...select.options];
	const refresh = () => {
		const picked = select.selectedOptions[0];
		face.replaceChildren(
			...options().map((option) => {
				const choice = el("span", {
					className: `dropdown-choice${option === picked ? "" : " unseen"}`,
				});
				look(option, choice);
				return choice;
			}),
		);
		button.disabled = select.disabled;
	};
	// Code sets the value as on any select; the button follows.
	Object.defineProperty(select, "value", {
		get: () => VALUE.get.call(select),
		set: (v) => {
			VALUE.set.call(select, v);
			refresh();
		},
	});
	select.addEventListener("input", refresh);
	select.addEventListener("change", refresh);
	new MutationObserver(refresh).observe(select, {
		childList: true,
		subtree: true,
		characterData: true,
		attributes: true,
	});

	let active = -1;
	const items = () => /** @type {HTMLElement[]} */ ($$(".dropdown-option", list));
	const highlight = (i) => {
		active = i;
		items().forEach((item, j) => item.classList.toggle("active", j === i));
		const item = items()[i];
		if (item) {
			button.setAttribute("aria-activedescendant", item.id);
			item.scrollIntoView({ block: "nearest" });
		} else button.removeAttribute("aria-activedescendant");
	};
	/** The next option from `from` in direction `step` that can be picked, or `from`. */
	const next = (from, step) => {
		const all = options();
		for (let i = from + step; i >= 0 && i < all.length; i += step) if (!all[i].disabled) return i;
		return from;
	};

	const choose = (i) => {
		const option = options()[i];
		if (!option || option.disabled) return;
		if (VALUE.get.call(select) !== option.value) {
			VALUE.set.call(select, option.value);
			select.dispatchEvent(new Event("input", { bubbles: true }));
			select.dispatchEvent(new Event("change", { bubbles: true }));
		}
		refresh();
	};

	const place = () => {
		const r = button.getBoundingClientRect();
		const below = innerHeight - r.bottom - 8;
		const above = r.top - 8;
		const down = below >= Math.min(list.scrollHeight, 240) || below >= above;
		list.style.minWidth = `${r.width}px`;
		list.style.maxHeight = `${Math.max(120, down ? below : above)}px`;
		const width = list.offsetWidth;
		list.style.left = `${Math.max(8, Math.min(r.left, innerWidth - width - 8))}px`;
		list.style.top = down ? `${r.bottom + 2}px` : "";
		list.style.bottom = down ? "" : `${innerHeight - r.top + 2}px`;
	};
	const isOpen = () => button.getAttribute("aria-expanded") === "true";
	const open = () => {
		if (isOpen() || select.disabled) return;
		const item = (option, i) => {
			const node = el("div", {
				id: `${id}-${i}`,
				className: "dropdown-option",
				role: "option",
				title: option.title,
				"aria-selected": String(option.selected),
				"aria-disabled": String(option.disabled),
			});
			look(option, node);
			// A rule in the select (<hr>) is a line above the option after it.
			if (option.previousElementSibling instanceof HTMLHRElement) node.classList.add("after-rule");
			return node;
		};
		// An <optgroup> is a group with its name over its options, as a native list shows it.
		let i = 0;
		list.replaceChildren(
			...[...select.children].flatMap((child) => {
				if (child instanceof HTMLOptionElement) return [item(child, i++)];
				if (!(child instanceof HTMLOptGroupElement)) return [];
				return [
					el(
						"div",
						{ role: "group", "aria-label": child.label, title: child.title },
						el("div", { className: "dropdown-group", "aria-hidden": "true" }, child.label),
						...[...child.children].map((option) => item(option, i++)),
					),
				];
			}),
		);
		list.showPopover();
		button.setAttribute("aria-expanded", "true");
		place();
		highlight(select.selectedIndex);
		addEventListener("pointerdown", outside, true);
		addEventListener("resize", close);
		addEventListener("scroll", onScroll, true);
	};
	const close = () => {
		if (!isOpen()) return;
		list.hidePopover();
		button.setAttribute("aria-expanded", "false");
		highlight(-1);
		removeEventListener("pointerdown", outside, true);
		removeEventListener("resize", close);
		removeEventListener("scroll", onScroll, true);
	};
	const outside = (ev) => {
		if (!button.contains(ev.target) && !list.contains(ev.target)) close();
	};
	// The page scrolling moves the button from under the list; the list scrolling doesn't.
	const onScroll = (ev) => {
		if (!list.contains(ev.target)) close();
	};

	button.addEventListener("click", () => (isOpen() ? close() : open()));
	// The focus stays on the button while an option is clicked.
	list.addEventListener("mousedown", (ev) => ev.preventDefault());
	list.addEventListener("pointermove", (ev) => {
		const item = /** @type {HTMLElement} */ (ev.target).closest(".dropdown-option");
		const i = items().indexOf(/** @type {HTMLElement} */ (item));
		if (i >= 0 && i !== active && !options()[i].disabled) highlight(i);
	});
	list.addEventListener("click", (ev) => {
		const item = /** @type {HTMLElement} */ (ev.target).closest(".dropdown-option");
		const i = items().indexOf(/** @type {HTMLElement} */ (item));
		if (i < 0 || options()[i].disabled) return;
		close();
		choose(i);
	});

	// Typing a name jumps to it, as in any list: letters typed close together are one name, and
	// a space among them is part of it ("roboto m").
	let typed = "";
	let typedAt = 0;
	const typing = () => Date.now() - typedAt <= 600;
	const typeAhead = (key) => {
		typed = typing() ? typed + key : key;
		typedAt = Date.now();
		const all = options();
		const from = isOpen() ? active : select.selectedIndex;
		const start = typed.length > 1 ? from : from + 1;
		for (let k = 0; k < all.length; k++) {
			const i = (start + k + all.length) % all.length;
			if (!all[i].disabled && all[i].textContent.toLowerCase().startsWith(typed.toLowerCase()))
				return i;
		}
		return -1;
	};

	button.addEventListener("keydown", (ev) => {
		if (ev.ctrlKey || ev.metaKey) return;
		const all = options();
		const letter = ev.key.length === 1 && !ev.altKey && (ev.key !== " " || typing());
		// Any other key ends a name being typed, so the next letter starts a new one.
		if (!letter) typedAt = 0;
		let handled = true;
		if (letter) {
			const i = typeAhead(ev.key);
			if (i >= 0) isOpen() ? highlight(i) : choose(i);
		} else if (!isOpen()) {
			if (["ArrowDown", "ArrowUp", "Enter", " "].includes(ev.key)) open();
			else handled = false;
		} else if (ev.key === "ArrowDown") highlight(next(active, 1));
		else if (ev.key === "ArrowUp") highlight(next(active, -1));
		else if (ev.key === "Home") highlight(next(-1, 1));
		else if (ev.key === "End") highlight(next(all.length, -1));
		else if (ev.key === "PageDown") highlight(next(Math.min(all.length - 1, active + 9), 1));
		else if (ev.key === "PageUp") highlight(next(Math.max(0, active - 9), -1));
		else if (ev.key === "Enter" || ev.key === " ") {
			const picked = active;
			close();
			choose(picked);
		} else if (ev.key === "Escape") close();
		else {
			// Tab closes the list and moves on as usual.
			if (ev.key === "Tab") close();
			handled = false;
		}
		if (!handled) return;
		ev.preventDefault();
		// The list's keys, not the page's: Escape would close the settings, letters are shortcuts.
		ev.stopPropagation();
	});
	// A button clicks when Space comes up, which would open or close the list again: Space has
	// already done its part going down.
	button.addEventListener("keyup", (ev) => {
		if (ev.key === " ") ev.preventDefault();
	});
	button.addEventListener("blur", close);

	refresh();
	return button;
};

/**
 * Every select on the page drawn by the page, so all of them look alike. The Field menu is
 * the exception: it's a button that opens a native list (styles.css).
 */
export const dropdowns = () => {
	for (const select of $$("select"))
		if (!select.closest(".field-picker")) dropdown(/** @type {HTMLSelectElement} */ (select));
};
