#!/usr/bin/env node
// Озвучивает реплики героев через Gemini TTS: русские реплики Dr. Harlow (его голос Enceladus —
// тот же, что у английской озвучки) и реплики остальных героев, у каждого свой голос.
//
//   GEMINI_API_KEY=… node tools/gen-voices.mjs            — озвучить фразы, которых ещё нет
//   GEMINI_API_KEY=… node tools/gen-voices.mjs --force    — перезаписать все
//   node tools/gen-voices.mjs --list                       — показать список с номерами
//   node tools/gen-voices.mjs --out ~/Downloads/quest-voice-gen — записать в отдельную папку, проект не трогать;
//       подключить потом: node tools/import-voices.mjs ~/Downloads/quest-voice-gen
//   пробный прогон: --only <герой> (harlow, luna, max, owl, robo), --kind <вид> (correct, grammar, location,
//       narrator, self-win…; «self» — все реплики героя игрока, «team» — командной игры), --limit N — записать не больше N новых фраз:
//       GEMINI_API_KEY=… node tools/gen-voices.mjs --out ~/Downloads/quest-voice-gen --only owl --kind grammar --limit 3
//   --wait — при лимите «в минуту» (бесплатный тариф) ждать и продолжать самому; суточный лимит — всё равно стоп
//   --prune — убрать из словаря записи фраз, которых больше нет в контенте (без флага записанное не трогается)
//
// Фразы берутся из content.js (voiceLines), файлы — tts_cache/<sha1>.m4a, словарь «ключ → файл» —
// tts_voices.json (ключ — фраза у Dr. Harlow, «герой|фраза» у остальных; см. voiceKey). Уже записанные фразы
// (в том числе импортированные) пропускаются и не перезаписываются. Модель для новых фраз — MODEL ниже,
// другую можно задать через GEMINI_TTS_MODEL. Лимит запросов Gemini исчерпан — записанное сохраняется,
// скрипт останавливается (код выхода 2); повторный запуск продолжит с того же места.
// Нужен macOS (afconvert для сжатия в AAC).
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { loadContent } from './packs.mjs';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
// новые фразы — gemini-3.8-flash-tts (решение владельца 12.10.2026); записанное раньше (2.5 Pro) не перезаписывается
const MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-tts';
// Голос и манера для каждого героя (названия голосов — из списка Gemini TTS)
const VOICES = {
  harlow: { voice: 'Enceladus', style: 'тёплый, добрый и спокойный голос доктора, который объясняет детям 7–10 лет; говорит не спеша и чётко' },
  luna:   { voice: 'Leda',      style: 'ласковая молодая медсестра-зайчиха, мягко и заботливо, с улыбкой' },
  max:    { voice: 'Puck',      style: 'бодрый весёлый шахтёр-мальчишка, энергично и с азартом' },
  owl:    { voice: 'Charon',    style: 'мудрый добрый профессор-сова, неторопливо, чуть торжественно' },
  robo:   { voice: 'Fenrir',    style: 'весёлый робот-диджей, ритмично и задорно, слегка «механически»' },
};
const MANIFEST = join(ROOT, 'tts_voices.json');

// content.js написан для браузера — выполняем его с «пустым» window
// контент и все пакеты локаций (packs/*.json): новые пакеты озвучиваются до подключения
const sandbox = { window: { EQ: loadContent({ packs: 'all' }) } };
const all = sandbox.window.EQ.voiceLines();
const keys = new Set(all.map(x => x.key));   // ключ записи: фраза (Dr. Harlow) или «герой|фраза»
const FORCE = process.argv.includes('--force'), PRUNE = process.argv.includes('--prune'), WAIT = process.argv.includes('--wait');
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? (process.argv[i + 1] || '') : null; };
// пробный прогон: только один герой, один вид реплик, не больше N новых фраз
const ONLY = arg('--only'), KIND = arg('--kind'), LIMIT = arg('--limit') == null ? Infinity : Number(arg('--limit'));
if (ONLY != null && !['harlow', 'luna', 'max', 'owl', 'robo'].includes(ONLY)){ console.error('--only: harlow, luna, max, owl или robo'); process.exit(1); }
if (KIND === ''){ console.error('--kind: вид реплики, например correct, grammar, location, narrator, self-win или self'); process.exit(1); }
if (!(LIMIT > 0)){ console.error('--limit: целое число больше нуля'); process.exit(1); }
// «self» — все реплики героя игрока, «team» — все реплики командной игры
const kindOk = x => KIND == null || x.kind === KIND || (['self', 'team'].includes(KIND) && x.kind?.startsWith(KIND + '-'));
const items = all.filter(x => (ONLY == null || x.speaker === ONLY) && kindOk(x));
if (!items.length){ console.error(`Нет фраз${ONLY ? ` героя ${ONLY}` : ''}${KIND ? ` вида ${KIND}` : ''}. Виды: ${[...new Set(all.map(x => x.kind || x.lang))].join(', ')}`); process.exit(1); }
const lines = items.map(x => x.text);
if (PRUNE && (ONLY != null || KIND != null)){ console.error('--prune — только при полном прогоне, без --only и --kind'); process.exit(1); }
// --out <папка>: файлы и их список (generated.json) — только туда; tts_cache/ и tts_voices.json не меняются
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? resolve((process.argv[outArg + 1] || '').replace(/^~/, process.env.HOME)) : null;
if (outArg > 0 && !process.argv[outArg + 1]){ console.error('Укажите папку: --out ~/Downloads/quest-voice-gen'); process.exit(1); }

if (process.argv.includes('--list')){
  // номер — по полному списку (как в import-voices), даже если выбран один герой или вид
  items.forEach(x => console.log(`${String(all.indexOf(x) + 1).padStart(3)}. [${x.speaker}, ${x.kind || x.lang}] ${x.text}`));
  process.exit(0);
}
const KEY = (process.env.GEMINI_API_KEY || '').trim();
if (!KEY){
  console.error('Нужен ключ: GEMINI_API_KEY=… node tools/gen-voices.mjs  (ключ — в Google AI Studio → Get API key)');
  process.exit(1);
}
// ключ Gemini — латинские буквы, цифры и знаки без пробелов (старые — AIza…, новые длиннее);
// «…» или кириллица — значит, вставили не ключ
if (!/^[\x21-\x7e]{20,}$/.test(KEY)){
  console.error('GEMINI_API_KEY не похож на ключ (нужны латинские буквы, цифры и знаки без пробелов). Скопируйте ключ из AI Studio заново.');
  process.exit(1);
}

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
// режим --out: что уже записано в папку — { ключ: { file, speaker, text, kind } }
const GEN = OUT && join(OUT, 'generated.json');
if (OUT) mkdirSync(OUT, { recursive: true });
const generated = GEN && existsSync(GEN) ? JSON.parse(readFileSync(GEN, 'utf8')) : {};
const fileFor = (text, speaker) => createHash('sha1').update(`${speaker}|${VOICES[speaker].voice}|${MODEL}|${text}`).digest('hex') + '.m4a';
const tmp = mkdtempSync(join(tmpdir(), 'eq-ru-'));

function findAudio(node){
  if (!node || typeof node !== 'object') return null;
  if (typeof node.data === 'string' && node.data.length > 1000) return node.data;
  for (const v of Object.values(node)){ const hit = findAudio(v); if (hit) return hit; }
  return null;
}
function toWav(buf){
  if (buf.subarray(0, 4).toString() === 'RIFF') return buf; // уже WAV
  const h = Buffer.alloc(44); // иначе это «сырой» PCM 24 кГц, 16 бит, моно
  h.write('RIFF', 0); h.writeUInt32LE(36 + buf.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(buf.length, 40);
  return Buffer.concat([h, buf]);
}

const KIND_STYLE = {
  letter: 'назови английскую букву — её название, как в английском алфавите; чётко, для ребёнка',
  word: 'чётко и не спеша произнеси одно английское слово для ребёнка 7–10 лет, с естественным английским произношением',
  lesson: 'чётко, не спеша и дружелюбно прочитай по-английски для ребёнка 7–10 лет, с естественным английским произношением',
};
// реплики героев: манера героя + подсказка, как читать
const KIND_HINT = {
  en: 'короткая фраза по-английски, с естественным английским произношением',
  grammar: 'объясняет правило: английские слова — с английским произношением, не спеша',
};
// английская озвучка уроков, записанная раньше (tts_manifest.json → tts_cache/*.mp3): такие фразы не перезаписываем
const LESSON_AUDIO = existsSync(join(ROOT, 'tts_manifest.json')) ? JSON.parse(readFileSync(join(ROOT, 'tts_manifest.json'), 'utf8')) : {};
const hasLessonAudio = text => !!(LESSON_AUDIO[text] || LESSON_AUDIO[text.replace(/(^|\s)I(?=[\s'’.,!?]|$)/g, '$1i')]);
// исчерпан лимит запросов (HTTP 429 / RESOURCE_EXHAUSTED): дальше пробовать бессмысленно — сохраняемся и выходим
// retry — через сколько секунд можно снова (из ответа Gemini), perMinute — лимит в минуту, а не в сутки
class LimitError extends Error {
  constructor(message, body){
    super(message);
    const hint = body?.error?.details?.find(d => d.retryDelay)?.retryDelay || /retry in ([\d.]+)\s*s/i.exec(message)?.[1];
    this.retry = hint ? Math.ceil(parseFloat(hint)) : null;
    this.perMinute = /per minute/i.test(message) || (this.retry != null && this.retry <= 120);
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Модели 2.5 (gemini-2.5-pro-preview-tts и т.п.) не принимают манеру отдельным полем — для них классический
// generateContent: манера словами перед текстом («…: <фраза>»), модель читает только фразу.
const LEGACY = /^gemini-2\.5-.*tts/.test(MODEL);
async function synthLegacy(text, voice, style){
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Прочитай вслух ровно одну фразу после двоеточия, ничего не добавляя. Манера: ${style}.\n\n${text}` }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429 || body.error?.status === 'RESOURCE_EXHAUSTED') throw new LimitError(body.error?.message || `HTTP ${res.status}`, body);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.error?.message || JSON.stringify(body).slice(0, 300)}`);
  const b64 = findAudio(body);
  if (!b64) throw new Error('в ответе нет аудио: ' + JSON.stringify(body).slice(0, 300));
  return toWav(Buffer.from(b64, 'base64'));
}
async function synth(text, speaker, kind){
  const voice = VOICES[speaker].voice, style = KIND_STYLE[kind] || [VOICES[speaker].style, KIND_HINT[kind]].filter(Boolean).join('; ');
  if (LEGACY) return synthLegacy(text, voice, style);
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
    body: JSON.stringify({
      model: MODEL,
      input: [{ type: 'user_input', content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style }] }] }],
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429 || body.error?.status === 'RESOURCE_EXHAUSTED') throw new LimitError(body.error?.message || `HTTP ${res.status}`, body);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.error?.message || JSON.stringify(body).slice(0, 300)}`);
  const b64 = findAudio(body);
  if (!b64) throw new Error('в ответе нет аудио: ' + JSON.stringify(body).slice(0, 300));
  return toWav(Buffer.from(b64, 'base64'));
}

let made = 0, kept = 0, failed = 0, limited = null;
for (const [i, { text, speaker, kind, key }] of items.entries()){
  if (made + failed >= LIMIT) break;
  const file = fileFor(text, speaker);
  const out = join(OUT || join(ROOT, 'tts_cache'), file);
  if (!FORCE && manifest[key] && existsSync(join(ROOT, 'tts_cache', manifest[key]))){ kept++; continue; }
  if (OUT && !FORCE && generated[key] && existsSync(join(OUT, generated[key].file))){ kept++; continue; }
  if (kind === 'lesson' && hasLessonAudio(text)){ kept++; continue; }
  process.stdout.write(`${i + 1}/${lines.length} ${text.slice(0, 60)}… `);
  try {
    const wav = join(tmp, 'line.wav');
    // --wait: минутный лимит (бесплатный тариф — несколько запросов в минуту) — ждём и пробуем ту же фразу снова
    let audio;
    for (;;){
      try { audio = await synth(text, speaker, kind); break; }
      catch (e){
        if (!(WAIT && e instanceof LimitError && e.perMinute)) throw e;
        const sec = Math.max(e.retry || 20, 5) + 2;
        process.stdout.write(`⏳ ${sec} с… `);
        await sleep(sec * 1000);
      }
    }
    writeFileSync(wav, audio);
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', wav, out]);
    made++;
    if (OUT){
      generated[key] = { file, speaker, text, kind };
      writeFileSync(GEN, JSON.stringify(generated, null, 2) + '\n');   // сохраняем после каждой фразы
      console.log('✓');
      continue;
    }
    const old = manifest[key];
    manifest[key] = file;
    if (old && old !== file && !Object.values(manifest).includes(old) && existsSync(join(ROOT, 'tts_cache', old))) unlinkSync(join(ROOT, 'tts_cache', old));
    console.log('✓');
  } catch (e) {
    if (e instanceof LimitError){ limited = e.message; console.log('✗ лимит'); break; }
    failed++;
    console.log('✗ ' + e.message);
  }
  if (!OUT) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n'); // сохраняем после каждой фразы
}
const left = items.length - made - kept - failed;   // ещё не записано (лимит, --limit)
const where = OUT ? `Файлы — в ${OUT}\nПодключить: node tools/import-voices.mjs ${OUT}` : 'Словарь: tts_voices.json';
if (!OUT) writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
if (limited){
  console.log(`\nЛимит запросов Gemini исчерпан — остановились. Записанное сохранено: озвучено ${made}, уже было ${kept}, осталось ${left}.\n` +
    `Ответ Gemini: ${limited}\nЗапустите ту же команду позже (обычно лимит сбрасывается через минуту или в начале суток) — готовое пропустится.\n` +
    `${WAIT ? '' : 'Если лимит «в минуту» — добавьте --wait: скрипт сам будет ждать и продолжать.\n'}${where}`);
  process.exit(2);
}
if (OUT || !PRUNE){
  console.log(`\nГотово: озвучено ${made}, уже было ${kept}, ошибок ${failed}${left ? `, осталось ${left} (--limit)` : ''}. ${where}`);
  process.exit(failed ? 1 : 0);
}

// --prune: реплики, которых больше нет в контенте (слова словаря — не трогаем: их озвучивают отдельно, см. voice-todo.mjs)
const { DICT } = await import(join(ROOT, 'js/dict-data.js'));
const dictWords = new Set(DICT.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split('|')[0].trim()));
for (const key of Object.keys(manifest)) if (!keys.has(key) && !dictWords.has(key)){
  const f = manifest[key];
  delete manifest[key];
  if (!Object.values(manifest).includes(f) && existsSync(join(ROOT, 'tts_cache', f))) unlinkSync(join(ROOT, 'tts_cache', f));
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nГотово: озвучено ${made}, уже было ${kept}, ошибок ${failed}. Словарь: tts_voices.json`);
process.exit(failed ? 1 : 0);
