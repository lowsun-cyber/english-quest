// English Quest — Состояние ученика: значения по умолчанию, загрузка и сохранение (localStorage → IndexedDB → память).

// ---------- STATE ----------
export const DEFAULT_STATE = {
  xp: 0, gold: 0, streak: 0, // streak — верные ответы подряд (внутренний счётчик)
  freezes: 0,      // 🧊 заморозки серии дней, не больше FREEZE_MAX (см. activity.js)
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

export function getLS(){ try { return window['local' + 'Storage']; } catch(e){ return null; } }
export function getIDB(){ try { return window['index' + 'edDB']; } catch(e){ return null; } }

// Одно подключение на всё приложение. Если IndexedDB не отвечает (бывает в приватных окнах
// и редко — просто так), через IDB_TIMEOUT считаем, что её нет: запуск не должен зависать.
const IDB_TIMEOUT = 1500;
let _idb = null;
export function openIDB(){
  if (_idb) return _idb;
  _idb = new Promise((resolve, reject) => {
    const idb = getIDB();
    if (!idb) return reject('no-idb');
    const timer = setTimeout(() => reject('idb-timeout'), IDB_TIMEOUT);
    try {
      const req = idb.open(IDB_NAME, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = () => { clearTimeout(timer); idbReady = true; resolve(req.result); };
      req.onerror = () => { clearTimeout(timer); reject(req.error); };
      req.onblocked = () => { clearTimeout(timer); reject('idb-blocked'); };
    } catch(e){ clearTimeout(timer); reject(e); }
  });
  _idb.catch(() => { _idb = null; }); // в следующий раз попробуем снова
  return _idb;
}

// ---------- УЧЕНИКИ НА УСТРОЙСТВЕ ----------
// Индекс устройства: { active, list: [{ id, name, avatar, created }], tutorPin?, pinResetAt? }.
// Первый ученик ('main') хранится под старым ключом — прогресс, сделанный до профилей, не теряется.
// PIN — общий для устройства (один взрослый замок), остальные настройки — у каждого ученика свои.
export const MAIN_ID = 'main';
const PROFILES_KEY = 'english_quest_profiles';
export let profiles = null;
export function setProfiles(p){ profiles = p; }
export const activeId = () => profiles?.active || MAIN_ID;
export const activeProfile = () => profiles?.list.find(p => p.id === activeId()) || { id: MAIN_ID, name: 'Ученик', avatar: '🦊' };
export function stateKey(id = activeId()){ return id === MAIN_ID ? STORE_KEY : `${STORE_KEY}__${id}`; }
const idbKey = id => id === MAIN_ID ? 'state' : `state__${id}`;
const memory = {};   // запасное хранилище в памяти, если браузер не даёт писать

async function idbGet(key){
  const db = await openIDB();
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), IDB_TIMEOUT);
    const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = () => { clearTimeout(timer); resolve(req.result ?? null); };
    req.onerror = () => { clearTimeout(timer); resolve(null); };
  });
}
async function idbPut(key, value){
  const db = await openIDB();
  const store = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE);
  value === undefined ? store.delete(key) : store.put(value, key);
}

export async function loadProfiles(){
  let p = null;
  try { p = JSON.parse(getLS()?.getItem(PROFILES_KEY) || 'null'); } catch (e) {}
  if (!p) try { p = await idbGet('profiles'); } catch (e) {}
  if (!p) p = memory.profiles || null;
  if (!p || !Array.isArray(p.list) || !p.list.length) p = { active: MAIN_ID, list: [{ id: MAIN_ID, name: 'Ученик', avatar: '🦊', created: Date.now() }] };
  if (!p.list.some(x => x.id === p.active)) p.active = p.list[0].id;
  return p;
}
export async function saveProfiles(){
  memory.profiles = JSON.parse(JSON.stringify(profiles));
  try { getLS()?.setItem(PROFILES_KEY, JSON.stringify(profiles)); } catch (e) {}
  try { await idbPut('profiles', profiles); } catch (e) {}
}
// PIN раньше жил в настройках ученика — переносим в индекс устройства
export function takeDeviceSettings(st){
  if (st?.settings?.tutorPin && !profiles.tutorPin){
    profiles.tutorPin = st.settings.tutorPin;
    if (st.settings.pinResetAt) profiles.pinResetAt = st.settings.pinResetAt;
    saveProfiles();
  }
  if (st?.settings){ delete st.settings.tutorPin; delete st.settings.pinResetAt; }
  return st;
}
export async function deleteStoredState(id){
  delete memory[id];
  try { getLS()?.removeItem(stateKey(id)); getLS()?.removeItem(stateKey(id) + '_before_restore'); } catch (e) {}
  try { await idbPut(idbKey(id), undefined); } catch (e) {}
}
export async function writeStoredState(id, st){
  memory[id] = JSON.parse(JSON.stringify(st));
  try { getLS()?.setItem(stateKey(id), JSON.stringify(st)); } catch (e) {}
  try { await idbPut(idbKey(id), st); } catch (e) {}
}

export async function loadState(id = activeId()){
  // 1) localStorage
  try {
    const raw = getLS()?.getItem(stateKey(id));
    if (raw) return { ...freshState(), ...JSON.parse(raw) };
  } catch(e){}
  // 2) IndexedDB
  try {
    const v = await idbGet(idbKey(id));
    if (v) return { ...freshState(), ...v };
  } catch(e){}
  // 3) память
  if (memory[id]) return { ...freshState(), ...memory[id] };
  return freshState();
}

export async function saveState(){
  if (realState) return; // репетитор смотрит копию чужого прогресса — ничего не пишем
  await writeStoredState(activeId(), state);
}
