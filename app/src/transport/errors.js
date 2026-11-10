// How a print can break off part way. Nothing imported, so drivers (src/printers/) can throw
// these without depending on the connections that import the drivers.

/** A send that broke off part way, saying how much got through first. */
export class SendError extends Error {
	/**
	 * @param {unknown} cause
	 * @param {number} sent bytes written before the failure
	 */
	constructor(cause, sent) {
		super(/** @type {any} */ (cause)?.message ?? String(cause), { cause });
		this.name = "SendError";
		this.sent = sent;
	}
}

/**
 * A print that broke off part way, counted in labels: what the printer got whole is printed,
 * whatever the protocol. Byte counts only mean something to a driver that streams.
 */
export class PartialPrintError extends Error {
	/**
	 * @param {unknown} cause
	 * @param {number} labelsSent how many of the labels asked for got out whole
	 */
	constructor(cause, labelsSent) {
		super(/** @type {any} */ (cause)?.message ?? String(cause), { cause });
		this.name = "PartialPrintError";
		this.labelsSent = labelsSent;
	}
}
