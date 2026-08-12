// Makes the gallery bridge that already exists in frame-twelve.html work.
//
// The app looks for window.Capacitor.Plugins.Media and calls createAlbum /
// savePhoto / saveVideo, passing the album as a NAME ("Frame Twelve"). Since
// @capacitor-community/media v5 the Android side wants the album IDENTIFIER
// instead, so the translation happens here. The HTML stays untouched.

import { Media } from '@capacitor-community/media';

// Album identifiers are stable, and getAlbums() is a real IPC round trip, so
// remember what we resolve.
const cache = new Map();

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
  if (cache.has(name)) return cache.get(name);

  let id = await findAlbum(name);

  if (!id) {
    // Not there yet — create it, then look again. createAlbum resolves void,
    // so the second lookup is the only way to learn the identifier.
    try {
      await Media.createAlbum({ name });
    } catch {
      // Already exists, or the platform refused. Either way, re-check.
    }
    id = await findAlbum(name);
  }

  if (id) cache.set(name, id);
  return id;
}

async function withAlbum(opts) {
  const album = await albumIdentifier(opts && opts.album);
  // Passing album: undefined is better than passing a name the platform will
  // reject — the file still reaches the camera roll, just not the sub-album.
  return album ? { ...opts, album } : { ...opts, album: undefined };
}

const shim = {
  getAlbums: () => Media.getAlbums(),
  createAlbum: (opts) => Media.createAlbum(opts),
  savePhoto: async (opts) => Media.savePhoto(await withAlbum(opts)),
  saveVideo: async (opts) => Media.saveVideo(await withAlbum(opts)),
};

// The native shell injects window.Capacitor before page scripts run; only
// augment it, never replace it.
if (typeof window !== 'undefined' && window.Capacitor) {
  window.Capacitor.Plugins = window.Capacitor.Plugins || {};
  window.Capacitor.Plugins.Media = shim;
}
