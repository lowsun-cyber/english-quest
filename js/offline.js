// English Quest — Работа без интернета: service worker, скачивание озвучки, установка.
import { TTS_CACHE_DIR, loadManifest, loadRuManifest } from './tts.js';
import { toast } from './ui.js';

// ---------- БЕЗ ИНТЕРНЕТА (PWA) ----------
// sw.js хранит приложение на устройстве. Озвучка кэшируется при первом прослушивании;
// кнопка в панели для взрослых скачивает её всю сразу (в тот же кэш, что использует sw.js).
export const AUDIO_CACHE = 'eq-audio-v1';
export const canOffline = 'serviceWorker' in navigator && 'caches' in window && location.protocol !== 'file:';
if (canOffline){
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
window.addEventListener('offline', () => toast('📴 Нет интернета — играем офлайн'));
window.addEventListener('online', () => toast('📶 Интернет снова есть'));

export let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; toast('📲 English Quest установлен'); });
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function audioFiles(){
  const m = await loadManifest();
  const ru = await loadRuManifest();
  return [
    ...new Set(Object.values(m).map(k => k + '.mp3')),
    ...new Set(Object.values(ru)),
  ].map(f => new URL(TTS_CACHE_DIR + f, location.href).href);
}
export async function audioCachedCount(){
  if (!canOffline) return { have: 0, total: 0 };
  const files = await audioFiles();
  const cache = await caches.open(AUDIO_CACHE);
  const keys = new Set((await cache.keys()).map(r => r.url));
  return { have: files.filter(f => keys.has(f)).length, total: files.length };
}
export let audioDownloading = false;
export async function downloadAllAudio(onProgress){
  if (audioDownloading) return;
  audioDownloading = true;
  try {
    const cache = await caches.open(AUDIO_CACHE);
    const have = new Set((await cache.keys()).map(r => r.url));
    const todo = (await audioFiles()).filter(f => !have.has(f));
    let done = 0, failed = 0;
    const total = todo.length;
    // по 6 файлов параллельно — быстро и без перегрузки слабого Wi-Fi
    const worker = async () => {
      while (todo.length){
        const url = todo.shift();
        try { const r = await fetch(url, { cache: 'no-store' }); if (r.ok) await cache.put(url, r); else failed++; }
        catch (e) { failed++; }
        onProgress(++done, total);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return { failed };
  } finally { audioDownloading = false; }
}

export function offlineSectionHtml(){
  if (!canOffline) return `<p class="t-muted">Работа без интернета включается, когда приложение открыто с сайта, а не как файл.</p>`;
  const install = isStandalone() ? '<p class="t-muted">✓ Приложение установлено на этом устройстве.</p>'
    : installPrompt ? '<button class="btn secondary" id="t-install">📲 Установить на устройство</button>'
    : isIOS() ? '<p class="t-muted">📲 Чтобы установить на iPhone/iPad: в Safari нажмите «Поделиться» → «На экран «Домой»».</p>'
    : '<p class="t-muted">📲 Установить можно из меню браузера: «Установить приложение» или «Добавить на главный экран».</p>';
  return `
    <p class="t-muted">Уроки, прогресс и задания работают без интернета. Озвучка слов сохраняется при первом прослушивании — или скачайте её всю заранее (около 45 МБ, лучше по Wi-Fi). Упражнение «Говори» без интернета может не распознавать речь.</p>
    <div class="t-offline">
      <div class="t-audio-stat" id="t-audio-stat">Проверяю, сколько озвучки уже сохранено…</div>
      <div class="review-progress" id="t-audio-bar" hidden><span></span></div>
      <div class="controls">
        <button class="btn" id="t-audio-dl" disabled>⬇️ Скачать всю озвучку</button>
        ${install.startsWith('<button') ? install : ''}
      </div>
      ${install.startsWith('<button') ? '' : install}
    </div>`;
}
export async function wireOfflineSection(){
  if (!canOffline) return;
  const stat = document.getElementById('t-audio-stat');
  const btn = document.getElementById('t-audio-dl');
  const bar = document.getElementById('t-audio-bar');
  const show = ({ have, total }) => {
    if (!stat.isConnected) return;
    stat.innerHTML = have >= total
      ? `✓ Вся озвучка сохранена: <b>${total}</b> файлов — слова звучат без интернета.`
      : `Озвучка на устройстве: <b>${have}</b> из ${total} файлов.`;
    btn.disabled = have >= total || audioDownloading;
    btn.hidden = have >= total;
  };
  show(await audioCachedCount());
  btn.onclick = async () => {
    if (!navigator.onLine){ toast('Нужен интернет, чтобы скачать озвучку'); return; }
    btn.disabled = true;
    bar.hidden = false;
    const res = await downloadAllAudio((done, total) => {
      if (!bar.isConnected) return;
      bar.firstElementChild.style.width = Math.round(done * 100 / total) + '%';
      stat.textContent = `Скачиваю озвучку: ${done} из ${total}…`;
    });
    if (bar.isConnected) bar.hidden = true;
    show(await audioCachedCount());
    toast(res && res.failed ? `Не скачалось файлов: ${res.failed} — попробуйте ещё раз` : '✓ Озвучка сохранена для офлайна');
  };
  const ins = document.getElementById('t-install');
  if (ins) ins.onclick = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    ins.remove();
  };
}
