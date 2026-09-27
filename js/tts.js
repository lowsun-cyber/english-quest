// English Quest — Озвучка: английские MP3, русские записи Dr. Harlow, голос устройства.

// ---------- TTS ----------
// Живой голос Enceladus (Gemini 2.5 Pro TTS). Все фразы прегенерированы
// в build-time и лежат статикой в tts_cache/<sha1>.mp3.
// Клиент читает манифест { фраза -> ключ } и играет соответствующий MP3.
export const TTS_VOICE = 'enceladus';
export const TTS_CACHE_DIR = 'tts_cache/';
export let _ttsManifest = null;
export let _ttsManifestLoading = null;
// Фразы, записанные голосами героев: { фраза -> 'файл.m4a' } (tools/gen-voices.mjs, tools/import-voices.mjs):
// русские реплики Dr. Harlow и приветствия остальных героев. Запись героя важнее общего голоса.
let _voices = null;
export function loadVoiceManifest(){
  return _voices || (_voices = fetch('tts_voices.json').then(r => r.ok ? r.json() : {}).catch(() => ({})));
}
function playFile(file, onFail){
  const a = new Audio(TTS_CACHE_DIR + file);
  _currentAudio = a;
  a.play().catch(err => { if (!isInterrupted(a, err)) onFail(); });
}
export let _currentAudio = null;

export async function loadManifest(){
  if (_ttsManifest) return _ttsManifest;
  if (_ttsManifestLoading) return _ttsManifestLoading;
  _ttsManifestLoading = fetch('tts_manifest.json')
    .then(r => r.ok ? r.json() : {})
    .then(j => { _ttsManifest = j || {}; return _ttsManifest; })
    .catch(() => { _ttsManifest = {}; return _ttsManifest; });
  return _ttsManifestLoading;
}
loadManifest(); // прогреваем сразу

export function stopSpeech(){
  if (_currentAudio){
    try { _currentAudio.pause(); _currentAudio.currentTime = 0; } catch(e){}
    _currentAudio = null;
  }
  try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch(e){}
}

// Возвращает URL к статическому MP3 по фразе или null, если нет в манифесте.
export function ttsFileUrl(text){
  if (!_ttsManifest) return null;
  const key = _ttsManifest[text];
  return key ? (TTS_CACHE_DIR + key + '.mp3') : null;
}

// Кэш выбранного мужского голоса (только для fallback на speechSynthesis при оффлайне)
export const _voiceCache = { en: null, ru: null };

export function pickMaleVoice(lang){
  const key = lang.slice(0,2).toLowerCase();
  if (_voiceCache[key]) return _voiceCache[key];
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null;
  const langMatches = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(key));
  if (!langMatches.length) return null;

  // Явно мужские имена/маркеры
  const maleRe = /\b(male|david|daniel|alex|fred|george|mark|tom|thomas|ryan|guy|matt|matthew|james|john|paul|peter|michael|arthur|oliver|liam|ethan|aaron|brian|kevin|justin|reed|rishi|arnaud|maged|yuri|pavel|dmitry|sergey|maxim|nikolay|nikolai|artemiy)\b/i;
  // Явно женские — исключаем
  const femaleRe = /\b(female|samantha|karen|victoria|allison|susan|zira|hazel|serena|kate|moira|tessa|fiona|veena|milena|katya|elena|irina|maria|anna|olga|milena)\b/i;

  // Приоритет: явно male > не-female с natural/enhanced/premium > google en > первый доступный
  const scored = langMatches.map(v => {
    const n = (v.name || '') + ' ' + (v.voiceURI || '');
    let s = 0;
    if (maleRe.test(n)) s += 100;
    if (femaleRe.test(n)) s -= 100;
    if (/natural|neural|enhanced|premium|online|wavenet|studio/i.test(n)) s += 20;
    if (/google/i.test(n)) s += 10;
    if (/microsoft/i.test(n)) s += 8;
    if (/^en-us|^en_us/i.test(v.lang)) s += 5;
    return { v, s };
  }).sort((a,b) => b.s - a.s);

  _voiceCache[key] = scored[0]?.v || langMatches[0] || null;
  return _voiceCache[key];
}

// Нормализация текста перед подачей в TTS.
// Причина: некоторые голоса (особенно Windows/системные) читают одиночную заглавную I
// как букву алфавита. Приводим одиночные I к нижнему регистру — на произношении
// местоимения это не сказывается, а буквенный «capital I» устраняется.
export function normalizeForSpeech(text){
  let t = String(text);
  // Убираем скобочные комментарии (обычно русский пояснитель): "How ___ sugar? (нельзя посчитать)" → "How ___ sugar?"
  t = t.replace(/\s*\([^)]*\)/g, '');
  // Схлопываем пробелы
  t = t.replace(/\s+/g, ' ').trim();
  // Одиночная I как отдельное слово → i
  t = t.replace(/(^|[\s(\-"'“‘])I(?=[\s.,!?;:)\-"'”’]|$)/g, '$1i');
  // I'm / I've / I'll / I'd → i'm ...
  t = t.replace(/(^|[\s(\-"'“‘])I(?=['’](m|ve|ll|d|re))/g, '$1i');
  return t;
}

// Chrome-баг: без периодического resume() длинные утерансы обрываются через ~15с.
export let _resumeTimer = null;
export function _keepAlive(){
  if (_resumeTimer) return;
  _resumeTimer = setInterval(() => {
    try {
      if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending){
        clearInterval(_resumeTimer); _resumeTimer = null;
        return;
      }
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    } catch(e){}
  }, 5000);
}

export function speak(text, opts={}){
  const raw = String(text).trim();
  if (!raw) return;
  stopSpeech();

  // 'en-US', 'en_GB' и т.п. → 'en', иначе такие вызовы никогда не доходили до MP3
  const lang = opts.lang
    ? (opts.lang.toLowerCase().startsWith('en') ? 'en' : opts.lang)
    : (looksEnglish(raw) ? 'en' : 'ru');
  const clean = lang === 'en' ? normalizeForSpeech(raw) : raw;

  // Русский: запись героя, если есть; иначе — голос устройства.
  if (lang !== 'en'){
    loadVoiceManifest().then(v => v[raw] ? playFile(v[raw], () => speakFallback(clean, lang)) : speakFallback(clean, lang));
    return;
  }

  Promise.all([loadManifest(), loadVoiceManifest()]).then(([, voices]) => {
    // английская фраза, записанная голосом конкретного героя (например, «I am Nurse Luna…»)
    if (voices[raw]) return playFile(voices[raw], () => speakFallback(clean, lang));
    // Пробуем найти MP3 сразу по исходной фразе; иначе — по нормализованной;
    // иначе — фолбэк на браузерный голос.
    const url = ttsFileUrl(raw) || ttsFileUrl(clean);
    if (!url){
      console.warn('[TTS] no cached MP3 for:', raw.slice(0,60));
      speakFallback(clean, lang);
      return;
    }
    const a = new Audio(url);
    a.playbackRate = 1.0;
    a.volume = 1.0;
    _currentAudio = a;
    a.play().catch(err => {
      if (isInterrupted(a, err)) return;
      console.warn('[TTS] play failed, fallback:', err);
      speakFallback(clean, lang);
    });
  });
}

// Фразу прервала следующая (stopSpeech → pause) — это не сбой, голос устройства не нужен.
export function isInterrupted(audio, err){ return audio !== _currentAudio || (err && err.name === 'AbortError'); }

// Фолбэк на браузерный speechSynthesis — если бэкенд недоступен.
export function speakFallback(text, lang){
  if (!('speechSynthesis' in window)) return;
  try { window.speechSynthesis.cancel(); } catch(e){}
  const ttsLang = lang.startsWith('en') ? 'en-US' : 'ru-RU';
  const voice = pickMaleVoice(ttsLang);
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  const runFrom = (idx) => {
    if (idx >= sentences.length) return;
    const u = new SpeechSynthesisUtterance(sentences[idx]);
    u.rate = 0.9; u.pitch = 0.95; u.lang = ttsLang;
    if (voice) u.voice = voice;
    u.onend = () => setTimeout(() => runFrom(idx + 1), 650);
    window.speechSynthesis.speak(u);
    _keepAlive();
  };
  runFrom(0);
}

export function looksEnglish(text){
  return /[a-zA-Z]/.test(text) && !/[а-яА-Я]/.test(text);
}
// прогреваем voices и сбрасываем кэш при их подгрузке
if ('speechSynthesis' in window){
  window.speechSynthesis.onvoiceschanged = () => {
    _voiceCache.en = null; _voiceCache.ru = null;
    window.speechSynthesis.getVoices();
  };
  window.speechSynthesis.getVoices();
}
