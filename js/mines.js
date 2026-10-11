// English Quest — Секретные регионы («Шахты»): туман со счётчиком до открытия, локации после.
// Данные — SECRET_REGIONS в content.js, расчёт — secretRegionState() в stats.js, вопросы — runQuiz (checkpoint.js).
import { runQuiz } from './checkpoint.js';
import { CHARACTERS, QUEST_PASS_PCT } from './eq.js';
import { heroPic } from './heroes.js';
import { renderHUD, reward } from './hud.js';
import { saveState, state } from './state.js';
import { rarityOf, secretKey, secretRegionState } from './stats.js';
import { closeModal, confetti, openModal, toast } from './ui.js';
import { escapeHtml } from './util.js';

let rerender = () => {};
// туман плывёт, только пока сцена на экране (и не плывёт, если анимации отключены в системе)
let fogObserver = null;
function pauseOffscreen(el){
  if (!el || !('IntersectionObserver' in window)) return;
  fogObserver?.disconnect();
  fogObserver = new IntersectionObserver(([e]) => el.classList.toggle('fog-paused', !e.isIntersecting));
  fogObserver.observe(el);
}
// wrap — место карты; onChange — перерисовать карту после квеста
export function renderSecret(wrap, region, onChange){
  rerender = onChange || rerender;
  const S = secretRegionState(region, state);
  if (!S.open){
    // до открытия — только силуэт и счётчик: цель для редких квестов, а сюрприз сохраняется
    // под туманом проступают места региона: чем больше редких квестов, тем реже туман (--reveal 0…1)
    const reveal = Math.min(1, S.have / S.need).toFixed(2);
    const pics = region.locations.filter(l => !l.boss).map(l => l.img).filter(Boolean);
    wrap.innerHTML = `
      <div class="secret-fog" style="--reveal:${reveal}" role="img" aria-label="Тайное место скрыто густым туманом, сквозь него едва что-то видно. Редких квестов пройдено ${S.have} из ${S.need}.">
        <div class="fog-scene" aria-hidden="true">
          ${pics.map((src, i) => `<img class="fog-isl fog-isl-${i}" src="${src}" alt="" draggable="false">`).join('')}
          <span class="fog-cloud fc1"></span><span class="fog-cloud fc2"></span><span class="fog-cloud fc3"></span>
          <span class="fog-q">❔</span>
        </div>
        <h3>Тайное место</h3>
        <p>Где-то здесь, под туманом, что-то спрятано… Проходи <b>редкие квесты</b> на ${QUEST_PASS_PCT}% в любых регионах.</p>
        <div class="fog-bar" aria-hidden="true"><span style="width:${Math.round(S.have * 100 / S.need)}%"></span></div>
        <p class="fog-count">Редких квестов: <b>${S.have} из ${S.need}</b></p>
      </div>`;
    pauseOffscreen(wrap.querySelector('.secret-fog'));
    return;
  }
  const guide = CHARACTERS[region.guide] || CHARACTERS.harlow;
  wrap.innerHTML = `
    <div class="region-head secret-head" style="--region-color:${region.color}">
      <span class="secret-guide" style="--hero-color:${guide.color}">${heroPic(guide, 'happy')}</span>
      <div class="secret-text"><span><b>${region.emoji} ${escapeHtml(region.name)}</b> <span class="t-muted">· секретный регион</span></span>
      <span><b>${escapeHtml(guide.name)}:</b> ${escapeHtml(region.intro)}</span>
      <span class="region-rank">💠 Кристаллы: <b>${state.crystals || 0}</b> — пригодятся для твоей клиники</span></div>
    </div>
    <ol class="secret-locs" role="list">
      ${S.locations.map(({ loc, res, passed, lock }, i) => {
        const r = rarityOf(loc.rarity);
        const status = lock ? `🔒 ${lock}` : passed ? `✓ пройдено · лучший ${res.best}%` : res ? `лучший ${res.best}% · нужно ${QUEST_PASS_PCT}%` : `${loc.size} вопросов · приз: 💠 ${loc.crystals}`;
        return `<li><button class="quest-card secret-loc rarity-${loc.rarity}${passed ? ' done' : ''}${lock ? ' locked' : ''}" data-loc="${i}" style="--rarity:${r.color}; --rarity-pill:${r.pill}"
            aria-label="${escapeHtml(`${loc.title}. ${r.title}${loc.boss ? ', босс' : ''}. ${status}`)}">
          <span class="quest-rarity">${r.title}${loc.boss ? ' · босс' : ''}</span>
          <span class="hub-em" aria-hidden="true">${lock ? '🔒' : loc.emoji}</span>
          <span class="hub-name">${escapeHtml(loc.title)}</span>
          <span class="hub-state">${escapeHtml(status)}</span>
        </button></li>`;
      }).join('')}
    </ol>`;
  wrap.querySelectorAll('.secret-loc').forEach(b => b.onclick = () => {
    const it = S.locations[+b.dataset.loc];
    if (it.lock){ toast(`🔒 ${it.lock}`); return; }
    startSecretLocation(region, it.loc);
  });
}

export function startSecretLocation(region, loc){
  const S = secretRegionState(region, state), r = rarityOf(loc.rarity);
  const need = Math.ceil(loc.size * QUEST_PASS_PCT / 100);
  const header = `
    <h2>${loc.emoji} ${escapeHtml(loc.title)}</h2>
    <div class="lead">${escapeHtml(region.name)} · ${r.title.toLowerCase()} квест${loc.boss ? ', босс' : ''}. Вопросы по пройденным темам, нужно ${need} из ${loc.size}.</div>`;
  runQuiz({ header, lessons: S.pool, size: loc.size, mix: loc.mix, onFinish(right, total){
    const key = secretKey(region, loc), pct = Math.round(right * 100 / total);
    const q = state.quests[key] || { best: 0, runs: 0 };
    q.best = Math.max(q.best || 0, pct); q.last = pct; q.at = Date.now(); q.runs = (q.runs || 0) + 1;
    const first = pct >= QUEST_PASS_PCT && !q.passedAt;
    if (first) q.passedAt = Date.now();
    state.quests[key] = q;
    if (first){
      state.crystals = (state.crystals || 0) + loc.crystals;
      confetti();
      reward(r.xp || 100, r.coins || 50, { bonus: true });   // легендарный босс: +100 XP, +50 🪙
    } else saveState();
    openModal(`
      ${header}
      <div class="question checkpoint-result ${pct >= QUEST_PASS_PCT ? 'pass' : 'fail'}">
        <span class="cp-big" aria-hidden="true">${pct >= QUEST_PASS_PCT ? loc.emoji : '💪'}</span>
        <h3>${pct >= QUEST_PASS_PCT ? (loc.boss ? 'Босс Шахт побеждён!' : 'Место пройдено!') : 'Почти получилось'}</h3>
        <p>Верно: <b>${right}</b> из ${total} (${pct}%).</p>
        ${first ? `<p>Награда: <b>💠 ${loc.crystals}</b> кристаллов для клиники, +${r.xp || 100} XP, +${r.coins || 50} 🪙.</p>` : ''}
        ${pct < QUEST_PASS_PCT ? '<p>Ошибки попали в «Мои ошибки» — повтори их и возвращайся.</p>' : ''}
      </div>
      <div class="controls">
        ${pct < QUEST_PASS_PCT ? '<button class="btn" id="sl-retry">🔁 Попробовать снова</button>' : ''}
        <button class="btn ${pct < QUEST_PASS_PCT ? 'secondary' : ''}" id="sl-close">К Шахтам</button>
      </div>`);
    document.getElementById('sl-retry')?.addEventListener('click', () => startSecretLocation(region, loc));
    document.getElementById('sl-close').onclick = closeModal;
    renderHUD();
    rerender();
  } });
}
