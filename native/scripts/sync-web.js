#!/usr/bin/env node
// Builds www/ — what Capacitor packages into the APK.
//
// web/frame-twelve.html is the source of truth and is never edited. This
// copies it to www/index.html and adds one <script> tag for the native
// bridge, which must run before the app's DOMContentLoaded handler looks for
// window.Capacitor.Plugins.Media.
//
//   npm run sync-web

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, '..', 'web', 'frame-twelve.html');
const WWW = path.join(ROOT, 'www');
const OUT = path.join(WWW, 'index.html');
const TAG = '<script src="native-bridge.js"></script>';

fs.mkdirSync(WWW, { recursive: true });

// Bundle the bridge: the app is plain HTML with no module loader, so the
// plugin's ESM imports have to be flattened into one classic script.
execFileSync(
  path.join(ROOT, 'node_modules', '.bin', 'esbuild'),
  [
    path.join(ROOT, 'src', 'native-bridge.js'),
    '--bundle',
    '--format=iife',
    '--target=es2019',
    '--outfile=' + path.join(WWW, 'native-bridge.js'),
  ],
  { stdio: 'inherit' }
);

let html = fs.readFileSync(SRC, 'utf8');

if (!html.includes(TAG)) {
  // Into <head>, so it runs before the inline app script at the end of body.
  if (!html.includes('</head>')) {
    throw new Error('no </head> in frame-twelve.html — cannot inject bridge');
  }
  html = html.replace('</head>', `${TAG}\n</head>`);
}

fs.writeFileSync(OUT, html);

const size = (p) => (fs.statSync(p).size / 1024).toFixed(1) + ' KB';
console.log(`www/index.html        ${size(OUT)}`);
console.log(`www/native-bridge.js  ${size(path.join(WWW, 'native-bridge.js'))}`);
