import { StdinBuffer } from "@earendil-works/pi-tui";

/** Terminal transport for the official Pi renderer; callbacks stay in its worker. */
export class PiExtensionTerminal {
  constructor(write, columns = 100, rows = 30) {
    this.output = write;
    this.columns = columns;
    this.rows = rows;
    this.kittyProtocolActive = false;
  }
  start(input, resize) {
    this.buffer?.destroy();
    this.buffer = new StdinBuffer();
    this.buffer.on("data", input);
    this.buffer.on("paste", (text) => input(`\x1b[200~${text}\x1b[201~`));
    this.onResize = resize;
    this.write("\x1b[?2004h");
  }
  stop() { this.buffer?.destroy(); this.buffer = undefined; this.onResize = undefined; }
  async drainInput() {}
  write(data) { this.output(data); }
  input(data) { this.buffer?.process(data); }
  resize(columns, rows) { this.columns = columns; this.rows = rows; this.onResize?.(); }
  moveBy(lines) { if (lines) this.write(`\x1b[${Math.abs(lines)}${lines > 0 ? "B" : "A"}`); }
  hideCursor() { this.write("\x1b[?25l"); }
  showCursor() { this.write("\x1b[?25h"); }
  clearLine() { this.write("\x1b[2K\r"); }
  clearFromCursor() { this.write("\x1b[J"); }
  clearScreen() { this.write("\x1b[2J\x1b[H"); }
  setTitle() {}
  setProgress() {}
  setProgramStatus() {}
}
