/**
 * Snapshot-based undo. Documents are small JSON, so storing whole copies is simpler and
 * safer than inverse operations. Consecutive edits with the same `group` key (e.g. typing
 * in one field or one drag) collapse into a single undo step.
 *
 * Pictures are the exception to "small": a data URL can be hundreds of KB, and a hundred
 * steps each with its own copy would hold tens of MB for a picture that never changed. So long
 * strings are kept once, in a pool every step shares, and a step holds a reference.
 */

// Shorter than any picture, longer than any text people type into a label.
const POOLED_LENGTH = 2048;
const REF = "$pooled";
const REF_PATTERN = /"\$pooled":(\d+)/g;

export class History {
	/** @type {Map<string, number>} */
	#ids = new Map();
	/** @type {Map<number, string>} */
	#strings = new Map();
	#nextId = 0;

	constructor(initial, limit = 100) {
		this.stack = [this.#snapshot(initial)];
		this.index = 0;
		this.limit = limit;
		this.lastGroup = null;
	}

	push(state, group = null) {
		const snap = this.#snapshot(state);
		if (snap === this.stack[this.index]) return;
		this.stack.length = this.index + 1;
		if (group !== null && group === this.lastGroup && this.index > 0) {
			this.stack[this.index] = snap;
		} else {
			this.stack.push(snap);
			if (this.stack.length > this.limit) this.stack.shift();
			this.index = this.stack.length - 1;
		}
		this.lastGroup = group;
		this.#prune();
	}

	/**
	 * Replaces the current step's state, for changes that follow from the edit just made (an
	 * auto length following the text), so undoing that edit undoes them too.
	 */
	amend(state) {
		this.stack[this.index] = this.#snapshot(state);
		this.#prune();
	}

	/** Ends the current group so the next edit starts a new undo step. */
	seal() {
		this.lastGroup = null;
	}

	get canUndo() {
		return this.index > 0;
	}
	get canRedo() {
		return this.index < this.stack.length - 1;
	}

	undo() {
		if (!this.canUndo) return null;
		this.lastGroup = null;
		return this.#restore(this.stack[--this.index]);
	}

	redo() {
		if (!this.canRedo) return null;
		this.lastGroup = null;
		return this.#restore(this.stack[++this.index]);
	}

	/** How many long strings are held, each once, for tests. */
	get pooled() {
		return this.#strings.size;
	}

	#snapshot(state) {
		return JSON.stringify(state, (_key, value) => {
			if (typeof value !== "string" || value.length < POOLED_LENGTH) return value;
			let id = this.#ids.get(value);
			if (id === undefined) {
				id = this.#nextId++;
				this.#ids.set(value, id);
				this.#strings.set(id, value);
			}
			return { [REF]: id };
		});
	}

	#restore(snap) {
		return JSON.parse(snap, (_key, value) =>
			value !== null && typeof value === "object" && REF in value
				? this.#strings.get(value[REF])
				: value,
		);
	}

	/** Lets go of long strings no step refers to any more: a picture deleted and out of reach. */
	#prune() {
		const used = new Set();
		for (const snap of this.stack) for (const [, id] of snap.matchAll(REF_PATTERN)) used.add(+id);
		for (const [id, value] of this.#strings) {
			if (used.has(id)) continue;
			this.#strings.delete(id);
			this.#ids.delete(value);
		}
	}
}
