#!/usr/bin/env node
// Разметка контента по карте программы: у каждого урока модуль Spotlight, темы ФРП и CEFR,
// у вопросов грамматики — существующий код навыка. Плюс сводка: сколько слов набрано к цели класса.
//   node tests/curriculum.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT, 'content.js'), 'utf8'), ctx);
if (existsSync(join(ROOT, 'packs.js'))) vm.runInContext(readFileSync(join(ROOT, 'packs.js'), 'utf8'), ctx);   // подключённые пакеты локаций — как на сайте
const { LESSONS, CURRICULUM, SKILLS, taskTypeFor } = ctx.window.EQ;

let fail = 0, total = 0;
const check = (name, cond, info = '') => { total++; if (!cond){ fail++; console.log(`FAIL  ${name}${info ? '  — ' + JSON.stringify(info) : ''}`); } };
const uniq = a => new Set(a).size === a.length;

const topics = Object.fromEntries(CURRICULUM.topics.map(t => [t.id, t]));
check('id тем не повторяются', uniq(CURRICULUM.topics.map(t => t.id)));
check('коды навыков не повторяются', uniq(CURRICULUM.skills.map(s => s.code)));
check('коды типов заданий не повторяются', uniq(CURRICULUM.taskTypes.map(t => t.code)));
check('навыки: код G<класс>-NN, слой base/frp/ext', CURRICULUM.skills.every(s => new RegExp(`^G${s.grade}-\\d\\d$`).test(s.code) && ['base', 'frp', 'ext'].includes(s.layer)));
check('темы: id g<класс>-…', CURRICULUM.topics.every(t => t.id.startsWith(`g${t.grade}-`)));
const KINDS = ['cards', 'vocab', 'listen', 'match', 'spell', 'grammar', 'reading', 'speak', 'picture', 'fill', 'build'];
check('типы заданий: упражнения Quest существуют', CURRICULUM.taskTypes.every(t => t.kinds.every(k => KINDS.includes(k))));
check('типы заданий: редкость из списка', CURRICULUM.taskTypes.every(t => ['common', 'rare', 'epic', 'legendary'].includes(t.rarity)));
// граф навыков: опоры существуют, из своего или младшего класса, без циклов
check('граф навыков: опоры — существующие навыки своего или младшего класса', CURRICULUM.skills.every(s => Array.isArray(s.needs) && s.needs.every(c => SKILLS[c] && SKILLS[c].grade <= s.grade && c !== s.code)), CURRICULUM.skills.filter(s => !(s.needs || []).every(c => SKILLS[c])).map(s => s.code));
{
  const state = {}, cyc = [];
  const visit = c => { if (state[c] === 1) return cyc.push(c); if (state[c] === 2) return; state[c] = 1; (SKILLS[c].needs || []).forEach(visit); state[c] = 2; };
  CURRICULUM.skills.forEach(s => visit(s.code));
  check('граф навыков без циклов', !cyc.length, cyc);
}
check('чтение в 4 классе — тип 4-A', taskTypeFor('reading', 4) === '4-A' && taskTypeFor('cards', 2) === null);

for (const l of LESSONS){
  check(`${l.id}: модуль Spotlight`, /^(Starter|M[1-8])$/.test(l.module || ''), l.module);
  check(`${l.id}: темы своего класса`, Array.isArray(l.topics) && l.topics.length > 0 && l.topics.every(t => topics[t]?.grade === l.grade), l.topics);
  check(`${l.id}: уровень CEFR`, ['Pre-A1', 'A1', 'A1+'].includes(l.cefr), l.cefr);
  for (const q of l.grammar){
    if (q.skill) check(`${l.id}: навык ${q.skill} есть в карте`, !!SKILLS[q.skill] && SKILLS[q.skill].grade <= l.grade, q.q);
    check(`${l.id}: ответ «${q.a}» есть среди вариантов`, q.options.includes(q.a) && new Set(q.options).size === q.options.length, q.q);
    // разбор неверного ответа: у каждого неверного варианта своё объяснение (js/why.js)
    const wrong = q.options.filter(o => o !== q.a);
    check(`${l.id}: объяснение к каждому неверному варианту`, wrong.every(o => q.why?.[o]?.trim()) && Object.keys(q.why || {}).every(k => wrong.includes(k)), q.q);
  }
  check(`${l.id}: у каждого слова есть картинка и перевод`, l.words.every(w => w.en && w.ru && w.emoji), l.words.filter(w => !w.emoji).map(w => w.en));
  const ems = l.words.map(w => w.emoji);
  check(`${l.id}: картинки слов не повторяются`, new Set(ems).size === ems.length, ems.filter((e, i) => ems.indexOf(e) !== i));
  check(`${l.id}: слова не повторяются`, new Set(l.words.map(w => w.en)).size === l.words.length);
  for (const r of l.reading.questions) check(`${l.id}: ответ на вопрос к тексту среди вариантов`, r.options.includes(r.a), r.q);
  for (const it of l.pics || []){
    check(`${l.id}: «${it.right}» — два разных варианта и картинка`, !!it.emoji && it.right && it.wrong && it.right !== it.wrong);
    if (it.word) check(`${l.id}: слово ${it.word} из «Что на картинке?» есть в уроке`, l.words.some(w => w.en === it.word));
    if (it.skill) check(`${l.id}: навык ${it.skill} в «Что на картинке?» есть в карте`, !!SKILLS[it.skill] && SKILLS[it.skill].grade <= l.grade);
  }
}
check('id уроков не повторяются', uniq(LESSONS.map(l => l.id)));
const heroCount = /Spotlight \(2, 3, 4\), (\d+) тем/.exec(readFileSync(join(ROOT, 'index.html'), 'utf8'))?.[1];
check('число тем на главной совпадает с контентом', +heroCount === LESSONS.length, { наГлавной: heroCount, тем: LESSONS.length });
for (const g of [2, 3, 4]){
  const ord = LESSONS.filter(l => l.grade === g).map(l => l.order);
  check(`${g} класс: порядок тем без повторов`, uniq(ord), ord);
}
check('2 класс: у каждой темы есть «Что на картинке?» (тип 2-E)', LESSONS.filter(l => l.grade === 2).every(l => l.pics?.length >= 3));
const { fillItemsFor, buildItemsFor } = ctx.window.EQ;
for (const l of LESSONS.filter(l => l.grade === 4)){
  const n = l.reading.text.split(/\s+/).length;
  check(`${l.id}: текст (4-A) — 70–160 слов и 3 вопроса`, n >= 70 && n <= 160 && l.reading.questions.length >= 3, { слов: n, вопросов: l.reading.questions.length });
  const b = buildItemsFor(l);
  check(`${l.id}: «Собери предложение» (4-C) — не меньше 3 заданий`, b.length >= 3, b.length);
  for (const it of b) check(`${l.id}: «${it.text}» — 4–9 слов`, it.tokens.length >= 4 && it.tokens.length <= 9 && it.tokens.join(' ') === it.text);
}
for (const l of LESSONS.filter(l => l.grade === 3)){
  const n = l.reading.text.split(/\s+/).length;
  check(`${l.id}: мини-сказка (3-F) — 60–130 слов и 3 вопроса`, n >= 60 && n <= 130 && l.reading.questions.length >= 3, { слов: n, вопросов: l.reading.questions.length });
  const f = fillItemsFor(l);
  check(`${l.id}: «Вставь слово» (3-A) — не меньше 3 заданий`, f.length >= 3, f.length);
  for (const it of f) check(`${l.id}: «${it.q}» — один пропуск, ответ — слово урока`, it.q.split('___').length === 2 && l.words.some(w => w.en === it.a) && it.others.length >= 3);
}
for (const g of [2, 3, 4]) check(`${g} класс: у грамматики есть коды навыков`, LESSONS.filter(l => l.grade === g).some(l => l.grammar.some(q => q.skill)));

// реплики героев (HERO_LINES, SELF_LINES, LOCATION_INTROS) и выбор голоса
{
  const { CHARACTERS, HERO_LINES, SELF_LINES, LOCATION_INTROS, LOCATION_ART, SECRET_REGIONS, FALLBACK_GUIDE, guideFor, narratorFor, locationIntro, heroLine, voiceKey, voiceLines } = ctx.window.EQ;
  const heroes = Object.keys(CHARACTERS);
  check('реплики есть у каждого героя — гида и героя игрока', heroes.every(h => HERO_LINES[h]?.length && SELF_LINES[h]?.length));
  check('запасной гид — другой герой', heroes.every(h => FALLBACK_GUIDE[h] && FALLBACK_GUIDE[h] !== h && CHARACTERS[FALLBACK_GUIDE[h]]));
  const all = Object.values(HERO_LINES).flat();
  check('разбор Prof. Owl — по существующим навыкам', all.filter(x => x.skill).every(x => SKILLS[x.skill]), all.filter(x => x.skill && !SKILLS[x.skill]).map(x => x.skill));
  // у гида нет пола: «справился/справилась», «готов/готова» — только в репликах героя игрока
  const gendered = /справил(ся|ась)|\bготов[аы]?\b|\bрад[аы]?\b|\bсмог(ла)?\b|\bсам[аи]?\b/i;
  check('реплики гида без родовых окончаний', !all.some(x => gendered.test(x.text)), all.filter(x => gendered.test(x.text)).map(x => x.text));
  check('реплики Шахт — о существующих местах', heroLine('max', 'mines', { id: 'x' }) === null && SECRET_REGIONS[0].locations.every(l => heroLine('max', 'mines', { id: l.id })));
  for (const [id, x] of Object.entries(LOCATION_INTROS)){
    const l = LESSONS.find(l => l.id === id);
    // speaker — гид по предложению владельца; пока оно не подтверждено, тему ведёт Dr. Harlow
    check(`вступление ${id}: тема есть, говорит её гид или Dr. Harlow, место — из атласа`, l && (l.guide === x.speaker || l.guide === 'harlow') && CHARACTERS[x.speaker] && x.text.toLowerCase().includes(LOCATION_ART[id].name.split(' ')[0].toLowerCase().slice(0, 3)), { guide: l?.guide, speaker: x.speaker });
  }
  const lunaLesson = LESSONS.find(l => l.guide === 'luna'), harlowLesson = LESSONS.find(l => l.guide === 'harlow');
  check('играешь за гида — ведёт запасной', guideFor(lunaLesson, 'luna') === 'harlow' && guideFor(lunaLesson, 'max') === 'luna' && guideFor(harlowLesson, 'harlow') === 'luna');
  check('играешь за Dr. Harlow — ведущая Nurse Luna', narratorFor('harlow') === 'luna' && narratorFor('owl') === 'harlow');
  check('запасной гид читает вступление без «бип»', locationIntro(LESSONS.find(l => l.id === 'g2-hello'), 'robo').text.startsWith('Это Арка'));
  const v = voiceLines(), keys = v.map(x => x.key);
  check('озвучка: ключи записей не повторяются', uniq(keys));
  check('озвучка: ключ — фраза у Dr. Harlow, «герой|фраза» у остальных', v.every(x => x.key === voiceKey(x.speaker, x.text)) && voiceKey('owl', 'A') === 'owl|A' && voiceKey('harlow', 'A') === 'A');
  check('озвучка: все реплики героев попали в задание', heroes.every(h => [...HERO_LINES[h], ...SELF_LINES[h]].every(x => keys.includes(voiceKey(h, x.text)))));
  check('озвучка: вступления — голосом гида и запасного гида', Object.values(LOCATION_INTROS).every(x => keys.includes(voiceKey(x.speaker, x.text)) && keys.includes(voiceKey(FALLBACK_GUIDE[x.speaker], x.alt || x.text))));
  check('озвучка: Nurse Luna-ведущая не называет себя Dr. Harlow', !v.some(x => x.speaker === 'luna' && /Я Dr\. Harlow/.test(x.text)));
}

// сводка (не проверка): насколько словарь дотягивает до цели ФРП
const words = new Set();
const lines = [];
for (const g of [2, 3, 4]){
  for (const l of LESSONS.filter(l => l.grade === g)) for (const w of l.words) words.add(w.en.toLowerCase());
  const tagged = LESSONS.filter(l => l.grade === g).flatMap(l => l.grammar).filter(q => q.skill).length;
  const all = LESSONS.filter(l => l.grade === g).flatMap(l => l.grammar).length;
  const covered = new Set(LESSONS.filter(l => l.grade === g).flatMap(l => l.topics)).size;
  lines.push(`  ${g} класс: слов ${words.size} из ${CURRICULUM.levels[g].words}, тем ${covered} из ${CURRICULUM.topics.filter(t => t.grade === g).length}, вопросов грамматики с навыком ${tagged} из ${all}`);
}
console.log('Покрытие карты программы (накопительно):\n' + lines.join('\n'));
console.log(`\n${total - fail} из ${total} проверок разметки прошли`);
process.exit(fail ? 1 : 0);
