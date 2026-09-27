// English Quest — Состояние ученика: значения по умолчанию, загрузка и сохранение (localStorage → IndexedDB → память).

// ---------- STATE ----------
export const DEFAULT_STATE = {
  xp: 0, gold: 0, hearts: 5, streak: 0,
  inventory: {},   // { en: count }
  lessonProgress: {}, // { lessonId: { vocab: n, reading: 0/1, grammar: n, listen: n, speak: n, match: n } }
  mistakes: {},    // { 'type:lessonId:ref': { type, lessonId, ref, box, due, wrong, last } } — см. «Мои ошибки»
  mastered: 0,     // сколько ошибок выучено до конца
  activity: {},    // { 'YYYY-MM-DD': { sec, ok, bad } } — для режима репетитора
  lessonWrong: {}, // { lessonId: число ошибок за всё время }
  homework: null,  // текущее домашнее задание, см. makeHomework()
  checkpoints: {}, // { 'g2-p1': { best, passedAt } } — проверки после каждых 4 тем
  settings: { theme: 'light', speechRate: 0.9, dailyGoal: 10 },
  bestStreak: 0,   // рекорд серии дней с выполненной целью
  version: 2,
};
export let state = null;
export let realState = null; // пока репетитор смотрит чужой прогресс (см. backup.js), здесь лежит настоящий
// Модули читают state напрямую (живая привязка), а меняют только через эти функции
export function setState(s){ state = s; }
export function setRealState(s){ realState = s; }
// Глубокая копия: иначе вложенные объекты (inventory, mistakes) общие с DEFAULT_STATE и переживают сброс
export function freshState(){ return JSON.parse(JSON.stringify(DEFAULT_STATE)); }

// ---------- SAVE / LOAD (browser storage + IDB fallback + in-memory) ----------
// NOTE: preview iframe blocks web storage APIs. All calls go through window[...]
// and try/catch so preview falls back to in-memory silently.
export const STORE_KEY = 'english_quest_v2';
export const IDB_NAME = 'EnglishQuest';
export const IDB_STORE = 'state';
export let idbReady = false;
export let memoryStore = null;

export function getLS(){ try { return window['local' + 'Storage']; } catch(e){ return null; } }
export function getIDB(){ try { return window['index' + 'edDB']; } catch(e){ return null; } }

export function openIDB(){
  return new Promise((resolve, reject) => {
    const idb = getIDB();
    if (!idb) return reject('no-idb');
    try {
      const req = idb.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = () => { idbReady = true; resolve(req.result); };
      req.onerror = () => reject(req.error);
    } catch(e){ reject(e); }
  });
}

export async function loadState(){
  // 1) try browser storage
  try {
    const ls = getLS();
    if (ls) {
      const raw = ls.getItem(STORE_KEY);
      if (raw) return { ...freshState(), ...JSON.parse(raw) };
    }
  } catch(e){}
  // 2) try IDB
  try {
    const db = await openIDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get('state');
      req.onsuccess = () => resolve(req.result ? { ...freshState(), ...req.result } : freshState());
      req.onerror = () => resolve(freshState());
    });
  } catch(e){}
  // 3) in-memory
  if (memoryStore) return { ...freshState(), ...memoryStore };
  return freshState();
}

export async function saveState(){
  if (realState) return; // репетитор смотрит копию чужого прогресса — ничего не пишем
  memoryStore = JSON.parse(JSON.stringify(state));
  try {
    const ls = getLS();
    if (ls) ls.setItem(STORE_KEY, JSON.stringify(state));
  } catch(e){}
  try {
    if (!idbReady) await openIDB();
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(state, 'state');
  } catch(e){}
}
