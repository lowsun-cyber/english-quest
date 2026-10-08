// English Quest — Статистика ученика по его прогрессу (без DOM и без глобального state).
// Общая для панели репетитора в приложении и для админ-панели (admin/), поэтому цифры везде одинаковые.
import { CURRICULUM, LESSONS, MAX_LEVEL, SKILLS, buildItemsFor, fillItemsFor, levelFromXp, rankFor } from './eq.js';
import { dayKey, fmtDay, parseDay, shiftDay } from './util.js';

// ---------- уроки, упражнения, проверки ----------
export const PARTS = ['vocab', 'listen', 'match', 'spell', 'grammar', 'reading', 'speak'];
export const BLOCK = 4;
export const CHECKPOINT_SIZE = 10;
export const CHECKPOINT_PASS = 7;
export const EX_NAMES = { cards: '🃏 Карточки', vocab: '📚 Слова', listen: '🎧 Слушай', match: '🎯 Пара', spell: '✍️ Напиши', grammar: '🧩 Грамматика', reading: '📖 Чтение', speak: '🎤 Говори', picture: '🖼️ Что на картинке?', fill: '🔤 Вставь слово', build: '🧱 Собери предложение' };
// для домашки — упражнения, которые есть в каждой теме («Что на картинке?» — только там, где есть картинки-фразы)
export const EX_ORDER = ['cards', 'vocab', 'listen', 'match', 'spell', 'grammar', 'reading', 'speak'];
// упражнения экрана темы: обязательные (PARTS) и дополнительные
// «Вставь слово» (3-A) — с 3 класса, если из фраз урока получилось хотя бы 3 задания
export const hasFill = l => l.grade >= 3 && fillItemsFor(l).length >= 3;
// «Собери предложение» (4-C) — в 4 классе, если в уроке хотя бы 3 подходящих предложения
export const hasBuild = l => l.grade >= 4 && buildItemsFor(l).length >= 3;
export const lessonExercises = l => ['cards', ...PARTS, ...(l.pics?.length ? ['picture'] : []), ...(hasFill(l) ? ['fill'] : []), ...(hasBuild(l) ? ['build'] : [])];
export const GOAL_OPTIONS = [5, 10, 15, 20];

export function lessonsOf(grade){ return LESSONS.filter(l => l.grade === grade).sort((a, b) => a.order - b.order); }
export function checkpointsOf(grade){
  const ls = lessonsOf(grade), out = [];
  for (let i = 0; i < ls.length; i += BLOCK){
    const part = i / BLOCK + 1;
    out.push({ id: `g${grade}-p${part}`, grade, part, lessons: ls.slice(i, i + BLOCK),
      emoji: part === 1 ? '💎' : '🏆', title: `Проверка: ${grade} класс, часть ${part}` });
  }
  return out;
}
export const CHECKPOINTS = [...new Set(LESSONS.map(l => l.grade))].flatMap(checkpointsOf);
export const GRADES = [...new Set(LESSONS.map(l => l.grade))].sort();

export function isLessonComplete(l, st){
  const p = st.lessonProgress?.[l.id];
  if (!p) return false;
  return (p.vocab||0) >= 3 && (p.listen||0) >= 3 && (p.grammar||0) >= 2 && (p.reading||0) >= 1;
}
export const goalOf = st => GOAL_OPTIONS.includes(st.settings?.dailyGoal) ? st.settings.dailyGoal : 10;
export function homeworkDone(st, hw, ex){ return (st.lessonProgress?.[hw.lessonId]?.[ex] || 0) > (hw.baseline?.[ex] || 0); }

// Достаём из контента всё, что нужно для показа ошибки. null — если урок/слово удалены.
export function resolveMistake(m){
  const lesson = LESSONS.find(l => l.id === m.lessonId);
  if (!lesson) return null;
  if (m.type === 'word'){
    const w = lesson.words.find(w => w.en === m.ref);
    return w ? { lesson, word: w } : null;
  }
  if (m.type === 'grammar'){
    const q = lesson.grammar.find(q => q.q === m.ref);
    return q ? { lesson, q } : null;
  }
  if (m.type === 'reading'){
    const q = lesson.reading?.questions.find(q => q.q === m.ref);
    return q ? { lesson, q, reading: lesson.reading } : null;
  }
  return null;
}
export function mistakeList(st){
  return Object.entries(st.mistakes || {}).map(([key, m]) => ({ key, m, data: resolveMistake(m) })).filter(x => x.data);
}

// ---------- серия дней ----------
// День засчитан, когда цель выполнена (activity[день].goalMet); 🧊 заморозка закрывает пропуск.
export function streakOf(st){
  const act = st.activity || {};
  const met = k => !!act[k]?.goalMet, frozen = k => !!act[k]?.frozen;
  const today = dayKey(), todayMet = met(today);
  let k = todayMet ? today : shiftDay(today, -1), n = 0;
  while (met(k) || frozen(k)){ if (met(k)) n++; k = shiftDay(k, -1); }
  return { streak: n, todayMet, best: Math.max(st.bestStreak || 0, n), freezes: st.freezes || 0 };
}

export function lastDaysOf(st, n){
  const out = [];
  for (let i = n - 1; i >= 0; i--){
    const k = shiftDay(dayKey(), -i);
    out.push({ key: k, t: parseDay(k), ...(st.activity?.[k] || { sec: 0, ok: 0, bad: 0 }) });
  }
  return out;
}

const minutes = sec => sec > 0 && sec < 60 ? '<1' : Math.round(sec / 60);
const pctOf = (ok, bad) => ok + bad ? Math.round(ok * 100 / (ok + bad)) : null;

// Сводка за последние n дней + за всё время
// ---------- грамматические навыки (коды G2–G4 из карты программы) ----------
// weak — есть ошибки и верных меньше 70% (или ошибок не меньше трёх); сначала слабые, затем по коду
export const SKILL_WEAK_PCT = 70;
export function skillStats(st){
  return Object.entries(st.skills || {}).filter(([code]) => SKILLS[code]).map(([code, v]) => {
    const ok = v.ok || 0, bad = v.bad || 0, pct = pctOf(ok, bad);
    const wrong = Object.entries(v.wrong || {}).sort((a, b) => b[1] - a[1]);
    return { code, skill: SKILLS[code], ok, bad, pct, last: v.last || 0, wrong, weak: bad > 0 && (pct < SKILL_WEAK_PCT || bad >= 3) };
  }).sort((a, b) => (b.weak - a.weak) || (a.weak ? a.pct - b.pct : 0) || a.code.localeCompare(b.code));
}
// Что уже встречалось ребёнку по карте программы: темы и навыки начатых уроков
export function curriculumCoverage(st){
  const started = LESSONS.filter(l => Object.keys(st.lessonProgress?.[l.id] || {}).length);
  const topics = new Set(started.flatMap(l => l.topics || []));
  return { topics: topics.size, topicsTotal: CURRICULUM.topics.length, skills: Object.keys(st.skills || {}).filter(c => SKILLS[c]).length, skillsTotal: CURRICULUM.skills.length };
}

export function studentStats(st, n = 7){
  const days = lastDaysOf(st, n);
  const sec = days.reduce((s, d) => s + d.sec, 0);
  const ok = days.reduce((s, d) => s + d.ok, 0);
  const bad = days.reduce((s, d) => s + d.bad, 0);
  const active = days.filter(d => d.sec > 0 || d.ok + d.bad > 0).length;
  const lessons = LESSONS.map(l => {
    const p = st.lessonProgress?.[l.id] || {};
    return { l, p, parts: PARTS.filter(ex => p[ex]).length, done: isLessonComplete(l, st), wrong: st.lessonWrong?.[l.id] || 0 };
  });
  const hard = mistakeList(st).sort((a, b) => b.m.wrong - a.m.wrong);
  const si = streakOf(st);
  const allKeys = Object.keys(st.activity || {}).sort();
  const all = allKeys.map(k => ({ key: k, ...st.activity[k] }));
  const allSec = all.reduce((s, d) => s + (d.sec || 0), 0), allOk = all.reduce((s, d) => s + (d.ok || 0), 0), allBad = all.reduce((s, d) => s + (d.bad || 0), 0);
  const xp = st.xp || 0, level = levelFromXp(xp);
  return {
    n, days, goal: goalOf(st), metDays: days.filter(d => d.goalMet).length, streak: si.streak, best: si.best, freezes: si.freezes,
    sec, min: minutes(sec), ok, bad, total: ok + bad, pct: pctOf(ok, bad), active, lessons, hard,
    checkpoints: CHECKPOINTS.map(cp => ({ cp, r: st.checkpoints?.[cp.id] || null })),
    lessonsDone: lessons.filter(x => x.done).length,
    xp, level, maxLevel: MAX_LEVEL, rank: rankFor(level), gold: st.gold || 0, mastered: st.mastered || 0,
    collected: Object.keys(st.inventory || {}).length,
    skills: skillStats(st), coverage: curriculumCoverage(st),
    allTime: { days: all, sec: allSec, min: minutes(allSec), ok: allOk, bad: allBad, pct: pctOf(allOk, allBad),
      activeDays: all.filter(d => d.sec > 0 || (d.ok || 0) + (d.bad || 0) > 0).length, first: allKeys[0] || null, last: allKeys[allKeys.length - 1] || null },
  };
}

// Короткий текстовый отчёт для мессенджера
export function reportText(st, who = '', s = studentStats(st), extra = []){
  const d = new Date();
  const lines = [`English Quest — отчёт${who ? ` · ${who}` : ''} на ${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`];
  lines.push(`За ${s.n} дней: ${s.min} мин, занятия в ${s.active} из ${s.n} дней`);
  lines.push(s.total ? `Ответов: ${s.total}, верных ${s.pct}%` : 'Ответов за неделю нет');
  lines.push(`Цель дня ${s.goal} мин: выполнена в ${s.metDays} из ${s.n} дней, серия ${s.streak} (рекорд ${s.best}), заморозок ${s.freezes}`);
  const started = s.lessons.filter(x => x.parts > 0);
  if (started.length) lines.push(`Темы в работе: ${started.map(x => `${x.l.title} (${x.parts}/${PARTS.length})`).join(', ')}`);
  const worst = s.lessons.filter(x => x.wrong > 0).sort((a,b) => b.wrong - a.wrong).slice(0, 3);
  if (worst.length) lines.push(`Больше всего ошибок: ${worst.map(x => `${x.l.title} (${x.wrong})`).join(', ')}`);
  const words = s.hard.filter(x => x.m.type === 'word').slice(0, 8).map(x => x.data.word.en);
  if (words.length) lines.push(`Трудные слова: ${words.join(', ')}`);
  const weak = s.skills.filter(x => x.weak).slice(0, 3);
  if (weak.length) lines.push(`Грамматика, над чем поработать: ${weak.map(x => `${x.skill.title} (${x.pct}%${x.wrong[0] ? `, путает: ${x.wrong[0][0]}` : ''})`).join('; ')}`);
  if (st.mastered) lines.push(`Выучено после ошибок: ${st.mastered}`);
  lines.push(...extra);
  const cpsDone = CHECKPOINTS.filter(cp => st.checkpoints?.[cp.id]?.passedAt);
  if (cpsDone.length) lines.push(`Сданы проверки: ${cpsDone.map(cp => `${cp.grade} кл. ч.${cp.part} (${st.checkpoints[cp.id].best}/${CHECKPOINT_SIZE})`).join(', ')}`);
  const hw = st.homework, hl = hw && LESSONS.find(l => l.id === hw.lessonId);
  if (hl) lines.push(`Домашнее задание: ${hl.title} — ${hw.tasks.map(ex => `${EX_NAMES[ex].replace(/^\S+\s/, '')} ${homeworkDone(st, hw, ex) ? '✓' : '—'}`).join(', ')}${hw.due ? ` (срок ${fmtDay(hw.due)})` : ''}`);
  return lines.join('\n');
}

// Домашнее задание (тот же формат, что в приложении — см. homework.js)
export function makeHomeworkFor(st, { lessonId, tasks, due, note }){
  return {
    id: [lessonId, tasks.join(','), due || '', note || ''].join('|'),
    lessonId, tasks, due: due || '', note: note || '',
    assigned: Date.now(),
    // что уже было сделано до задания — считаем только новые прохождения
    baseline: Object.fromEntries(tasks.map(ex => [ex, st.lessonProgress?.[lessonId]?.[ex] || 0])),
    doneAt: null,
  };
}
