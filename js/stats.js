// English Quest — Статистика ученика по его прогрессу (без DOM и без глобального state).
// Общая для панели репетитора в приложении и для админ-панели (admin/), поэтому цифры везде одинаковые.
import { ACHIEVEMENTS, CLINIC_FURNITURE, CLINIC_HELPERS, CLINIC_PATIENTS, CLINIC_PRIZE, CLINIC_ROOMS, CHARACTERS, CURRICULUM, MATERIALS, ERROR_TYPES, LESSONS, MAX_LEVEL, QUEST_PASS_PCT, QUEST_RARITY, RANK_STEPS, REGIONS, SECRET_REGIONS, SKILLS, extraQuestOf, isNewItem, questRarity, buildItemsFor, fillItemsFor, levelFromXp, rankOf } from './eq.js';
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
  // только полные блоки по 4 темы — как на карте (mapNodes); хвост из 1–3 тем без проверки
  for (let i = 0; i + BLOCK <= ls.length; i += BLOCK){
    const part = i / BLOCK + 1;
    out.push({ id: `g${grade}-p${part}`, grade, part, lessons: ls.slice(i, i + BLOCK),
      emoji: part === 1 ? '💎' : '🏆', title: `Босс-проверка: ${grade} класс, часть ${part}` });
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
// ---------- квесты: редкость, открытие, результаты ----------
// state.quests['урок:упражнение'] = { best, last, runs, passedAt } — лучший и последний результат в %, первое прохождение на 80%
export const questKey = (lesson, kind) => `${lesson.id}:${kind}`;
export const rarityOf = id => QUEST_RARITY.find(r => r.id === id) || QUEST_RARITY[0];
export const questPassed = (st, lesson, kind) => (st.quests?.[questKey(lesson, kind)]?.best ?? -1) >= QUEST_PASS_PCT;
const SCORED = kind => kind !== 'cards';   // карточки — просмотр, без ответов
// Редкость квеста темы: у квеста из пакета — своя (или по его упражнению), у остальных — по типу задания
export function questRarityOf(lesson, kind){
  const x = extraQuestOf(lesson, kind);
  return x ? (x.rarity || questRarity(x.kind, lesson.grade)) : questRarity(kind, lesson.grade);
}
// Название квеста: «🧩 Грамматика» или у квеста из пакета — его эмодзи и название
export const questTitle = (lesson, kind) => { const x = extraQuestOf(lesson, kind); return x ? `${x.emoji || '✨'} ${x.title}` : EX_NAMES[kind]; };
// Новый квест из пакета: подключён меньше 14 дней назад и ещё не начат
export const questIsNew = (lesson, kind, st) => { const x = extraQuestOf(lesson, kind); return !!x && isNewItem(x.addedAt) && !st.quests?.[questKey(lesson, kind)] && !st.lessonProgress?.[lesson.id]?.[kind]; };
export function lessonQuests(l){
  const order = id => QUEST_RARITY.findIndex(r => r.id === id);
  const kinds = [...lessonExercises(l), ...(l.extraQuests || []).map(q => `x:${q.id}`)];
  return kinds.map(kind => ({ kind, rarity: questRarityOf(l, kind) })).sort((a, b) => order(a.rarity) - order(b.rarity));
}
// Почему квест закрыт; null — открыт. Начатое (есть прогресс или результат) не закрывается никогда.
//   редкий — после двух обычных квестов темы на 80% и выше;
//   эпический — когда все редкие квесты темы пройдены на 80% или освоены все её навыки.
export function questLock(lesson, kind, st){
  if (st.settings?.unlockAll) return null;
  if (st.lessonProgress?.[lesson.id]?.[kind] || st.quests?.[questKey(lesson, kind)]) return null;
  // домашнее задание от репетитора открыто всегда
  if (st.homework?.lessonId === lesson.id && (st.homework.tasks || []).includes(kind)) return null;
  const qs = lessonQuests(lesson), rarity = questRarityOf(lesson, kind);
  const passed = r => qs.filter(q => q.rarity === r && SCORED(q.kind) && questPassed(st, lesson, q.kind)).length;
  const scored = r => qs.filter(q => q.rarity === r && SCORED(q.kind)).length;
  const commonsOk = passed('common') >= Math.min(2, scored('common'));
  if (rarity === 'rare') return commonsOk ? null : `Пройди два обычных квеста этой темы на ${QUEST_PASS_PCT}%`;
  if (rarity === 'epic' || rarity === 'legendary'){
    if (!commonsOk) return `Пройди два обычных квеста этой темы на ${QUEST_PASS_PCT}%`;
    const skills = [...new Set((lesson.grammar || []).map(q => q.skill).filter(Boolean))];
    const skillsOk = skills.length && skills.every(c => masteryOf(st.skills?.[c] || {}).level === 'mastered');
    return passed('rare') >= scored('rare') || skillsOk ? null : `Пройди редкие квесты этой темы на ${QUEST_PASS_PCT}%`;
  }
  return null;
}
// Сколько квестов пройдено на 80% — всего и по редкости; боссы — сданные проверки
export function questCounts(st){
  const out = { quests: 0, common: 0, rare: 0, epic: 0, legendary: 0, bosses: 0, bossesTotal: CHECKPOINTS.length };
  for (const l of LESSONS) for (const q of lessonQuests(l)) if (questPassed(st, l, q.kind)){ out.quests++; out[q.rarity]++; }
  out.bosses = CHECKPOINTS.filter(cp => st.checkpoints?.[cp.id]?.passedAt).length;
  out.legendary += out.bosses;
  return out;
}
// Какие достижения выполнены по прогрессу (ACHIEVEMENTS в content.js)
export function achievementsOf(st){
  const c = questCounts(st), ranks = regionRanks(st), si = streakOf(st);
  const goalDays = Object.values(st.activity || {}).filter(d => d.goalMet).length;
  const words = wordStats(st).filter(w => w.level === 'mastered').length;
  const skills = skillStats(st).filter(x => x.level === 'mastered').length;
  const ok = w => {
    if (w.quests != null) return c.quests >= w.quests;
    if (w.rare != null) return c.rare >= w.rare;
    if (w.epic != null) return c.epic >= w.epic;
    if (w.bosses != null) return w.bosses === 'all' ? c.bosses >= c.bossesTotal : c.bosses >= w.bosses;
    if (w.goalDays != null) return goalDays >= w.goalDays;
    if (w.streak != null) return si.best >= w.streak;
    if (w.skills != null) return skills >= w.skills;
    if (w.words != null) return words >= w.words;
    if (w.mastered != null) return (st.mastered || 0) >= w.mastered;
    if (w.revenge != null) return (st.revengeWins || 0) >= w.revenge;
    if (w.minesBoss != null) return !!st.quests?.['mines:deep']?.passedAt;
    if (w.rank) return (ranks.find(r => r.region.id === w.rank[0])?.step || 0) >= w.rank[1];
    return false;
  };
  return ACHIEVEMENTS.filter(a => ok(a.when)).map(a => a.id);
}

// ---------- секретные регионы («Шахты») ----------
// Открытие — по условию региона (редкие квесты на 80%); квесты локаций — по пройденным темам.
// Результаты — в state.quests['регион:локация'], как у обычных квестов.
export const secretKey = (region, loc) => `${region.id}:${loc.id}`;
export function secretPool(st){
  const done = LESSONS.filter(l => isLessonComplete(l, st));
  return done.length >= 2 ? done : LESSONS.filter(l => Object.keys(st.lessonProgress?.[l.id] || {}).length);
}
export function secretRegionState(region, st){
  const have = questCounts(st).rare, need = region.unlock?.rare ?? 10;
  const open = have >= need || !!st.settings?.unlockAll;
  const pool = secretPool(st), words = pool.reduce((n, l) => n + l.words.length, 0);
  const passed = loc => (st.quests?.[secretKey(region, loc)]?.best ?? -1) >= QUEST_PASS_PCT;
  const locations = region.locations.map(loc => {
    const res = st.quests?.[secretKey(region, loc)] || null;
    let lock = null;
    if (!open) lock = 'Регион ещё скрыт';
    else if (words < loc.size) lock = 'Пройди хотя бы две темы — вопросы берутся из пройденных';
    else if (loc.boss && !region.locations.filter(x => !x.boss).every(passed)) lock = 'Сначала пройди остальные места Шахт';
    return { loc, res, passed: passed(loc), lock };
  });
  return { region, open, have: Math.min(have, need), need, pool, locations };
}

// ---------- своя клиника (итерация 4) ----------
// Всё заработанное считается из прогресса: первое прохождение квеста на 80% даёт материалы по редкости
// (CLINIC_PRIZE), испытание — блоки и помощника, места «Шахт» — кристаллы. В прогрессе хранится только
// st.clinic = { комната: когда построена } — поэтому слияние устройств безопасно, а старый прогресс сразу при деле.
export const clinicPrize = rarity => CLINIC_PRIZE[rarity] || CLINIC_PRIZE.common;
// Подпись приза для карточек квестов: «🧱 3 · 🪵 1» и т. п.
export const MAT_EMOJI = { blocks: '🧱', boards: '🪵', glass: '🪟', crystals: '💠' };
// st — чтобы назвать предмет мебели и комнату, к рецепту которой ведёт квест
export function prizeLine(rarity, st = null){
  const p = clinicPrize(rarity), parts = MATERIALS.filter(m => p[m.id]).map(m => `${MAT_EMOJI[m.id]} ${p[m.id]}`);
  const c = st && questCounts(st);
  if (p.furniture){ const f = c && CLINIC_FURNITURE[c.rare]; parts.push(f ? `${f.emoji} ${f.title.toLowerCase()}` : '🛋️ мебель'); }
  if (p.recipe){
    const room = c && CLINIC_ROOMS.find(r => r.recipe && r.recipe > c.epic);
    parts.push(room ? `📜 к рецепту «${room.title}» (${c.epic + 1} из ${room.recipe})` : '📜 рецепт комнаты');
  }
  if (p.helper) parts.push('🤝 помощник');
  return parts.join(' · ');
}
const minesPassed = (st, loc) => (st.quests?.[`mines:${loc.id}`]?.best ?? -1) >= QUEST_PASS_PCT;
export function clinicState(st){
  const c = questCounts(st), earned = { blocks: 0, boards: 0, glass: 0, crystals: 0 };
  const addP = (p, k = 1) => { for (const m of MATERIALS) earned[m.id] += (p[m.id] || 0) * k; };
  addP(CLINIC_PRIZE.common, c.common); addP(CLINIC_PRIZE.rare, c.rare); addP(CLINIC_PRIZE.epic, c.epic);
  addP(CLINIC_PRIZE.boss, c.bosses);
  const mines = SECRET_REGIONS.find(r => r.id === 'mines');
  for (const loc of mines?.locations || []) if (minesPassed(st, loc)) earned.crystals += loc.crystals || 0;
  const minesOpen = !!mines && secretRegionState(mines, st).open;
  const built = st.clinic || {};
  const spent = { blocks: 0, boards: 0, glass: 0, crystals: 0 };
  const rooms = CLINIC_ROOMS.map(room => {
    const isBuilt = !!room.built || !!built[room.id];
    if (isBuilt && !room.built) for (const [k, v] of Object.entries(room.cost || {})) spent[k] += v;
    const recipe = room.built || (room.mines ? minesOpen : c.epic >= (room.recipe || 0)) || !!st.settings?.unlockAll;
    return { room, built: isBuilt, recipe, host: CHARACTERS[room.host] || null };
  });
  const have = Object.fromEntries(MATERIALS.map(m => [m.id, Math.max(0, earned[m.id] - spent[m.id])]));
  for (const r of rooms){
    const cost = Object.entries(r.room.cost || {});
    r.need = cost.map(([k, v]) => ({ id: k, need: v, have: Math.min(v, have[k]) }));
    r.canBuild = !r.built && r.recipe && cost.every(([k, v]) => have[k] >= v);
    r.state = r.built ? 'built' : r.room.mines && !r.recipe ? 'secret' : !r.recipe ? 'locked' : 'building';
  }
  const furniture = CLINIC_FURNITURE.slice(0, c.rare);
  const minesBoss = !!st.quests?.['mines:deep']?.passedAt;
  const helpers = CLINIC_HELPERS.map(h => ({ ...h, hero: CHARACTERS[h.hero], got: h.minesBoss ? minesBoss : c.bosses >= h.bosses }));
  // пациенты: одна пройденная тема — один вылеченный, по регионам (классам)
  const patients = GRADES.map(g => {
    const ls = lessonsOf(g);
    return { grade: g, total: ls.length, list: ls.map((l, i) => ({ lesson: l, animal: CLINIC_PATIENTS[i % CLINIC_PATIENTS.length], cured: isLessonComplete(l, st) })) };
  });
  // альбом слов: освоенные слова из всех тем; по регионам — сколько слов в темах класса
  const mastered = new Set(wordStats(st).filter(w => w.level === 'mastered').map(w => w.en));
  const album = GRADES.map(g => { const ws = [...lessonWords().values()].filter(w => w.grade === g); return { grade: g, total: ws.length, got: ws.filter(w => mastered.has(w.en)).length }; });
  return { counts: c, earned, spent, have, rooms, furniture, helpers, patients, album, minesOpen,
    cured: patients.reduce((n, p) => n + p.list.filter(x => x.cured).length, 0),
    built: rooms.filter(r => r.built).length };
}
// Построить комнату: возвращает новое st.clinic или null, если нельзя
export function buildRoom(st, roomId, now = Date.now()){
  const r = clinicState(st).rooms.find(x => x.room.id === roomId);
  if (!r?.canBuild) return null;
  return { ...(st.clinic || {}), [roomId]: now };
}
// Строка для родителя
export function clinicLine(st, cs = clinicState(st)){
  const rooms = cs.rooms.filter(r => r.built).map(r => r.room.title);
  return `Клиника: комнат ${cs.built} из ${cs.rooms.length} (${rooms.join(', ')}), вылечено пациентов ${cs.cured}, мебели ${cs.furniture.length}, помощников ${cs.helpers.filter(h => h.got).length}`;
}

// ---------- квест-реванш ----------
// Накопилось REVENGE_MIN трудных слов и вопросов в «Моих ошибках» — на карте появляется реванш на самые трудные
// (до REVENGE_MAX). Задания — на ступень проще, чем там, где была ошибка (revengeFormat).
export const REVENGE_MIN = 5, REVENGE_MAX = 7;
// В реванш идут слова и вопросы грамматики; отвеченное в реванше верно (m.rv) возвращается туда только после новой ошибки
const revengeCandidates = st => mistakeList(st).filter(x => (x.m.type === 'word' || x.m.type === 'grammar') && !(x.m.rv && x.m.rv >= (x.m.last || 0)));
export function revengeItems(st){
  return revengeCandidates(st)
    .sort((a, b) => (b.m.wrong || 0) - (a.m.wrong || 0) || (b.m.last || 0) - (a.m.last || 0))
    .slice(0, REVENGE_MAX);
}
export const revengeReady = st => revengeCandidates(st).length >= REVENGE_MIN;
// Формат задания реванша: «Напиши» → выбрать слово по картинке; слова и прочее → услышать и выбрать картинку;
// «Слушай» → то же из двух картинок; грамматика → два варианта (верный и тот, что выбирал ребёнок)
export function revengeFormat(m){
  if (m.type === 'grammar') return 'grammar2';
  if (m.ex === 'spell') return 'pick-word';
  if (m.ex === 'listen') return 'listen2';
  return 'listen';
}

// ---------- ранги регионов ----------
// Ранг идёт по шагам подряд: 1 — пройдена хотя бы одна тема региона, 2 — сдана хотя бы одна проверка,
// 3 — сданы все проверки, 4 — пройдены все темы. Считается из прогресса, поэтому старый прогресс
// открывает ранги сам, а синхронизация ничего нового не хранит.
export function regionRanks(st){
  return REGIONS.map(region => {
    const ls = lessonsOf(region.grade), cps = checkpointsOf(region.grade);
    const done = ls.filter(l => isLessonComplete(l, st)).length;
    const passed = cps.filter(cp => st.checkpoints?.[cp.id]?.passedAt).length;
    const conds = [done > 0, passed > 0, cps.length > 0 && passed === cps.length, ls.length > 0 && done === ls.length];
    let step = 0;
    while (step < conds.length && conds[step]) step++;
    // полученное звание не теряется, даже если в регион добавили новые темы и проверки (пакеты локаций)
    step = Math.max(step, Math.min(4, st.rankSteps?.[region.id] || 0));
    return { region, step, rank: rankOf(region.id, step), next: rankOf(region.id, step + 1), nextNeed: RANK_STEPS[step] || null,
      done, lessons: ls.length, passed, checkpoints: cps.length };
  });
}
// Класс игрока для «Кто играет?»: регион, открытый на карте, иначе класс домашки, иначе старший класс с прогрессом
export function playerGrade(st){
  const g = +st.settings?.mapGrade;
  if (REGIONS.some(r => r.grade === g)) return g;
  const hw = st.homework && LESSONS.find(l => l.id === st.homework.lessonId);
  if (hw) return hw.grade;
  const started = LESSONS.filter(l => Object.keys(st.lessonProgress?.[l.id] || {}).length).map(l => l.grade);
  return started.length ? Math.max(...started) : REGIONS[0].grade;
}
// Звание для шапки и отчётов — самый высокий ранг в самом дальнем регионе, где он есть (null — пока ни одного)
export function topRank(st){ return [...regionRanks(st)].reverse().find(r => r.rank)?.rank || null; }

export const goalOf = st => GOAL_OPTIONS.includes(st.settings?.dailyGoal) ? st.settings.dailyGoal : 10;
export function homeworkDone(st, hw, ex){ return (st.lessonProgress?.[hw.lessonId]?.[ex] || 0) > (hw.baseline?.[ex] || 0); }

// Достаём из контента всё, что нужно для показа ошибки. null — если урок/слово удалены.
export function resolveMistake(m){
  const lesson = LESSONS.find(l => l.id === m.lessonId);
  if (!lesson) return null;
  // слова, вопросы и тексты темы и её квестов из пакетов
  const parts = [lesson, ...(lesson.extraQuests || [])];
  if (m.type === 'word'){
    for (const p of parts){ const w = (p.words || []).find(w => w.en === m.ref); if (w) return { lesson: p === lesson ? lesson : { ...lesson, words: p.words }, word: w }; }
    return null;
  }
  if (m.type === 'grammar'){
    for (const p of parts){ const q = (p.grammar || []).find(q => q.q === m.ref); if (q) return { lesson, q }; }
    return null;
  }
  if (m.type === 'reading'){
    for (const p of parts){ const q = p.reading?.questions.find(q => q.q === m.ref); if (q) return { lesson, q, reading: p.reading }; }
    return null;
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
    const m = masteryOf({ ok, bad, last: v.last });
    return { code, skill: SKILLS[code], ok, bad, pct, last: v.last || 0, wrong, weak: bad > 0 && (pct < SKILL_WEAK_PCT || bad >= 3),
      mastery: m.score, level: m.level, needs: (SKILLS[code].needs || []).filter(c => SKILLS[c]) };
  }).map((x, _, all) => {
    // опоры навыка (граф навыков): у слабого навыка взрослому видно, что проверить сначала
    x.needs = x.needs.map(c => ({ code: c, skill: SKILLS[c], level: all.find(y => y.code === c)?.level || 'new' }));
    return x;
  }).sort((a, b) => (b.weak - a.weak) || (a.weak ? a.pct - b.pct : 0) || a.code.localeCompare(b.code));
}
// ---------- типы ошибок ----------
const ERR_IDS = new Set(ERROR_TYPES.map(t => t.id));
export const errorType = id => ERROR_TYPES.find(t => t.id === id) || null;
// Расстояние Левенштейна (сколько букв поменять, вставить или убрать)
export function editDistance(a, b){
  a = String(a).toLowerCase(); b = String(b).toLowerCase();
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++){
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// Похожие слова: отличаются одной буквой (в длинных — двумя) или одно начинается с другого (dog / dogs)
export function similarWords(a, b){
  const x = String(a || '').toLowerCase().trim(), y = String(b || '').toLowerCase().trim();
  if (!x || !y || x === y) return false;
  const d = editDistance(x, y), len = Math.max(x.length, y.length);
  return d <= (len >= 6 ? 2 : 1) || (Math.min(x.length, y.length) >= 3 && (x.startsWith(y) || y.startsWith(x)) && d <= 2);
}
// Тип ошибки по ответу. type — word | grammar | reading; exercise — упражнение; chosen — выбранный вариант (нет — пропуск)
export function classifyError({ type, exercise, answer, chosen, skill } = {}){
  if (type === 'reading') return 'meaning';
  if (type === 'grammar' || skill) return 'form';
  if (exercise === 'spell') return 'spelling';
  if (chosen && similarWords(answer, chosen)) return 'similar';
  return 'unknown';
}
export const isErrorType = id => ERR_IDS.has(id);

// ---------- мастерство (слова и навыки) ----------
// Доля верных с поправкой на малое число ответов: (верно + 1) / (ответов + 2) — один верный ответ ещё не «освоено».
// Давность: ответ старше 14 дней весит меньше (до ×0,75 через 64 дня) — давно не повторяли, значит, могли забыть.
// Уровни: new — ответов не было, weak — до 50%, learning — до 80%, mastered — от 80% и не меньше 3 верных.
export const MASTERY_LEVELS = [
  { id: 'new', title: 'ещё не было' },
  { id: 'weak', title: 'трудное' },
  { id: 'learning', title: 'учим' },
  { id: 'mastered', title: 'освоено' },
];
export const levelTitle = id => MASTERY_LEVELS.find(l => l.id === id)?.title || id;
export function masteryOf({ ok = 0, bad = 0, last = 0 } = {}, now = Date.now()){
  if (!ok && !bad) return { score: null, level: 'new' };
  const days = last ? Math.max(0, (now - last) / 864e5) : 30;   // для старого прогресса без даты — «месяц назад»
  const fresh = days <= 14 ? 1 : Math.max(0.75, 1 - (days - 14) / 200);
  const score = (ok + 1) / (ok + bad + 2) * fresh;
  const level = score >= 0.8 && ok >= 3 ? 'mastered' : score >= 0.5 ? 'learning' : 'weak';
  return { score: Math.round(score * 100) / 100, level };
}
// Все слова уроков: en → { en, ru, emoji, grade, lessonId } (первое появление)
let _words = null;
export function lessonWords(){
  if (_words) return _words;
  _words = new Map();
  for (const l of [...LESSONS].sort((a, b) => a.grade - b.grade || a.order - b.order))
    for (const w of [...l.words, ...(l.extraQuests || []).flatMap(q => q.words || [])]) if (!_words.has(w.en)) _words.set(w.en, { ...w, grade: l.grade, lessonId: l.id });
  return _words;
}
// Мастерство по словам. st.words — ответы с этого обновления; у старого прогресса берём то, что уже было:
// верные — из коллекции слов (inventory), ошибки — из «Моих ошибок». Берётся большее, поэтому ничего не задваивается.
export function wordStats(st, now = Date.now()){
  const oldBad = {};
  for (const m of Object.values(st.mistakes || {})) if (m.type === 'word') oldBad[m.ref] = Math.max(oldBad[m.ref] || 0, m.wrong || 0);
  const out = [];
  for (const [en, w] of lessonWords()){
    const v = st.words?.[en] || {}, inv = st.inventory?.[en] || 0;
    const ok = Math.max(v.ok || 0, inv), bad = Math.max(v.bad || 0, oldBad[en] || 0);
    if (!ok && !bad) continue;
    const m = masteryOf({ ok, bad, last: v.last || 0 }, now);
    const err = Object.entries(v.err || {}).sort((a, b) => b[1] - a[1]);
    const withW = Object.entries(v.with || {}).sort((a, b) => b[1] - a[1]);
    out.push({ en, word: w, ok, bad, last: v.last || 0, score: m.score, level: m.level, err, with: withW });
  }
  return out.sort((a, b) => a.score - b.score || b.bad - a.bad || a.en.localeCompare(b.en));
}
// Сводка: сколько слов на каждом уровне, всего слов в уроках, типы ошибок
export function masterySummary(st, now = Date.now()){
  const words = wordStats(st, now), levels = { weak: 0, learning: 0, mastered: 0 };
  for (const w of words) levels[w.level]++;
  // типы ошибок за всё время с этого обновления (st.errorTypes пополняет logError в js/mistakes.js)
  const errors = ERROR_TYPES.map(t => ({ type: t, n: st.errorTypes?.[t.id] || 0 })).filter(x => x.n).sort((a, b) => b.n - a.n);
  return { words, levels, seen: words.length, total: lessonWords().size, errors };
}

// Подписи для отчётов: «не узнал ×5 · перепутал с похожим ×3»; у слова — главный тип и с чем путает
export const errorsLine = errors => errors.map(e => `${e.type.title} ×${e.n}`).join(' · ');
export function wordErrNote(w){
  const t = errorType(w.err[0]?.[0]);
  if (!t) return '';
  return w.err[0][0] === 'similar' && w.with[0] ? `${t.title}: ${w.with[0][0]}` : t.title;
}
export const needsLine = x => x.needs.map(n => `${n.code} ${n.skill.title} (${levelTitle(n.level)})`).join('; ');

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
    xp, level, maxLevel: MAX_LEVEL, rank: topRank(st), regions: regionRanks(st), gold: st.gold || 0, mastered: st.mastered || 0,
    collected: Object.keys(st.inventory || {}).length,
    skills: skillStats(st), coverage: curriculumCoverage(st), mastery: masterySummary(st), clinic: clinicLine(st),
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
  if (s.mastery?.seen){
    const hardW = s.mastery.words.filter(w => w.level === 'weak').slice(0, 5).map(w => w.en);
    lines.push(`Слова: освоено ${s.mastery.levels.mastered} из ${s.mastery.seen} встреченных${hardW.length ? `; трудные: ${hardW.join(', ')}` : ''}`);
  }
  if (st.mastered) lines.push(`Выучено после ошибок: ${st.mastered}`);
  lines.push(s.clinic || clinicLine(st));
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
