// English Quest — Перенос и резервная копия прогресса: файл, код, просмотр, замена с отменой.
import { renderGoal } from './activity.js';
import { LESSONS, levelFromXp } from './eq.js';
import { renderHomework } from './homework.js';
import { isLessonComplete, renderHUD, renderInventory } from './hud.js';
import { renderMap } from './map.js';
import { renderMistakes } from './mistakes.js';
import { activeProfile, freshState, getLS, realState, saveState, setRealState, setState, state, stateKey } from './state.js';
import { openTutorPanel } from './tutor.js';
import { createProfile } from './profiles.js';
import { toast } from './ui.js';
import { DAY, copyText, dayKey, escapeHtml, fmtDay, startOfDay } from './util.js';

// ---------- ПЕРЕНОС И РЕЗЕРВНАЯ КОПИЯ ----------
// Сервера нет, поэтому прогресс переносится файлом или кодом.
// Файл: JSON { app, format, exportedAt, summary, state }.
// Код: «EQ1.» + base64url(gzip(тот же JSON)); если браузер не умеет gzip — «EQ0.» без сжатия.
// Загруженный прогресс можно только посмотреть (репетитор) или поставить вместо текущего —
// тогда текущий откладывается в undoKey() и замену можно отменить.
export const BACKUP_APP = 'english-quest';
// у каждого ученика свой «прежний прогресс» для отмены
export const undoKey = () => stateKey() + '_before_restore';
export let pendingImport = null;   // разобранный файл/код, ждёт решения

export function stateSummary(st){
  const lvl = levelFromXp(st.xp || 0);
  const done = LESSONS.filter(l => isLessonComplete(l, { lessonProgress: st.lessonProgress || {} })).length;
  const days = Object.keys(st.activity || {}).sort();
  return { level: lvl, xp: st.xp || 0, lessonsDone: done, mistakes: Object.keys(st.mistakes || {}).length, lastDay: days[days.length - 1] || null };
}
export function summaryText(sum, exportedAt){
  const when = exportedAt ? new Date(exportedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : 'неизвестно';
  return `Копия от ${when}: уровень ${sum.level}, ${sum.xp} XP, пройдено тем ${sum.lessonsDone} из ${LESSONS.length}, в «Моих ошибках» ${sum.mistakes}${sum.lastDay ? `, последнее занятие ${fmtDay(sum.lastDay)}` : ''}.`;
}

export function backupPayload(){
  const { name, avatar } = activeProfile();
  return { app: BACKUP_APP, format: 1, exportedAt: Date.now(), profile: { name, avatar }, summary: stateSummary(state), state };
}
export function b64url(bytes){
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64url(str){
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}
export async function pipeBytes(bytes, stream){
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
export async function encodeCode(obj){
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if ('CompressionStream' in window) return 'EQ1.' + b64url(await pipeBytes(raw, new CompressionStream('gzip')));
  return 'EQ0.' + b64url(raw);
}
export async function decodeCode(code){
  const m = /^EQ([01])\.([A-Za-z0-9_-]+)$/.exec(code.replace(/\s+/g, ''));
  if (!m) throw new Error('Это не код English Quest.');
  let bytes = unb64url(m[2]);
  if (m[1] === '1'){
    if (!('DecompressionStream' in window)) throw new Error('Этот браузер не умеет читать сжатый код — загрузите файл.');
    bytes = await pipeBytes(bytes, new DecompressionStream('gzip'));
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Берём из файла только известные поля нужных типов — остальное по умолчанию.
export function sanitizeState(src){
  const out = freshState();
  if (!src || typeof src !== 'object') return out;
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  for (const k of Object.keys(out)){
    const def = out[k], v = src[k];
    if (typeof def === 'number' && Number.isFinite(v)) out[k] = Math.max(0, v);
    else if (isObj(def) && isObj(v)) out[k] = v;
    else if (k === 'homework' && (v === null || isObj(v))) out[k] = v;
  }
  out.freezes = Math.min(2, out.freezes);
  delete out.settings.tutorPin; delete out.settings.pinResetAt; // PIN — дело устройства, не копии
  out.settings = { ...freshState().settings, ...out.settings };
  if (!['light', 'dark'].includes(out.settings.theme)) out.settings.theme = 'light';
  return out;
}
export function parseBackup(obj){
  if (!obj || obj.app !== BACKUP_APP || !obj.state) throw new Error('В файле нет прогресса English Quest.');
  const st = sanitizeState(obj.state);
  const pr = obj.profile && typeof obj.profile === 'object' ? obj.profile : {};
  return { state: st, exportedAt: obj.exportedAt, summary: stateSummary(st), profile: { name: String(pr.name || '').slice(0, 20), avatar: String(pr.avatar || '') } };
}

export function backupFileName(){ return `english-quest-progress-${dayKey()}.json`; }
export function markBackedUp(){ state.settings.lastBackup = Date.now(); saveState(); }

export function backupSectionHtml(){
  const last = state.settings.lastBackup;
  const hasUndo = (() => { try { return !!getLS()?.getItem(undoKey()); } catch (e) { return false; } })();
  const canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] }));
  return `
    <p class="t-muted">Прогресс хранится только в этом браузере. Сохраните копию, чтобы не потерять его, перенести на другое устройство или отправить репетитору.</p>
    <p class="t-muted">Последняя копия: <b>${last ? daysAgo(last) : 'ещё не делали'}</b></p>
    <div class="controls">
      <button class="btn" id="t-bk-file">💾 Сохранить в файл</button>
      ${canShareFiles ? '<button class="btn secondary" id="t-bk-share">📤 Отправить</button>' : ''}
      <button class="btn gold" id="t-bk-code">📋 Скопировать код</button>
    </div>
    <textarea class="t-report" id="t-bk-code-out" readonly hidden rows="3" aria-label="Код прогресса"></textarea>

    <h4 class="t-h4">Загрузить прогресс</h4>
    <div class="controls">
      <label class="btn secondary t-file-btn">📂 Из файла<input type="file" id="t-bk-in" accept=".json,application/json,.txt" hidden /></label>
    </div>
    <textarea class="t-report" id="t-bk-paste" rows="3" placeholder="…или вставьте сюда код (начинается с EQ1.)" aria-label="Код прогресса для загрузки"></textarea>
    <div class="controls"><button class="btn secondary" id="t-bk-paste-go">Загрузить код</button></div>
    <div id="t-bk-preview"></div>
    ${hasUndo ? '<p class="t-muted">Прогресс недавно заменили или сбросили. <button class="icon-btn" id="t-bk-undo">↩︎ Вернуть прежний</button></p>' : ''}`;
}
export function daysAgo(t){
  const d = Math.round((startOfDay(Date.now()) - startOfDay(t)) / DAY);
  return d <= 0 ? 'сегодня' : d === 1 ? 'вчера' : `${d} дн. назад`;
}

export function showImportPreview(parsed){
  pendingImport = parsed;
  const box = document.getElementById('t-bk-preview');
  box.innerHTML = `
    <div class="t-bk-card">
      <p>${parsed.profile.name ? `<b>${escapeHtml(parsed.profile.avatar)} ${escapeHtml(parsed.profile.name)}.</b> ` : ''}${escapeHtml(summaryText(parsed.summary, parsed.exportedAt))}</p>
      <div class="controls">
        <button class="btn" id="t-bk-view">👀 Только посмотреть</button>
        <button class="btn secondary" id="t-bk-add">➕ Добавить как нового ученика</button>
        <button class="btn rose" id="t-bk-replace">♻️ Заменить прогресс: ${escapeHtml(activeProfile().name)}</button>
        <button class="icon-btn" id="t-bk-cancel">Отмена</button>
      </div>
      <p class="t-muted">«Посмотреть» — для репетитора: откроется статистика из копии, здесь ничего не изменится.</p>
    </div>`;
  document.getElementById('t-bk-view').onclick = () => viewOtherState(parsed);
  document.getElementById('t-bk-replace').onclick = () => {
    if (!confirm('Заменить прогресс на этом устройстве прогрессом из копии? Текущий прогресс можно будет вернуть.')) return;
    restoreState(parsed.state);
  };
  document.getElementById('t-bk-add').onclick = async () => {
    const name = parsed.profile.name || prompt('Как зовут ученика?', '') || '';
    await createProfile(name, parsed.profile.avatar, parsed.state);
    pendingImport = null;
    toast('➕ Ученик добавлен — переключиться можно через «Кто занимается?»');
    openTutorPanel();
  };
  document.getElementById('t-bk-cancel').onclick = () => { pendingImport = null; box.innerHTML = ''; };
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
export function importError(e){
  document.getElementById('t-bk-preview').innerHTML = `<p class="gate-err" role="alert">${escapeHtml(e.message || 'Не удалось прочитать копию.')}</p>`;
}

export function restoreState(newState){
  try { getLS()?.setItem(undoKey(), JSON.stringify(state)); } catch (e) {}
  setState(newState);
  applyLoadedState();
  toast('♻️ Прогресс восстановлен из копии');
  openTutorPanel();
}
// Сброс прогресса: настройки (PIN, тема, цель дня) остаются, прежний прогресс можно вернуть.
export function resetSectionHtml(){
  return `
    <p class="t-muted">Удалит прогресс, ошибки, задания и награды на этом устройстве. PIN, тема и цель дня сохранятся. Сброс можно отменить кнопкой «Вернуть прежний» в разделе «Перенос и резервная копия».</p>
    <div class="controls"><button class="btn rose" id="t-reset">♻️ Сбросить прогресс</button></div>`;
}
export function wireResetSection(){
  const btn = document.getElementById('t-reset');
  if (btn) btn.onclick = () => {
    if (!confirm('Сбросить весь прогресс ученика на этом устройстве? Его можно будет вернуть.')) return;
    try { getLS()?.setItem(undoKey(), JSON.stringify(state)); } catch (e) {}
    const fresh = freshState();
    const { lastBackup, ...keep } = state.settings;
    fresh.settings = { ...fresh.settings, ...keep };
    setState(fresh);
    applyLoadedState();
    toast('Прогресс сброшен');
    openTutorPanel();
  };
}

export function undoRestore(){
  let prev = null;
  try { prev = JSON.parse(getLS()?.getItem(undoKey()) || 'null'); } catch (e) {}
  if (!prev) return;
  setState(sanitizeState(prev));
  try { getLS()?.removeItem(undoKey()); } catch (e) {}
  applyLoadedState();
  toast('↩︎ Прежний прогресс возвращён');
  openTutorPanel();
}
export function applyLoadedState(){
  saveState();
  const theme = state.settings.theme || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('btn-theme').textContent = theme === 'light' ? '🌙' : '☀️';
  renderHUD(); renderMap(); renderInventory(); renderMistakes(); renderHomework(); renderGoal(true);
}

// Просмотр чужого прогресса: панель рисуется по копии, сохранение отключено.
export function viewOtherState(parsed){
  if (!realState) setRealState(state);
  setState(parsed.state);
  state._viewMeta = parsed;
  openTutorPanel();
}
export function endView(){
  if (!realState) return;
  setState(realState);
  setRealState(null);
}

export function wireBackupSection(){
  document.getElementById('t-bk-file').onclick = () => {
    const blob = new Blob([JSON.stringify(backupPayload(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = backupFileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    markBackedUp();
    toast('💾 Файл сохранён');
  };
  const share = document.getElementById('t-bk-share');
  if (share) share.onclick = async () => {
    const file = new File([JSON.stringify(backupPayload())], backupFileName(), { type: 'application/json' });
    try { await navigator.share({ files: [file], title: 'English Quest — прогресс', text: summaryText(stateSummary(state), Date.now()) }); markBackedUp(); }
    catch (e) { if (e.name !== 'AbortError') toast('Не получилось отправить — сохраните файл'); }
  };
  document.getElementById('t-bk-code').onclick = async () => {
    const out = document.getElementById('t-bk-code-out');
    out.value = await encodeCode(backupPayload());
    out.hidden = false;
    markBackedUp();
    toast(await copyText(out.value, out) ? `📋 Код скопирован (${out.value.length} симв.)` : 'Скопируйте код из поля');
  };
  document.getElementById('t-bk-in').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { showImportPreview(parseBackup(JSON.parse(await f.text()))); }
    catch (err) { importError(err instanceof SyntaxError ? new Error('Файл повреждён или это не копия English Quest.') : err); }
    e.target.value = '';
  };
  document.getElementById('t-bk-paste-go').onclick = async () => {
    const code = document.getElementById('t-bk-paste').value.trim();
    if (!code) return;
    try { showImportPreview(parseBackup(await decodeCode(code))); }
    catch (err) { importError(err instanceof SyntaxError ? new Error('Код повреждён — скопируйте его целиком.') : err); }
  };
  const undo = document.getElementById('t-bk-undo');
  if (undo) undo.onclick = () => { if (confirm('Вернуть прогресс, который был до восстановления из копии?')) undoRestore(); };
}
