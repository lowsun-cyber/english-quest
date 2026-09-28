#!/usr/bin/env node
// Озвучивает реплики героев через Gemini TTS: русские реплики Dr. Harlow (его голос Enceladus —
// тот же, что у английской озвучки) и приветствия остальных героев, у каждого свой голос.
//
//   GEMINI_API_KEY=… node tools/gen-voices.mjs            — озвучить фразы, которых ещё нет
//   GEMINI_API_KEY=… node tools/gen-voices.mjs --force    — перезаписать все
//   node tools/gen-voices.mjs --list                       — показать список с номерами
//
// Фразы берутся из content.js (voiceLines), файлы — tts_cache/<sha1>.m4a, словарь «фраза → файл» —
// tts_voices.json. Уже записанные фразы (в том числе импортированные) пропускаются,
// удалённые из контента — убираются из словаря. Нужен macOS (afconvert для сжатия в AAC).
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-pro-preview-tts'; // та же линейка, что у английской озвучки
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
const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(ROOT, 'content.js'), 'utf8'), sandbox);
const items = sandbox.window.EQ.voiceLines();
const lines = items.map(x => x.text);
const FORCE = process.argv.includes('--force');

if (process.argv.includes('--list')){
  items.forEach((x, i) => console.log(`${String(i + 1).padStart(3)}. [${x.speaker}, ${x.kind || x.lang}] ${x.text}`));
  process.exit(0);
}
const KEY = process.env.GEMINI_API_KEY;
if (!KEY){
  console.error('Нужен ключ: GEMINI_API_KEY=… node tools/gen-voices.mjs  (ключ — в Google AI Studio → Get API key)');
  process.exit(1);
}

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
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
};
async function synth(text, speaker, kind){
  const voice = VOICES[speaker].voice, style = KIND_STYLE[kind] || VOICES[speaker].style;
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
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.error?.message || JSON.stringify(body).slice(0, 300)}`);
  const b64 = findAudio(body);
  if (!b64) throw new Error('в ответе нет аудио: ' + JSON.stringify(body).slice(0, 300));
  return toWav(Buffer.from(b64, 'base64'));
}

let made = 0, kept = 0, failed = 0;
for (const [i, { text, speaker, kind }] of items.entries()){
  const file = fileFor(text, speaker);
  const out = join(ROOT, 'tts_cache', file);
  if (!FORCE && manifest[text] && existsSync(join(ROOT, 'tts_cache', manifest[text]))){ kept++; continue; }
  process.stdout.write(`${i + 1}/${lines.length} ${text.slice(0, 60)}… `);
  try {
    const wav = join(tmp, 'line.wav');
    writeFileSync(wav, await synth(text, speaker, kind));
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', wav, out]);
    const old = manifest[text];
    manifest[text] = file;
    if (old && old !== file && !Object.values(manifest).includes(old) && existsSync(join(ROOT, 'tts_cache', old))) unlinkSync(join(ROOT, 'tts_cache', old));
    made++;
    console.log('✓');
  } catch (e) {
    failed++;
    console.log('✗ ' + e.message);
  }
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n'); // сохраняем после каждой фразы
}

// реплики, которых больше нет в контенте
for (const text of Object.keys(manifest)) if (!lines.includes(text)){
  const f = manifest[text];
  delete manifest[text];
  if (!Object.values(manifest).includes(f) && existsSync(join(ROOT, 'tts_cache', f))) unlinkSync(join(ROOT, 'tts_cache', f));
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`\nГотово: озвучено ${made}, уже было ${kept}, ошибок ${failed}. Словарь: tts_voices.json`);
process.exit(failed ? 1 : 0);
