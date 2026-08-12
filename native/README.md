# Frame Twelve — native

Wraps `web/frame-twelve.html` in an Expo app so it installs as a real Android
app. The HTML stays the single source of truth; nothing about the drawing
engine is reimplemented.

## Why a wrapper

The web app is ~8,600 lines of canvas code — pointer handling, compositing,
onion skinning, flood fill, GIF/WebM encoding. Rewriting that against a native
canvas library would take months and lose behaviour. The wrapper keeps every
feature, and the two things a WebView cannot do on its own are bridged.

## What is bridged

**Storage.** Frame Twelve keeps projects in IndexedDB and localStorage. Loaded
from `file://`, that storage is opaque or unavailable and saved work vanishes
between launches. The WebView is given a `baseUrl` of `https://frametwelve.local`
so the page has a stable origin to key storage against.

**Exports.** The web app exports by clicking an `<a download>`, which does
nothing in a WebView — there is no download manager. `src/downloadBridge.js` is
injected before the page loads, intercepts those clicks, and posts the bytes to
React Native, which writes a real file and opens the Android share sheet.

## Regenerating after editing the web app

`src/frameTwelveHtml.js` is generated — the HTML as a JSON-escaped string. It is
committed because EAS uploads only this directory, so `../web` is not available
at build time. After editing `web/frame-twelve.html`:

```
npm run bundle-html
```

## Building

Requires an Expo account. EAS builds in Expo's cloud, so no Android SDK is
needed locally:

```
npm install
npx eas login
npx eas build --platform android --profile preview
```

The `preview` profile produces a sideloadable APK. `production` produces an
app bundle for Play.

To iterate without a build, run `npx expo start` and open it in Expo Go.

## Verifying a change

`npx expo export --platform android` bundles without needing a device and will
surface import and syntax errors.
