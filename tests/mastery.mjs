#!/usr/bin/env node
// Типы ошибок, мастерство, квесты и достижения (js/stats.js) без браузера: классификация ответа, похожие слова,
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

// квесты: редкость, открытие по мастерству, достижения
{
  const { LESSONS, questRarity, QUEST_RARITY, ACHIEVEMENTS } = ctx.window.EQ;
  const L = LESSONS.find(l => l.id === 'g2-letters'), L3 = LESSONS.find(l => l.grade === 3);
  check('редкость по карте программы: 2-E — эпический, 2-C — редкий, 3-A — обычный, 4-A — редкий',
    questRarity('picture', 2) === 'epic' && questRarity('spell', 2) === 'rare' && questRarity('fill', 3) === 'common' && questRarity('reading', 4) === 'rare');
  check('редкость по формату, если в карте нет: слова — обычный, грамматика — редкий, «Говори» — эпический',
    questRarity('vocab', 3) === 'common' && questRarity('grammar', 2) === 'rare' && questRarity('speak', 4) === 'epic');
  check('у каждого квеста — известная редкость', LESSONS.every(l => S.lessonQuests(l).every(q => QUEST_RARITY.some(r => r.id === q.rarity))));
  const pass = (...kinds) => Object.fromEntries(kinds.map(k => [`g2-letters:${k}`, { best: 100, runs: 1, passedAt: 1 }]));
  check('обычный открыт всегда', S.questLock(L, 'vocab', fresh()) === null);
  check('редкий закрыт без обычных', S.questLock(L, 'spell', fresh()) !== null);
  check('редкий: один обычный на 80% — мало', S.questLock(L, 'spell', fresh({ quests: pass('vocab') })) !== null);
  check('редкий: «Карточки» не считаются', S.questLock(L, 'spell', fresh({ quests: pass('cards', 'vocab') })) !== null);
  check('редкий: два обычных на 80% — открыт', S.questLock(L, 'spell', fresh({ quests: pass('vocab', 'listen') })) === null);
  check('79% — не пройден', S.questLock(L, 'spell', fresh({ quests: { ...pass('vocab'), 'g2-letters:listen': { best: 79 } } })) !== null);
  check('эпический закрыт, пока редкие не пройдены', S.questLock(L, 'reading', fresh({ quests: pass('vocab', 'listen') })) !== null);
  check('эпический открыт после редких', S.questLock(L, 'reading', fresh({ quests: pass('vocab', 'listen', 'spell', 'grammar') })) === null);
  const LS = LESSONS.find(l => l.grade === 2 && l.grammar.some(q => q.skill));
  const skills = Object.fromEntries([...new Set(LS.grammar.map(q => q.skill).filter(Boolean))].map(c => [c, { ok: 5, bad: 0, last: Date.now() }]));
  const passLS = Object.fromEntries(['vocab', 'listen'].map(k => [`${LS.id}:${k}`, { best: 100, runs: 1, passedAt: 1 }]));
  check('эпический открыт, если навыки темы освоены', S.questLock(LS, 'reading', fresh({ quests: passLS, skills })) === null);
  check('…и закрыт, если навыки не освоены', S.questLock(LS, 'reading', fresh({ quests: passLS })) !== null);
  check('начатое не закрывается', S.questLock(L, 'reading', fresh({ lessonProgress: { 'g2-letters': { reading: 1 } } })) === null);
  check('домашнее задание открыто', S.questLock(L, 'reading', fresh({ homework: { lessonId: 'g2-letters', tasks: ['reading'] } })) === null);
  check('репетитор открыл всё', S.questLock(L, 'reading', fresh({ settings: { unlockAll: true } })) === null);
  check('другая тема — свои замки', S.questLock(L3, 'grammar', fresh({ quests: pass('vocab', 'listen') })) !== null);
  const c = S.questCounts(fresh({ quests: pass('vocab', 'listen', 'spell'), checkpoints: { 'g2-p1': { best: 8, passedAt: 1 } } }));
  check('счёт квестов по редкости и боссы', c.quests === 3 && c.common === 2 && c.rare === 1 && c.bosses === 1 && c.legendary === 1, c);
  check('проверки только по полным блокам из 4 тем', S.CHECKPOINTS.every(cp => cp.lessons.length === 4) && c.bossesTotal === 12, c.bossesTotal);
  const ach = S.achievementsOf(fresh({ quests: pass('vocab', 'listen', 'spell'), checkpoints: { 'g2-p1': { best: 8, passedAt: 1 } }, mastered: 1 }));
  check('достижения по прогрессу', ['first-quest', 'first-rare', 'first-boss', 'mistake-1'].every(id => ach.includes(id)) && !ach.includes('first-epic') && !ach.includes('bosses-all'), ach);
  check('достижения: id уникальны, редкость известна', new Set(ACHIEVEMENTS.map(a => a.id)).size === ACHIEVEMENTS.length && ACHIEVEMENTS.every(a => QUEST_RARITY.some(r => r.id === a.rarity)));
  check('пустой прогресс — без достижений', S.achievementsOf(fresh()).length === 0);
}

// квест-реванш: отбор и формат на ступень проще
{
  const { LESSONS } = ctx.window.EQ, L = LESSONS.find(l => l.id === 'g2-family');
  const mk = (n, extra = {}) => Object.fromEntries(L.words.slice(0, n).map((w, i) => [`word:${L.id}:${w.en}`, { type: 'word', lessonId: L.id, ref: w.en, wrong: i + 1, box: 0, due: 0, last: 100 + i, ...extra }]));
  check('реванш: 4 трудных — рано', !S.revengeReady(fresh({ mistakes: mk(4) })));
  check('реванш: 5 трудных — готов', S.revengeReady(fresh({ mistakes: mk(5) })));
  const items = S.revengeItems(fresh({ mistakes: mk(9) }));
  check('реванш: не больше 7, сначала с большим числом ошибок', items.length === 7 && items[0].m.wrong === 9, items.map(x => x.m.wrong));
  check('реванш: отвеченное верно не возвращается без новой ошибки', !S.revengeReady(fresh({ mistakes: mk(5, { rv: 500 }) })));
  check('реванш: после новой ошибки — снова в реванше', S.revengeReady(fresh({ mistakes: mk(5, { rv: 50 }) })));
  check('реванш: чтение не берётся', !S.revengeReady(fresh({ mistakes: { ...mk(4), r: { type: 'reading', lessonId: L.id, ref: L.reading.questions[0].q, wrong: 3, box: 0, due: 0, last: 1 } } })));
  check('формат: «Напиши» → выбрать слово', S.revengeFormat({ type: 'word', ex: 'spell' }) === 'pick-word');
  check('формат: «Слова» → на слух', S.revengeFormat({ type: 'word', ex: 'vocab' }) === 'listen');
  check('формат: «Слушай» → на слух из двух', S.revengeFormat({ type: 'word', ex: 'listen' }) === 'listen2');
  check('формат: старая ошибка без упражнения → на слух', S.revengeFormat({ type: 'word' }) === 'listen');
  check('формат: грамматика → из двух', S.revengeFormat({ type: 'grammar' }) === 'grammar2');
  check('достижение за реванш', S.achievementsOf(fresh({ revengeWins: 1 })).includes('revenge-1'));
}

// секретный регион «Шахты»
{
  const { LESSONS, SECRET_REGIONS } = ctx.window.EQ, R = SECRET_REGIONS.find(r => r.id === 'mines');
  const g2 = LESSONS.filter(l => l.grade === 2).sort((a, b) => a.order - b.order);
  const rares = n => Object.fromEntries(g2.slice(0, Math.ceil(n / 2)).flatMap(l => ['spell', 'grammar'].map(k => [`${l.id}:${k}`, { best: 100, runs: 1, passedAt: 1 }])).slice(0, n));
  const done = Object.fromEntries(g2.slice(0, 2).map(l => [l.id, { vocab: 3, listen: 3, grammar: 2, reading: 1 }]));
  check('Шахты: данные — 4 места, последнее босс, условие 10 редких', R && R.locations.length === 4 && R.locations[3].boss && R.unlock.rare === 10);
  const closed = S.secretRegionState(R, fresh({ quests: rares(9) }));
  check('Шахты: 9 редких — скрыты, счётчик 9 из 10', !closed.open && closed.have === 9 && closed.need === 10, closed.have);
  const open = S.secretRegionState(R, fresh({ quests: rares(10), lessonProgress: done }));
  check('Шахты: 10 редких — открыты', open.open);
  check('Шахты: вопросы — из пройденных тем', open.pool.length === 2 && open.pool.every(l => done[l.id]));
  check('Шахты: три места открыты, босс закрыт', open.locations.filter(x => !x.lock).length === 3 && open.locations[3].lock);
  const three = Object.fromEntries(R.locations.slice(0, 3).map(l => [`mines:${l.id}`, { best: 90, passedAt: 1 }]));
  check('Шахты: босс открывается после трёх мест', !S.secretRegionState(R, fresh({ quests: { ...rares(10), ...three }, lessonProgress: done })).locations[3].lock);
  check('Шахты: без пройденных тем места закрыты', S.secretRegionState(R, fresh({ quests: rares(10) })).locations.every(x => x.lock));
  check('Шахты: секретное достижение за босса', S.achievementsOf(fresh({ quests: { 'mines:deep': { best: 90, passedAt: 1 } } })).includes('mines-boss'));
  check('Шахты: места не считаются обычными квестами', S.questCounts(fresh({ quests: three })).quests === 0);
}

console.log(`\n${total - fail} из ${total} проверок мастерства, квестов и достижений прошли`);
process.exit(fail ? 1 : 0);
