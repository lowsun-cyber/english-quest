#!/usr/bin/env node
// Разметка контента по карте программы: у каждого урока модуль Spotlight, темы ФРП и CEFR,
// у вопросов грамматики — существующий код навыка. Плюс сводка: сколько слов набрано к цели класса.
//   node tests/curriculum.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT, 'content.js'), 'utf8'), ctx);
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
const KINDS = ['cards', 'vocab', 'listen', 'match', 'spell', 'grammar', 'reading', 'speak', 'picture', 'fill'];
check('типы заданий: упражнения Quest существуют', CURRICULUM.taskTypes.every(t => t.kinds.every(k => KINDS.includes(k))));
check('типы заданий: редкость из списка', CURRICULUM.taskTypes.every(t => ['common', 'rare', 'epic', 'legendary'].includes(t.rarity)));
check('чтение в 4 классе — тип 4-A', taskTypeFor('reading', 4) === '4-A' && taskTypeFor('cards', 2) === null);

for (const l of LESSONS){
  check(`${l.id}: модуль Spotlight`, /^(Starter|M[1-8])$/.test(l.module || ''), l.module);
  check(`${l.id}: темы своего класса`, Array.isArray(l.topics) && l.topics.length > 0 && l.topics.every(t => topics[t]?.grade === l.grade), l.topics);
  check(`${l.id}: уровень CEFR`, ['Pre-A1', 'A1', 'A1+'].includes(l.cefr), l.cefr);
  for (const q of l.grammar){
    if (q.skill) check(`${l.id}: навык ${q.skill} есть в карте`, !!SKILLS[q.skill] && SKILLS[q.skill].grade <= l.grade, q.q);
    check(`${l.id}: ответ «${q.a}» есть среди вариантов`, q.options.includes(q.a) && new Set(q.options).size === q.options.length, q.q);
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
const { fillItemsFor } = ctx.window.EQ;
for (const l of LESSONS.filter(l => l.grade === 3)){
  const n = l.reading.text.split(/\s+/).length;
  check(`${l.id}: мини-сказка (3-F) — 60–130 слов и 3 вопроса`, n >= 60 && n <= 130 && l.reading.questions.length >= 3, { слов: n, вопросов: l.reading.questions.length });
  const f = fillItemsFor(l);
  check(`${l.id}: «Вставь слово» (3-A) — не меньше 3 заданий`, f.length >= 3, f.length);
  for (const it of f) check(`${l.id}: «${it.q}» — один пропуск, ответ — слово урока`, it.q.split('___').length === 2 && l.words.some(w => w.en === it.a) && it.others.length >= 3);
}
for (const g of [2, 3, 4]) check(`${g} класс: у грамматики есть коды навыков`, LESSONS.filter(l => l.grade === g).some(l => l.grammar.some(q => q.skill)));

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
