#!/usr/bin/env node
// Подключает озвучку, сделанную вручную (AI Studio, Perplexity и т.п.).
//
//   node tools/import-voices.mjs ~/Downloads/quest-voice
//
// Подходят два вида файлов (wav, mp3, m4a, aiff); всё сжимается в AAC, записывается в tts_cache/,
// словарь «фраза → файл» — в tts_voices.json.
// • Пачки из `node tools/voice-todo.mjs`: en-01.mp3, ru-01.wav … — одна запись на пачку, фразы через паузы.
//   Запись режется по тишине; кусков должно быть ровно столько, сколько фраз в пачке (batches.json),
//   иначе пачка пропускается — её лучше переозвучить.
// • Отдельные файлы с номером фразы в начале имени: 01.wav, 02.mp3, 31 луна.m4a … Номера — как в
//   `node tools/gen-voices.mjs --list` (1–30 — Dr. Harlow, 31–38 — остальные герои, 39–64 — буквы, дальше слова и фразы уроков).
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const dir = process.argv[2] && resolve(process.argv[2].replace(/^~/, process.env.HOME));
if (!dir || !existsSync(dir)){ console.error('Укажите папку с файлами: node tools/import-voices.mjs <папка>'); process.exit(1); }

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(ROOT, 'content.js'), 'utf8'), sandbox);
const items = sandbox.window.EQ.voiceLines();
const lines = items.map(x => x.text);
const MANIFEST = join(ROOT, 'tts_voices.json');
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};

const AUDIO = /\.(wav|mp3|m4a|aiff?|aac)$/i;
const toM4a = (src, text, speaker) => {
  const out = createHash('sha1').update(`${speaker}|import|${text}`).digest('hex') + '.m4a';
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', src, join(ROOT, 'tts_cache', out)]);
  manifest[text] = out;
};
let ok = 0;

// ---------- пачки: одна запись — несколько фраз через паузы ----------
const batchesFile = join(dir, 'batches.json');
const batches = existsSync(batchesFile) ? JSON.parse(readFileSync(batchesFile, 'utf8')) : {};
const tmp = mkdtempSync(join(tmpdir(), 'eq-import-'));
const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
// корреляция Пирсона: насколько длина звука следует за длиной текста
function corr(a, b){
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  const num = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0);
  const den = Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0));
  return den ? num / den : 0;
}
// куски речи между паузами: [[начало, конец], …] в секундах
function speechParts(wav, noise, minPause){
  // отчёт silencedetect ffmpeg пишет в stderr
  const log = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', wav, '-af', `silencedetect=noise=${noise}dB:d=${minPause}`, '-f', 'null', '-'], { encoding: 'utf8' }).stderr || '';
  const dur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' }));
  const sil = [];
  const re = /silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g;
  let m; while ((m = re.exec(log))) sil.push([+m[1], +m[2]]);
  const parts = []; let t = 0;
  for (const [a, b] of sil){ if (a - t > 0.25) parts.push([t, a]); t = b; }
  if (dur - t > 0.25) parts.push([t, dur]);
  return parts;
}
// имя пачки — в начале имени файла: «en-01.mp3», «dict-03.mp3» и «en-01 — 5 фраз.mp3» подходят все
const batchId = f => /^((?:en|ru|dict|text)-\d+)/i.exec(f)?.[1].toLowerCase();
for (const f of readdirSync(dir).filter(f => AUDIO.test(f) && batches[batchId(f)])){
  const id = batchId(f), list = batches[id];
  // уже подключённую пачку не перекодируем заново (иначе файлы меняются без нужды); --force — подключить снова
  if (!process.argv.includes('--force') && list.every(x => manifest[x.text] && existsSync(join(ROOT, 'tts_cache', manifest[x.text])))){ console.log(`· ${f}: уже подключена`); continue; }
  const wav = join(tmp, id + '.wav');
  ffmpeg(['-i', join(dir, f), '-ac', '1', '-ar', '24000', wav]);
  // подбираем порог тишины и длину паузы, пока кусков не станет столько, сколько фраз
  let parts = null, tried = [];
  // в рассказах внутри бывают паузы между предложениями — для них сначала пробуем только длинные паузы
  const pauses = id.startsWith('text-') ? [1.6, 1.3, 2.0, 1.0] : [0.8, 0.6, 1.0, 0.5, 1.3, 0.4, 1.6];
  for (const minPause of pauses) for (const noise of [-35, -30, -40, -45]){
    if (parts) break;
    const p = speechParts(wav, noise, minPause);
    tried.push(p.length);
    if (p.length === list.length) parts = p;
  }
  if (!parts){ console.log(`✗ ${f}: фраз в пачке ${list.length}, а в записи нашлось ${[...new Set(tried)].sort((a, b) => a - b).join(' / ')} — пачка пропущена, лучше переозвучить`); continue; }
  // кусков столько же, но не съехали ли они на одну фразу? Длина куска должна расти вместе с длиной фразы:
  // без сдвига совпадение должно быть лучше, чем со сдвигом на одну фразу в любую сторону
  if (list.length >= 8){
    const chars = list.map(x => x.text.replace(/[^\p{L}]/gu, '').length), secs = parts.map(([a, b]) => b - a);
    const r0 = corr(chars, secs), r1 = corr(chars.slice(1), secs.slice(0, -1)), r2 = corr(chars.slice(0, -1), secs.slice(1));
    if (!(r0 > Math.max(r1, r2))){ console.log(`✗ ${f}: куски, похоже, съехали на одну фразу (совпадение ${r0.toFixed(2)}, со сдвигом ${Math.max(r1, r2).toFixed(2)}) — пачка пропущена, лучше переозвучить`); continue; }
  }
  parts.forEach(([a, b], i) => {
    const seg = join(tmp, `${id}-${i}.wav`);
    ffmpeg(['-i', wav, '-ss', String(Math.max(0, a - 0.08)), '-to', String(b + 0.12), seg]);
    toM4a(seg, list[i].text, list[i].speaker);
    ok++;
  });
  console.log(`✓ ${f}: ${list.length} фраз`);
}
rmSync(tmp, { recursive: true, force: true });

// ---------- отдельные файлы с номером фразы ----------
const files = readdirSync(dir).filter(f => /^\d+/.test(f) && AUDIO.test(f));
for (const f of files){
  const n = parseInt(f, 10);
  const text = lines[n - 1];
  if (!text){ console.log(`✗ ${f}: реплики №${n} нет (всего ${lines.length})`); continue; }
  try {
    toM4a(join(dir, f), text, items[n - 1].speaker);
    ok++;
    console.log(`✓ ${String(n).padStart(2)}  [${items[n - 1].speaker}] ${text.slice(0, 60)}`);
  } catch (e) { console.log(`✗ ${f}: не удалось конвертировать (${e.message.split('\n')[0]})`); }
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
// без записи: нет ни голоса героя, ни (для английских слов и фраз) старой записи из tts_manifest.json
const lessonAudio = existsSync(join(ROOT, 'tts_manifest.json')) ? JSON.parse(readFileSync(join(ROOT, 'tts_manifest.json'), 'utf8')) : {};
const missing = items.filter(x => !manifest[x.text] && !(x.lang === 'en' && (lessonAudio[x.text] || lessonAudio[x.text.replace(/(^|\s)I(?=[\s'’.,!?]|$)/g, '$1i')])));
console.log(`\nПодключено: ${ok}. ${missing.length ? `Ещё без записи: ${missing.length} (node tools/voice-todo.mjs — новое задание)` : 'Озвучено всё ✓'}`);
