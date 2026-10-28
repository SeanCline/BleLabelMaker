// Ways to reach a printer, one module each under transport/, and what they share.
export { Connection, SendError } from "./transport/connection.js";
export { BluetoothPrinter, bluetoothAvailable } from "./transport/bluetooth.js";
export { SerialPrinter, serialAvailable } from "./transport/serial.js";
export { VirtualPrinter } from "./transport/virtual.js";
