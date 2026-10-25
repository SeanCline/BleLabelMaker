<!-- generated:intro -->

# BLE Label Maker

Design and print labels on Bluetooth label makers, right from the web.

**Open it: https://blelabelmaker.sdcline.com/**

<!-- /generated:intro -->

It's a web page, not an app: open it in your browser, design a label and print it straight to a
Bluetooth label maker. There's nothing to install and no account, and your labels never leave
your device.

## What it does

- **Text** in a choice of fonts, sizes and weights, with emoji, sized to fit the label if you
  like.
- **Designs** with several text boxes, shapes, barcodes, QR codes and pictures, which you can
  drag, resize and rotate.
- **Fields** that fill themselves in as you print: today's date, a date a month from now, or a
  number that counts up with every label.
- **Batches:** paste a list or a spreadsheet and print one label per line.
- **Save, open and share** labels, as files or as links. Every printed label is kept in a
  history you can search and reprint from.
- **A virtual printer** that shows exactly what a real one would print, for trying things out
  without any hardware.
- **Works offline** once the page has loaded.

## What you need

- **Chrome or Edge** on Windows, macOS, Linux, ChromeOS or Android. Printing uses Web
  Bluetooth, which other browsers don't offer; in them you can still design and use the
  virtual printer. iPhones and iPads aren't supported, as no browser there has Web Bluetooth.
- **A supported label maker** (below), switched on and nearby. Press _Print_ and pick it from
  the list the first time.

## Supported label makers

<!-- generated:printers -->

| Label maker     | Labels                                  | Status                 |
| --------------- | --------------------------------------- | ---------------------- |
| Phomemo D30     | 12 mm pre-cut; 12 mm continuous         | Tested                 |
| Phomemo D10     | 12 mm pre-cut; 12 mm continuous         | Untested (should work) |
| Phomemo D20     | 12 mm pre-cut; 12 mm continuous         | Untested (should work) |
| Phomemo D30 Pro | 12 mm pre-cut; 12 mm continuous         | Untested (should work) |
| Phomemo D30s    | 12 mm pre-cut; 12 mm continuous         | Untested (should work) |
| Phomemo D35     | 12 mm pre-cut; 12 mm continuous         | Untested (should work) |
| Phomemo Q30     | 12 mm pre-cut; 12 mm continuous         | Untested (should work) |
| Phomemo V30D    | 12 mm pre-cut; 12 mm continuous         | Untested (should work) |
| Phomemo A30     | 12, 14, 15 mm pre-cut; 12 mm continuous | Untested (should work) |
| Phomemo P15     | 12, 14, 15 mm pre-cut; 12 mm continuous | Untested (should work) |

"Untested" models use the same commands as a tested one, so they should work, but nobody
has confirmed it yet. If you have one, please try it: after its first print, the app asks
whether it came out right, so you can confirm it works or report a problem. You can also
open an [issue](https://github.com/SeanCline/BleLabelMaker/issues).

<!-- /generated:printers -->

## Development

The app is plain HTML, CSS and JavaScript with no build step; it lives in [`app/`](app/). See
[app/README.md](app/README.md) for running it locally, the tests and deploying, and
[app/DESIGN.md](app/DESIGN.md) for how it works and how to add a printer.

## License

MIT, see [LICENSE.txt](LICENSE.txt). The bundled fonts and libraries have their own licenses,
listed in [app/README.md](app/README.md#licenses).

<!-- generated:disclaimer -->

_BLE Label Maker is not affiliated with any label maker manufacturer. Label maker models are trademarks of their respective owners._

<!-- /generated:disclaimer -->
