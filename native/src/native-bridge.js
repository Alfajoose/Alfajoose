// Native plumbing for frame-twelve.html. The HTML is never edited; everything
// here adapts the plugins to what the app already expects.
//
// Three jobs:
//
//   1. Register window.Capacitor.Plugins.Media, which the app probes for, and
//      translate album name -> album identifier (the plugin changed to
//      identifiers in v5; the app still passes a name).
//
//   2. Route non-media saves away from the gallery. The app's _saveToGallery
//      wraps every non-video payload as "data:image/png;base64,…" — correct
//      for frames and sprite sheets, wrong for a .keela project, which would
//      land in the camera roll as a corrupt image.
//
//   3. Act on <a download> clicks. The app calls _dlFallback directly when
//      exporting a frame sequence, to avoid one share sheet per frame. A bare
//      anchor download is a no-op in any Android WebView, so those exports
//      would silently vanish.

import { Media } from '@capacitor-community/media';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const ALBUM = 'Frame Twelve';

const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|heic)$/i;
const VIDEO_RE = /\.(mp4|webm|mov|m4v|3gp)$/i;

// ---------------------------------------------------------------- albums ---

// Identifiers are stable and getAlbums() is a real IPC round trip.
const albumIds = new Map();

async function findAlbum(name) {
  try {
    const { albums = [] } = await Media.getAlbums();
    const hit = albums.find((a) => a.name === name);
    return hit ? hit.identifier : undefined;
  } catch {
    return undefined;
  }
}

async function albumIdentifier(name) {
  if (!name) return undefined;
  if (albumIds.has(name)) return albumIds.get(name);

  let id = await findAlbum(name);
  if (!id) {
    // createAlbum resolves void, so a second lookup is the only way to learn
    // the identifier it just made.
    try {
      await Media.createAlbum({ name });
    } catch {
      /* already exists, or refused — re-check either way */
    }
    id = await findAlbum(name);
  }
  if (id) albumIds.set(name, id);
  return id;
}

async function withAlbum(opts) {
  const album = await albumIdentifier(opts && opts.album);
  // Better to save with no album than to fail on a name the platform rejects.
  return { ...opts, album: album || undefined };
}

// ------------------------------------------------------------ file saves ---

function sanitise(name) {
  return String(name || 'frame-twelve-export').replace(/[^\w.\-]+/g, '_');
}

// Anything that is not an image or a video — .keela projects, .json — belongs
// in Documents with a share sheet, not in the camera roll.
async function saveAsFile(base64, name, mime) {
  const path = sanitise(name);
  await Filesystem.writeFile({
    path,
    data: base64,
    directory: Directory.Documents,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({
    path,
    directory: Directory.Documents,
  });
  try {
    await Share.share({ title: path, url: uri, dialogTitle: path });
  } catch {
    // User dismissed the sheet. The file is already written, so this is fine.
  }
  return { ok: true, uri };
}

async function saveToAlbum(base64, name, mime) {
  const isVideo = VIDEO_RE.test(name);
  const path = `data:${mime || (isVideo ? 'video/mp4' : 'image/png')};base64,${base64}`;
  const opts = await withAlbum({ path, album: ALBUM });
  return isVideo ? Media.saveVideo(opts) : Media.savePhoto(opts);
}

function splitDataUrl(url) {
  const comma = url.indexOf(',');
  if (comma < 0) return null;
  const meta = url.slice(5, comma);
  const base64 = meta.includes('base64')
    ? url.slice(comma + 1)
    : btoa(unescape(url.slice(comma + 1)));
  return { mime: meta.split(';')[0] || '', base64 };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// ------------------------------------------------------------- 1. plugin ---

if (typeof window !== 'undefined' && window.Capacitor) {
  window.Capacitor.Plugins = window.Capacitor.Plugins || {};
  window.Capacitor.Plugins.Media = {
    getAlbums: () => Media.getAlbums(),
    createAlbum: (opts) => Media.createAlbum(opts),
    savePhoto: async (opts) => Media.savePhoto(await withAlbum(opts)),
    saveVideo: async (opts) => Media.saveVideo(await withAlbum(opts)),
  };
}

// ------------------------------------------------- 2. re-route non-media ---

// The app defines window.FrameTwelveNative on DOMContentLoaded. This script is
// in <head> so its own DOMContentLoaded listener would run first; 'load' fires
// later, which is what lets us wrap the finished object.
window.addEventListener('load', () => {
  const native = window.FrameTwelveNative;
  if (!native || typeof native.saveToGallery !== 'function') return;

  const original = native.saveToGallery.bind(native);

  native.saveToGallery = async (opts) => {
    const name = (opts && opts.name) || '';
    if (IMAGE_RE.test(name) || VIDEO_RE.test(name)) {
      return original(opts); // genuinely media — let the app's path run
    }
    return saveAsFile(opts.data, name, 'application/octet-stream');
  };
});

// ----------------------------------------------- 3. act on <a download> ---

(() => {
  const blobs = new Map();
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);

  URL.createObjectURL = function (obj) {
    const url = create(obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    // The app revokes on a 2s timer; outlive that so a click can still read it.
    setTimeout(() => blobs.delete(url), 10000);
    return revoke(url);
  };

  async function handle(href, name) {
    let base64;
    let mime = '';

    if (href.startsWith('data:')) {
      const parsed = splitDataUrl(href);
      if (!parsed) return;
      ({ base64, mime } = parsed);
    } else {
      const blob = blobs.get(href) || (await fetch(href).then((r) => r.blob()));
      if (!blob) return;
      mime = blob.type;
      base64 = await blobToBase64(blob);
    }

    // Frame sequences arrive one anchor per frame, so images go straight to
    // the album silently. A share sheet per frame would be unusable.
    if (IMAGE_RE.test(name) || VIDEO_RE.test(name)) {
      await saveToAlbum(base64, name, mime);
    } else {
      await saveAsFile(base64, name, mime);
    }
  }

  function intercept(a) {
    if (!a || !a.hasAttribute || !a.hasAttribute('download')) return false;
    const href = a.getAttribute('href') || '';
    if (!href) return false;
    handle(href, a.getAttribute('download') || '').catch(() => {});
    return true;
  }

  const nativeClick = HTMLElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (intercept(this)) return;
    return nativeClick.apply(this, arguments);
  };

  document.addEventListener(
    'click',
    (ev) => {
      const a = ev.target?.closest?.('a[download]');
      if (a && intercept(a)) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    },
    true
  );
})();
