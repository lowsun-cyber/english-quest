// English Quest — Замок панели для взрослых: пример на умножение или PIN-код.
// Это защита от случайного входа ребёнка, а не от взлома: код открыт, данные в браузере.
// PIN общий для устройства (индекс учеников) и хранится хешем, а не цифрами.
import { profiles, saveProfiles } from './state.js';
import { openModal, toast } from './ui.js';
import { fmtDay, dayKey } from './util.js';

const UNLOCK_MINUTES = 15;   // после входа панель столько открывается без PIN
const MAX_TRIES = 5, COOLDOWN_SEC = 30;
let unlockedUntil = 0;
let fails = 0, blockedUntil = 0;

function pinHash(pin){
  let h = 0x811c9dc5;
  for (const c of 'english-quest|' + pin){ h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}
export const hasPin = () => !!profiles?.tutorPin;
export const isUnlocked = () => Date.now() < unlockedUntil;
function unlock(){ unlockedUntil = Date.now() + UNLOCK_MINUTES * 60000; fails = 0; }
export function lockNow(){ unlockedUntil = 0; }

// onOpen — что показать после входа (панель репетитора)
export function openGate(onOpen){
  if (isUnlocked()) return onOpen();
  if (!hasPin()) return mathGate(onOpen, 6, 4, 6, 4, 'Здесь статистика и домашние задания. Чтобы войти, реши пример.', () => { unlock(); onOpen(); });
  openModal(`
    <h2>Для взрослых</h2>
    <div class="lead">Введите PIN-код панели.</div>
    <form class="gate" id="gate-form">
      <label for="gate-in" class="gate-q">PIN</label>
      <input id="gate-in" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" required />
      <button class="btn" type="submit" id="gate-go">Войти</button>
    </form>
    <p class="gate-err" id="gate-err" role="alert"></p>
    <button class="gate-forgot" id="gate-forgot" type="button">Забыли PIN?</button>
  `);
  const input = document.getElementById('gate-in'), err = document.getElementById('gate-err'), go = document.getElementById('gate-go');
  const cooldown = () => {
    const left = Math.ceil((blockedUntil - Date.now()) / 1000);
    if (left <= 0 || !go.isConnected){ go.disabled = false; if (go.isConnected && /Подождите/.test(err.textContent)) err.textContent = ''; return; }
    go.disabled = true;
    err.textContent = `Слишком много попыток. Подождите ${left} с.`;
    setTimeout(cooldown, 1000);
  };
  cooldown();
  input.focus();
  document.getElementById('gate-form').onsubmit = (e) => {
    e.preventDefault();
    if (Date.now() < blockedUntil) return;
    if (pinHash(input.value) === profiles.tutorPin){ unlock(); onOpen(); return; }
    input.value = '';
    if (++fails >= MAX_TRIES){ fails = 0; blockedUntil = Date.now() + COOLDOWN_SEC * 1000; cooldown(); }
    else err.textContent = `Неверный PIN. Осталось попыток: ${MAX_TRIES - fails}.`;
  };
  document.getElementById('gate-forgot').onclick = () => mathGate(onOpen, 12, 28, 12, 18,
    'Если PIN забыт, его можно убрать, решив пример. В панели останется отметка, что PIN сбрасывали.',
    () => {
      delete profiles.tutorPin;
      profiles.pinResetAt = Date.now();
      saveProfiles();
      unlock();
      toast('PIN убран — придумайте новый в разделе «Замок панели»');
      onOpen();
    });
}

function mathGate(onOpen, aMin, aSpan, bMin, bSpan, lead, onOk){
  const a = aMin + Math.floor(Math.random() * aSpan), b = bMin + Math.floor(Math.random() * bSpan);
  openModal(`
    <h2>Для взрослых</h2>
    <div class="lead">${lead}</div>
    <form class="gate" id="gate-form">
      <label for="gate-in" class="gate-q">${a} × ${b} =</label>
      <input id="gate-in" type="text" inputmode="numeric" autocomplete="off" maxlength="4" required />
      <button class="btn" type="submit">Войти</button>
    </form>
    <p class="gate-err" id="gate-err" role="alert"></p>
  `);
  const input = document.getElementById('gate-in');
  input.focus();
  document.getElementById('gate-form').onsubmit = (e) => {
    e.preventDefault();
    if (parseInt(input.value, 10) === a * b) onOk();
    else { document.getElementById('gate-err').textContent = 'Неверно. Попробуйте ещё раз.'; input.select(); }
  };
}

// ---- раздел «Замок панели» в панели для взрослых ----
export function pinResetNote(){
  const t = profiles?.pinResetAt;
  return t ? `PIN сбрасывали через «Забыли PIN?» ${fmtDay(dayKey(t))}` : '';
}
export function lockSectionHtml(){
  const note = pinResetNote();
  const form = `
    <form class="t-pin-form" id="t-pin-form" ${hasPin() ? 'hidden' : ''}>
      <label>Новый PIN <input id="t-pin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password" /></label>
      <label>Ещё раз <input id="t-pin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password" /></label>
      <button class="btn" type="submit">${hasPin() ? 'Сохранить PIN' : 'Установить PIN'}</button>
    </form>
    <p class="gate-err" id="t-pin-err" role="alert"></p>`;
  return `
    ${note ? `<p class="t-warn">⚠️ ${note}. Если это были не вы — поставьте новый PIN.</p>` : ''}
    ${hasPin()
      ? `<p class="t-muted">✓ Вход по PIN-коду. После входа панель ${UNLOCK_MINUTES} минут открывается без PIN.</p>
         <div class="controls">
           <button class="btn secondary" id="t-pin-change">Сменить PIN</button>
           <button class="icon-btn" id="t-pin-remove">Убрать PIN</button>
           <button class="icon-btn" id="t-lock-now">🔒 Закрыть замок сейчас</button>
         </div>`
      : `<p class="t-muted">Сейчас вход по примеру на умножение — ученик 3–4 класса легко его решит. Придумайте PIN из 4 цифр, чтобы в панель не заходили без вас.</p>`}
    ${form}`;
}
export function wireLockSection(onChange, onLock){
  const form = document.getElementById('t-pin-form');
  if (!form) return;
  const err = document.getElementById('t-pin-err');
  form.onsubmit = (e) => {
    e.preventDefault();
    const p1 = document.getElementById('t-pin1').value, p2 = document.getElementById('t-pin2').value;
    if (!/^\d{4}$/.test(p1)){ err.textContent = 'PIN — ровно 4 цифры.'; return; }
    if (p1 !== p2){ err.textContent = 'PIN-коды не совпадают.'; return; }
    profiles.tutorPin = pinHash(p1);
    delete profiles.pinResetAt;
    saveProfiles();
    toast('🔒 PIN установлен');
    onChange();
  };
  const change = document.getElementById('t-pin-change');
  if (change) change.onclick = () => { form.hidden = false; document.getElementById('t-pin1').focus(); };
  const remove = document.getElementById('t-pin-remove');
  if (remove) remove.onclick = () => {
    if (!confirm('Убрать PIN? Вход снова будет по примеру на умножение.')) return;
    delete profiles.tutorPin;
    saveProfiles();
    toast('PIN убран');
    onChange();
  };
  const lock = document.getElementById('t-lock-now');
  if (lock) lock.onclick = () => { lockNow(); onLock(); toast('🔒 Панель закрыта'); };
}
