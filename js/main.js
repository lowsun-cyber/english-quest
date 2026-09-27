// English Quest — Точка входа: тема, сброс, кнопки главного экрана, запуск.
// Все модули подключаются здесь, чтобы их обработчики событий зарегистрировались.
import './activity.js';
import './backup.js';
import './checkpoint.js';
import './eq.js';
import './exercises.js';
import './homework.js';
import './hud.js';
import './map.js';
import './mistakes.js';
import './offline.js';
import './state.js';
import './tts.js';
import './tutor.js';
import './ui.js';
import './util.js';
import './worksheet.js';
import { renderGoal } from './activity.js';
import { CHARACTERS, HARLOW_LINES } from './eq.js';
import { applyHomeworkFromHash, renderHomework } from './homework.js';
import { renderHUD, renderInventory, renderTeam } from './hud.js';
import { currentNode, mapGrade, openNode, renderMap } from './map.js';
import { renderMistakes } from './mistakes.js';
import { freshState, loadState, saveState, setState, state } from './state.js';
import { showGuide, toast } from './ui.js';
import { pick } from './util.js';

// ---------- THEME ----------
document.getElementById('btn-theme').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const nxt = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', nxt);
  state.settings.theme = nxt;
  document.getElementById('btn-theme').textContent = nxt === 'light' ? '🌙' : '☀️';
  saveState();
};

// ---------- RESET ----------
document.getElementById('btn-reset').onclick = () => {
  if (!confirm('Сбросить весь прогресс?')) return;
  setState(freshState());
  saveState();
  renderHUD(); renderInventory(); renderMap(); renderMistakes(); renderHomework(); renderGoal(true);
  toast('Прогресс сброшен');
};

// ---------- CTA ----------
document.getElementById('btn-hero-start').onclick = () => {
  const n = currentNode(mapGrade());
  if (n) openNode(n);
  else document.getElementById('lessons-sec').scrollIntoView({ behavior: 'smooth' });
};
document.getElementById('btn-hero-team').onclick = () => document.getElementById('team-sec').scrollIntoView({behavior:'smooth'});

// ---------- INIT ----------
(async function init(){
  setState(await loadState());
  const theme = state.settings?.theme || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('btn-theme').textContent = theme === 'light' ? '🌙' : '☀️';
  renderHUD();
  renderTeam();
  renderMap();
  renderInventory();
  renderMistakes();
  applyHomeworkFromHash();
  // ссылка на задание, открытая во вкладке, где приложение уже запущено
  window.addEventListener('hashchange', applyHomeworkFromHash);
  renderHomework();
  renderGoal(true);
  // welcome from Harlow
  setTimeout(() => {
    showGuide('Dr. Harlow', pick(HARLOW_LINES.welcome), CHARACTERS.harlow);
  }, 900);
})();
