// English Quest — Шапка (XP, монеты, серия, заморозки), команда героев, инвентарь, награды и штрафы.
import { logAnswer, streakInfo } from './activity.js';
import { CHARACTERS, HARLOW_LINES, LESSONS, MAX_LEVEL, RANKS, RANK_STEPS, heroIntro, levelFromXp, totalXpForLevel } from './eq.js';
import { heroPic, playerHero, setHeroMood } from './heroes.js';
import { checkAchievements } from './achievements.js';
import { renderClinic } from './clinic.js';
import { isReplay } from './quests.js';
import { CHECKPOINTS } from './map.js';
import { activeId, saveState, state } from './state.js';
import { speak } from './tts.js';
import { confetti, openModal, showGuide, toast } from './ui.js';
import { pick } from './util.js';
import { isLessonComplete as lessonComplete, regionRanks, topRank } from './stats.js';

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
  const rk = topRank(state), rt = document.getElementById('rank-title');
  rt.textContent = rk ? `${rk.emoji} ${rk.title}` : '🌱 Новичок';
  rt.style.setProperty('--rank-color', rk ? rk.color : 'var(--grass-3)');
  rt.setAttribute('aria-label', `${rk ? `Звание: ${rk.title}` : 'Звания пока нет'}. Показать все звания`);
  const hr = document.getElementById('hud-rank');   // звание под именем игрока в шапке
  if (hr) hr.textContent = rk ? rk.title : 'Новичок';
  celebrateRanks();
  checkAchievements();
  renderClinic();
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

// ---------- RANKS ----------
// Новый ранг региона — поздравление. Первый расчёт для ученика (запуск, смена ученика) только запоминает ранги.
let seenRanks = null;
function celebrateRanks(){
  const rr = regionRanks(state), who = activeId();
  if (seenRanks && seenRanks.who === who){
    const got = rr.filter((r, i) => r.step > seenRanks.steps[i]).map(r => r.rank);
    if (got.length){
      const rk = got[got.length - 1];
      confetti();
      toast(`${rk.emoji} Новое звание: ${rk.title}!`);
    }
  }
  seenRanks = { who, steps: rr.map(r => r.step) };
  // запоминаем полученные звания: новые темы в регионе их не отнимут
  if (!state._viewMeta && rr.some(r => r.step > (state.rankSteps?.[r.region.id] || 0))){
    state.rankSteps = { ...(state.rankSteps || {}), ...Object.fromEntries(rr.map(r => [r.region.id, Math.max(r.step, state.rankSteps?.[r.region.id] || 0)])) };
    saveState();
  }
}
// «Мои звания»: по 4 ранга в каждом регионе и что нужно для следующего
export function openRanks(){
  openModal(`
    <h2>🏅 Мои звания</h2>
    <p class="t-muted">В каждом регионе — 4 звания. Они открываются за пройденные темы и проверки.</p>
    ${regionRanks(state).map(r => `
      <section class="rank-region" style="--rank-color:${r.region.color}">
        <h3>${r.region.emoji} ${r.region.name} <small>· ${r.region.grade} класс</small></h3>
        <ol class="rank-steps" role="list">
          ${RANKS.filter(x => x.region === r.region.id).map(x => `
            <li class="${x.step <= r.step ? 'got' : ''}" style="--rank-color:${x.color}">
              <span class="rank-em" aria-hidden="true">${x.step <= r.step ? x.emoji : '🔒'}</span>
              <b>${x.title}</b>
              <small>${x.step <= r.step ? 'получено ✓' : RANK_STEPS[x.step - 1]}</small>
            </li>`).join('')}
        </ol>
        <p class="t-muted">Тем пройдено: ${r.done} из ${r.lessons} · проверок сдано: ${r.passed} из ${r.checkpoints}</p>
      </section>`).join('')}
  `);
}
document.getElementById('rank-title')?.addEventListener('click', openRanks);

// ---------- TEAM ----------
export function renderTeam(){
  const container = document.getElementById('team');
  container.innerHTML = '';
  const mine = playerHero(state);
  Object.values(CHARACTERS).forEach(c => {
    const card = document.createElement('div');
    card.className = 'char-card' + (c === mine ? ' mine' : '');
    card.innerHTML = `
      <div class="char-avatar" style="--hero-color:${c.color}">
        ${heroPic(c, 'full')}
        <span class="avatar-plate"></span>
      </div>
      <div class="char-name">${c.name}</div>
      <div class="char-sub">${c.subtitle}</div>
      <div class="char-role">${c.role}</div>
      ${c.playable ? (c === mine
        ? '<div class="char-mine">⭐ Твой герой</div>'
        : `<button class="btn secondary char-pick" type="button">Играть за ${c.name}</button>`) : ''}
    `;
    card.addEventListener('click', () => {
      const { en, ru } = heroIntro(c);
      showGuide(c.name, ru, c);
      speak(en);
    });
    card.querySelector('.char-pick')?.addEventListener('click', (e) => { e.stopPropagation(); chooseHero(c.id); });
    container.appendChild(card);
  });
}
// Герой-аватар ученика: хранится в прогрессе (state.hero) и синхронизируется вместе с ним
export function chooseHero(id){
  if (!CHARACTERS[id]?.playable) return;
  state.hero = id;
  saveState();
  renderTeam();
  document.dispatchEvent(new Event('eq:hero'));   // чип ученика в шапке
  toast(`${CHARACTERS[id].emoji} Теперь твой герой — ${CHARACTERS[id].name}!`);
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
// Сколько опыта дал последний верный ответ (с учётом повтора квеста) — для всплывающих «+N XP»
export let lastXp = 0;
export function reward(xp, gold, opts={}){
  if (!opts.bonus) logAnswer(true);
  if (!opts.bonus && isReplay()) xp = Math.ceil(xp / 2);   // повтор пройденного квеста — половина опыта
  if (!opts.bonus) lastXp = xp;
  const prevLvl = levelFromXp(state.xp);
  state.xp += xp;
  state.gold += gold;
  state.streak += 1;
  if (opts.item) addItem(opts.item, 1);
  if (!opts.bonus) setHeroMood('happy');   // гид упражнения радуется верному ответу
  const newLvl = levelFromXp(state.xp);
  if (newLvl > prevLvl){
    confetti();
    toast(`🎉 Level ${newLvl}!`);
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
  setHeroMood('hint');   // и подсказывает после ошибки
  state.streak = 0;
  saveState();
  renderHUD();
}
