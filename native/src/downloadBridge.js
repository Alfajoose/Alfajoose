// Injected into the WebView before the page loads.
//
// Frame Twelve exports by building a Blob, wrapping it in an object URL and
// clicking an <a download>. That is a no-op inside a WebView: there is no
// browser download manager. This intercepts those clicks and hands the bytes
// to React Native, which writes a real file and opens the share sheet.

export default `
(function () {
  if (window.__ftBridgeInstalled) return;
  window.__ftBridgeInstalled = true;

  // Remember which Blob each object URL points at, so we can recover the
  // bytes when the anchor is clicked.
  var blobs = new Map();
  var createObjectURL = URL.createObjectURL.bind(URL);
  var revokeObjectURL = URL.revokeObjectURL.bind(URL);

  URL.createObjectURL = function (obj) {
    var url = createObjectURL(obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };

  URL.revokeObjectURL = function (url) {
    // Keep the blob a moment longer than the page does; the click handler
    // may still be reading it.
    setTimeout(function () { blobs.delete(url); }, 10000);
    return revokeObjectURL(url);
  };

  function send(payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  function deliver(blob, filename) {
    var reader = new FileReader();
    reader.onload = function () {
      // reader.result is "data:<mime>;base64,<data>"
      var s = String(reader.result);
      var comma = s.indexOf(',');
      send({
        type: 'save-file',
        filename: filename || 'frame-twelve-export',
        mime: blob.type || 'application/octet-stream',
        base64: comma >= 0 ? s.slice(comma + 1) : '',
      });
    };
    reader.onerror = function () {
      send({ type: 'error', message: 'Could not read the exported file.' });
    };
    reader.readAsDataURL(blob);
  }

  function handleAnchor(a) {
    if (!a || !a.hasAttribute || !a.hasAttribute('download')) return false;
    var href = a.getAttribute('href') || '';
    var name = a.getAttribute('download') || '';

    if (blobs.has(href)) {
      deliver(blobs.get(href), name);
      return true;
    }
    if (href.indexOf('data:') === 0) {
      var comma = href.indexOf(',');
      var meta = href.slice(5, comma);
      var isB64 = meta.indexOf('base64') !== -1;
      var raw = href.slice(comma + 1);
      send({
        type: 'save-file',
        filename: name || 'frame-twelve-export',
        mime: meta.split(';')[0] || 'application/octet-stream',
        base64: isB64 ? raw : btoa(unescape(raw)),
      });
      return true;
    }
    if (href.indexOf('blob:') === 0) {
      // Object URL we never saw created — fetch it back out.
      fetch(href).then(function (r) { return r.blob(); })
                 .then(function (b) { deliver(b, name); })
                 .catch(function () {
                   send({ type: 'error', message: 'Export failed.' });
                 });
      return true;
    }
    return false;
  }

  // Most exports call a.click() directly.
  var nativeClick = HTMLElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (handleAnchor(this)) return;
    return nativeClick.apply(this, arguments);
  };

  // Anchors that end up in the DOM and get tapped by the user.
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest && ev.target.closest('a[download]');
    if (a && handleAnchor(a)) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }, true);
})();
true;
`;
