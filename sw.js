// Guarda o app no celular para abrir sem internet. Suba o número do CACHE a cada mudança no app.
const CACHE = 'racha-v9';
const ARQUIVOS = ['./', 'index.html', 'app.js', 'calc.js', 'config.js', 'manifest.webmanifest', 'favicon.png', 'logo.jpg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ARQUIVOS.map(a => c.add(a).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return; // chamadas à planilha passam direto
  const url = new URL(req.url);
  if (url.hostname.endsWith('google.com') || url.hostname.endsWith('googleusercontent.com') || url.hostname.includes('awesomeapi')) return;
  // Rede primeiro (pega versão nova), cache se estiver sem internet.
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
