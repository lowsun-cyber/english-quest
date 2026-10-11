#!/usr/bin/env node
// Пакеты локаций: проверка и сборка packs.js.
//
//   node tools/packs.mjs            — проверить все пакеты в packs/ и собрать packs.js из подключённых (packs/index.json)
//   node tools/packs.mjs --check    — только проверить (packs.js не трогать); код выхода 1 при ошибках
//
// Подключённые пакеты (packs/index.json) проверяются строго: всё, что звучит, должно быть озвучено
// (node tools/voice-todo.mjs — задание на озвучку, import-voices.mjs — подключить записи).
// Формат и шаблон — packs/README.md.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import vm from 'node:vm';

export const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const read = f => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));

// Контент для Node. packs: 'none' — без пакетов (проверка ссылок), 'enabled' — как на сайте (packs.js),
// 'all' — все пакеты из packs/ (озвучка: новые пакеты озвучиваются до подключения)
export function loadContent({ packs = 'none' } = {}){
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, 'content.js'), 'utf8'), ctx);
  if (packs === 'enabled' && existsSync(join(ROOT, 'packs.js'))) vm.runInContext(readFileSync(join(ROOT, 'packs.js'), 'utf8'), ctx);
  if (packs === 'all') ctx.window.EQ.addPacks(listPacks().map(f => read(`packs/${f}`)));
  return ctx.window.EQ;
}
export function listPacks(){
  const dir = join(ROOT, 'packs');
  return existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json').sort() : [];
}
export const enabledPacks = () => existsSync(join(ROOT, 'packs/index.json')) ? read('packs/index.json') : [];

// Что звучит в пакете (те же строки, что voiceLines в content.js)
export function packLines(p){
  const parts = [...(p.type === 'location' ? [p.lesson] : []), ...(p.quests || [])];
  const lines = [];
  for (const x of parts) lines.push(...(x.words || []).map(w => w.en), ...(x.phrases || []), ...(x.grammar || []).map(g => g.q.replace('___', g.a)),
    ...(x.pics || []).map(q => q.right), ...(x.reading ? [x.reading.text] : []));
  return [...new Set(lines)];
}
export function recordedSet(){
  const man = existsSync(join(ROOT, 'tts_manifest.json')) ? read('tts_manifest.json') : {};
  const voices = existsSync(join(ROOT, 'tts_voices.json')) ? read('tts_voices.json') : {};
  return t => !!(voices[t] || man[t] || man[t.replace(/(^|\s)I(?=[\s'’.,!?]|$)/g, '$1i')]);
}

// Ошибки пакета (пустой список — всё хорошо). strict — проверять озвучку.
export function validatePack(p, EQ, { strict = false, file = '' } = {}){
  const err = [], { LESSONS, SKILLS, CHARACTERS, EXTRA_KINDS } = EQ;
  const need = (cond, msg) => { if (!cond) err.push(msg); };
  need(/^[a-z0-9-]+$/.test(p.id || ''), 'id — латиница, цифры и дефис');
  if (file) need(file === `${p.id}.json`, `имя файла должно быть ${p.id}.json`);
  need(['location', 'quests'].includes(p.type), 'type — location или quests');
  need(/^\d{4}-\d\d-\d\d$/.test(p.addedAt || '') && !isNaN(Date.parse(p.addedAt)), 'addedAt — дата ГГГГ-ММ-ДД');
  need(['base', 'frp', 'ext'].includes(p.layer), 'layer — base, frp или ext');
  const words = (ws, where) => {
    need(Array.isArray(ws), `${where}: words — список`);
    for (const w of ws || []) need(w && w.en && w.ru && w.emoji, `${where}: у слова нужны en, ru, emoji (${JSON.stringify(w)})`);
  };
  const grammar = (gs, where) => {
    for (const g of gs || []){
      need(g.q?.includes('___') && g.a && g.hint && Array.isArray(g.options) && g.options.includes(g.a), `${where}: вопрос «${g.q}» — нужны ___ в q, a, hint и a среди options`);
      need(!g.skill || SKILLS[g.skill], `${where}: нет навыка ${g.skill} (коды — CURRICULUM.skills)`);
    }
  };
  const reading = (r, where) => { if (!r) return;
    need(r.title && r.text && Array.isArray(r.questions) && r.questions.length, `${where}: reading — title, text и questions`);
    for (const q of r.questions || []) need(q.q && q.options?.includes(q.a), `${where}: вопрос к тексту «${q.q}» — a среди options`);
  };
  const pics = (ps, where) => { for (const x of ps || []) need(x.emoji && x.right && x.wrong && x.right !== x.wrong, `${where}: картинка — emoji, right, wrong`); };
  let lesson = null;
  if (p.type === 'location'){
    const l = p.lesson || {};
    lesson = l;
    need([2, 3, 4].includes(l.grade), 'lesson.grade — 2, 3 или 4');
    need(l.title && l.subtitle && l.intro, 'lesson: title, subtitle, intro');
    need(CHARACTERS[l.guide], `lesson.guide — один из героев: ${Object.keys(CHARACTERS).join(', ')}`);
    need(!LESSONS.some(x => x.id === p.id), `тема ${p.id} уже есть`);
    words(l.words, 'lesson'); need((l.words || []).length >= 6, 'lesson: слов не меньше 6');
    need(new Set((l.words || []).map(w => w.emoji)).size >= 4, 'lesson: хотя бы 4 разные картинки слов');
    need(Array.isArray(l.phrases) && l.phrases.length >= 2, 'lesson: фраз для «Говори» не меньше 2');
    need((l.grammar || []).length >= 2, 'lesson: вопросов грамматики не меньше 2'); grammar(l.grammar, 'lesson');
    need(!!l.reading, 'lesson: нужен текст для чтения'); reading(l.reading, 'lesson'); pics(l.pics, 'lesson');
  } else if (p.type === 'quests'){
    lesson = LESSONS.find(x => x.id === p.lessonId);
    need(lesson, `lessonId — существующая тема (нет ${p.lessonId})`);
    need((p.quests || []).length >= 1, 'quests — хотя бы один квест');
  }
  const ids = new Set();
  for (const q of p.quests || []){
    const where = `квест ${q.id}`;
    need(/^[a-z0-9-]+$/.test(q.id || '') && !ids.has(q.id), `${where}: id — латиница, без повторов`); ids.add(q.id);
    need(q.title && q.emoji, `${where}: title и emoji`);
    need(EXTRA_KINDS.includes(q.kind), `${where}: kind — одно из ${EXTRA_KINDS.join(', ')}`);
    need(!q.rarity || ['common', 'rare', 'epic'].includes(q.rarity), `${where}: rarity — common, rare или epic`);
    if (q.words) words(q.words, where);
    grammar(q.grammar, where); reading(q.reading, where); pics(q.pics, where);
    const base = lesson || {}, has = k => (q[k] && (!Array.isArray(q[k]) || q[k].length)) ? q[k] : base[k];
    const ws = has('words') || [];
    if (['cards', 'vocab', 'listen', 'match', 'spell'].includes(q.kind)) need(ws.length >= 4 && new Set(ws.map(w => w.emoji)).size >= 4, `${where}: для «${q.kind}» нужно 4 слова с разными картинками`);
    if (q.kind === 'grammar') need((has('grammar') || []).length >= 2, `${where}: для грамматики — 2 вопроса`);
    if (q.kind === 'reading') need(!!has('reading'), `${where}: для чтения — текст`);
    if (q.kind === 'picture') need((has('pics') || []).length >= 2, `${where}: для «Что на картинке?» — 2 картинки`);
    if (q.kind === 'speak') need((has('phrases') || []).length >= 1, `${where}: для «Говори» — фразы`);
  }
  if (p.scene){
    const s = p.scene;
    need(s.image && s.width > 0 && s.height > 0, 'scene: image, width, height');
    for (const m of s.markers || []){
      need(m.x >= 0 && m.y >= 0 && m.x <= s.width && m.y <= s.height, `scene: метка ${m.quest} (${m.x}, ${m.y}) вне сцены ${s.width}×${s.height}`);
      need(ids.has(m.quest) || EXTRA_KINDS.includes(m.quest), `scene: метка ведёт на неизвестный квест ${m.quest}`);
    }
    need(!s.image || existsSync(join(ROOT, s.image)), `scene: нет файла ${s.image}`);
  }
  if (strict){
    const ok = recordedSet(), missing = packLines(p).filter(t => !ok(t));
    need(!missing.length, `не озвучено ${missing.length}: ${missing.slice(0, 5).join(' | ')}${missing.length > 5 ? ' …' : ''} — node tools/voice-todo.mjs`);
  }
  return err;
}

// Содержимое packs.js для подключённых пакетов
export function buildPacksJs(packs){
  return `// English Quest — подключённые пакеты локаций. Файл собирает node tools/packs.mjs из packs/*.json — не править вручную.\n`
    + `window.EQ.addPacks(${JSON.stringify(packs, null, 1)});\n`;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`){
  const EQ = loadContent(), enabled = enabledPacks(), files = listPacks();
  let bad = 0;
  for (const id of enabled) if (!files.includes(`${id}.json`)){ console.log(`✗ packs/index.json: нет файла packs/${id}.json`); bad++; }
  const ready = [];
  for (const f of files){
    const p = read(`packs/${f}`), on = enabled.includes(p.id);
    const errs = validatePack(p, EQ, { strict: on, file: f });
    console.log(`${errs.length ? '✗' : '✓'} ${f}${on ? ' (подключён)' : ''}${errs.length ? '\n   ' + errs.join('\n   ') : ''}`);
    bad += errs.length ? 1 : 0;
    if (on && !errs.length) ready.push(p);
  }
  if (bad){ console.log('\nЕсть ошибки — packs.js не обновлён.'); process.exit(1); }
  const order = id => enabled.indexOf(id);
  const js = buildPacksJs(ready.sort((a, b) => order(a.id) - order(b.id)));
  if (process.argv.includes('--check')){
    const cur = existsSync(join(ROOT, 'packs.js')) ? readFileSync(join(ROOT, 'packs.js'), 'utf8') : '';
    if (cur !== js){ console.log('packs.js устарел — запустите node tools/packs.mjs'); process.exit(1); }
    console.log('packs.js актуален');
  } else { writeFileSync(join(ROOT, 'packs.js'), js); console.log(`packs.js: подключено пакетов — ${ready.length}`); }
}
