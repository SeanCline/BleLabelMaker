/**
 * Snapshot-based undo. Documents are small JSON, so storing whole copies is simpler and
 * safer than inverse operations. Consecutive edits with the same `group` key (e.g. typing
 * in one field or one drag) collapse into a single undo step.
 */
export class History {
	constructor(initial, limit = 100) {
		this.stack = [snapshot(initial)];
		this.index = 0;
		this.limit = limit;
		this.lastGroup = null;
	}

	push(state, group = null) {
		const snap = snapshot(state);
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
	}

	/** Ends the current group so the next edit starts a new undo step. */
	seal() {
		this.lastGroup = null;
	}

	reset(state) {
		this.stack = [snapshot(state)];
		this.index = 0;
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
		return JSON.parse(this.stack[--this.index]);
	}

	redo() {
		if (!this.canRedo) return null;
		this.lastGroup = null;
		return JSON.parse(this.stack[++this.index]);
	}
}

const snapshot = (state) => JSON.stringify(state);
