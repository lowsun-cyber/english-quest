// English Quest — Достижения: проверка условий, выдача один раз, «Сундук достижений» на главной.
// Список и условия — ACHIEVEMENTS в content.js, расчёт — achievementsOf() в stats.js.
import { ACHIEVEMENTS } from './eq.js';
import { activeId, saveState, state } from './state.js';
import { achievementsOf, rarityOf } from './stats.js';
import { confetti, toast } from './ui.js';
import { escapeHtml } from './util.js';

// Новые достижения записываются в прогресс. Первый расчёт для ученика (запуск, смена ученика, старый
// прогресс после обновления) выдаёт заслуженное тихо, без поздравлений.
let checkedFor = null;
export function checkAchievements(){
  if (!state || state._viewMeta) return;   // репетитор смотрит чужой прогресс — ничего не выдаём
  const quiet = checkedFor !== activeId();
  checkedFor = activeId();
  const fresh = achievementsOf(state).filter(id => !state.achievements[id]);
  if (!fresh.length) return;
  for (const id of fresh) state.achievements[id] = Date.now();
  saveState();
  renderAchievements();
  if (quiet) return;
  const a = ACHIEVEMENTS.find(x => x.id === fresh[fresh.length - 1]);
  confetti();
  toast(`${a.emoji} Достижение: ${a.title}!`);
}

export function renderAchievements(){
  const wrap = document.getElementById('achievements');
  if (!wrap || !state) return;
  const got = ACHIEVEMENTS.filter(a => state.achievements[a.id]).length;
  document.getElementById('ach-count').textContent = `${got} из ${ACHIEVEMENTS.length}`;
  wrap.innerHTML = ACHIEVEMENTS.map(a => {
    const has = !!state.achievements[a.id], r = rarityOf(a.rarity), hidden = a.secret && !has;
    const label = hidden ? 'Секретное достижение' : `${a.title}. ${r.title}. ${has ? 'Получено' : a.text}`;
    return `<li class="ach rarity-${a.rarity}${has ? ' got' : ''}" style="--rarity:${r.color}" aria-label="${escapeHtml(label)}">
      <span class="ach-em" aria-hidden="true">${hidden ? '❔' : has ? a.emoji : '🔒'}</span>
      <b>${hidden ? '???' : escapeHtml(a.title)}</b>
      <small>${hidden ? 'секрет' : has ? r.title : escapeHtml(a.text)}</small>
    </li>`;
  }).join('');
}
