#!/usr/bin/env node
// Типы ошибок, мастерство, квесты и достижения (js/stats.js) без браузера: классификация ответа, похожие слова,
// уровень освоения с учётом давности, старый прогресс без новых полей.
//   node tests/mastery.mjs
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import vm from 'node:vm';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(readFileSync(join(ROOT, 'content.js'), 'utf8'), ctx);
if (existsSync(join(ROOT, 'packs.js'))) vm.runInContext(readFileSync(join(ROOT, 'packs.js'), 'utf8'), ctx);   // подключённые пакеты локаций — как на сайте
globalThis.window = ctx.window;   // js/eq.js берёт контент из window.EQ
const S = await import(join(ROOT, 'js/stats.js'));
const A = await import(join(ROOT, 'js/aipack.js'));
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

// своя клиника (итерация 4): материалы — из пройденных квестов, построенное — в st.clinic
{
  const { LESSONS, CLINIC_PRIZE, CLINIC_ROOMS, CLINIC_FURNITURE, SECRET_REGIONS } = ctx.window.EQ;
  const all = LESSONS.flatMap(l => S.lessonQuests(l).map(q => ({ key: S.questKey(l, q.kind), rarity: q.rarity })));
  const passedOf = (rarity, n) => Object.fromEntries(all.filter(q => q.rarity === rarity).slice(0, n).map(q => [q.key, { best: 100, runs: 1, passedAt: 1 }]));
  const empty = S.clinicState(fresh());
  check('клиника: у нового игрока материалов нет', Object.values(empty.have).every(v => v === 0), empty.have);
  check('клиника: приёмная построена с начала', empty.rooms[0].state === 'built' && empty.built === 1);
  check('клиника: остальные закрыты, секретная — «Шахты»', empty.rooms.slice(1, -1).every(r => r.state === 'locked') && empty.rooms.at(-1).state === 'secret');
  check('клиника: старый прогресс без поля clinic', S.clinicState({ quests: passedOf('common', 2) }).have.blocks === 2 * CLINIC_PRIZE.common.blocks);
  const st = fresh({ quests: { ...passedOf('common', 4), ...passedOf('rare', 3), ...passedOf('epic', 1) } });
  const cs = S.clinicState(st);
  check('клиника: материалы по редкости', cs.have.blocks === 4 * CLINIC_PRIZE.common.blocks && cs.have.boards === 4 * CLINIC_PRIZE.common.boards + 3 * CLINIC_PRIZE.rare.boards
    && cs.have.glass === 3 * CLINIC_PRIZE.rare.glass + CLINIC_PRIZE.epic.glass, cs.have);
  check('клиника: мебель за редкие квесты', cs.furniture.length === 3 && cs.furniture[0].id === CLINIC_FURNITURE[0].id);
  const aviary = cs.rooms.find(r => r.room.id === 'aviary');
  check('клиника: эпический квест открыл рецепт', aviary.state === 'building' && aviary.recipe);
  const poor = fresh({ quests: { ...passedOf('common', 2), ...passedOf('epic', 1) } });
  check('клиника: не хватает блоков — строить нельзя', !S.clinicState(poor).rooms.find(r => r.room.id === 'aviary').canBuild && S.buildRoom(poor, 'aviary') === null);
  check('клиника: закрытую комнату построить нельзя', S.buildRoom(st, 'surgery') === null);
  const rich = fresh({ quests: { ...passedOf('common', 10), ...passedOf('epic', 1) } });
  const built = S.buildRoom(rich, 'aviary', 777);
  check('клиника: хватает материалов — комната строится', built?.aviary === 777, built);
  const after = S.clinicState({ ...rich, clinic: built });
  const cost = CLINIC_ROOMS.find(r => r.id === 'aviary').cost;
  check('клиника: материалы списаны по рецепту', after.have.blocks === 10 * CLINIC_PRIZE.common.blocks - cost.blocks && after.built === 2, after.have);
  check('клиника: повторно ту же комнату не построить', S.buildRoom({ ...rich, clinic: built }, 'aviary') === null);
  const mines = SECRET_REGIONS.find(r => r.id === 'mines');
  const cr = S.clinicState(fresh({ quests: { ...passedOf('rare', 10), 'mines:entry': { best: 90, passedAt: 1 }, 'mines:deep': { best: 90, passedAt: 1 } } }));
  check('клиника: кристаллы — за места Шахт', cr.have.crystals === mines.locations.find(l => l.id === 'entry').crystals + mines.locations.find(l => l.id === 'deep').crystals, cr.have);
  check('клиника: Шахты открыты — секретная комната строится', cr.rooms.at(-1).state === 'building');
  check('клиника: помощник за босса Шахт', cr.helpers.find(h => h.minesBoss).got);
  const g2 = LESSONS.filter(l => l.grade === 2).sort((a, b) => a.order - b.order);
  const pt = S.clinicState(fresh({ lessonProgress: { [g2[0].id]: Object.fromEntries(S.PARTS.map(k => [k, 3])) }, checkpoints: { 'g2-p1': { best: 8, passedAt: 1 } } }));
  check('клиника: пройденная тема — вылеченный пациент', pt.cured >= 1 && pt.patients.find(p => p.grade === 2).list[0].cured);
  check('клиника: помощник Луна за первого босса', pt.helpers[0].got && !pt.helpers[1].got);
  check('клиника: приз квеста называет мебель', S.prizeLine('rare', fresh()).includes(CLINIC_FURNITURE[0].title.toLowerCase()));
  check('клиника: приз эпического — к рецепту', S.prizeLine('epic', fresh()).includes('рецепт'));
  check('клиника: строка для родителя', /Клиника: комнат 1 из \d+/.test(S.clinicLine(fresh())) && S.reportText(fresh()).includes('Клиника:'));
}

// дополнения итерации 2: коды ошибок, карта пробелов, граф навыков как условие открытия
{
  const { LESSONS, ERROR_CODES, CURRICULUM } = ctx.window.EQ;
  check('коды: все навыки карты программы распределены по кодам', CURRICULUM.skills.every(k => ERROR_CODES.some(c => (c.when.skills || []).includes(k.code))));
  check('коды: на слух — L1 при любом типе', S.errorCodeOf({ exercise: 'listen', error: 'similar' }) === 'L1');
  check('коды: навык важнее типа (am/is/are → B1)', S.errorCodeOf({ exercise: 'grammar', error: 'form', skill: 'G2-01' }) === 'B1');
  check('коды: прошедшее время → V5', S.errorCodeOf({ skill: 'G4-07' }) === 'V5');
  check('коды: похожие слова → W2, буквы → R1, текст → R2, порядок → O1',
    S.errorCodeOf({ error: 'similar' }) === 'W2' && S.errorCodeOf({ error: 'spelling' }) === 'R1' && S.errorCodeOf({ error: 'meaning' }) === 'R2' && S.errorCodeOf({ exercise: 'build', error: 'form' }) === 'O1');
  const none = S.errorGaps(fresh());
  check('пробелы: у нового игрока пробелов нет', !none.gaps.length && none.groups.every(g => g.state === 'none'));
  const L = LESSONS.find(l => l.grammar.some(q => q.skill === 'G2-01')), gq = L.grammar.find(q => q.skill === 'G2-01');
  const mk = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [`word:${L.id}:${L.words[i].en}`, { type: 'word', lessonId: L.id, ref: L.words[i].en, wrong: 1, box: 0, due: 0, last: NOW, ex: 'listen', lastErr: 'unknown', code: 'L1' }]));
  const g3 = S.errorGaps(fresh({ mistakes: mk(3) }));
  check('пробелы: 3 карточки на слух — пробел L1', g3.gaps[0]?.code === 'L1' && g3.groups.find(g => g.id === 'ear').state === 'gap', g3.gaps);
  check('пробелы: 1 карточка — «следим»', S.errorGaps(fresh({ mistakes: mk(1) })).codes.find(c => c.code === 'L1').state === 'watch');
  check('пробелы: были ошибки, всё выучено — «исправлено»', S.errorGaps(fresh({ errorCodes: { L1: 4 } })).codes.find(c => c.code === 'L1').state === 'fixed');
  const weak = S.errorGaps(fresh({ skills: { 'G2-01': { ok: 1, bad: 3, last: Date.now() } } }));
  check('пробелы: слабый навык — пробел даже без карточек', weak.codes.find(c => c.code === 'B1').state === 'gap' && weak.codes.find(c => c.code === 'B1').weak.length === 1);
  check('пробелы: старый прогресс — ошибки по словам видны', S.errorGaps(fresh({ words: { cat: { ok: 1, bad: 2, err: { similar: 2 } } } })).codes.find(c => c.code === 'W2').total === 2);
  check('пробелы: старая карточка без кода — по навыку вопроса', S.mistakeCode({ type: 'grammar', lessonId: L.id, ref: gq.q, lastErr: 'form', ex: 'grammar' }) === 'B1');
  check('пробелы: записанное и старое не складываются', S.errorGaps(fresh({ errorCodes: { W2: 3 }, words: { cat: { ok: 0, bad: 2, err: { similar: 2 } } } })).codes.find(c => c.code === 'W2').total === 3);
  check('отчёт: строка о пробелах', S.reportText(fresh({ mistakes: mk(3) })).includes('Пробелы: Не узнаёт слово на слух (L1)'));
  // граф навыков
  const dayoff = LESSONS.find(l => l.id === 'g3-dayoff');   // Present Continuous, опора — to be (G2-01)
  check('граф: опора не тренировалась — тема открыта', S.skillGate(dayoff, fresh()) === null);
  check('граф: слабая опора закрывает тему', S.skillGate(dayoff, fresh({ skills: { 'G2-01': { ok: 1, bad: 3, last: Date.now() } } }))?.code === 'G2-01');
  check('граф: мало ответов — не закрывает', S.skillGate(dayoff, fresh({ skills: { 'G2-01': { ok: 0, bad: 2, last: Date.now() } } })) === null);
  check('граф: подтянутый навык открывает', S.skillGate(dayoff, fresh({ skills: { 'G2-01': { ok: 6, bad: 3, last: Date.now() } } })) === null);
  check('граф: свой навык темы не закрывает её саму', S.skillGate(L, fresh({ skills: { 'G2-01': { ok: 0, bad: 5, last: Date.now() } } }))?.code !== 'G2-01');
  const block = S.checkpointsOf(3)[0].lessons, own = S.lessonSkills(block[0])[0];
  check('граф: босс закрыт, пока слаб навык его части', !own || S.skillGate(block, fresh({ skills: { [own]: { ok: 0, bad: 4, last: Date.now() } } }), { own: true })?.code === own);
  check('граф: вопросы для тренировки навыка', S.skillItems('G2-01', 3).length >= 6 && S.skillItems('G2-01', 3).every(x => x.q.skill === 'G2-01'));
}

// посылки от Dr. Harlow (итерация 5): формат, состояние, выгрузка без имени
{
  const ex = JSON.parse(readFileSync(join(ROOT, 'docs/ai-pack/example-parcel.json'), 'utf8'));
  const P = patch => ({ ...JSON.parse(JSON.stringify(ex)), ...patch });
  const errs = p => A.validateParcel(p);
  check('посылка: образец из docs проходит проверку', !errs(ex).length, errs(ex));
  check('посылка: неверный format', errs(P({ format: 'x' })).some(e => /format/.test(e)));
  check('посылка: id с пробелами', errs(P({ id: 'Cat cap' })).some(e => /id/.test(e)));
  check('посылка: без приза', errs(P({ reward: null })).some(e => /reward/.test(e)));
  check('посылка: больше 3 квестов', errs(P({ quests: [ex.quests[0], ex.quests[1], { ...ex.quests[1], id: 'b' }, { ...ex.quests[1], id: 'c' }] })).some(e => /от 1 до 3/.test(e)));
  const q0 = ex.quests[0];
  check('посылка: мало слов', errs(P({ quests: [{ ...q0, words: q0.words.slice(0, 3) }] })).some(e => /не меньше 4/.test(e)));
  check('посылка: нет объяснения к неверному варианту', errs(P({ quests: [{ ...q0, grammar: [{ ...q0.grammar[0], why: { cat: 'нет' } }] }] })).some(e => /why/.test(e)));
  check('посылка: неизвестный код ошибки', errs(P({ quests: [{ ...q0, focus: ['Z9'] }] })).some(e => /focus/.test(e)));
  check('посылка: неизвестный навык', errs(P({ quests: [{ ...ex.quests[1], grammar: [{ ...ex.quests[1].grammar[0], skill: 'G9-99' }, ...ex.quests[1].grammar.slice(1)] }] })).some(e => /G9-99/.test(e)));
  check('посылка: повтор id квеста', errs(P({ quests: [q0, { ...ex.quests[1], id: q0.id }] })).some(e => /не повторяется/.test(e)));
  check('посылка: не JSON — null', A.parseParcel('{oops') === null);
  // в прогрессе
  const st = fresh({ parcels: A.addParcel(fresh(), ex, 1000) });
  let list = A.parcelsOf(st);
  check('посылка: в прогрессе, не пройдена', list.length === 1 && !list[0].done && list[0].left === 2);
  st.quests[A.specialKey(ex, ex.quests[0])] = { best: 85, passedAt: 2000 };
  st.quests[A.specialKey(ex, ex.quests[1])] = { best: 60 };
  check('посылка: 80% — квест пройден, 60% — нет', A.parcelsOf(st)[0].left === 1);
  st.quests[A.specialKey(ex, ex.quests[1])] = { best: 100, passedAt: 3000 };
  list = A.parcelsOf(st);
  check('посылка: все квесты — посылка пройдена, дата — последний квест', list[0].done && list[0].doneAt === 3000);
  check('посылка: отозванная не видна', !A.parcelsOf(fresh({ parcels: { [ex.id]: { pack: ex, sent: 1, withdrawn: 5 } } })).length);
  check('посылка: испорченная не видна', !A.parcelsOf(fresh({ parcels: { x: { pack: { ...ex, quests: [] }, sent: 1 } } })).length);
  const again = A.addParcel({ parcels: { [ex.id]: { pack: ex, sent: 1000, opened: 1500 } } }, { ...ex, title: 'Новая' }, 9000);
  check('посылка: тот же id заменяет содержимое, отправка и открытие сохраняются', again[ex.id].pack.title === 'Новая' && again[ex.id].sent === 1000 && again[ex.id].opened === 1500);
  const many = {}; for (let i = 0; i < A.PARCEL_KEEP + 3; i++) many[`old-${i}`] = { pack: { ...ex, id: `old-${i}` }, sent: i, withdrawn: 1 };
  check('посылка: старые отозванные сверх лимита уходят', Object.keys(A.addParcel({ parcels: many }, ex, 99999)).length <= A.PARCEL_KEEP + 1);
  // выгрузка
  const exp = A.aiExport(fresh({ skills: { 'G2-01': { ok: 1, bad: 3, last: Date.now(), wrong: { are: 2 } } }, words: { cat: { ok: 1, bad: 2, err: { similar: 2 }, with: { cap: 2 } } } }), { student: 's123' });
  check('выгрузка: формат, код ученика, класс', exp.format === A.EXPORT_FORMAT && exp.student === 's123' && exp.grade === 2);
  check('выгрузка: пробелы, навыки, путаница', exp.gaps.some(g => g.code === 'B1' && g.state === 'gap') && exp.skills[0].wrongChoices[0].option === 'are' && exp.hardWords.some(w => w.en === 'cat' && w.confusedWith.includes('cap')));
  const txt = JSON.stringify(exp);
  check('выгрузка: без имени и личных данных', !/name|avatar|activity|email/i.test(Object.keys(exp).join(',')) && !txt.includes('Лёва'));
  check('шаблон: задание + выгрузка', A.promptWithExport(exp).startsWith(A.AI_PROMPT) && A.promptWithExport(exp).includes('"student": "s123"') && A.AI_PROMPT.includes(A.PARCEL_FORMAT));
}

// вступительное испытание (страж ворот): адаптивное, docs/concept-entry-test-and-key.md, раздел 6
{
  const { PLACEMENT } = ctx.window.EQ;
  // прогон: ok(part) — сдаёт ли игрок часть; возвращает ответы и порядок частей
  const run = (g, ok) => { const answers = [], order = [], used = new Set(); let p;
    while ((p = S.placementNext(g, answers)) != null){ order.push(p); const items = S.placementPart(g, p, used); items.forEach(x => x.skill && used.add(x.skill));
      items.forEach((x, i) => answers.push({ part: p, ok: ok(p) ? i < PLACEMENT.pass : i < 1, skill: x.skill || null })); }
    return { answers, order }; };
  for (const g of S.GRADES){
    const n = S.placementParts(g).length;
    for (let p = 0; p < n; p++){
      const it = S.placementPart(g, p);
      check(`испытание ${g} кл., часть ${p + 1}: 4 задания — слово, «послушай» и 2 на навык`, it.length === PLACEMENT.perPart && it[0].type === 'word' && it[1].type === 'listen' && it.filter(x => x.skill).length === 2 && (new Set(it.filter(x => x.skill).map(x => x.skill)).size === 1 || S.placementParts(g)[p].length < 4), it.map(x => x.type + ':' + (x.skill || '')));
    }
    const allOk = run(g, () => true), noneOk = run(g, () => false);
    check(`испытание ${g} кл.: начинается с середины`, allOk.order[0] === Math.floor((n - 1) / 2));
    check(`испытание ${g} кл.: не больше ${PLACEMENT.maxTasks} заданий`, allOk.answers.length <= PLACEMENT.maxTasks && noneOk.answers.length <= PLACEMENT.maxTasks && allOk.answers.length >= 12, [allOk.answers.length, noneOk.answers.length]);
    check(`испытание ${g} кл.: всё верно — вверх, старт с последней темы`, allOk.order[1] > allOk.order[0] && S.placementResult(g, allOk.answers).startIdx === S.lessonsOf(g).length - 1, allOk.order);
    check(`испытание ${g} кл.: всё неверно — вниз, старт с первой темы`, noneOk.order[1] < noneOk.order[0] && S.placementResult(g, noneOk.answers).startIdx === 0, noneOk.order);
  }
  const g = 3, ls = S.lessonsOf(g);
  const mid = run(g, p => p <= 2);   // сданы части 1–3
  const r = S.placementResult(g, mid.answers);
  check('испытание: граница между сданной и несданной частью — старт с части 4', r.startIdx === 12 && r.start === ls[12].id, { order: mid.order, startIdx: r.startIdx });
  const used = new Set(), skillsPerPart = mid.order.map(p => { const it = S.placementPart(g, p, used); it.forEach(x => x.skill && used.add(x.skill)); return it.find(x => x.skill)?.skill; });
  check('испытание: навыки частей не повторяются, если есть другие', new Set(skillsPerPart).size === skillsPerPart.length, skillsPerPart);
  const ans = (pairs) => pairs.map(([skill, ok]) => ({ part: 0, ok, skill }));
  const sk = S.placementResult(g, [...ans([['G3-01', true], ['G3-01', true], ['G2-01', true], ['G2-01', false], ['G3-02', false], ['G3-02', false]])]).skills;
  check('испытание: навыки — освоено / проверим в игре / учим', sk['G3-01'] === 'mastered' && sk['G2-01'] === 'check' && sk['G3-02'] === 'learn', sk);
  const st = fresh({ placement: r });
  check('испытание: темы до стартовой открыты, дальше — нет', S.placementOpens(st, ls[0]) && S.placementOpens(st, ls[12]) && !S.placementOpens(st, ls[13]));
  check('испытание: другой класс и пропуск не открывают', !S.placementOpens(st, S.lessonsOf(2)[3]) && !S.placementOpens(fresh({ placement: { skipped: 1 } }), ls[1]));
  check('испытание: строка для родителя с навыками', /Вступительное испытание: 3 класс, верно \d+ из \d+/.test(S.placementLine(st)) && S.reportText(st).includes('Вступительное испытание'), S.placementLine(st));
  check('испытание: пропуск — в строке', S.placementLine(fresh({ placement: { skipped: 1 } })) === 'Вступительное испытание: пропущено');
  check('испытание: «один класс» — совета на другой класс нет', !('prev' in r));
}

console.log(`\n${total - fail} из ${total} проверок мастерства, квестов и достижений прошли`);
process.exit(fail ? 1 : 0);
