# BLE Label Maker

A label designer for Bluetooth label printers that runs as a web page and
prints straight from the browser over Web Bluetooth. No account, no tracking, no build step.
Printers plug in as drivers; see [DESIGN.md](DESIGN.md#printers-and-drivers).

_BLE Label Maker is not affiliated with any label maker manufacturer. Label
maker models are trademarks of their respective owners._

## Supported printers

The list, with which models are tested, is in the repository's
[README](../README.md#supported-label-makers); `npm run name` generates it from
the printer registry (`src/printers/`).

Every model can also be tried without hardware on the built-in virtual printer,
which decodes the exact bytes the real one would receive.

## Run it

```sh
node serve.js        # http://localhost:8080
```

Open that URL in **Chrome or Edge** to print. Web Bluetooth only works on
`https://` or `localhost` pages, so opening `index.html` as a file won't work.
In Firefox and Safari you can still design, save, load and test-print with the
virtual printer.

It deploys to GitHub Pages from CI; see [Deploy](#deploy).

### From other devices on your network

Phones and other PCs need HTTPS, because `http://<computer-name>` isn't a
secure page and the browser switches Bluetooth off there.

```sh
npm run cert         # once: makes a test CA and certificate in ../certs
npm run serve:lan    # https://<computer-name>/, and http:// redirects there
```

The script prints the address. Allow TCP 443 (and 80 for the redirect)
through the firewall. Then on each device, open `http://<computer-name>/ca.crt`
and trust it:

- **Windows:** open the file, choose _Install Certificate_ → _Local Machine_ →
  _Trusted Root Certification Authorities_.
- **Android:** _Settings → Security → Encryption & credentials → Install a
  certificate → CA certificate_.
- **iPhone/iPad:** install the profile, then turn it on under _Settings →
  General → About → Certificate Trust Settings_.

The CA can only vouch for this computer's own names and addresses, so trusting
it doesn't let it impersonate any other site. Running `npm run cert` again
makes a new CA, which has to be trusted again. Pass extra names or IPs to it if
the computer is reached some other way (e.g. `npm run cert -- ws2025.lan`).
`../certs` holds the private keys. It's outside the served folder and ignored
by git.

Settings for `node serve.js` (environment variables):

| Variable        | Effect                                                                        |
| --------------- | ----------------------------------------------------------------------------- |
| `PORT`          | Port to listen on (default 8080, or 443 with `HTTPS`)                         |
| `HOST`          | `0.0.0.0` to accept connections from the network (default this computer only) |
| `HTTPS`         | Serve HTTPS with the certificate from `npm run cert`                          |
| `REDIRECT_PORT` | With `HTTPS`, also redirect plain HTTP on this port                           |

After the first visit the app works offline, and Chrome or Edge can install it
as a desktop app (the install icon in the address bar). Fonts are bundled, so
it never needs the internet.

## Use it

- **Start:** a new label has one text, already selected. Double-click the label
  and type, pick a font and size from the bar over it, then press Print (top
  right). _Fit to box_ (under More) picks the largest size that fits and shows
  it in the size box; typing a size there turns fitting off.
- **Emoji** go in text: type them, or use the _Emoji_ button next to the text
  field, or the smiley on the bar while typing on the label, to insert one
  where the cursor is. They print as crisp line art, or
  tick _Dithered emoji_ (shown once the text has one) to print them in shades
  of dots, like a photo.
- **Fields** fill themselves in when the label prints. Type them, or pick one
  from the _Field_ menu (`{ }` on the bar while typing):
  - `{date}`, `{date+30d}` (also `-1w`, `+3m`, `+1y`), `{date:iso}` for
    2026-12-31, `{time}`
  - `{n}` or `{n:000}`: a number that goes up with every label printed. _Next
    number_, under the arrow beside Print, sets where it continues.
  - `{{` and `}}` print a literal brace.
    Fields work in text, barcodes and QR codes.
- **Batch:** click _Batch_ beside Print and paste a list (one label per line) or cells from a
  spreadsheet, or open a CSV. Pasting a list straight onto the label offers
  the same, and the _One per line_ template starts with a sample list. The
  button shows how many labels the list makes. Pasted lines that all have the same number of
  comma-separated values are read as CSV. Put `{1}`, `{2}`… (or
  `{Column name}` with _First line is column names_) in the design, or `{0}`
  for the whole line. Print then
  makes one label per row. While there's a list, the label area shows which
  row it previews, with arrows to step through them.
- **Labels:** the size chip at the label area's bottom left; pick a pre-cut size, or _Continuous roll_ for rolls that are one
  long label. A roll starts out as long as the text (_Auto_; in a batch, each label gets its
  own length); untick _Auto_ to set a length. Only the sizes the selected printer model
  takes are listed.
- **Design:** add text, shapes, barcodes, QR codes and images from the toolbar
  down the label's left (or drop a picture on the page), then drag to move and
  use the handles to resize. The toolbar's last button lists everything on the
  label, for picking what's hidden under something else.
  Double-click text to type on the label (on a phone, tap text that's
  already selected). The bar over what's selected has
  its main settings (B, I and U work on a selection while typing); More… opens
  the rest. Text wraps inside its box. Text can
  have a larger first line (a title), letter spacing, an underline, an outline,
  or be stacked one letter per line. Images can fit, fill (cropping) or stretch to their box.
  - Select several: Shift- or Ctrl-click, drag across empty space, or Ctrl+A.
    Drag one to move them all; the bar lines them up or spaces them evenly.
  - Copy / cut / paste: Ctrl+C / X / V, also between labels and tabs. Pasting
    text or an image onto the label adds it. Text copied from Word, Google Docs or a web
    page keeps its bold, italic and underline, as does text copied from the label. Duplicate: Ctrl+D.
  - Zoom: the − / Fit / + buttons in the label area's corner, Ctrl+scroll, or
    \+ − 0 on the canvas. Scroll (or middle-drag) to move around a zoomed-in
    label.
  - Ruler (next to zoom): shows millimetre rulers along the label. They mark where the
    selection starts and ends (to 0.1 mm) and where the pointer is.
  - Undo/redo: Ctrl+Z / Ctrl+Y
  - Delete the selected element: Del
  - Nudge: arrow keys (hold Shift for 1 mm)
  - Rotate the selected element: R
  - Turn off snapping while dragging: hold Alt
- **Save / Open** (in the _File_ menu, with New, Share and History): Save downloads a `.label` file (JSON). Open restores the
  label and editor exactly as they were saved. You can also drag a `.label`
  file onto the page. Your current label is autosaved in the browser too.
- **Share:** copies a link that opens the label, design and all, in anyone's
  browser. The label travels inside the link (after the #), so it never touches
  a server. Links with pictures get long; for those, send the .label file.
- **History:** every label you print is kept in this browser. Search it,
  reopen a label, or print it again in one click. Reprinting the same design
  updates its entry instead of adding a duplicate. Export saves the history as
  a backup file. Import merges a backup in, for example on another computer.
- **Print:** the printer chip at the top right says which printer is in use,
  its battery, and any problem (cover open, out of labels). Click it to choose
  _Virtual printer_, _Bluetooth_ or _Serial port_ and set the darkness. The
  arrow beside Print sets the number of copies. Press Print or Ctrl+Enter. If
  prints come out upside down, turn on _Flip 180°_ under _More printer
  settings_ in the printer chip.
- **Printer model:** picked up from the printer's name when it connects, or
  set under _More printer settings_, which also has the feed after a continuous label
  (each model has its own default).
- **Serial port (experimental):** if Bluetooth LE won't connect, pair the
  printer in Windows' Bluetooth settings and choose _Serial port_. It
  shows up as a "Standard Serial over Bluetooth link" COM port; Chrome and Edge
  can print through that.

## Develop

```sh
npm test             # unit tests (node:test, no dependencies)
npm install          # once, for the browser tests and tools
npm run test:e2e     # UI tests in headless Chrome/Edge (set CHROME_PATH if not found)
npm run coverage     # both, measuring src/ in Node and the browser; CI fails below .c8rc.json's floors
npm run lint         # ESLint, Prettier and type checking (JSDoc types, tsc --checkJs)
npm run format       # fix formatting and auto-fixable lint
npm run precache     # after adding or removing an app file
npm run name         # after changing the name or repository in src/app-info.js
```

There is no build step. Types are JSDoc comments checked by TypeScript; the
document model's types are at the top of `src/model.js`.

[DESIGN.md](DESIGN.md) covers the architecture, file format and protocol.

## Deploy

Every push to `main` runs CI (lint, unit and browser tests). When it passes, the
`deploy` job builds the site with `node tools/make-site.mjs` (only the files
the app serves, plus the licenses and `CNAME`) and publishes it to GitHub
Pages at https://blelabelmaker.sdcline.com/. One-time setup on GitHub:

1. _Settings → Pages → Build and deployment → Source:_ **GitHub Actions**.
2. _Settings → Pages → Custom domain:_ `blelabelmaker.sdcline.com`, then tick
   _Enforce HTTPS_ once the certificate is issued. Web Bluetooth needs HTTPS.
3. At the DNS host for `sdcline.com`: a `CNAME` record from `blelabelmaker`
   to `<github-user>.github.io`.

To change the domain, edit `CNAME` and step 2.

## Licenses

The app is licensed under the MIT License ([LICENSE.txt](../LICENSE.txt)).
Bundled third-party files keep their own licenses, in a `LICENSE.txt` next to them:

- `fonts/`: fonts from Google Fonts, under the SIL Open Font License 1.1 or the
  Apache License 2.0 (each family's license is in `fonts/LICENSE.txt`).
- `src/vendor/`: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator), MIT.

## Credits

Phomemo protocol details come from
[odensc/phomemo-d30-web-bluetooth](https://github.com/odensc/phomemo-d30-web-bluetooth)
(Apache-2.0).
