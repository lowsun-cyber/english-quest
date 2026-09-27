#!/usr/bin/env node
// Подключает реплики героев, озвученные вручную (AI Studio, Perplexity и т.п.).
//
//   node tools/import-voices.mjs ~/Downloads/harlow
//
// В папке — файлы с номером фразы в начале имени: 01.wav, 02.mp3, 31 луна.m4a …
// Номера — как в `node tools/gen-voices.mjs --list` (1–30 — Dr. Harlow, 31–38 — остальные герои).
// Подходят wav, mp3, m4a, aiff. Файлы сжимаются в AAC и записываются в tts_cache/, словарь — в tts_voices.json.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
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

const files = readdirSync(dir).filter(f => /^\d+/.test(f) && /\.(wav|mp3|m4a|aiff?|aac)$/i.test(f));
let ok = 0;
for (const f of files){
  const n = parseInt(f, 10);
  const text = lines[n - 1];
  if (!text){ console.log(`✗ ${f}: реплики №${n} нет (всего ${lines.length})`); continue; }
  const out = createHash('sha1').update(`${items[n - 1].speaker}|import|${text}`).digest('hex') + '.m4a';
  try {
    execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', join(dir, f), join(ROOT, 'tts_cache', out)]);
    manifest[text] = out;
    ok++;
    console.log(`✓ ${String(n).padStart(2)}  [${items[n - 1].speaker}] ${text.slice(0, 60)}`);
  } catch (e) { console.log(`✗ ${f}: не удалось конвертировать (${e.message.split('\n')[0]})`); }
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
const missing = lines.map((t, i) => manifest[t] ? null : i + 1).filter(Boolean);
console.log(`\nПодключено: ${ok}. ${missing.length ? `Ещё без записи: ${missing.join(', ')}` : 'Озвучены все реплики ✓'}`);
