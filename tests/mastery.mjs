#!/usr/bin/env node
// Типы ошибок и мастерство (js/stats.js) без браузера: классификация ответа, похожие слова,
// уровень освоения с учётом давности, старый прогресс без новых полей.
//   node tests/mastery.mjs
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT, 'content.js'), 'utf8'), ctx);
globalThis.window = ctx.window;   // js/eq.js берёт контент из window.EQ
const S = await import(join(ROOT, 'js/stats.js'));
const { DEFAULT_STATE } = await import(join(ROOT, 'js/state.js'));

let fail = 0, total = 0;
const check = (name, cond, info = '') => { total++; if (!cond){ fail++; console.log(`FAIL  ${name}${info !== '' ? '  — ' + JSON.stringify(info) : ''}`); } };
const fresh = (patch = {}) => ({ ...JSON.parse(JSON.stringify(DEFAULT_STATE)), ...patch });
const DAY = 864e5, NOW = Date.UTC(2026, 9, 11);

// похожие слова
check('cat / cap — похожи', S.similarWords('cat', 'cap'));
check('dog / dogs — похожи', S.similarWords('dog', 'dogs'));
check('sister / sitter — похожи (длинные, 2 буквы)', S.similarWords('sister', 'sitter'));
check('cat / dog — не похожи', !S.similarWords('cat', 'dog'));
check('sister / brother — не похожи', !S.similarWords('sister', 'brother'));
check('одинаковые и пустые — не «похожие»', !S.similarWords('cat', 'cat') && !S.similarWords('', 'cat'));

// тип ошибки
const cls = S.classifyError;
check('пропуск — не узнал', cls({ type: 'word', exercise: 'vocab', answer: 'cat' }) === 'unknown');
check('cap вместо cat — перепутал с похожим', cls({ type: 'word', exercise: 'vocab', answer: 'cat', chosen: 'cap' }) === 'similar');
check('dog вместо cat — не узнал', cls({ type: 'word', exercise: 'listen', answer: 'cat', chosen: 'dog' }) === 'unknown');
check('«Напиши» — написание, даже если похоже', cls({ type: 'word', exercise: 'spell', answer: 'cat', chosen: 'cta' }) === 'spelling');
check('грамматика — форма', cls({ type: 'grammar', answer: 'went', chosen: 'goed', skill: 'G4-07' }) === 'form');
check('картинка с навыком — форма', cls({ type: 'word', exercise: 'picture', answer: 'cat', chosen: 'It is a cats.', skill: 'G2-04' }) === 'form');
check('чтение — смысл текста', cls({ type: 'reading', answer: 'Yes', chosen: 'No' }) === 'meaning');
check('все типы описаны в ERROR_TYPES', ['unknown', 'similar', 'spelling', 'form', 'meaning'].every(id => S.errorType(id)));

// мастерство
const m = (ok, bad, daysAgo) => S.masteryOf({ ok, bad, last: daysAgo == null ? 0 : NOW - daysAgo * DAY }, NOW);
check('нет ответов — new', m(0, 0, 1).level === 'new' && m(0, 0, 1).score === null);
check('один верный — ещё не освоено', m(1, 0, 0).level === 'learning');
check('3 верных подряд недавно — освоено', m(3, 0, 1).level === 'mastered', m(3, 0, 1));
check('ошибок больше, чем верных, — трудное', m(1, 3, 1).level === 'weak', m(1, 3, 1));
check('давность снижает мастерство', m(5, 0, 90).score < m(5, 0, 1).score && m(5, 0, 1000).score >= Math.round(6 / 7 * 0.75 * 100) / 100);
check('свежий ответ — без поправки на давность', m(5, 0, 14).score === m(5, 0, 0).score);

// слова: старый прогресс (коллекция и «Мои ошибки») и новые ответы не задваиваются
const old = fresh({ inventory: { cat: 4, dog: 1 }, mistakes: { 'word:g2-x:dog': { type: 'word', ref: 'dog', wrong: 2 } } });
const ws = S.wordStats(old, NOW), cat = ws.find(w => w.en === 'cat'), dog = ws.find(w => w.en === 'dog');
check('старый прогресс: верные из коллекции', cat?.ok === 4 && cat.bad === 0, cat);
check('старый прогресс: ошибки из «Моих ошибок»', dog?.ok === 1 && dog.bad === 2, dog);
check('старый прогресс без даты — не «освоено» навсегда', cat.level !== 'new');
const both = fresh({ inventory: { cat: 4 }, words: { cat: { ok: 6, bad: 1, last: NOW, err: { similar: 1 }, with: { cap: 1 } } } });
const c2 = S.wordStats(both, NOW).find(w => w.en === 'cat');
check('новые ответы: берётся большее, без сложения', c2.ok === 6 && c2.bad === 1, c2);
check('с чем путает и тип — в подписи', S.wordErrNote(c2) === 'перепутал с похожим: cap', S.wordErrNote(c2));
check('сначала трудные слова', S.wordStats(fresh({ words: { cat: { ok: 5, bad: 0, last: NOW }, dog: { ok: 0, bad: 3, last: NOW } } }), NOW)[0].en === 'dog');
const sum = S.masterySummary(fresh({ words: { cat: { ok: 5, bad: 0, last: NOW }, dog: { ok: 0, bad: 3, last: NOW } }, errorTypes: { unknown: 2, similar: 1 } }), NOW);
check('сводка: уровни и типы ошибок', sum.levels.mastered === 1 && sum.levels.weak === 1 && sum.errors[0].type.id === 'unknown' && sum.errors[0].n === 2, sum.levels);
check('сводка: всего слов в уроках (не меньше минимума ФРП к 4 классу)', sum.total >= 500, sum.total);

// навыки: уровень и опоры
const sk = S.skillStats(fresh({ skills: { 'G4-07': { ok: 1, bad: 4, last: NOW }, 'G4-06': { ok: 5, bad: 0, last: NOW } } }));
const g407 = sk.find(x => x.code === 'G4-07');
check('навык: слабый и трудный', g407.weak && g407.level === 'weak');
check('навык: опоры с их уровнем', g407.needs.some(n => n.code === 'G4-06' && n.level === 'mastered') && g407.needs.some(n => n.code === 'G3-10' && n.level === 'new'), g407.needs);
check('подпись опор', /G4-06 .*\(освоено\)/.test(S.needsLine(g407)), S.needsLine(g407));

console.log(`\n${total - fail} из ${total} проверок мастерства прошли`);
process.exit(fail ? 1 : 0);
