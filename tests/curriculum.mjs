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
const KINDS = ['cards', 'vocab', 'listen', 'match', 'spell', 'grammar', 'reading', 'speak'];
check('типы заданий: упражнения Quest существуют', CURRICULUM.taskTypes.every(t => t.kinds.every(k => KINDS.includes(k))));
check('типы заданий: редкость из списка', CURRICULUM.taskTypes.every(t => ['common', 'rare', 'epic', 'legendary'].includes(t.rarity)));
check('чтение в 4 классе — тип 4-A', taskTypeFor('reading', 4) === '4-A' && taskTypeFor('cards', 2) === null);

for (const l of LESSONS){
  check(`${l.id}: модуль Spotlight`, /^(Starter|M[1-8])$/.test(l.module || ''), l.module);
  check(`${l.id}: темы своего класса`, Array.isArray(l.topics) && l.topics.length > 0 && l.topics.every(t => topics[t]?.grade === l.grade), l.topics);
  check(`${l.id}: уровень CEFR`, ['Pre-A1', 'A1', 'A1+'].includes(l.cefr), l.cefr);
  for (const q of l.grammar) if (q.skill) check(`${l.id}: навык ${q.skill} есть в карте`, !!SKILLS[q.skill] && SKILLS[q.skill].grade <= l.grade, q.q);
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
