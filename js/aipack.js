// English Quest — Посылки от Dr. Harlow (итерация 5, AI-пакеты; концепция, «Адаптивная логика», слой 2).
// Раз в неделю взрослый выгружает прогресс ученика без имени (aiExport), прогоняет его через модель по шаблону
// (AI_PROMPT), проверяет ответ и загружает посылку: в админ-панели (доставка по синхронизации) или в панели
// репетитора на устройстве. Посылка — 1–3 особых квеста под пробелы ученика и уникальный приз.
// Здесь — без DOM: формат и проверка (validateParcel), выгрузка, состояние посылок. Показ — js/parcels.js.
import { ERROR_CODES, LESSONS, QUEST_PASS_PCT, SKILLS } from './eq.js';
import { errorGaps, isLessonComplete, lessonsOf, playerGrade, skillStats, wordStats } from './stats.js';

export const PARCEL_FORMAT = 'eq-parcel/1';
export const EXPORT_FORMAT = 'eq-ai-export/1';
export const PARCEL_MAX_BYTES = 60 * 1024;
export const PARCEL_KEEP = 20;   // столько посылок хранится в прогрессе ученика (старые выполненные уходят)
const ID_RE = /^[a-z0-9][a-z0-9-]{2,59}$/;
const CODES = new Set(ERROR_CODES.map(c => c.code));

// ---------- проверка посылки ----------
// Возвращает список ошибок по-русски (пусто — посылка годится). Те же правила, что у пакетов локаций:
// у вопроса — ___, ответ среди вариантов и объяснение к каждому неверному варианту.
export function validateParcel(p){
  const errs = [], need = (ok, msg) => { if (!ok) errs.push(msg); };
  const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return ['Посылка — это объект JSON'];
  need(p.format === PARCEL_FORMAT, `format — «${PARCEL_FORMAT}»`);
  need(typeof p.id === 'string' && ID_RE.test(p.id), 'id — латиница в нижнем регистре, цифры и дефисы, 3–60 знаков');
  need(p.student == null || (typeof p.student === 'string' && p.student.length <= 40), 'student — код ученика из выгрузки (не имя)');
  need(str(p.title, 60), 'title — название посылки, до 60 знаков');
  need(str(p.note, 400), 'note — письмо Dr. Harlow ребёнку по-русски, до 400 знаков');
  need(p.reward && str(p.reward.title, 80) && str(p.reward.emoji, 8), 'reward — уникальный приз: title (до 80 знаков) и emoji');
  need(Array.isArray(p.quests) && p.quests.length >= 1 && p.quests.length <= 3, 'quests — от 1 до 3 особых квестов');
  const ids = new Set();
  for (const [i, q] of (Array.isArray(p.quests) ? p.quests : []).entries()){
    const where = `Квест ${i + 1}${q?.title ? ` «${q.title}»` : ''}`;
    if (!q || typeof q !== 'object'){ errs.push(`${where}: нужен объект`); continue; }
    need(typeof q.id === 'string' && ID_RE.test(q.id) && !ids.has(q.id), `${where}: id — как у посылки и не повторяется`);
    ids.add(q.id);
    need(str(q.title, 60) && str(q.emoji, 8), `${where}: нужны title и emoji`);
    need(q.focus == null || (Array.isArray(q.focus) && q.focus.every(c => CODES.has(c))), `${where}: focus — коды ошибок из карты пробелов (W1, B1, L1…)`);
    const words = q.words || [], grammar = q.grammar || [];
    need(Array.isArray(words) && Array.isArray(grammar), `${where}: words и grammar — списки`);
    need(!words.length || words.length >= 4, `${where}: слов нужно не меньше 4 — из них собираются варианты ответа`);
    for (const w of words) need(w && str(w.en, 40) && str(w.ru, 60) && str(w.emoji, 8), `${where}: у слова нужны en, ru, emoji (${JSON.stringify(w)})`);
    const ens = words.map(w => w?.en);
    need(new Set(ens).size === ens.length, `${where}: слова не повторяются`);
    for (const g of grammar){
      const ok = g && str(g.q, 120) && g.q.includes('___') && str(g.a, 40) && str(g.hint, 120) && Array.isArray(g.options) && g.options.includes(g.a) && g.options.length >= 2 && g.options.length <= 4;
      need(ok, `${where}: вопрос «${g?.q}» — нужны ___ в q, a, hint и 2–4 варианта с ответом среди них`);
      if (!ok) continue;
      need(!g.skill || SKILLS[g.skill], `${where}: нет навыка ${g.skill} (коды — карта программы)`);
      const wrong = g.options.filter(o => o !== g.a);
      need(g.why && wrong.every(o => str(g.why[o], 160)) && Object.keys(g.why).every(k => wrong.includes(k)), `${where}: вопрос «${g.q}» — why: объяснение к каждому неверному варианту`);
    }
    const n = words.length + grammar.length;
    need(n >= 4 && n <= 15, `${where}: заданий (слов и вопросов) — от 4 до 15, сейчас ${n}`);
  }
  if (!errs.length) need(JSON.stringify(p).length <= PARCEL_MAX_BYTES, 'посылка слишком большая (больше 60 КБ)');
  return errs;
}
export const parseParcel = text => { try { return JSON.parse(text); } catch (e) { return null; } };

// ---------- посылки в прогрессе ученика ----------
// st.parcels = { id: { pack, sent, opened, withdrawn } }; результаты квестов — st.quests['sp:посылка:квест']
export const specialKey = (p, q) => `sp:${p.id}:${q.id}`;
export const questSize = q => (q.words || []).length + (q.grammar || []).length;
export function parcelState(entry, st){
  const p = entry.pack, quests = p.quests.map(q => {
    const res = st.quests?.[specialKey(p, q)] || null;
    return { q, res, passed: (res?.best ?? -1) >= QUEST_PASS_PCT };
  });
  const done = quests.every(x => x.passed);
  const doneAt = done ? Math.max(...quests.map(x => x.res.passedAt || x.res.at || 0)) : null;
  return { entry, pack: p, quests, done, doneAt, left: quests.filter(x => !x.passed).length };
}
// Действующие посылки (не отозванные, с верным форматом), новые сверху
export function parcelsOf(st){
  return Object.values(st.parcels || {})
    .filter(e => e && !e.withdrawn && e.pack && !validateParcel(e.pack).length)
    .map(e => parcelState(e, st))
    .sort((a, b) => (b.entry.sent || 0) - (a.entry.sent || 0));
}
// Новая посылка в прогресс: возвращает новое st.parcels (старые выполненные — сверх PARCEL_KEEP — уходят)
export function addParcel(st, pack, now = Date.now()){
  const out = { ...(st.parcels || {}) };
  out[pack.id] = { pack, sent: out[pack.id]?.sent || now, opened: out[pack.id]?.opened || null, withdrawn: null };
  const list = Object.entries(out).sort((a, b) => (b[1].sent || 0) - (a[1].sent || 0));
  for (const [id, e] of list.slice(PARCEL_KEEP)) if (e.withdrawn || parcelState(e, st).done) delete out[id];
  return out;
}

// ---------- выгрузка для AI ----------
// Только учебные данные: без имени, аватара и дат занятий. student — код ученика (на сервере — id,
// на устройстве — id профиля), чтобы посылка нашла адресата.
export function aiExport(st, { student = '', now = Date.now() } = {}){
  const grade = playerGrade(st);
  const done = LESSONS.filter(l => isLessonComplete(l, st));
  const current = lessonsOf(grade).find(l => !isLessonComplete(l, st)) || null;
  const known = [...new Set(done.flatMap(l => l.words.map(w => w.en)))].slice(0, 400);
  const g = errorGaps(st);
  return {
    format: EXPORT_FORMAT, student, made: new Date(now).toISOString().slice(0, 10), grade,
    lessonsDone: done.map(l => ({ id: l.id, grade: l.grade, title: l.title })),
    currentLesson: current ? { id: current.id, title: current.title, words: current.words.map(w => w.en) } : null,
    gaps: g.codes.filter(c => c.state !== 'none').map(c => ({ code: c.code, title: c.title, state: c.state, inMistakesNow: c.active, errorsTotal: c.total })),
    skills: skillStats(st).map(x => ({ code: x.code, title: x.skill.title, level: x.level, pct: x.pct, answers: x.ok + x.bad, wrongChoices: x.wrong.slice(0, 3).map(([o, n]) => ({ option: o, times: n })) })),
    hardWords: wordStats(st, now).filter(w => w.level !== 'mastered').slice(0, 30).map(w => ({ en: w.en, ru: w.word.ru, level: w.level, ok: w.ok, bad: w.bad,
      errorTypes: Object.fromEntries(w.err), confusedWith: w.with.slice(0, 3).map(([x]) => x) })),
    knownWords: known,
    errorCodes: ERROR_CODES.map(c => ({ code: c.code, title: c.title })),
  };
}

// Шаблон задания для модели (Claude, Perplexity): выгрузка вставляется в конец. Ответ — только JSON посылки.
export const AI_PROMPT = `Ты помогаешь учителю английского готовить «посылку от Dr. Harlow» — 2–3 особых квеста для ребёнка 7–10 лет, который занимается по школьной программе английского (2–4 класс) в игре English Quest.

Ниже — выгрузка прогресса ребёнка (без имени): пробелы по кодам ошибок (gaps), навыки грамматики (skills), трудные слова и с чем ребёнок их путает (hardWords), знакомые слова (knownWords).

Задача:
1. Выбери 2–3 самых важных пробела: сначала state = "gap", затем частые путаницы из hardWords.confusedWith и wrongChoices.
2. На каждый пробел сделай один квест на 6–10 заданий. Используй только знакомые слова (knownWords) и слова текущей темы — новых слов не больше 2 на квест.
3. Задания двух видов:
   - words — слова для вопросов «как по-английски?» и «послушай и выбери»: не меньше 4 слов, в том числе слова, которые ребёнок путает, рядом друг с другом (например, cat и cap);
   - grammar — вопрос с пропуском ___, 3–4 варианта, ответ a, подсказка hint по-русски и why — короткое объяснение по-русски для КАЖДОГО неверного варианта: почему он не подходит (до 120 знаков, просто, как для 8 лет).
4. Придумай уникальный приз за всю посылку: название говорит, чему ребёнок научился («Кристальный ключ Распутывателя cat и cap»), и один эмодзи.
5. Напиши короткое письмо Dr. Harlow ребёнку по-русски (note, до 400 знаков): тепло, без оценок, что тренируем и почему это пригодится.

Требования: интерфейс и объяснения — по-русски, английский — только в заданиях; без имён, фамилий и личных данных; без ссылок; каждое задание проверь — ответ однозначный.

Ответь ТОЛЬКО JSON в таком формате, без пояснений вокруг:
{
  "format": "${PARCEL_FORMAT}",
  "id": "латиница-и-дефисы, например 2026-10-12-cat-cap",
  "student": "код ученика из выгрузки (поле student)",
  "title": "Посылка от Dr. Harlow",
  "note": "письмо ребёнку",
  "reward": { "title": "название приза", "emoji": "🗝️" },
  "quests": [
    {
      "id": "cat-cap", "title": "cat или cap?", "emoji": "🐱", "focus": ["W2"],
      "words": [ { "en": "cat", "ru": "кот", "emoji": "🐱" } ],
      "grammar": [ { "skill": "G2-01", "q": "The cat ___ black.", "a": "is", "hint": "Один кот — is.", "options": ["is", "are", "am"],
        "why": { "are": "are — для многих, а кот один.", "am": "am — только после I." } } ]
    }
  ]
}
focus — коды ошибок из errorCodes, skill — коды навыков из skills (если подходят).

Выгрузка:
`;
export const promptWithExport = exp => AI_PROMPT + JSON.stringify(exp, null, 2);
