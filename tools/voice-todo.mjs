#!/usr/bin/env node
// Задание на озвучку вручную (Perplexity, AI Studio и т.п.): всё, что ещё звучит голосом устройства.
//
//   node tools/voice-todo.mjs ~/Downloads/quest-voice [--also <другой tts_voices.json>]
//
// В папке появятся ОЗВУЧКА.md (промпты и фразы пачками по 20) и batches.json (какие фразы в какой пачке).
// Каждую пачку озвучивают одной записью с паузами между фразами и сохраняют под именем пачки
// (en-01.mp3, ru-01.wav …) в ту же папку. Потом: node tools/import-voices.mjs ~/Downloads/quest-voice —
// запись режется по паузам, кусков должно быть столько же, сколько фраз в пачке.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { loadContent } from './packs.mjs';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const dir = resolve((process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : join(process.env.HOME, 'Downloads', 'quest-voice')).replace(/^~/, process.env.HOME));
const BATCH = 20, WORD_BATCH = 40, TEXT_BATCH = 5, HERO_BATCH = 10;   // слова режутся по паузам надёжнее всего, длинные тексты — хуже

// контент и все пакеты локаций (packs/*.json): новые пакеты озвучиваются до подключения
const EQ = loadContent({ packs: 'all' });
const items = EQ.voiceLines();
// слова словаря (js/dict-data.js): тот же голос, звучат по кнопке 🔊 в словаре
const { DICT } = await import(join(ROOT, 'js/dict-data.js'));
const known = new Set(items.map(x => x.text));
for (const line of DICT.split('\n')){
  const en = line.startsWith('#') ? '' : line.split('|')[0].trim();
  if (en && !known.has(en)){ known.add(en); items.push({ speaker: 'harlow', lang: 'en', kind: 'dict', text: en, key: en }); }
}
const read = f => existsSync(join(ROOT, f)) ? JSON.parse(readFileSync(join(ROOT, f), 'utf8')) : {};
const voices = read('tts_voices.json'), lessonAudio = read('tts_manifest.json');
// --also <tts_voices.json> — учесть и записи из другой копии (например, рабочей копии hero-voices с ежедневной озвучкой)
const alsoArg = process.argv.indexOf('--also');
if (alsoArg > 0) Object.assign(voices, JSON.parse(readFileSync(resolve(process.argv[alsoArg + 1].replace(/^~/, process.env.HOME)), 'utf8')));
// озвучено: запись героя или (для слов и фраз уроков) старая английская запись
const recorded = x => !!voices[x.key] || (x.lang === 'en' && !!(lessonAudio[x.text] || lessonAudio[x.text.replace(/(^|\s)I(?=[\s'’.,!?]|$)/g, '$1i')]));
const todo = items.filter(x => !recorded(x));
if (!todo.length){ console.log('Всё уже озвучено ✓'); process.exit(0); }

const PROMPTS = {
  en: `Озвучь по-английски список фраз для детей 7–10 лет.
Голос: Enceladus. Модель: Gemini Pro TTS (Google AI Studio → Generate speech).
Манера: тёплый, добрый мужской голос (доктор Dr. Harlow), естественное английское произношение, чётко и не спеша.
Прочитай каждую фразу один раз, строго по порядку, и после каждой сделай паузу 2 секунды.
Ничего не добавляй от себя: без вступления, без номеров, без комментариев. Нужен один аудиофайл.`,
  dict: `Озвучь по-английски список отдельных английских слов и выражений для детей 7–10 лет.
Голос: Enceladus. Модель: Gemini Pro TTS (Google AI Studio → Generate speech).
Манера: тёплый, добрый мужской голос (доктор Dr. Harlow), естественное английское произношение, чётко и не спеша.
Прочитай каждое слово один раз, строго по порядку, и после каждого сделай паузу 2 секунды.
Ничего не добавляй от себя: без вступления, без номеров, без перевода и без комментариев. Нужен один аудиофайл.`,
  text: `Озвучь по-английски короткие рассказы для детей 7–10 лет.
Голос: Enceladus. Модель: Gemini Pro TTS (Google AI Studio → Generate speech).
Манера: тёплый, добрый мужской голос (доктор Dr. Harlow), естественное английское произношение, выразительно, не спеша.
Прочитай каждый рассказ целиком один раз, строго по порядку. Между рассказами — пауза 3 секунды, внутри рассказа длинных пауз не делай.
Ничего не добавляй от себя: без вступления, без номеров, без комментариев. Нужен один аудиофайл.`,
  ru: `Озвучь по-русски реплики доктора-оленя Dr. Harlow для детей 7–10 лет.
Голос: Enceladus. Модель: Gemini Pro TTS (Google AI Studio → Generate speech).
Манера: тёплый, добрый и спокойный мужской голос доктора, говорит не спеша и чётко.
Прочитай каждую реплику один раз, строго по порядку, и после каждой сделай паузу 2 секунды.
Ничего не добавляй от себя: без вступления, без номеров, без комментариев. Нужен один аудиофайл.`,
};
// голоса героев — те же, что в tools/gen-voices.mjs (записанное раньше звучит тем же голосом)
const HERO_VOICES = {
  harlow: ['Enceladus', 'Dr. Harlow, добрый доктор-олень: тёплый, спокойный мужской голос, говорит не спеша и чётко'],
  luna: ['Leda', 'Nurse Luna, медсестра-зайчиха: ласковый молодой женский голос, мягко и заботливо, с улыбкой'],
  max: ['Puck', 'Miner Max, шахтёр-мальчишка: бодрый весёлый голос, энергично и с азартом'],
  owl: ['Charon', 'Prof. Owl, профессор-сова: мудрый добрый голос, неторопливо, чуть торжественно'],
  robo: ['Fenrir', 'DJ Robo, робот-диджей: весёлый задорный голос, ритмично, слегка «механически»'],
};
// виды реплик героя: что это за реплики и как их читать
const CATS = {
  guide: ['реплики гида темы', 'Герой ведёт урок: коротко хвалит за верный ответ, мягко подбадривает после ошибки, подсказывает. Тепло и живо, без сюсюканья; английские слова — с естественным английским произношением.'],
  self: ['реплики героя игрока', 'Ребёнок выбрал этого героя своим персонажем: герой говорит о себе от первого лица — радуется победе, собирается перед испытанием, не унывает после ошибки. Искренне, как ребёнок-герой.'],
  team: ['реплики для командной игры', 'Командный квест: несколько детей вместе лечат пациента или побеждают босса. Герой подбадривает команду — радостно, с азартом, коротко, как болельщик.'],
  location: ['вступления к локациям', 'Герой приглашает в новое место на карте и коротко говорит, что там будем делать. Чуть сказочно и с интересом, не торопясь.'],
  narrator: ['реплики ведущей', 'Nurse Luna — ведущая игры: объясняет, что делать, и подсказывает, куда нажать. Спокойно, понятно и дружелюбно.'],
};
const catOf = x => x.kind?.startsWith('self-') ? 'self' : x.kind?.startsWith('team-') ? 'team' : x.kind === 'location' ? 'location' : x.kind === 'narrator' ? 'narrator' : 'guide';
const MODEL_NOTE = 'Модель: Gemini Pro TTS (в Google AI Studio — «Generate speech», самая новая Pro-модель с озвучкой).';
const COMMON = 'Прочитай каждую реплику один раз, строго по порядку, и после каждой сделай паузу 2 секунды. Ничего не добавляй от себя: без вступления, без номеров, без комментариев. Нужен один аудиофайл.';
const heroPrompt = (id, cat) => `Голос: ${HERO_VOICES[id][0]}
${MODEL_NOTE}

Инструкция по стилю (поле Style instructions):
Озвучь ${CATS[cat][0]} для детей 7–10 лет. Говорит ${HERO_VOICES[id][1]}.
${CATS[cat][1]}
Реплики по-русски; английские слова и фразы — с естественным английским произношением.
${COMMON}`;
const batches = {};
let md = `# Озвучка English Quest\n\nВсего фраз без записи: ${todo.length}.\n\n` +
  `Как сделать (Google AI Studio → Generate speech):\n` +
  `1. Для каждой пачки выберите голос из строки «Голос», вставьте инструкцию в поле стиля, а реплики — в поле текста.\n` +
  `2. Скачайте аудио и сохраните в эту папку под именем пачки (например, \`owl-team-01.wav\`).\n` +
  `3. Скажите Claude — он подключит записи: запись режется по паузам, кусков должно быть столько же, сколько реплик.\n` +
  `Если реплик в записи окажется больше или меньше (пропуск, повтор, лишнее слово), пачка не подключится — её стоит перезаписать.\n` +
  `Пачки реплик героев — по 10: так паузы между ними надёжнее находятся.\n`;
// русские фразы Dr. Harlow-ведущего, английские фразы и слова — как раньше; реплики героев — по герою и виду
const group = x => {
  // реплики героев (у Dr. Harlow — с видом реплики, кроме слов и фраз уроков) — по герою и виду
  if (x.speaker !== 'harlow' || (x.kind && !['lesson', 'letter', 'word', 'dict'].includes(x.kind))) return `${x.speaker}-${catOf(x)}`;
  return x.lang === 'ru' ? 'ru' : x.kind === 'dict' ? 'dict' : x.text.length > 160 ? 'text' : 'en';
};
const order = ['ru', 'en', 'text', 'dict', ...Object.keys(HERO_VOICES).flatMap(id => Object.keys(CATS).map(c => `${id}-${c}`))];
for (const g of order){
  const list = todo.filter(x => group(x) === g), size = { dict: WORD_BATCH, text: TEXT_BATCH, ru: BATCH, en: BATCH }[g] || HERO_BATCH;
  for (let i = 0; i < list.length; i += size){
    const id = `${g}-${String(i / size + 1).padStart(2, '0')}`;
    const part = list.slice(i, i + size);
    batches[id] = part.map(x => ({ text: x.text, speaker: x.speaker, key: x.key }));
    const [hero, cat] = g.split('-');
    const title = PROMPTS[g] ? { ru: 'реплик по-русски', dict: 'слов словаря', text: 'рассказов по-английски', en: 'фраз по-английски' }[g] : `${EQ.CHARACTERS[hero].name} — ${CATS[cat][0]}`;
    md += `\n## ${id} — ${part.length} · ${title}\n\n` + '```\n' + (PROMPTS[g] || heroPrompt(hero, cat)) + '\n\nТекст:\n' + part.map(x => x.text).join('\n\n') + '\n```\n';
  }
}
const left = todo.filter(x => !order.includes(group(x)));
if (left.length) console.error('Без пачки остались фразы:', left.slice(0, 5).map(x => `${x.speaker}/${x.kind}: ${x.text}`));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'batches.json'), JSON.stringify(batches, null, 1) + '\n');
writeFileSync(join(dir, 'ОЗВУЧКА.md'), md);
console.log(`Без записи: ${todo.length} (по-русски ${todo.filter(x => x.lang === 'ru').length}, слов словаря ${todo.filter(x => x.kind === 'dict').length}), пачек: ${Object.keys(batches).length}\nЗадание: ${join(dir, 'ОЗВУЧКА.md')}`);
