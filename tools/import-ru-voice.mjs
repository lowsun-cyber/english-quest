#!/usr/bin/env node
// Подключает русские реплики Dr. Harlow, озвученные вручную (AI Studio, Perplexity и т.п.).
//
//   node tools/import-ru-voice.mjs ~/Downloads/harlow
//
// В папке — файлы с номером реплики в начале имени: 01.wav, 02.mp3, 07 урок.m4a …
// Номера — как в `node tools/gen-ru-voice.mjs --list`. Подходят wav, mp3, m4a, aiff.
// Файлы сжимаются в AAC и записываются в tts_cache/, словарь — в tts_manifest_ru.json.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const dir = process.argv[2] && resolve(process.argv[2].replace(/^~/, process.env.HOME));
if (!dir || !existsSync(dir)){ console.error('Укажите папку с файлами: node tools/import-ru-voice.mjs <папка>'); process.exit(1); }

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(ROOT, 'content.js'), 'utf8'), sandbox);
const lines = sandbox.window.EQ.harlowRussianLines();
const MANIFEST = join(ROOT, 'tts_manifest_ru.json');
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};

const files = readdirSync(dir).filter(f => /^\d+/.test(f) && /\.(wav|mp3|m4a|aiff?|aac)$/i.test(f));
let ok = 0;
for (const f of files){
  const n = parseInt(f, 10);
  const text = lines[n - 1];
  if (!text){ console.log(`✗ ${f}: реплики №${n} нет (всего ${lines.length})`); continue; }
  const out = createHash('sha1').update(`ru|import|${text}`).digest('hex') + '.m4a';
  try {
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', join(dir, f), join(ROOT, 'tts_cache', out)]);
    manifest[text] = out;
    ok++;
    console.log(`✓ ${String(n).padStart(2)}  ${text.slice(0, 60)}`);
  } catch (e) { console.log(`✗ ${f}: не удалось конвертировать (${e.message.split('\n')[0]})`); }
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
const missing = lines.map((t, i) => manifest[t] ? null : i + 1).filter(Boolean);
console.log(`\nПодключено: ${ok}. ${missing.length ? `Ещё без записи: ${missing.join(', ')}` : 'Озвучены все реплики ✓'}`);
