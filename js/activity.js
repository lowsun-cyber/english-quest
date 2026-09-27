// English Quest — Учёт времени и ответов по дням; цель дня и серия дней.
import { reward } from './hud.js';
import { realState, saveState, state } from './state.js';
import { back, confetti, modal, toast } from './ui.js';
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
export const GOAL_OPTIONS = [5, 10, 15, 20];
export function goalMinutes(){ return GOAL_OPTIONS.includes(state.settings.dailyGoal) ? state.settings.dailyGoal : 10; }
export function dayMet(k){ return !!state.activity[k]?.goalMet; }
export function streakInfo(){
  const today = dayKey(), todayMet = dayMet(today);
  let k = todayMet ? today : shiftDay(today, -1), n = 0;
  while (dayMet(k)){ n++; k = shiftDay(k, -1); }
  return { streak: n, todayMet, best: Math.max(state.bestStreak || 0, n) };
}
export function checkGoal(){
  const a = todayActivity();
  if (a.goalMet || a.sec < goalMinutes() * 60) return;
  a.goalMet = true;
  const { streak } = streakInfo();
  state.bestStreak = Math.max(state.bestStreak || 0, streak);
  confetti();
  toast(`🎯 Цель дня выполнена! 🔥 ${streak} ${plural(streak, 'день', 'дня', 'дней')} подряд`);
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
