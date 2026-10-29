// Classic (non-module) script that runs before everything else, in any browser.
(function () {
  // 1) Always use HTTPS on the public site: the session cookie is HTTPS-only, so an http:// visit
  //    would otherwise loop back to the login page (common when a phone opens the bare domain).
  var h = location.hostname;
  var local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || /\.(localhost|test)$/.test(h);
  if (location.protocol === 'http:' && !local) {
    location.replace('https://' + location.host + location.pathname + location.search + location.hash);
    return;
  }

  // 2) Theme before first paint.
  try {
    var t = localStorage.getItem('ot-theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage unavailable (private mode) */ }

  // 3) Never leave a blank screen: show startup errors, or a notice if the app did not start.
  function show(msg) {
    var app = document.getElementById('app');
    if (!app || app.getAttribute('data-err')) return;
    app.setAttribute('data-err', '1');
    var box = document.createElement('div');
    box.className = 'banner';
    box.textContent = msg;
    app.innerHTML = '';
    app.appendChild(box);
  }
  window.addEventListener('error', function (e) {
    if (e && e.message && !window.__otStarted) show('The app hit an error while starting: ' + e.message + ' (' + (navigator.userAgent || '') + ')');
  });
  window.addEventListener('load', function () {
    setTimeout(function () {
      var app = document.getElementById('app');
      if (app && !app.children.length && !window.__otStarted) {
        show('The app did not start in this browser. Please update your browser (iOS 14+ / Chrome 90+), then reload. Browser: ' + (navigator.userAgent || 'unknown'));
      }
    }, 12000);
  });
})();
