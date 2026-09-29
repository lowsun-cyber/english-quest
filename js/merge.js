// English Quest — Объединение прогресса с разных устройств (без DOM, проверяется tests/merge.mjs).
//
// Трёхстороннее слияние: base — последний прогресс, согласованный с сервером; local — на этом
// устройстве; remote — на сервере (его прислало другое устройство). Для каждого поля:
//   • изменилось только на одной стороне — берём эту сторону (так же доходят сброс и удаление);
//   • изменилось на обеих — объединяем по смыслу поля:
//       счётчики (опыт, золото, ответы, минуты) — складываем прибавки обеих сторон;
//       прохождение тем — лучший результат; ошибки — по последней попытке;
//       настройки, домашка и прочее — последнее изменение (при равенстве — это устройство).
// Так ребёнок ничего не теряет, а золото не удваивается и потраченное не возвращается.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function same(a, b){
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return (a ?? null) === (b ?? null);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && same(a[k], b[k]));
}

const keysOf = (...objs) => [...new Set(objs.flatMap(o => isObj(o) ? Object.keys(o) : []))];
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));

// общий шаг: если поле поменялось только на одной стороне — ответ очевиден
function three(b, l, r, both){
  if (same(l, b)) return clone(r);
  if (same(r, b)) return clone(l);
  if (same(l, r)) return clone(l);
  return both(b, l, r);
}

const n = v => Number.isFinite(v) ? v : 0;
const add = (b, l, r) => Math.max(0, n(l) + n(r) - n(b));        // прибавки обеих сторон
const latest = (b, l, r) => clone(l === undefined ? r : l);      // оба изменили — это устройство
const max = (b, l, r) => Math.max(n(l), n(r));

// { ключ: число } — счётчики по ключам
const addMap = (b, l, r) => {
  const out = {};
  for (const k of keysOf(b, l, r)){
    const v = three(b?.[k], l?.[k], r?.[k], add);
    if (v !== undefined && v !== 0) out[k] = v;
  }
  return out;
};

// { ключ: объект } — по ключам с правилом для самих объектов; удалённое на одной стороне не воскресает
function objMap(b, l, r, merge){
  const out = {};
  for (const k of keysOf(b, l, r)){
    const inB = isObj(b) && k in b, inL = isObj(l) && k in l, inR = isObj(r) && k in r;
    if (inB && (!inL || !inR)){
      // было и удалено на одной стороне: удаляем, если другая сторона его не меняла
      const kept = inL ? l[k] : inR ? r[k] : undefined;
      if (kept !== undefined && !same(kept, b[k])) out[k] = clone(kept);
      continue;
    }
    const v = three(b?.[k], l?.[k], r?.[k], merge);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// поля одного объекта: rules[поле] или «последнее изменение»
function fields(b, l, r, rules = {}){
  const out = {};
  for (const k of keysOf(b, l, r)){
    const v = three(b?.[k], l?.[k], r?.[k], rules[k] || latest);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const RULES = {
  xp: add, gold: add, mastered: add,
  freezes: (b, l, r) => Math.min(2, add(b, l, r)),   // FREEZE_MAX из activity.js
  bestStreak: max,
  inventory: addMap,
  lessonWrong: addMap,
  // { lessonId: { vocab: n, … } } — лучший результат по каждому упражнению
  lessonProgress: (b, l, r) => objMap(b, l, r, (bb, ll, rr) => {
    const out = {};
    for (const k of keysOf(bb, ll, rr)) out[k] = three(bb?.[k], ll?.[k], rr?.[k], max);
    return out;
  }),
  // { день: { sec, ok, bad, goalMet, frozen } } — время и ответы складываются
  activity: (b, l, r) => objMap(b, l, r, (bb, ll, rr) => fields(bb, ll, rr, {
    sec: add, ok: add, bad: add,
    goalMet: (x, y, z) => !!(y || z), frozen: (x, y, z) => !!(y || z),
  })),
  // { id: { best, passedAt } } — лучший результат, самая ранняя сдача
  checkpoints: (b, l, r) => objMap(b, l, r, (bb, ll, rr) => fields(bb, ll, rr, {
    best: max,
    passedAt: (x, y, z) => (y && z) ? Math.min(y, z) : (y || z || null),
  })),
  // «Мои ошибки»: у кого попытка позже, тот и прав
  mistakes: (b, l, r) => objMap(b, l, r, (bb, ll, rr) => clone(n(rr?.last) > n(ll?.last) ? rr : ll)),
  // домашка: новее та, что назначена позже; для того же задания — «сделано», если сделано где-нибудь
  homework: (b, l, r) => {
    if (!isObj(l) || !isObj(r)) return clone(l ?? r ?? null);
    if (l.id === r.id) return { ...clone(n(r.assigned) > n(l.assigned) ? r : l), doneAt: (l.doneAt && r.doneAt) ? Math.min(l.doneAt, r.doneAt) : (l.doneAt || r.doneAt || null) };
    return clone(n(r.assigned) > n(l.assigned) ? r : l);
  },
  settings: (b, l, r) => fields(b, l, r, { lastBackup: max }),
};

// fresh — пустой прогресс (DEFAULT_STATE): основа, когда устройство подключается впервые
export function mergeStates(base, local, remote, fresh = {}){
  if (!isObj(remote)) return clone(local);
  if (!isObj(local)) return clone(remote);
  return fields(isObj(base) ? base : fresh, local, remote, RULES);
}
