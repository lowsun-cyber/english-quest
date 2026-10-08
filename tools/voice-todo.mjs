#!/usr/bin/env node
// Задание на озвучку вручную (Perplexity, AI Studio и т.п.): всё, что ещё звучит голосом устройства.
//
//   node tools/voice-todo.mjs ~/Downloads/quest-voice
//
// В папке появятся ОЗВУЧКА.md (промпты и фразы пачками по 20) и batches.json (какие фразы в какой пачке).
// Каждую пачку озвучивают одной записью с паузами между фразами и сохраняют под именем пачки
// (en-01.mp3, ru-01.wav …) в ту же папку. Потом: node tools/import-voices.mjs ~/Downloads/quest-voice —
// запись режется по паузам, кусков должно быть столько же, сколько фраз в пачке.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const dir = resolve((process.argv[2] || join(process.env.HOME, 'Downloads', 'quest-voice')).replace(/^~/, process.env.HOME));
const BATCH = 20;

const sandbox = { window: {} };
vm.runInNewContext(readFileSync(join(ROOT, 'content.js'), 'utf8'), sandbox);
const items = sandbox.window.EQ.voiceLines();
const read = f => existsSync(join(ROOT, f)) ? JSON.parse(readFileSync(join(ROOT, f), 'utf8')) : {};
const voices = read('tts_voices.json'), lessonAudio = read('tts_manifest.json');
// озвучено: запись героя или (для слов и фраз уроков) старая английская запись
const recorded = x => !!voices[x.text] || (x.lang === 'en' && !!(lessonAudio[x.text] || lessonAudio[x.text.replace(/(^|\s)I(?=[\s'’.,!?]|$)/g, '$1i')]));
const todo = items.filter(x => !recorded(x));
if (!todo.length){ console.log('Всё уже озвучено ✓'); process.exit(0); }

const PROMPTS = {
  en: `Озвучь по-английски список фраз для детей 7–10 лет.
Озвучка: Google Gemini TTS (gemini-2.5-pro-tts), голос Enceladus.
Манера: тёплый, добрый мужской голос (доктор Dr. Harlow), естественное английское произношение, чётко и не спеша.
Прочитай каждую фразу один раз, строго по порядку, и после каждой сделай паузу 2 секунды.
Ничего не добавляй от себя: без вступления, без номеров, без комментариев. Нужен один аудиофайл.`,
  ru: `Озвучь по-русски реплики доктора-оленя Dr. Harlow для детей 7–10 лет.
Озвучка: Google Gemini TTS (gemini-2.5-pro-tts), голос Enceladus.
Манера: тёплый, добрый и спокойный мужской голос доктора, говорит не спеша и чётко.
Прочитай каждую реплику один раз, строго по порядку, и после каждой сделай паузу 2 секунды.
Ничего не добавляй от себя: без вступления, без номеров, без комментариев. Нужен один аудиофайл.`,
};
const batches = {};
let md = `# Озвучка English Quest\n\nВсего фраз: ${todo.length}. Пачек: см. ниже.\n\n` +
  `Как сделать: для каждой пачки вставьте в Perplexity промпт и фразы пачки, скачайте аудио и сохраните\n` +
  `в эту папку под именем пачки (например, \`en-01.mp3\`). Потом скажите Claude — он подключит записи.\n` +
  `Если в записи окажется лишняя или пропущенная фраза, пачка не подключится — её можно переозвучить отдельно.\n`;
for (const lang of ['ru', 'en']){
  const list = todo.filter(x => (x.lang === 'ru' ? 'ru' : 'en') === lang);
  for (let i = 0; i < list.length; i += BATCH){
    const id = `${lang}-${String(i / BATCH + 1).padStart(2, '0')}`;
    const part = list.slice(i, i + BATCH);
    batches[id] = part.map(x => ({ text: x.text, speaker: x.speaker }));
    md += `\n## ${id} — ${part.length} ${lang === 'ru' ? 'реплик по-русски' : 'фраз по-английски'}\n\n` +
      '```\n' + PROMPTS[lang] + '\n\n' + part.map(x => x.text).join('\n') + '\n```\n';
  }
}
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'batches.json'), JSON.stringify(batches, null, 1) + '\n');
writeFileSync(join(dir, 'ОЗВУЧКА.md'), md);
console.log(`Фраз без записи: ${todo.length} (по-русски ${todo.filter(x => x.lang === 'ru').length}), пачек: ${Object.keys(batches).length}\nЗадание: ${join(dir, 'ОЗВУЧКА.md')}`);
