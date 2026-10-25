// Byte helpers every printer driver and connection uses.

/** Splits bytes into writes of at most `size`, without copying. */
export const packetize = (bytes, size) => {
	const packets = [];
	for (let i = 0; i < bytes.length; i += size) packets.push(bytes.subarray(i, i + size));
	return packets;
};

export const concat = (...arrays) => {
	const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
	let offset = 0;
	for (const a of arrays) {
		out.set(a, offset);
		offset += a.length;
	}
	return out;
};
