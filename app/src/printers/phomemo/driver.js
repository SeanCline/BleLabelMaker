// The Phomemo D-series driver: everything the app needs to print to, and hear from, a D30 or
// one of its relatives, behind the PrinterDriver interface in ../index.js.
import {
	buildPrintJob,
	DENSITY,
	STATUS_QUERIES,
	PACKET_SIZE,
	AUTO_POWER_OFF_MINUTES,
	setAutoPowerOff,
} from "./protocol.js";
import { StatusParser, statusRecord, answerQuery } from "./status.js";
import { PrinterDecoder } from "./decoder.js";

const phomemoBlocks = (s) => !s.paper || s.coverOpen;

/** @type {import("../index.js").PrinterDriver} */
export const dSeries = {
	id: "phomemo-d-series",
	bluetooth: {
		service: "0000ff00-0000-1000-8000-00805f9b34fb",
		write: "0000ff02-0000-1000-8000-00805f9b34fb",
	},
	packetSize: PACKET_SIZE,
	buildJob: buildPrintJob,
	densities: DENSITY,
	statusQueries: STATUS_QUERIES,
	statusParser: (onEvent) => new StatusParser(onEvent),
	autoPowerOff: { minutes: AUTO_POWER_OFF_MINUTES, command: setAutoPowerOff },
	decoder: (handlers) => new PrinterDecoder(handlers),
	simulator: {
		reply: (event, s) => (event.type === "query" ? answerQuery(event.query, s) : []),
		// A real printer with no paper or an open cover prints nothing and says why.
		blocks: (s) => phomemoBlocks(s),
		afterJob: (s, printed) =>
			phomemoBlocks(s)
				? [statusRecord.cover(s.coverOpen), statusRecord.paper(s.paper)]
				: printed
					? [statusRecord.printed()]
					: [],
	},
};
