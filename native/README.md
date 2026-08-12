# Frame Twelve — native

Packages `web/frame-twelve.html` as an Android app with Capacitor. The HTML is
the single source of truth and is never edited; `scripts/sync-web.js` copies it
into `www/` at build time.

## Why Capacitor

The app already contains a native gallery bridge, written for Capacitor:

```js
var C = window.Capacitor;
if(!C || !C.Plugins || !C.Plugins.Media) return;   // frame-twelve.html:9207
```

Exports check for it first and only fall back to share/download when absent.
Capacitor also serves the page from a real origin (`https://localhost`), so the
app's IndexedDB and localStorage behave exactly as they do in a browser.

## The one shim

`src/native-bridge.js` registers `window.Capacitor.Plugins.Media`. It exists
because the app passes the album as a **name**, while
`@capacitor-community/media` v5+ wants the album **identifier** on Android. The
shim resolves name to identifier via `getAlbums()`, creating the album if
needed. Bundled with esbuild, since the HTML has no module loader.

## Permissions

`@capacitor-community/media` requests storage permissions at runtime but
declares none in its own manifest, so `AndroidManifest.xml` declares them here.
Without that the request fails silently and gallery save never works.

## Building

CI does this on every push — see `.github/workflows/build-apk.yml`. Locally:

```
npm install
npm run sync-web
npx cap sync android
cd android && ./gradlew assembleDebug
```

## Icons

```
npm run icons
```

Regenerates every launcher density from `scripts/make-icons.py`, plus the web
startup logo. Nothing is a hand-placed binary.
