// Types for the parts of the vendored library we use, so the type checker reads this
// instead of checking the library's own (unmodified) source.
interface QrCode {
	addData(data: string, mode?: "Numeric" | "Alphanumeric" | "Byte" | "Kanji"): void;
	make(): void;
	getModuleCount(): number;
	isDark(row: number, col: number): boolean;
}
declare const qrcode: {
	(typeNumber: number, errorCorrectionLevel: "L" | "M" | "Q" | "H"): QrCode;
	stringToBytes: (s: string) => number[];
};
export default qrcode;
