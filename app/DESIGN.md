# Design

## Shape

A static, build-free web app: plain ES modules, no framework and no bundler.
That makes it easy to host on GitHub Pages or serve with any local static
server. Nothing is loaded from the network at runtime. Fonts are self-hosted in
`fonts/` (regenerate with `node tools/fetch-fonts.mjs`), the interface's icons are
one sprite, `icons/ui.svg`, of Lucide's (regenerate with `npm run ui-icons`,
which lists the ones used), and a network-first
service worker (`sw.js`) caches the app so it works offline and can be
installed. Its file list and cache name are generated into `precache.js` by
`npm run precache`. The cache name changes whenever the list does, which clears
out removed files. `test/sw.test.js` fails if `precache.js` is out of date.

```
index.html / styles.css
src/
  app-info.js    the app's name, version and GitHub repository (npm run name stamps
                 them into the page), and storage ids
  printers/
    index.js     the driver interface and the registry of every model
    phomemo/     the Phomemo D-series driver: models, commands, status, decoder
  bytes.js       packetize, concat
  units.js       mm ↔ dots, pt ↔ dots (8 dots/mm, 203 dpi)
  model.js       document model, element factories, arranging, margins
  fileformat.js  .label serialize / parse / validate; copied-elements format
  fields.js      {date}, {n}, {1}… filled in per label
  richtext.js    text with formatted parts (runs): editing, styling, normalizing
  htmltext.js    formatted text on the clipboard: runs to HTML and back
  batch.js       batch lists: lines, spreadsheet cells, CSV
  layout.js      text wrapping and fit-to-box (pure, measure fn injected)
  caretmap.js    caret positions on laid-out text, for the inline editor
  render.js      document → canvas at printer resolution, 1-bit; element cache
  raster.js      canvas pixels → printer-oriented 1bpp rows, centred on the head
  printjob.js    design → labels to print (batch, copies, counter) → job bytes
  transport.js   Connection base class: Bluetooth, serial port, virtual printer
  history.js     undo/redo over document snapshots
  printhistory.js  print history entries, export/import
  share.js       labels as links
  report.js      diagnostics, bug and "it works" reports, GitHub issue links
  fonts.js, emoji.js, barcode.js, qr.js, snap.js
  app.js         entry point: boots the ui/ modules
  ui/
    dom.js       DOM helpers, toast, best-effort localStorage
    store.js     editor state, commit/undo, selection, subscribe, autosave
    stage.js     preview canvas, overlay, drag/resize/box-select, inline editor
    viewport.js  fit, zoom and pan
    ruler.js     millimetre rulers with the selection's extent and the pointer
    errors.js    a toast for errors nothing else caught
    panels.js    settings sections, Elements list, add/delete/arrange
    quickbar.js  the bar over the label (the selection's essentials) and the settings sheet
    toolbar.js   arrow keys between a toolbar's controls, one Tab stop for its buttons
    labelbar.js  label size: the printer's presets, continuous, custom, remembered per printer
    text-insert.js  emoji picker and Field menu, inserting at the cursor
    printing.js  printer choice and settings, status line, print
    report.js    the pop-up after an untested model prints, Report a problem, diagnostics
    virtual-output.js  the virtual printer's decoded labels
    batch.js, files.js, clipboard.js, keyboard.js, history-panel.js, idb.js, caret.js
test/            node:test suites for the pure modules
test/e2e/        headless-Chromium tests of the UI (npm run test:e2e), with a fake
                 Bluetooth D30 and a fake serial port (the D-series driver's tests). The barcode/QR tests scan
                 the virtual printer's output with zxing.
```

UI modules wire themselves up on import and re-render by subscribing to the
store. Every change goes through `commit()`, which records undo history,
notifies subscribers and autosaves.

Every module that doesn't touch the DOM (printers and their drivers, model,
fileformat, fields, batch, layout, raster, printjob, history and more) is tested
in Node. The rendering and UI
are checked in a real Chromium browser against the virtual printer.

## One document, one editor

There's one document: `{ label, elements[] }`, and one editor over it. A new
label is one text box filling the printable area, selected, so its bar shows
and typing on it is the obvious first step. (There used to be a Simple mode
that owned just that one text, and a Design mode; the bar over the label made
the difference between them small enough to drop.)

- A text box that fills the printable area keeps filling it when the label
  changes size (`textFillsLabel`); anything else keeps its place.
- Whenever nothing is selected on load, the first element is, for the same
  reason.
- Save and Load deal with a single structure, so "restore the same state"
  just means restoring the document plus `editor`.

Positions and sizes are stored in **millimetres** and font sizes in
**points**. That way files don't depend on the printer, and a label keeps its
proportions when the label size changes. Everything converts to dots only at
render time.

## WYSIWYG strategy

The editor's canvas _is_ the print raster. It's rendered at 8 dots/mm,
thresholded to pure black and white, and scaled up on screen with
`image-rendering: pixelated`. Selection and drag/resize handles are DOM
elements laid over the canvas. Editing never relies on DOM text layout, so the
preview can't drift from the print.

Text uses a plain threshold (luminance < 128) so
it stays crisp. Emoji are part of text. Every text font stack ends with
Google's monochrome **Noto Emoji**, so emoji draw as solid black line art. A
colour emoji glyph falls apart under the threshold: light ones such as ❄️
vanish, and dark ones turn into blobs. Variation selectors (U+FE0F) are
stripped before drawing, because with one Chromium picks a glyph outside Noto
Emoji.

## Fields and batches

Text, barcode data and QR data can hold fields in braces (`src/fields.js`):
dates with offsets and formats, the time, a counter `{n}` / `{n:000}`, and
batch columns `{1}` or `{Heading}`. Unknown fields stay as typed, so a typo
shows on the preview. The document always keeps the template.
`fillDocument(doc, ctx)` gives the document as one label prints. The preview
fills it for the batch row being viewed and the next counter value, except the
text being typed on the label, so the caret lines up with what's on screen.

A print plans its labels first. Each batch row is one label, and identical
copies stay one raster sent with the printer's copy count. A counter makes
every copy different, so each copy becomes its own raster. Every label is
rendered off-screen and turned into its own job (init, copies, image), and the
jobs go out in one send. After printing, the counter moves on to the next
unused number. Batch lists (`src/batch.js`) are lines, tab-separated
spreadsheet cells, or RFC 4180 CSV from an opened file. They're kept in local
storage, not in the .label file, since one design is often printed with
different lists.

## .label file format (version 1)

```json
{
	"format": "labelmaker-label",
	"app": "https://github.com/SeanCline/BleLabelMaker",
	"version": 1,
	"label": { "widthMm": 40, "heightMm": 12, "continuous": false },
	"elements": [
		{
			"id": "e1",
			"type": "text",
			"x": 1,
			"y": 1.5,
			"w": 38,
			"h": 9,
			"rotation": 0,
			"text": "Hello 📦",
			"fontFamily": "Inter",
			"fontSizePt": 14,
			"fontWeight": 700,
			"italic": false,
			"align": "center",
			"vAlign": "middle",
			"fit": false,
			"invert": false,
			"letterSpacingPt": 0,
			"underline": false,
			"outline": false,
			"stacked": false,
			"firstLineScale": 1
		},
		{
			"id": "e2",
			"type": "shape",
			"x": 0.5,
			"y": 0.5,
			"w": 39,
			"h": 11,
			"rotation": 0,
			"shape": "rect",
			"strokeMm": 0.5,
			"fill": false,
			"radiusMm": 1
		}
	],
	"editor": { "mode": "design", "selectedIds": ["e1"] }
}
```

- `app` says what made the file (`REPO_URL` in `app-info.js`), for anyone who
  finds one. It is never read back: a file without it, or from a fork naming
  another repository, opens the same.
- `label.continuous` marks a continuous roll (one long label): `widthMm` is
  then the length to print, and the print job ends with a feed instead of
  stopping at a gap. `label.autoLength` (continuous only, present only when
  on) makes the length follow the content: one text box filling the label is
  as long as its text at the height's size, one line per paragraph; anything
  else ends a margin past its furthest element (`contentLengthMm` in
  `render.js`). The editor applies it after each redraw, inside the undo step
  of the edit that caused it, and printing applies it per label, so batch rows
  can differ in length.
- A text element's `text` is a string, or, when part of it is formatted, a
  list of runs: each a string in the box's own style, or a
  `[style, string]` pair whose style (`fontWeight`, `italic`, `underline`)
  overrides the box's, as in `["Use by ", [{"fontWeight": 700}, "Friday"]]`.
  There's one way to write each text (`normalize` in `richtext.js`):
  neighbouring runs with the same style are joined, empty ones dropped, a style
  holds only what differs from the box, and text with no formatting is a plain
  string. A run never starts inside a grapheme or a `{field}`, so fields fill
  in run by run. `parse()` checks the runs and tidies hand-written ones.
- A text element's `ditherEmoji` draws its emoji with the system's colour emoji
  font on a layer of their own, dithered like a photo, instead of the outline
  emoji font; the letters stay a plain threshold.
- `x/y/w/h` are in mm from the label's top-left, as you read the label. They
  describe the element's box _after_ rotation, so the box is always
  axis-aligned. Rotating a quarter turn swaps `w` and `h` around the centre.
- `rotation` is 0, 90, 180 or 270 degrees clockwise. Only quarter turns are
  supported, so one-dot lines and barcode bars stay exact on the 8 dots/mm grid.
- Shapes are `rect` (with optional rounded corners), `ellipse` or `line` (a
  horizontal bar through the middle of the box; rotate it for a vertical one).
  Outlines are drawn entirely inside the box, at `strokeMm` thickness rounded
  to whole dots.
- Barcodes (`"type": "barcode"`, with `data`, `symbology` = `CODE128` / `EAN13` /
  `UPCA`, and `showText`) are encoded by `src/barcode.js`. QR codes
  (`"type": "qr"`, with `data` and `level` = `L`/`M`/`Q`/`H`) use the vendored
  `qrcode-generator` with UTF-8 text. Each bar or QR square is a whole number
  of printer dots. The renderer flags codes that can't be drawn, or whose
  modules are only one dot wide (unreliable to scan). Code content isn't
  validated on load, since a half-typed EAN is a normal editing state.
- Images (`"type": "image"`) embed a downscaled picture as a `data:image/…`
  URL (PNG, JPEG, WebP or GIF; anything else, including remote URLs, is
  rejected so files work offline and can't phone home). `mode` is `dither`
  (photos) or `threshold` (logos), `level` 0–255 is darkness, and `invert`
  flips the printed result.
- An element may leave out any property a new element would have anyway
  (`rotation`, `fontSizePt`, `symbology`…), as may `label.continuous` and
  `editor`; they take the values a new one gets (`OPTIONAL` in
  `fileformat.js`). Only an element's `id`, `type`, box and content
  (`text`, `data` or `src`) are required. So a property added later needs
  no new version: older files simply don't have it.
- `parse()` checks every field: types, ranges, known enums, and unique ids.
  It throws a `LabelFileError` with a message a person can read. Unknown extra
  fields are dropped.
- Version 1 is the first public format, and saved labels and share links must
  keep opening from here on. A change that older files can't simply leave out
  gets a new version and a migration in `parse()`, tested with a fixture
  file. Files from newer versions are refused with a message that says so,
  rather than half-read.

## Printers and drivers

The app is a label designer with printers plugged in. Nothing outside
`src/printers/` knows what brand a printer is. Generic code asks the selected
**model** for its sizes and asks the model's **driver** for bytes.

- A **driver** (`PrinterDriver` in `src/printers/index.js`) is one kind of
  printer's protocol: its Bluetooth service and write characteristic, packet
  size, job builder, darkness values, status queries and status parser, an
  optional auto power-off setting, and a decoder and simulator for the virtual
  printer. Status comes back in a shared vocabulary (battery, charging, paper,
  cover, firmware, autoPowerOff, printed), so the UI treats every printer the
  same.
- A **model** (`PrinterModel`) is data: the names it uses over Bluetooth, its
  head width, its default continuous feed, the label sizes it takes, whether
  it has been printed with this app (`tested`), and its driver.

`src/printers/index.js` lists every model from every driver. The Bluetooth
picker filters on all of their names and services. On connect, the
connection recognises the model from the device's name (longest prefix
wins), before GATT connect, so it uses that driver's service. _Advanced →
Printer model_ sets the model by hand. Label presets, the continuous roll
height, the feed default, the virtual printer and every print job follow the
selected model.

Today there is one driver, Phomemo's D-series (`src/printers/phomemo/`):

- **D30**: tested.
- **D10, D20, D30 Pro, D30s, D35, Q30, V30D**: print exactly like the D30. Their Bluetooth names are guesses from the model name;
  confusing two of them is harmless, since they print alike.
- **A30, P15**: the same print sequence with a
  different continuous feed (A30: 12 lines after the last copy only; P15:
  none). They take 14 and 15 mm labels on the same 12 mm head, so the print is
  centred on the head (`centreOnHead` in `raster.js`).

### Adding a printer

**A relative of one the app has** (same protocol): add one entry to that
driver's `models.js`, with its Bluetooth name prefix, head width, feed and
label sizes. Set `tested: true` once it has printed.

**A new kind of printer:** add a folder under `src/printers/` with a
`driver.js` implementing `PrinterDriver` and a `models.js`, and add its
models to `PRINTERS` in `src/printers/index.js`. Unit-test the job builder
against its decoder the way `test/phomemo-protocol.test.js` does; the virtual
printer then works for it with no further code. Things the interface doesn't
cover yet, because no printer has needed them:

1. **Orientation.** `toPrinterRaster` always turns the label a quarter turn,
   because a D-series head spans the label's height. Printers whose heads span
   the label's width (shipping-label printers) don't turn it, and some tape
   printers also turn it 180°. That would become a model field.
2. **Resolution.** `units.js` fixes 8 dots/mm (203 dpi). A 300 dpi model
   would need the dot pitch passed through rendering.
3. **Margins.** `MARGIN` in `model.js` is shared by every model today. A
   printer with other margins would carry its own.
4. **Label limits.** `LIMITS.labelHeightMm` (6–15 mm) and the label bar's
   inputs assume a 12 mm head. A wider printer needs its own range.

## The Phomemo D-series driver

What a print job sends:

| Step    | Bytes                            | Meaning                                                            |
| ------- | -------------------------------- | ------------------------------------------------------------------ |
| paper   | `1F 11 0A` / `1F 11 0B`          | Paper type: gap labels / continuous (the printer keeps it)         |
| offset  | `1F 11 24 n`                     | Shift by n bytes; n = 12 − bytes/row, so 0 on a full-width image   |
| init    | `1B 40`                          | ESC @ (reset)                                                      |
| density | `1F 11 02 n`                     | n = 1 light, 2 normal, 4 dark (sent after init; Normal by default) |
| copies  | `1F 11 21 n`                     | The printer repeats the next image n times                         |
| image   | `1D 76 30 00 xL xH yL yH` + data | GS v 0: raster, x = bytes/row, y = rows                            |
| feed    | `1B 64 17`                       | ESC d 23 (continuous paper only)                                   |

There is one sequence per paper type. The label decides which one is
used: pre-cut sizes use gaps, and _Continuous roll_ uses the continuous one.

- **Labels with gaps** (the default): paper type gaps, offset, init,
  density, copies, image. Nothing comes after the image, because the printer stops at the next
  gap by itself. The first real print used the continuous sequence on a
  gapped roll, and the D30 kept feeding blank labels after the image.
- **Continuous roll:** paper type continuous, init, density, then image +
  `ESC d 23` for each copy.

The copy count goes even for a single copy, so a count left over from an
earlier job can't carry into this one.

The paper type is a setting the printer keeps, and every job sends it. It
decides what happens after the image: set to gaps, the printer feeds on until
its sensor finds the next gap. On continuous tape there is none, so it feeds a
distance that grows with the label's length before giving up. A D30 left set
to gaps did exactly that even with the continuous sequence, until jobs said
which paper they were for. (`1F 11 26` is black-mark paper, which no model
here uses.)

Status:

| Query                     | Reply (notification)                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `1F 11 08` battery        | `1A 04 nn` percent (A1/A2/A3 = 10/5/3 %), `1A 03 A8/A9` not charging / charging       |
| `1F 11 11` paper          | `1A 06 88/89` out / present; the printer also sends `1A 05 98/99` cover closed / open |
| `1F 11 07` firmware       | `1A 07 x y z`                                                                         |
| `1F 11 0E` auto power-off | `1A 09 nn`: off after nn × 5 minutes, 0 = never (set with `1B 4E 07 nn`; unconfirmed) |
| (unsolicited)             | `1A 0F 0C` print finished                                                             |

The D30's density values are 1, 2 and 4, for Light, Normal and Dark. Normal is
the default. Which BLE characteristic carries the D30's notifications isn't
confirmed, so
`BluetoothPrinter` subscribes to every notifying characteristic in the `ff00`
service. All writes (print jobs and status queries) go through one queue, so a
query can never land in the middle of a job's image data.

- BLE: service `0000ff00-…`, write characteristic `0000ff02-…`. Writes are
  128-byte chunks with `writeValueWithResponse`. Each write waits for the
  previous one, which keeps the printer's buffer from overflowing.
- Bits are MSB first and `1` means black. The width is `heightMm × 8` dots
  (the print head runs across the label's short side), and the rows run along
  the label's length.
- Orientation: the label is rendered as you read it (landscape) and rotated
  90° clockwise into the raster. That matches the reference repo, which is
  known to print correctly. A "Flip 180°" setting is there in case real
  prints come out upside down.

The reference repo has two bugs that we don't copy. It allocates 8 extra
bytes and reports a non-integer row count in the header for most widths. Its
last-packet slice is wrong, so it sends empty writes.

## Virtual printer

`VirtualPrinter` has the same interface as the BLE transport. It sends every
packet to the driver's decoder (`printers/phomemo/decoder.js`), which parses the byte stream as the printer would
(ESC @, offset, density, copies, GS v 0, ESC d, status queries) and rebuilds
each printed bitmap, once per copy. It answers status queries with real D30-format notifications, and its
state can be changed from tests, or from the console with `?debug` in the URL
(`labelApp.simulateVirtual({
paper: false })`) to try out-of-paper, cover-open and low-battery handling.
The app shows those bitmaps as a strip of "printed" labels, rotated back to
reading orientation, along with byte and packet counts. A protocol bug shows
up there as a wrong or garbled label, before any paper is used.

The e2e suite goes one step further with a fake Web Bluetooth device
(`test/e2e/fake-bluetooth.js`). It exercises the real `BluetoothPrinter`: the
device picker, GATT, notifications, chunked writes, disconnects and Forget.
`test/e2e/fake-serial.js` does the same for `SerialPrinter`.

## Serial port (experimental)

The D30 also speaks classic Bluetooth (SPP). Windows turns a
paired SPP device into COM ports, and Web Serial (Chrome and Edge on desktop)
can open them, so `SerialPrinter` sends exactly the same bytes as
`BluetoothPrinter` and reads the same status records back. The picker lists
the SPP service id too, so Chrome can offer the printer's Bluetooth serial
service directly. A serial link has no write acknowledgements, so jobs go out
in 512-byte chunks with a 10 ms gap (about 50 KB/s). That's a guess at what the
printer can buffer, to adjust on hardware.

## Accessibility

- The bar over the label and the rail beside it are toolbars (`toolbar.js`): their
  buttons are one Tab stop, and the arrow keys, Home and End move between
  controls. Fields in them keep their own Tab stop and arrow keys, so nothing is
  out of reach from the keyboard. The bar's More… opens the settings
  as a non-modal dialog under it, which takes the focus and closes on Esc
  (before Esc deselects). While typing on the label, the bar's buttons don't
  take the focus, and its menus hand it back.
- The Elements list (the menu above the label) is a listbox: Tab reaches it,
  arrow keys / Home / End change the selection. The canvas overlay is focusable; there, arrow keys
  nudge, R rotates and Delete removes. Clicking an element focuses the canvas
  so shortcuts apply to it.
- The preview canvas carries a text description of every element; adding,
  deleting, rotating and keyboard selection are announced through a polite
  live region; errors use `role="alert"`.
- `test/e2e/a11y.e2e.js` runs axe-core over a new label, the open menus,
  the bar, the settings and the dialogs (currently zero findings at any severity), and drives
  the editor keyboard-only.

## Browser support

`navigator.bluetooth` is feature-detected. Without it (Firefox, Safari),
printing is limited to the virtual printer. The printer chip says the browser
can't use Bluetooth, its menu says to open the page in Chrome or Edge, and
everything else works.

## Hardware verification checklist (milestone 4)

1. Connect from Chrome or Edge. The device usually advertises as `D30`, and
   the picker uses a name-prefix filter.
2. Open `examples/orientation-test.label` and print it. The arrow should be
   at the left and "TOP EDGE" along the top. If the print is upside down, turn
   on **Flip 180°** in _Advanced_.
3. A label should stop at the next gap, with no blank labels after it. The
   first hardware print fed blank labels non-stop with the continuous-paper
   sequence, so gap labels no longer send a feed.
4. Print 3 copies. All three should come out, with no merging. This checks
   the copy count `1F 11 21`. If only one comes out, the printer may ignore
   it, and the fix is to repeat the image instead.
5. Check that the margins match the guides, and that text near the edges
   isn't clipped by the print head (the head may be 12 mm wide even on 14 and
   15 mm stock).
6. After connecting, the status line should show battery and "labels loaded".
   If it shows nothing, the D30 may not send status over BLE. Printing still
   works.
7. Open the cover, then take the labels out. The status line and a warning
   should report each. If the two are swapped, swap the `05`/`06` meanings in
   `printers/phomemo/status.js`.
8. Print the same label at Light, Normal and Dark and compare.
9. Scan a printed Code 128 and a QR code with a phone.
10. _Advanced → Turn the printer off after_ should show the printer's current
    setting once connected. Pick 10 minutes, leave the printer idle, and check
    it switches itself off. The D-series also has a `1A 40` "material" record (roll part number, width, length) for smart
    label rolls; if the D30 ever sends one, it could pick the label size
    automatically.
11. Serial: pair the D30 in Windows, choose _Phomemo D30 (serial port)_, and
    connect. If the picker shows two COM ports, the outgoing one is usually the
    right one. Print a label and a 10-label batch; if the batch garbles,
    increase `SERIAL_GAP_MS` in `transport.js`.
