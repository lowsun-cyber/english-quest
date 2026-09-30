// English Quest — Сервер учителя: подключение устройства по коду и синхронизация прогресса.
//
// Прогресс по-прежнему живёт на устройстве и работает без интернета. Если профиль ученика
// подключён к серверу (profile.cloud), изменения тихо отправляются туда, а изменения с других
// устройств приходят обратно и объединяются (merge.js). Основа для объединения — последний
// согласованный с сервером прогресс (readSyncBase).
import { api, ApiError, deviceLabel } from './api.js';
import { API_BASE, TEACHER_KEY } from './config.js';
import { applyLoadedState, sanitizeState, stateSummary, viewOtherState } from './backup.js';
import { mergeStates, same } from './merge.js';
import { activeId, activeProfile, freshState, profiles, readSyncBase, realState, saveProfiles, setOnSaved, setState, state, writeStoredState, writeSyncBase } from './state.js';
import { createProfile, renderProfileChip, switchProfile } from './profiles.js';
import { closeModal, modalClosedHooks, modalIsOpen, openModal, toast } from './ui.js';
import { escapeHtml } from './util.js';

export const cloudOn = () => !!API_BASE;
export const cloudLink = (id = activeId()) => profiles?.list.find(p => p.id === id)?.cloud || null;

// ---------- синхронизация ----------
let busy = false, again = false, timer = null, waitingForModal = false;
export let lastSync = { at: 0, ok: true, message: '' };

export function scheduleSync(ms = 4000){
  if (!cloudOn() || !cloudLink()) return;
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), ms);
}

const snapshot = st => { const c = JSON.parse(JSON.stringify(st)); delete c._viewMeta; return c; };

// Поставить объединённый прогресс вместо текущего. Если за время запроса ребёнок что-то
// успел сделать — эти изменения не теряются: сливаем их поверх.
function adopt(id, merged, before){
  if (id !== activeId()){ writeStoredState(id, merged); return; }
  const next = same(state, before) ? merged : mergeStates(before, snapshot(state), merged, freshState());
  setState(next);
  applyLoadedState();   // перерисовать экран и сохранить на устройстве
}

// Одна попытка синхронизации. Возвращает 'ok' | 'off' | 'busy' | 'later' | 'error'.
export async function syncNow(){
  const id = activeId(), link = cloudLink(id);
  if (!cloudOn() || !link || realState) return 'off';
  if (busy){ again = true; return 'busy'; }
  busy = true;
  try {
    const base = await readSyncBase(id);   // { version, state } | null
    const local = snapshot(state);
    if (base && same(local, base.state)){
      // здесь ничего не менялось — только забираем новое с сервера
      const r = await api('/progress', { token: link.token });
      if (r.state && r.version !== base.version){
        if (modalIsOpen()) return waitModal();
        const remote = sanitizeState(r.state);
        await writeSyncBase(id, { version: r.version, state: remote });
        adopt(id, remote, local);
      } else if (!r.state){
        // на сервере пусто (например, базу перенесли) — отправляем своё
        const w = await api('/progress', { token: link.token, body: { base: r.version, state: local } });
        await writeSyncBase(id, { version: w.version, state: local });
      }
    } else {
      try {
        const w = await api('/progress', { token: link.token, body: { base: base?.version ?? 0, state: local } });
        await writeSyncBase(id, { version: w.version, state: local });
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 409) throw e;
        // на сервере есть изменения с другого устройства — объединяем
        if (modalIsOpen()) return waitModal();
        const remote = e.data.state ? sanitizeState(e.data.state) : null;
        // основа: согласованный прогресс; при первом подключении — пустой; если основа потерялась —
        // серверный (лучше не досчитать, чем удвоить)
        const common = base ? base.state : (link.first ? freshState() : remote);
        const merged = mergeStates(common, local, remote, freshState());
        const w = await api('/progress', { token: link.token, body: { base: e.data.version, state: merged } });
        await writeSyncBase(id, { version: w.version, state: merged });
        adopt(id, merged, local);
      }
    }
    if (link.first){ delete link.first; saveProfiles(); }
    lastSync = { at: Date.now(), ok: true, message: '' };
    return 'ok';
  } catch (e) {
    if (e instanceof ApiError && e.status === 401){
      // учитель отключил устройство или удалил ученика
      await unlinkLocal(id);
      toast('☁️ Устройство отключено от сервера учителя. Прогресс остался на устройстве.');
      lastSync = { at: Date.now(), ok: false, message: 'Устройство отключено от сервера.' };
      return 'error';
    }
    lastSync = { at: Date.now(), ok: false, message: e.message || 'Нет связи с сервером.' };
    scheduleSync(60000);   // без сети — попробуем позже, прогресс сохранён на устройстве
    return 'error';
  } finally {
    busy = false;
    if (again){ again = false; scheduleSync(500); }
  }
}
// Идёт упражнение: подменять прогресс посреди вопроса нельзя — подождём закрытия окна.
function waitModal(){ waitingForModal = true; return 'later'; }

async function unlinkLocal(id){
  const p = profiles.list.find(x => x.id === id);
  if (p) delete p.cloud;
  await writeSyncBase(id, null);
  await saveProfiles();
  renderProfileChip();
}

// ---------- подключение устройства ----------
const pristine = st => !st.xp && !Object.keys(st.activity || {}).length && !Object.keys(st.lessonProgress || {}).length;

// Код от учителя → ключ устройства. Потом решаем, к какому профилю на устройстве его привязать.
export async function claimCode(code){
  return linkWith(await api('/claim', { body: { code, label: deviceLabel() } }));
}
// Вход ученика по логину и паролю — то же подключение устройства, только без кода
export async function claimLogin(login, password){
  return linkWith(await api('/student/login', { body: { login, password, label: deviceLabel() } }));
}
async function linkWith(r){
  const cloud = { studentId: r.student.id, token: r.token, deviceId: r.deviceId, name: r.student.name, first: true };
  const existing = profiles.list.find(p => p.cloud?.studentId === r.student.id);
  if (existing){
    existing.cloud = { ...cloud, first: false };
    await saveProfiles();
    if (existing.id !== activeId()) await switchProfile(existing.id);
    return finishLink(r.student);
  }
  const cur = activeProfile();
  if (!cur.cloud && pristine(state)) return linkTo(cur.id, cloud, r.student);
  // на устройстве уже есть прогресс — спрашиваем, чей он
  openModal(`
    <h2>☁️ Ученик: ${escapeHtml(r.student.avatar)} ${escapeHtml(r.student.name)}</h2>
    <p>Устройство подключено к серверу учителя. К какому профилю на этом устройстве относится этот ученик?</p>
    <div class="controls cl-choice">
      ${cur.cloud ? '' : `<button class="btn" id="cl-this">Это ${escapeHtml(cur.avatar)} ${escapeHtml(cur.name)} — объединить прогресс</button>`}
      <button class="btn secondary" id="cl-new">➕ Новый ученик на этом устройстве</button>
    </div>
    <p class="t-muted">«Объединить» — прогресс на этом устройстве и на сервере сложится. Ничего не потеряется.</p>`);
  let chosen = false;
  const choose = async (fn) => { chosen = true; closeModal(); await fn(); };
  const thisBtn = document.getElementById('cl-this');
  if (thisBtn) thisBtn.onclick = () => choose(() => linkTo(cur.id, cloud, r.student));
  document.getElementById('cl-new').onclick = () => choose(async () => {
    const id = await createProfile(r.student.name, r.student.avatar);
    await switchProfile(id);
    await linkTo(id, cloud, r.student);
  });
  // закрыли окно, не выбрав — безопаснее отдельный профиль, чем смешать чужой прогресс
  modalClosedHooks.add(function once(){
    modalClosedHooks.delete(once);
    if (chosen) return;
    (async () => { const id = await createProfile(r.student.name, r.student.avatar); await switchProfile(id); await linkTo(id, cloud, r.student); })();
  });
}
async function linkTo(id, cloud, student){
  const p = profiles.list.find(x => x.id === id);
  p.cloud = cloud;
  p.name = student.name;
  if (student.avatar) p.avatar = student.avatar;
  await writeSyncBase(id, null);
  await saveProfiles();
  renderProfileChip();
  return finishLink(student);
}
async function finishLink(student){
  const res = await syncNow();
  toast(res === 'ok' ? `☁️ ${student.name}: прогресс сохранён на сервере` : `☁️ ${student.name}: устройство подключено, прогресс отправится, когда будет интернет`);
  return res;
}

// Ссылка от учителя: …/#link=ABCD-EFGH
export function linkFromHash(){
  const m = /^#link=([A-Za-z0-9-]{8,12})$/.exec(location.hash);
  if (!m || !cloudOn()) return false;
  history.replaceState(null, '', location.pathname + location.search);
  openModal(`
    <h2>☁️ Подключить к учителю?</h2>
    <p>Прогресс ученика будет сохраняться на сервере учителя: он не потеряется, его можно продолжить на другом устройстве, а учитель увидит, что сделано.</p>
    <div class="controls"><button class="btn" id="cl-go">Подключить</button><button class="btn secondary" id="cl-no">Не сейчас</button></div>
    <p class="gate-err" id="cl-err" role="alert" hidden></p>`);
  document.getElementById('cl-no').onclick = closeModal;
  document.getElementById('cl-go').onclick = async (e) => {
    e.target.disabled = true;
    try { closeModal(); await claimCode(m[1]); }
    catch (err){ toast('☁️ ' + (err.message || 'Не получилось подключить')); }
  };
  return true;
}

// Учитель открыл прогресс ученика из кабинета: …/#view=<id ученика>
export async function viewFromHash(){
  const m = /^#view=(s[0-9a-f]{16})$/.exec(location.hash);
  if (!m || !cloudOn()) return false;
  history.replaceState(null, '', location.pathname + location.search);
  let token = null;
  try { token = localStorage.getItem(TEACHER_KEY); } catch (e) {}
  if (!token){ toast('Сначала войдите в кабинет учителя'); return true; }
  try {
    const r = await api(`/students/${m[1]}/progress`, { token });
    const st = sanitizeState(r.state || {});
    viewOtherState({ state: st, exportedAt: r.updated, summary: stateSummary(st), profile: { name: r.student.name, avatar: r.student.avatar }, source: 'server' });
  } catch (e) { toast(e.message || 'Не удалось открыть прогресс ученика'); }
  return true;
}

// ---------- раздел в панели для взрослых ----------
function ago(t){
  if (!t) return 'ещё не было';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? 'только что' : s < 3600 ? `${Math.round(s / 60)} мин назад` : new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}
export function cloudSectionHtml(){
  const link = cloudLink();
  if (link) return `
    <p>☁️ Подключено к серверу учителя: <b>${escapeHtml(link.name)}</b>. Прогресс сохраняется там автоматически.</p>
    <p class="t-muted" id="cl-status">Синхронизация: ${lastSync.ok ? ago(lastSync.at) : `не удалась — ${escapeHtml(lastSync.message)}. Всё сохранено на устройстве и отправится позже.`}</p>
    <div class="controls">
      <button class="btn secondary" id="cl-sync">🔄 Синхронизировать сейчас</button>
      <button class="icon-btn" id="cl-unlink">Отключить это устройство</button>
    </div>`;
  return `
    <p class="t-muted">Если ученик занимается у учителя с сервером English Quest, войдите под ним: прогресс не потеряется, его можно продолжить на другом устройстве, а учитель увидит, что сделано. Логин и пароль (или код подключения) даёт учитель.</p>
    <h4 class="t-h4">Вход по логину</h4>
    <form class="cl-form" id="cl-login-form">
      <label>Логин <input id="cl-login" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="30" /></label>
      <label>Пароль <input id="cl-password" type="password" autocomplete="current-password" /></label>
      <button class="btn" type="submit">☁️ Войти</button>
    </form>
    <p class="gate-err" id="cl-err" role="alert" hidden></p>
    <details class="cl-more">
      <summary>Забыли пароль?</summary>
      <p class="t-muted">Укажите почту родителя, которую знает учитель, — придёт ссылка, чтобы задать новый пароль.</p>
      <form class="cl-form" id="cl-forgot-form">
        <label>Почта родителя <input id="cl-forgot-email" type="email" autocomplete="email" /></label>
        <button class="btn secondary" type="submit">Прислать ссылку</button>
      </form>
      <p class="t-muted" id="cl-forgot-msg" role="status" hidden></p>
    </details>
    <details class="cl-more">
      <summary>Есть код подключения</summary>
      <form class="cl-form" id="cl-form">
        <label>Код подключения <input id="cl-code" autocomplete="off" autocapitalize="characters" placeholder="ABCD-EFGH" maxlength="12" /></label>
        <button class="btn secondary" type="submit">☁️ Подключить</button>
      </form>
    </details>`;
}
export function wireCloudSection(reopen){
  const syncBtn = document.getElementById('cl-sync');
  if (syncBtn) syncBtn.onclick = async () => {
    syncBtn.disabled = true;
    const res = await syncNow();
    toast(res === 'ok' ? '☁️ Синхронизировано' : res === 'later' ? '☁️ Синхронизирую после упражнения' : '☁️ ' + (lastSync.message || 'Не получилось'));
    reopen();
  };
  const unlink = document.getElementById('cl-unlink');
  if (unlink) unlink.onclick = async () => {
    if (!confirm('Отключить это устройство от сервера учителя? Прогресс останется на устройстве, но перестанет сохраняться на сервере.')) return;
    const link = cloudLink();
    try { await api('/logout', { token: link.token, body: {} }); } catch (e) {}
    await unlinkLocal(activeId());
    toast('Устройство отключено от сервера');
    reopen();
  };
  const showErr = (msg) => { const err = document.getElementById('cl-err'); if (err){ err.textContent = msg; err.hidden = false; } };
  const loginForm = document.getElementById('cl-login-form');
  if (loginForm) loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const login = document.getElementById('cl-login').value.trim(), password = document.getElementById('cl-password').value;
    if (!login || !password){ document.getElementById(login ? 'cl-password' : 'cl-login').focus(); return; }
    loginForm.querySelector('button').disabled = true;
    try { closeModal(); await claimLogin(login, password); }
    catch (ex){ reopen(); showErr(ex.message); }
  };
  const forgot = document.getElementById('cl-forgot-form');
  if (forgot) forgot.onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById('cl-forgot-msg');
    try { const r = await api('/password/forgot', { body: { email: document.getElementById('cl-forgot-email').value } }); msg.textContent = r.message; }
    catch (ex){ msg.textContent = ex.message; }
    msg.hidden = false;
  };
  const form = document.getElementById('cl-form');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const code = document.getElementById('cl-code').value.trim();
    if (!code){ document.getElementById('cl-code').focus(); return; }
    form.querySelector('button').disabled = true;
    try { closeModal(); await claimCode(code); }
    catch (ex){
      reopen();
      const err = document.getElementById('cl-err');
      if (err){ err.textContent = ex.message; err.hidden = false; }
    }
  };
}

// ---------- когда синхронизировать ----------
// Вызывается из main.js после загрузки всех модулей (они импортируют друг друга по кругу,
// поэтому на верхнем уровне этого файла чужие переменные ещё могут быть не готовы).
export function initCloud(){
  setOnSaved(() => scheduleSync(4000));
  modalClosedHooks.add(() => { if (waitingForModal){ waitingForModal = false; scheduleSync(300); } });
  if (!cloudOn()) return;
  const cab = document.getElementById('btn-teacher');
  if (cab) cab.hidden = false;
  window.addEventListener('online', () => scheduleSync(500));
  document.addEventListener('visibilitychange', () => scheduleSync(document.hidden ? 0 : 500));
  setInterval(() => { if (!document.hidden) syncNow(); }, 120000);
}
