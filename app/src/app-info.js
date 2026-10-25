// The app's name, in one place. After changing it, run `npm run name` to stamp it into
// index.html and the manifest (a test fails until you do).
export const APP_NAME = "BLE Label Maker";
// Under the icon on a phone's home screen, where there's room for about 12 characters.
export const APP_SHORT_NAME = "Label Maker";
export const APP_DESCRIPTION =
	"Design and print labels on Bluetooth label makers, right from the web.";
export const DISCLAIMER = `${APP_NAME} is not affiliated with any label maker manufacturer. Label maker models are trademarks of their respective owners.`;
// Where the source lives and where bug reports go ("owner/repository" on GitHub). Like the
// name, `npm run name` stamps it into index.html.
export const GITHUB_REPO = "SeanCline/BleLabelMaker";
export const REPO_URL = `https://github.com/${GITHUB_REPO}`;
// Kept equal to package.json's version (a test checks), so bug reports say which build.
export const APP_VERSION = "0.1.0";

// Not the name: where people's labels, settings and history are kept, and what saved files
// call themselves. Changing these loses or orphans what people have saved, so they stay put
// when the name changes.
export const STORAGE_ID = "labelmaker";
/** A localStorage key of this app's. */
export const storageKey = (what) => `${STORAGE_ID}.${what}`;
