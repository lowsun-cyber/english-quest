// English Quest — service worker: приложение работает без интернета.
//
// • Оболочка (HTML/CSS/JS/манифест озвучки) — «сначала сеть»: онлайн всегда свежая версия,
//   офлайн — последняя сохранённая. Поэтому после git push ничего не нужно «сбрасывать».
// • Озвучка (tts_cache/*.mp3) — «сначала кэш»: файл скачивается один раз при первом
//   прослушивании или кнопкой «Скачать всю озвучку» в панели для взрослых.
// • Шрифты Google — берём из кэша и тихо обновляем в фоне.
const SHELL_CACHE = 'eq-shell-v8';
const AUDIO_CACHE = 'eq-audio-v1';   // то же имя использует app.js для массовой загрузки
const FONT_CACHE = 'eq-fonts-v1';
const KNOWN = [SHELL_CACHE, AUDIO_CACHE, FONT_CACHE];

const SHELL = [
  './', 'index.html', 'how-to.html', 'teacher.html', 'base.css', 'style.css', 'content.js', 'translations.js',
  'js/activity.js', 'js/backup.js', 'js/checkpoint.js', 'js/eq.js', 'js/exercises.js', 'js/homework.js', 'js/hud.js', 'js/main.js', 'js/map.js', 'js/mistakes.js', 'js/offline.js', 'js/state.js', 'js/tts.js', 'js/tutor.js', 'js/ui.js', 'js/util.js', 'js/worksheet.js', 'js/lock.js', 'js/profiles.js', 'js/speech.js', 'js/howto.js', 'js/config.js', 'js/api.js', 'js/merge.js', 'js/cloud.js', 'js/teacher.js',
  'tts_manifest.json', 'tts_voices.json', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];
const FONTS_CSS = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&family=Baloo+2:wght@500;700;800&family=Nunito:wght@600;800&display=swap';

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
    // шрифты — по возможности; без них приложение всё равно работает на системных
    try {
      const fonts = await caches.open(FONT_CACHE);
      const res = await fetch(FONTS_CSS);
      if (res.ok){
        await fonts.put(FONTS_CSS, res.clone());
        const css = await res.text();
        const files = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]);
        await Promise.all(files.map(u => fetch(u).then(r => r.ok && fonts.put(u, r)).catch(() => {})));
      }
    } catch (e) {}
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (!KNOWN.includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin && url.pathname.includes('/tts_cache/')){
    event.respondWith(audio(req));
  } else if (url.origin === self.location.origin){
    event.respondWith(shellFirstNetwork(req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
  }
});

async function shellFirstNetwork(req){
  const cache = await caches.open(SHELL_CACHE);
  try {
    // no-cache: всегда сверяемся с сервером (если файл не менялся — короткий ответ 304).
    // Иначе HTTP-кэш сразу после выкладки может отдать смесь старых и новых модулей,
    // и приложение не запустится из-за несовпадения импортов.
    const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (res.ok && res.type === 'basic') cache.put(stripSearch(req), res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(stripSearch(req)) || (req.mode === 'navigate' && await cache.match('index.html'));
    return hit || new Response('Нет интернета', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
// ?v=… и прочие параметры не должны плодить копии в кэше
function stripSearch(req){ const u = new URL(req.url); u.search = ''; u.hash = ''; return u.href; }

async function staleWhileRevalidate(req, name){
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const refresh = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || refresh;
}

// Аудио запрашивается с заголовком Range, а Safari играет его из кэша только как 206.
// Поэтому кэшируем файл целиком, а нужный кусок отдаём сами.
async function audio(req){
  const cache = await caches.open(AUDIO_CACHE);
  const key = stripSearch(req);
  let full = await cache.match(key);
  if (!full){
    try {
      const res = await fetch(key);
      if (!res.ok) return res;
      await cache.put(key, res.clone());
      full = res;
    } catch (e) {
      return new Response('', { status: 504 });
    }
  }
  const range = req.headers.get('Range');
  if (!range) return full;
  const buf = await full.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  const start = m[1] ? +m[1] : 0;
  const end = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': full.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
