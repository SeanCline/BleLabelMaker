/**
 * Something other modules can wait for, such as a print or a change of printer: `on` adds a
 * listener, and `emit` runs each, in the order they were added, with what it's given.
 */
export const signal = () => {
	const listeners = new Set();
	return {
		on: (fn) => listeners.add(fn),
		emit: (...args) => {
			for (const fn of listeners) fn(...args);
		},
	};
};
