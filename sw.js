// English Quest — service worker: приложение работает без интернета.
//
// • Оболочка (HTML/CSS/JS/манифест озвучки) — «сначала сеть»: онлайн всегда свежая версия,
//   офлайн — последняя сохранённая. Поэтому после git push ничего не нужно «сбрасывать».
// • Озвучка (tts_cache/*.mp3) — «сначала кэш»: файл скачивается один раз при первом
//   прослушивании или кнопкой «Скачать всю озвучку» в панели для взрослых.
// • Шрифты Google — берём из кэша и тихо обновляем в фоне.
const SHELL_CACHE = 'eq-shell-v37';
const AUDIO_CACHE = 'eq-audio-v1';   // то же имя использует app.js для массовой загрузки
const KNOWN = [SHELL_CACHE, AUDIO_CACHE];   // старый кэш шрифтов Google (eq-fonts-v1) удаляется при обновлении

const SHELL = [
  './', 'index.html', 'how-to.html', 'privacy.html', 'teacher.html', 'admin/', 'admin/index.html', 'base.css', 'style.css', 'content.js', 'packs.js', 'translations.js',
  'js/activity.js', 'js/backup.js', 'js/checkpoint.js', 'js/eq.js', 'js/exercises.js', 'js/homework.js', 'js/hud.js', 'js/main.js', 'js/map.js', 'js/mistakes.js', 'js/offline.js', 'js/state.js', 'js/tts.js', 'js/tutor.js', 'js/ui.js', 'js/util.js', 'js/worksheet.js', 'js/lock.js', 'js/profiles.js', 'js/speech.js', 'js/howto.js', 'js/config.js', 'js/api.js', 'js/merge.js', 'js/cloud.js', 'js/stats.js', 'js/admin.js', 'js/admin-pdf.js', 'js/dictionary.js', 'js/dict-data.js', 'js/heroes.js', 'js/why.js', 'js/quests.js', 'js/achievements.js', 'js/revenge.js', 'js/mines.js', 'js/nav.js', 'js/path.js', 'js/scene.js', 'js/clinic.js', 'js/gapmap.js', 'js/aipack.js', 'js/parcels.js', 'js/placement.js', 'js/family.js', 'js/qr.js', 'js/team.js',
  'tts_manifest.json', 'tts_voices.json', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  // шрифты — на своём сервере (assets/fonts/fonts.css), без обращений к Google
  'assets/fonts/fonts.css', 'assets/fonts/baloo-2-latin-ext.woff2', 'assets/fonts/baloo-2-latin.woff2', 'assets/fonts/nunito-cyrillic-ext.woff2', 'assets/fonts/nunito-cyrillic.woff2', 'assets/fonts/nunito-latin-ext.woff2', 'assets/fonts/nunito-latin.woff2', 'assets/fonts/press-start-2p-cyrillic-ext.woff2', 'assets/fonts/press-start-2p-cyrillic.woff2', 'assets/fonts/press-start-2p-latin-ext.woff2', 'assets/fonts/press-start-2p-latin.woff2',
  // рисунки героев: полный рост и 4 эмоции (см. CHARACTERS в content.js)
  // рисунки мест Шахт (видны и под туманом)
  'assets/locations/mines-1-adit.svg', 'assets/locations/mines-2-crystals.svg', 'assets/locations/mines-3-lake.svg',
  ...['harlow', 'luna', 'max', 'owl', 'robo'].flatMap(h => ['', '-happy', '-thinking', '-hint', '-praise'].map(m => `assets/heroes/${h}${m}.svg`)),
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL);
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
  // API сервера учителя (тот же адрес, что у сайта: /api/…) — мимо кэша и без перезапроса: иначе теряется
  // заголовок входа X-EQ-Token (вход «слетал» сразу после ввода), а ответы с данными учеников попадали бы в кэш
  if (url.origin === self.location.origin && /^\/api(\/|$)/.test(url.pathname)) return;

  if (url.origin === self.location.origin && url.pathname.includes('/tts_cache/')){
    event.respondWith(audio(req));
  } else if (url.origin === self.location.origin && req.mode === 'navigate'){
    event.respondWith(navigate(req, url));
  } else if (url.origin === self.location.origin){
    event.respondWith(shellFirstNetwork(req));
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
    const hit = await cache.match(stripSearch(req));
    return hit || new Response('Нет интернета', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
// Переход на страницу: сам запрос браузера (перенаправления он проходит сам — например, /admin → /admin/).
// Без сети — страница из кэша; главная приложения подставляется только для его собственных адресов,
// кабинет учителя (/admin/) и API ею не подменяются.
async function navigate(req, url){
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok && res.type === 'basic' && !res.redirected) cache.put(stripSearch(req), res.clone());
    return res;
  } catch (e) {
    const own = !/\/(admin|api)(\/|$)/.test(url.pathname);
    const hit = await cache.match(stripSearch(req)) || (own && await cache.match('index.html'));
    return hit || new Response('Нет интернета', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
// ?v=… и прочие параметры не должны плодить копии в кэше
function stripSearch(req){ const u = new URL(req.url); u.search = ''; u.hash = ''; return u.href; }

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
