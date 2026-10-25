# Vendored code

| File | Source | Version | License |
|------|--------|---------|---------|
| `qrcode-generator.js` | [kazuhikoarase/qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) `dist/qrcode.mjs` | 2.0.4 | MIT, © 2009 Kazuhiko Arase (`LICENSE.txt`) |

Copied unmodified (renamed from `.mjs` so every static host serves it as
JavaScript). Bundled instead of loaded from a CDN so the app works offline.
`src/qr.js` wraps it and swaps in a UTF-8 text encoder.
