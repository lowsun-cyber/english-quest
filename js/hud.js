// English Quest — Шапка (XP, монеты, серия, заморозки), команда героев, инвентарь, награды и штрафы.
import { logAnswer, streakInfo } from './activity.js';
import { CHARACTERS, HARLOW_LINES, LESSONS, MAX_LEVEL, heroIntro, levelFromXp, rankFor, totalXpForLevel } from './eq.js';
import { CHECKPOINTS } from './map.js';
import { saveState, state } from './state.js';
import { speak } from './tts.js';
import { confetti, showGuide, toast } from './ui.js';
import { pick } from './util.js';
import { isLessonComplete as lessonComplete } from './stats.js';

// ---------- HUD RENDER ----------
export function renderHUD(){
  document.getElementById('stat-xp').textContent = state.xp;
  document.getElementById('stat-gold').textContent = state.gold;
  const fz = state.freezes || 0;
  document.getElementById('stat-freezes').textContent = fz;
  const fzBtn = document.getElementById('stat-freeze');
  fzBtn.classList.toggle('empty', !fz);
  fzBtn.title = fz ? `Заморозок: ${fz}. Спасут серию, если пропустишь день` : 'Заморозок нет — нажми, чтобы узнать, как их получить';
  fzBtn.setAttribute('aria-label', fzBtn.title);
  const si = streakInfo();
  const fire = document.getElementById('stat-streak');
  fire.textContent = si.streak;
  fire.parentElement.classList.toggle('pending', !si.todayMet);
  fire.parentElement.title = si.todayMet
    ? `Дней подряд с выполненной целью: ${si.streak}. Сегодня цель выполнена!`
    : si.streak ? `Дней подряд: ${si.streak}. Выполни цель сегодня, чтобы серия продолжилась.` : 'Выполняй цель дня каждый день — начнётся серия 🔥';
  fire.parentElement.setAttribute('aria-label', fire.parentElement.title);
  // level
  const lvl = levelFromXp(state.xp);
  const nextTotal = totalXpForLevel(lvl+1);
  const currentTotal = totalXpForLevel(lvl);
  const need = nextTotal - currentTotal;
  const got = state.xp - currentTotal;
  const pct = Math.min(100, Math.floor(got * 100 / need));
  document.getElementById('level-badge').textContent = 'L' + lvl;
  const rk = rankFor(lvl);
  document.getElementById('rank-title').textContent = `${rk.emoji} ${rk.title}`;
  document.getElementById('rank-title').style.setProperty('--rank-color', rk.color);
  document.getElementById('level-progress').style.width = pct + '%';
  document.getElementById('xp-text').textContent = lvl >= MAX_LEVEL
    ? `Максимум! ${state.xp} XP`
    : `${got} / ${need} XP до уровня ${lvl+1}`;
  // quests
  const completed = LESSONS.filter(l => isLessonComplete(l)).length;
  document.getElementById('stat-quests').textContent = completed;
  document.getElementById('stat-quests-total').textContent = LESSONS.length;
}

export function isLessonComplete(l, st = state){ return lessonComplete(l, st); }

// ---------- TEAM ----------
export function renderTeam(){
  const container = document.getElementById('team');
  container.innerHTML = '';
  Object.values(CHARACTERS).forEach(c => {
    const card = document.createElement('div');
    card.className = 'char-card';
    card.innerHTML = `
      <div class="char-avatar" style="background:${c.color}">
        <span>${c.emoji}</span>
        <span class="avatar-plate"></span>
      </div>
      <div class="char-name">${c.name}</div>
      <div class="char-sub">${c.subtitle}</div>
      <div class="char-role">${c.role}</div>
    `;
    card.addEventListener('click', () => {
      const { en, ru } = heroIntro(c);
      showGuide(c.name, ru, c);
      speak(en);
    });
    container.appendChild(card);
  });
}

// ---------- INVENTORY ----------
export function renderInventory(){
  const inv = document.getElementById('inv');
  inv.innerHTML = '';
  const items = Object.entries(state.inventory)
    .sort(([a], [b]) => (b.startsWith('trophy:') ? 1 : 0) - (a.startsWith('trophy:') ? 1 : 0))
    .slice(0, 48);
  const totalSlots = Math.max(24, Math.ceil((items.length + 4) / 8) * 8);
  for (let i=0;i<totalSlots;i++){
    const slot = document.createElement('div');
    slot.className = 'slot';
    if (items[i]){
      const [word, count] = items[i];
      // find emoji from any lesson
      let em = '📦';
      for (const l of LESSONS) {
        const w = l.words.find(w => w.en === word);
        if (w){ em = w.emoji; break; }
      }
      let label = word;
      if (word.startsWith('trophy:')){
        const cp = CHECKPOINTS.find(c => `trophy:${c.id}` === word);
        em = cp ? cp.emoji : '🏆';
        label = cp ? cp.title : 'Награда';
        slot.classList.add('trophy');
      }
      slot.innerHTML = `${em}<span class="count">${count}</span>`;
      slot.title = `${label}: ${count}`;
    } else {
      slot.classList.add('empty');
    }
    inv.appendChild(slot);
  }
}

export function addItem(word, n=1){
  state.inventory[word] = (state.inventory[word] || 0) + n;
}

// ---------- REWARD ----------
export function reward(xp, gold, opts={}){
  if (!opts.bonus) logAnswer(true);
  const prevLvl = levelFromXp(state.xp);
  state.xp += xp;
  state.gold += gold;
  state.streak += 1;
  if (opts.item) addItem(opts.item, 1);
  const newLvl = levelFromXp(state.xp);
  if (newLvl > prevLvl){
    confetti();
    const rk = rankFor(newLvl);
    toast(`🎉 Level ${newLvl}! ${rk.title}`);
    speak(`Level ${newLvl}!`);
    showGuide('Dr. Harlow', pick(HARLOW_LINES.levelUp), CHARACTERS.harlow);
  }
  saveState();
  renderHUD();
  renderInventory();
}
// Неверный ответ: без штрафа (сердечек больше нет) — ошибка уходит в «Мои ошибки», сбрасывается счётчик верных подряд
export function penalty(){
  logAnswer(false);
  state.streak = 0;
  saveState();
  renderHUD();
}
