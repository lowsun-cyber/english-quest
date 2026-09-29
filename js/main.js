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
import './lock.js';
import './profiles.js';
import './cloud.js';
import { applyFreezes, openFreezeInfo, renderGoal } from './activity.js';
import { CHARACTERS, HARLOW_LINES } from './eq.js';
import { applyHomeworkFromHash, renderHomework } from './homework.js';
import { renderHUD, renderInventory, renderTeam } from './hud.js';
import { currentNode, mapGrade, openNode, renderMap } from './map.js';
import { renderMistakes } from './mistakes.js';
import { loadProfiles, loadState, saveState, setProfiles, setState, state, takeDeviceSettings } from './state.js';
import { multi, openProfileChooser, renderProfileChip } from './profiles.js';
import { initCloud, linkFromHash, syncNow, viewFromHash } from './cloud.js';
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

// ---------- CTA ----------
document.getElementById('btn-hero-start').onclick = () => {
  const n = currentNode(mapGrade());
  if (n) openNode(n);
  else document.getElementById('lessons-sec').scrollIntoView({ behavior: 'smooth' });
};
document.getElementById('btn-hero-team').onclick = () => document.getElementById('team-sec').scrollIntoView({behavior:'smooth'});

// ---------- INIT ----------
(async function init(){
  initCloud();
  setProfiles(await loadProfiles());
  setState(takeDeviceSettings(await loadState()));
  saveState(); // PIN из старого места уже перенесён в индекс устройства — пересохраняем без него
  applyFreezes();
  const theme = state.settings?.theme || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('btn-theme').textContent = theme === 'light' ? '🌙' : '☀️';
  renderHUD();
  renderTeam();
  renderMap();
  renderInventory();
  renderMistakes();
  renderProfileChip();
  // несколько учеников: спрашиваем, кто занимается (и для кого пришло задание по ссылке)
  const chooseThenHomework = () => {
    const hw = location.hash.startsWith('#hw');
    if (multi()) openProfileChooser({ note: hw ? '📬 Пришло домашнее задание — для кого оно?' : '', onPick: () => applyHomeworkFromHash() });
    else applyHomeworkFromHash();
  };
  // ссылки из кабинета учителя: подключить устройство (#link=…) или посмотреть прогресс (#view=…)
  const fromTeacher = () => linkFromHash() || viewFromHash();
  if (!(await fromTeacher())) chooseThenHomework();
  // ссылка на задание, открытая во вкладке, где приложение уже запущено
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#hw')) chooseThenHomework(); else fromTeacher(); });
  syncNow();   // подключённый к серверу профиль — сразу забрать новое с других устройств
  document.getElementById('btn-profile').onclick = () => openProfileChooser();
  document.getElementById('stat-freeze').onclick = openFreezeInfo;
  try { document.getElementById('howto-new').hidden = !!localStorage.getItem('eq_howto_seen'); } catch (e) {}
  renderHomework();
  renderGoal(true);
  // welcome from Harlow
  setTimeout(() => {
    showGuide('Dr. Harlow', pick(HARLOW_LINES.welcome), CHARACTERS.harlow);
  }, 900);
})();
