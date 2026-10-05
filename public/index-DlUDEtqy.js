// Cache reset & updater
(async function() {
  try {
    if ('serviceWorker' in navigator) {
      var registrations = await navigator.serviceWorker.getRegistrations();
      for (var i = 0; i < registrations.length; i++) {
        await registrations[i].unregister();
      }
    }
    if ('caches' in window) {
      var keys = await caches.keys();
      for (var j = 0; j < keys.length; j++) {
        await caches.delete(keys[j]);
      }
    }
  } catch (e) {}
  var cleanUrl = window.location.origin + window.location.pathname.replace(/\/assets\/.*$/, '/');
  if (!cleanUrl.endsWith('/')) cleanUrl += '/';
  window.location.replace(cleanUrl);
})();
