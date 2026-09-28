// English Quest — Учёт времени и ответов по дням; цель дня и серия дней.
import { renderHUD, reward } from './hud.js';
import { realState, saveState, state } from './state.js';
import { back, closeModal, confetti, modal, openModal, toast } from './ui.js';
import { dayKey, plural, shiftDay } from './util.js';

// ---------- АКТИВНОСТЬ (для режима репетитора) ----------
// По дням: секунды занятий и ответы. Время считаем только пока открыт урок/повторение
// и ребёнок что-то нажимал за последние 90 секунд — чтобы открытая вкладка не «накручивала» минуты.
export const ACTIVITY_TICK = 5; // сек
export let lastInteraction = 0;
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  window.addEventListener(ev, () => { lastInteraction = Date.now(); }, { passive: true, capture: true }));

export function todayActivity(){
  const k = dayKey();
  return state.activity[k] || (state.activity[k] = { sec: 0, ok: 0, bad: 0 });
}
export function logAnswer(ok){ todayActivity()[ok ? 'ok' : 'bad'] += 1; }

export let _ticks = 0;
setInterval(() => {
  if (!state || realState) return;
  const practising = document.getElementById('modal-back').classList.contains('open')
    && document.visibilityState === 'visible'
    && Date.now() - lastInteraction < 90000;
  if (!practising) return;
  todayActivity().sec += ACTIVITY_TICK;
  checkGoal();
  renderGoal();
  if (++_ticks % 6 === 0) saveState(); // раз в ~30 с
}, ACTIVITY_TICK * 1000);

// ---------- ЦЕЛЬ ДНЯ И СЕРИЯ ДНЕЙ ----------
// Цель — минуты занятий в день (считаются так же, как статистика: при открытом уроке).
// День засчитан, когда цель выполнена (activity[день].goalMet). Серия — дни подряд,
// включая сегодня или, если сегодня ещё не выполнено, заканчивая вчера.
// 🧊 Заморозка закрывает пропущенный день (activity[день].frozen): серия не рвётся, но и не растёт.
// Заморозку дают за каждые 7 дней серии или продают за монеты; хранить можно FREEZE_MAX.
export const GOAL_OPTIONS = [5, 10, 15, 20];
export function goalMinutes(){ return GOAL_OPTIONS.includes(state.settings.dailyGoal) ? state.settings.dailyGoal : 10; }
export const FREEZE_MAX = 2, FREEZE_PRICE = 50, FREEZE_EVERY = 7;
export function dayMet(k){ return !!state.activity[k]?.goalMet; }
export function dayFrozen(k){ return !!state.activity[k]?.frozen; }
export function streakInfo(){
  const today = dayKey(), todayMet = dayMet(today);
  let k = todayMet ? today : shiftDay(today, -1), n = 0;
  while (dayMet(k) || dayFrozen(k)){ if (dayMet(k)) n++; k = shiftDay(k, -1); }
  return { streak: n, todayMet, best: Math.max(state.bestStreak || 0, n), freezes: state.freezes || 0 };
}
// Закрыть пропуски заморозками — при запуске и при смене ученика.
// Тратим, только если заморозок хватает на все пропущенные дни, иначе серия всё равно прервётся.
export function applyFreezes(){
  const today = dayKey();
  let k = shiftDay(today, -1);
  const gap = [];
  for (let i = 0; i < 60 && !dayMet(k) && !dayFrozen(k); i++){ gap.push(k); k = shiftDay(k, -1); }
  if (!gap.length || !dayMet(k) || gap.length > (state.freezes || 0)) return 0;
  for (const d of gap) (state.activity[d] ||= { sec: 0, ok: 0, bad: 0 }).frozen = true;
  state.freezes -= gap.length;
  saveState();
  toast(`🧊 Заморозка спасла серию! ${gap.length === 1 ? 'Вчера занятий не было' : `Пропущено дней: ${gap.length}`}, но 🔥 продолжается.`);
  return gap.length;
}
export function buyFreeze(){
  if ((state.freezes || 0) >= FREEZE_MAX || state.gold < FREEZE_PRICE) return false;
  state.gold -= FREEZE_PRICE;
  state.freezes = (state.freezes || 0) + 1;
  saveState();
  return true;
}
export function checkGoal(){
  const a = todayActivity();
  if (a.goalMet || a.sec < goalMinutes() * 60) return;
  a.goalMet = true;
  const { streak } = streakInfo();
  state.bestStreak = Math.max(state.bestStreak || 0, streak);
  confetti();
  toast(`🎯 Цель дня выполнена! 🔥 ${streak} ${plural(streak, 'день', 'дня', 'дней')} подряд`);
  if (streak % FREEZE_EVERY === 0 && (state.freezes || 0) < FREEZE_MAX){
    state.freezes = (state.freezes || 0) + 1;
    setTimeout(() => toast(`🧊 +1 заморозка за ${streak} ${plural(streak, 'день', 'дня', 'дней')} подряд!`), 2600);
  }
  reward(20, 5, { bonus: true }); // сохраняет состояние и обновляет шапку
  renderGoal();
}
export let _goalShown = '';
export function renderGoal(force){
  const el = document.getElementById('goal');
  if (!el || !state) return;
  const goal = goalMinutes(), a = state.activity[dayKey()] || { sec: 0 };
  const min = Math.floor(a.sec / 60), met = !!a.goalMet;
  const key = `${dayKey()}|${goal}|${min}|${met}`;
  if (key === _goalShown && !force) return;
  _goalShown = key;
  el.classList.toggle('met', met);
  el.style.setProperty('--p', met ? 100 : Math.min(100, Math.round(a.sec * 100 / (goal * 60))));
  document.getElementById('goal-min').textContent = met ? '✓' : min;
  document.getElementById('goal-sub').textContent = met ? `${min} мин — выполнено!` : `${min} / ${goal} мин`;
  el.setAttribute('aria-label', met ? `Цель дня выполнена: ${min} ${plural(min, 'минута', 'минуты', 'минут')}` : `Цель дня: ${min} из ${goal} минут`);
}

// Окно «🧊 Заморозки»: что это, сколько есть, купить за монеты
export function openFreezeInfo(){
  const fz = state.freezes || 0, gold = state.gold || 0;
  const canBuy = fz < FREEZE_MAX && gold >= FREEZE_PRICE;
  openModal(`
    <h2>🧊 Заморозки</h2>
    <div class="freeze-box">
      <div class="freeze-count" aria-label="Заморозок: ${fz} из ${FREEZE_MAX}">${'🧊'.repeat(fz)}${'<span class="freeze-slot">🧊</span>'.repeat(FREEZE_MAX - fz)}</div>
      <p>Заморозка спасает серию 🔥, если ты пропустишь день. Она срабатывает сама — на следующий день.</p>
      <ul class="freeze-rules">
        <li>Каждые ${FREEZE_EVERY} дней подряд — заморозка в подарок.</li>
        <li>Или купи за ${FREEZE_PRICE} 🪙 (у тебя ${gold} 🪙).</li>
        <li>Больше ${FREEZE_MAX} заморозок хранить нельзя.</li>
      </ul>
    </div>
    <div class="controls">
      <button class="btn gold" id="freeze-buy" ${canBuy ? '' : 'disabled'}>Купить за ${FREEZE_PRICE} 🪙</button>
      <button class="btn secondary" id="freeze-close">Понятно</button>
    </div>
    ${fz >= FREEZE_MAX ? '<p class="t-muted">У тебя уже максимум заморозок.</p>' : gold < FREEZE_PRICE ? `<p class="t-muted">Не хватает ${FREEZE_PRICE - gold} 🪙 — монеты даются за верные ответы.</p>` : ''}
  `);
  document.getElementById('freeze-close').onclick = closeModal;
  document.getElementById('freeze-buy').onclick = () => {
    if (!buyFreeze()) return;
    renderHUD();
    toast('🧊 Заморозка куплена!');
    openFreezeInfo();
  };
}
