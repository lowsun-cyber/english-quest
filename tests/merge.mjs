#!/usr/bin/env node
// Проверка объединения прогресса с разных устройств (js/merge.js).
//   node tests/merge.mjs
import { join, dirname } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const { mergeStates, same } = await import(join(ROOT, 'js/merge.js'));
const { DEFAULT_STATE } = await import(join(ROOT, 'js/state.js'));
const fresh = () => JSON.parse(JSON.stringify(DEFAULT_STATE));
const S = (patch) => ({ ...fresh(), ...patch });

let fail = 0, total = 0;
const check = (name, cond, info = '') => { total++; if (!cond){ fail++; console.log(`FAIL  ${name}${info !== '' ? '  — ' + JSON.stringify(info) : ''}`); } };
const M = (b, l, r) => mergeStates(b, l, r, fresh());

// изменения только с одной стороны
{
  const base = S({ xp: 100, gold: 40 });
  const local = S({ xp: 130, gold: 40 });
  check('только здесь — берём своё', M(base, local, base).xp === 130);
  check('только на сервере — берём серверное', M(base, base, local).xp === 130);
  check('ничего не менялось', same(M(base, base, base), base));
}

// счётчики складываются, потраченное не возвращается
{
  const base = S({ xp: 100, gold: 60, freezes: 1, mastered: 2 });
  const tablet = S({ xp: 120, gold: 70, freezes: 1, mastered: 3 });   // +20 XP, +10 золота
  const phone = S({ xp: 150, gold: 10, freezes: 2, mastered: 2 });    // +50 XP, купил заморозку за 50
  const m = M(base, tablet, phone);
  check('опыт: прибавки обеих сторон', m.xp === 170, m.xp);
  check('золото: +10 и −50', m.gold === 20, m.gold);
  check('заморозки не больше 2', M(S({ freezes: 1 }), S({ freezes: 2 }), S({ freezes: 2 })).freezes === 2);
  check('выучено после ошибок', m.mastered === 3);
  check('никогда не меньше нуля', M(S({ gold: 50 }), S({ gold: 0 }), S({ gold: 0 })).gold === 0);
}

// сброс на одном устройстве доходит до других
{
  const base = S({ xp: 300, lessonProgress: { a: { vocab: 2 } }, mistakes: { 'word:a:1': { last: 5, wrong: 1 } } });
  const reset = fresh();
  const m = M(base, base, reset);
  check('сброс: опыт 0', m.xp === 0);
  check('сброс: темы очищены', same(m.lessonProgress, {}));
  check('сброс: ошибки очищены', same(m.mistakes, {}));
}

// прохождение тем — лучший результат
{
  const base = S({ lessonProgress: { a: { vocab: 1, listen: 1 } } });
  const l = S({ lessonProgress: { a: { vocab: 3, listen: 1 }, b: { vocab: 1 } } });
  const r = S({ lessonProgress: { a: { vocab: 2, listen: 2, speak: 1 } } });
  const m = M(base, l, r);
  check('темы: по каждому упражнению лучшее', same(m.lessonProgress, { a: { vocab: 3, listen: 2, speak: 1 }, b: { vocab: 1 } }), m.lessonProgress);
}

// занятия по дням складываются, отметки объединяются
{
  const base = S({ activity: { '2026-09-28': { sec: 300, ok: 5, bad: 1, goalMet: false } } });
  const l = S({ activity: { '2026-09-28': { sec: 500, ok: 9, bad: 1, goalMet: false }, '2026-09-29': { sec: 60, ok: 1, bad: 0 } } });
  const r = S({ activity: { '2026-09-28': { sec: 700, ok: 8, bad: 3, goalMet: true }, '2026-09-29': { sec: 120, ok: 2, bad: 1 } } });
  const m = M(base, l, r);
  check('день: время и ответы складываются', same(m.activity['2026-09-28'], { sec: 900, ok: 12, bad: 3, goalMet: true }), m.activity['2026-09-28']);
  check('новый день на обоих устройствах', same(m.activity['2026-09-29'], { sec: 180, ok: 3, bad: 1 }), m.activity['2026-09-29']);
}

// «Мои ошибки»: исправленное не воскресает, новое не теряется
{
  const w1 = { type: 'word', box: 1, wrong: 1, last: 100 }, w2 = { type: 'word', box: 0, wrong: 2, last: 200 };
  const base = S({ mistakes: { w1, w2 } });
  const l = S({ mistakes: { w2, w3: { type: 'word', box: 0, wrong: 1, last: 300 } }, mastered: 1 });   // w1 выучено, w3 новое
  const r = S({ mistakes: { w1, w2: { ...w2, wrong: 3, last: 400 }, w4: { type: 'grammar', box: 0, wrong: 1, last: 350 } } });
  const m = M(base, l, r);
  check('выученное здесь не возвращается', !('w1' in m.mistakes), Object.keys(m.mistakes));
  check('новые с обеих сторон остаются', 'w3' in m.mistakes && 'w4' in m.mistakes);
  check('изменённое — по последней попытке', m.mistakes.w2.wrong === 3);
  const r2 = S({ mistakes: { w1: { ...w1, wrong: 5, last: 500 }, w2 } });
  check('удалено здесь, но там снова ошибся — остаётся', M(base, l, r2).mistakes.w1?.wrong === 5);
}

// проверки, домашка, настройки, коллекция
{
  const base = S({ checkpoints: { c1: { best: 6, passedAt: null } } });
  const l = S({ checkpoints: { c1: { best: 8, passedAt: 1000 } } });
  const r = S({ checkpoints: { c1: { best: 9, passedAt: 900 } } });
  check('проверка: лучший балл и первая сдача', same(M(base, l, r).checkpoints.c1, { best: 9, passedAt: 900 }));

  const hw = { id: 'a|vocab', lessonId: 'a', tasks: ['vocab'], assigned: 10, baseline: {}, doneAt: null };
  check('домашка: сделано хоть где-то', M(S({ homework: hw }), S({ homework: { ...hw, doneAt: 50 } }), S({ homework: { ...hw, note: 'x', doneAt: null } })).homework.doneAt === 50);
  check('домашка: новое задание важнее', M(S({ homework: hw }), S({ homework: { ...hw, doneAt: 50 } }), S({ homework: { ...hw, id: 'b', assigned: 20 } })).homework.id === 'b');
  check('домашка: отменили здесь', M(S({ homework: hw }), S({ homework: null }), S({ homework: hw })).homework === null);

  const sb = S({ settings: { theme: 'light', speechRate: 0.9, dailyGoal: 10 } });
  const sl = S({ settings: { theme: 'dark', speechRate: 0.9, dailyGoal: 10 } });
  const sr = S({ settings: { theme: 'light', speechRate: 0.9, dailyGoal: 15 } });
  check('настройки: по каждой отдельно', same(M(sb, sl, sr).settings, { theme: 'dark', speechRate: 0.9, dailyGoal: 15 }));

  check('коллекция: прибавки складываются', same(M(S({ inventory: { cat: 2 } }), S({ inventory: { cat: 3, dog: 1 } }), S({ inventory: { cat: 4 } })).inventory, { cat: 5, dog: 1 }));
  check('рекорд серии — максимум', M(S({ bestStreak: 3 }), S({ bestStreak: 5 }), S({ bestStreak: 4 })).bestStreak === 5);
}

// первое подключение: основа — пустой прогресс
{
  const l = S({ xp: 40, gold: 10 }), r = S({ xp: 100, gold: 30 });
  const m = mergeStates(null, l, r, fresh());
  check('первое подключение: складываем', m.xp === 140 && m.gold === 40);
  check('на сервере пусто — своё', same(mergeStates(null, l, null, fresh()), l));
  check('ничего не пропало из полей', Object.keys(DEFAULT_STATE).every(k => k in m), Object.keys(m));
  check('объединение не меняет входы', l.xp === 40 && r.xp === 100);
}

// грамматические навыки: ответы и неверные варианты складываются, время — последнее
{
  const base = S({ skills: { 'G4-07': { ok: 2, bad: 1, last: 100, wrong: { goed: 1 } } } });
  const tablet = S({ skills: { 'G4-07': { ok: 3, bad: 2, last: 200, wrong: { goed: 2 } } } });
  const phone = S({ skills: { 'G4-07': { ok: 4, bad: 3, last: 300, wrong: { goed: 1, gone: 1 } }, 'G2-01': { ok: 1, bad: 0, last: 250 } } });
  const k = M(base, tablet, phone).skills;
  check('навыки: ответы с обоих устройств складываются', k['G4-07'].ok === 5 && k['G4-07'].bad === 4 && k['G4-07'].last === 300, k);
  check('навыки: неверные варианты складываются', k['G4-07'].wrong.goed === 2 && k['G4-07'].wrong.gone === 1, k['G4-07'].wrong);
  check('навыки: новый навык с другого устройства появляется', k['G2-01']?.ok === 1);
}

console.log(`\n${total - fail} из ${total} проверок объединения прошли`);
process.exit(fail ? 1 : 0);
