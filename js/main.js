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
import './nav.js';
import { applyFreezes, openFreezeInfo, renderGoal } from './activity.js';
import { HARLOW_LINES, narratorLines } from './eq.js';
import { narratorHero } from './heroes.js';
import { applyHomeworkFromHash, renderHomework } from './homework.js';
import { renderAchievements } from './achievements.js';
import { openParcel } from './parcels.js';
import { onPlacementClick } from './placement.js';
import { renderHUD, renderInventory, renderTeam } from './hud.js';
import { renderMap, runNextStep } from './map.js';
import { startRevenge } from './revenge.js';
import { renderMistakes, startReview } from './mistakes.js';
import { loadProfiles, loadState, saveState, setProfiles, setState, state, takeDeviceSettings } from './state.js';
import { multi, openProfileChooser, renderProfileChip } from './profiles.js';
import { initCloud, linkFromHash, syncNow, viewFromHash } from './cloud.js';
import { familyFromHash } from './family.js';
import { openTeam, teamFromHash } from './team.js';
import { initDictionary } from './dictionary.js';
import { showNarrator, toast } from './ui.js';
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
document.getElementById('btn-hero-start').onclick = () => runNextStep();
// реванш — с карты, из «Моих ошибок» и с кнопки «Продолжить»
document.addEventListener('click', (e) => { if (e.target.closest('[data-revenge]')) startRevenge(); });
// посылка от Dr. Harlow: баннер над картой (js/parcels.js)
document.addEventListener('click', (e) => { const b = e.target.closest('[data-parcel]'); if (b) openParcel(b.dataset.parcel, renderMap); });
// вступительное испытание: карточка стража ворот над картой (js/placement.js)
document.addEventListener('click', (e) => { const b = e.target.closest('[data-placement]'); if (b) onPlacementClick(b, renderMap); });
document.addEventListener('click', (e) => { if (e.target.closest('[data-team]')) openTeam(); });   // «👥 Играть командой» над картой
document.addEventListener('eq:revenge', () => startRevenge());
document.addEventListener('eq:review', () => startReview());
document.getElementById('btn-hero-team').onclick = () => document.getElementById('team-sec').scrollIntoView({behavior:'smooth'});

// ---------- INIT ----------
(async function init(){
  initCloud();
  initDictionary();
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
  renderAchievements();
  renderMistakes();
  renderProfileChip();
  // несколько учеников: спрашиваем, кто занимается (и для кого пришло задание по ссылке)
  const chooseThenHomework = () => {
    const hw = location.hash.startsWith('#hw');
    if (multi()) openProfileChooser({ note: hw ? '📬 Пришло домашнее задание — для кого оно?' : '', onPick: () => applyHomeworkFromHash() });
    else applyHomeworkFromHash();
  };
  // ссылки из кабинета учителя: подключить устройство (#link=…) или посмотреть прогресс (#view=…);
  // ключ семьи: QR-код карточки (#fk=…) и письмо «новый ключ» (#famkey=…). viewFromHash — последней: она асинхронная
  // командный квест: QR-код комнаты (#room=…)
  const fromTeacher = () => linkFromHash() || familyFromHash() || teamFromHash() || viewFromHash();
  if (!(await fromTeacher())) chooseThenHomework();
  // ссылка на задание, открытая во вкладке, где приложение уже запущено
  window.addEventListener('hashchange', () => { if (location.hash.startsWith('#hw')) chooseThenHomework(); else fromTeacher(); });
  syncNow();   // подключённый к серверу профиль — сразу забрать новое с других устройств
  document.getElementById('btn-profile').onclick = () => openProfileChooser();
  document.getElementById('stat-freeze').onclick = openFreezeInfo;
  try { document.getElementById('howto-new').hidden = !!localStorage.getItem('eq_howto_seen'); } catch (e) {}
  renderHomework();
  renderGoal(true);
  // приветствие ведущего
  setTimeout(() => {
    // у Nurse Luna (ведущая, если ребёнок играет за Dr. Harlow) нет приветствия «Я Dr. Harlow»
    showNarrator(pick(HARLOW_LINES.welcome.filter(t => narratorLines(narratorHero().id).includes(t))));
  }, 900);
})();
