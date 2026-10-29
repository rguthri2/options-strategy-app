// The session cookie is HTTPS-only: move an http:// visit to https:// before the user signs in.
(function () {
  var h = location.hostname;
  var local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || /\.(localhost|test)$/.test(h);
  if (location.protocol === 'http:' && !local) location.replace('https://' + location.host + location.pathname + location.search + location.hash);
})();

document.getElementById('login').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('err');
  err.hidden = true;
  const res = await fetch('api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: document.getElementById('password').value }),
  });
  // Return to the page the link pointed to (e.g. a Telegram alert's #/t/NVDA). In-app routes only.
  if (res.ok) { location.href = './' + (/^#\/[\w\-./%?=&]*$/.test(location.hash) ? location.hash : ''); return; }
  const data = await res.json().catch(() => ({}));
  err.textContent = data.error || 'Sign-in failed';
  err.hidden = false;
});
