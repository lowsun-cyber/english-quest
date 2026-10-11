// English Quest — Секретные регионы («Шахты»): туман со счётчиком до открытия, локации после.
// Данные — SECRET_REGIONS в content.js, расчёт — secretRegionState() в stats.js, вопросы — runQuiz (checkpoint.js).
import { runQuiz } from './checkpoint.js';
import { CHARACTERS, QUEST_PASS_PCT } from './eq.js';
import { heroPic } from './heroes.js';
import { renderHUD, reward } from './hud.js';
import { saveState, state } from './state.js';
import { rarityOf, secretKey, secretRegionState } from './stats.js';
import { closeModal, confetti, openModal } from './ui.js';
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
    ${caveScene(region, S)}
    <div id="cave-card-slot"></div>`;
  // метка места → карточка под сценой: редкость, место, вопросы, приз и «Играть» или замок (эскиз 40)
  const card = i => {
    const { loc, res, passed, lock } = S.locations[i], r = rarityOf(loc.rarity);
    return `<div class="scene-card" style="--rarity:${r.color}; --rarity-pill:${r.pill}" aria-live="polite">
      <div class="scene-card-top"><span class="quest-pill">${r.title.toUpperCase()}${loc.boss ? ' · БОСС' : ''}</span><span class="scene-card-place">${escapeHtml(region.name)}</span></div>
      <b class="scene-card-title">${escapeHtml(loc.title)}</b>
      <span class="scene-card-what">${loc.size} вопросов по всем пройденным темам: слова, на слух${loc.mix.grammar ? ' и грамматика' : ''}.</span>
      <div class="scene-card-foot"><span class="scene-card-prize">Приз: ${passed ? 'получен' : `💠 ${loc.crystals}, +${r.xp || 100} XP`}</span>
        ${lock ? `<div class="scene-lock"><span aria-hidden="true">🔒</span> ${escapeHtml(lock)}</div>`
          : `<button type="button" class="btn ${passed ? 'secondary' : ''}" id="scene-play">${passed ? `Пройдено ★ · лучший ${res.best}% · ещё раз` : 'Играть'}</button>`}</div>
    </div>`;
  };
  const select = i => {
    wrap.querySelectorAll('.secret-loc').forEach(x => { const on = +x.dataset.loc === i; x.classList.toggle('sel', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    wrap.querySelector('#cave-card-slot').innerHTML = card(i);
    wrap.querySelector('#scene-play')?.addEventListener('click', () => startSecretLocation(region, S.locations[i].loc));
  };
  wrap.querySelectorAll('.secret-loc').forEach(b => b.onclick = () => select(+b.dataset.loc));
  const first = S.locations.findIndex(x => !x.lock && !x.passed);
  select(first >= 0 ? first : 0);
}

// Сцена «Шахты» по эталону 40-scene-mines: пещера, порода, кристаллы, фонарь; места — рисунки с метками
const CAVE_SPOTS = [[70, 236], [180, 262], [292, 236], [180, 140]];   // штольня, кристаллы (впереди), озеро, глубокий забой (в глубине)
function caveScene(region, S){
  const K = '#1c2b1a', o = `stroke="${K}" stroke-width="2.5" stroke-linejoin="round"`;
  const art = `<rect width="360" height="320" fill="#2a2433"/>
    <path d="M0 0 H360 V40 l-20 26 l-14 -18 l-22 30 l-18 -24 l-16 22 l-26 -30 l-18 26 l-20 -22 l-24 28 l-14 -20 l-24 26 l-18 -26 l-22 24 l-18 -20 l-26 30 l-20 -24 l-18 22 l-18 -26 V0 Z" fill="#3b3346" ${o}/>
    <path d="M0 236 q60 -30 120 -10 q60 -26 120 -6 q60 -20 120 0 V320 H0 Z" fill="#4b405a" ${o}/>
    <path d="M0 132 l40 -10 l10 30 l-50 16 Z M360 150 l-46 -6 l-8 34 l54 10 Z" fill="#3b3346" ${o}/>
    ${[[30, 110, '#5ce0e6'], [336, 120, '#9ff2f5'], [24, 300, '#a870ff'], [340, 296, '#5ce0e6'], [120, 80, '#9ff2f5'], [250, 84, '#a870ff']].map(([x, y, c]) => `<polygon points="${x - 6},${y} ${x},${y - 22} ${x + 6},${y}" fill="${c}" ${o}/>`).join('')}
    <circle cx="300" cy="70" r="26" fill="#ffe680" opacity=".22"/><path d="M300 46 v10" stroke="${K}" stroke-width="3"/><rect x="292" y="56" width="16" height="20" rx="3" fill="#ffe680" ${o}/>
    <path d="M60 300 L150 250 M80 312 L170 262" stroke="#8b6f5a" stroke-width="4"/>${[0, 1, 2, 3].map(i => `<path d="M${72 + i * 24} ${306 - i * 13} l14 7" stroke="#8b6f5a" stroke-width="4"/>`).join('')}
    ${S.locations.map(({ loc, lock }, i) => { const [x, y] = CAVE_SPOTS[i % CAVE_SPOTS.length];
      return loc.img ? `<image href="${loc.img}" x="${x - 70}" y="${y - 96}" width="140" height="119"${lock ? ' opacity=".55"' : ''}/>`
        : `<g transform="translate(${x} ${y})"${lock ? ' opacity=".55"' : ''}><ellipse cx="0" cy="0" rx="56" ry="15" fill="#4b405a" ${o}/><rect x="-28" y="-62" width="56" height="62" fill="#8b6f5a" ${o}/><path d="M-20 0 V-46 h40 V0" fill="#1c2b1a"/><path d="M-20 -46 L20 0 M20 -46 L-20 0" stroke="#9fb0b8" stroke-width="3"/><rect x="-7" y="-28" width="14" height="12" fill="#f5c02b" ${o}/></g>`; }).join('')}`;
  const LOCK = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="#4a5a48" stroke-width="3"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="#4a5a48" stroke-width="3" stroke-linecap="round"/></svg>';
  const marks = S.locations.map(({ loc, res, passed, lock }, i) => {
    const [x, y] = CAVE_SPOTS[i % CAVE_SPOTS.length], r = rarityOf(loc.rarity);
    const status = lock ? `закрыто: ${lock}` : passed ? `пройдено, лучший ${res.best}%` : `${loc.size} вопросов`;
    return `<button type="button" class="hub-ex scene-mark secret-loc${passed ? ' done' : ''}${lock ? ' locked' : ''}" data-loc="${i}" style="left:${((x + 34) / 360 * 100).toFixed(3)}%; top:${((y - 80) / 320 * 100).toFixed(3)}%; --rarity:${r.color}"
      aria-label="${escapeHtml(`${loc.title}. ${r.title}${loc.boss ? ', босс' : ''}. ${status}`)}" aria-pressed="false">${lock ? LOCK : passed ? '★' : i + 1}</button>`;
  }).join('');
  return `<div class="scene cave-scene">
    <svg class="scene-art" viewBox="0 0 360 320" aria-hidden="true" focusable="false">${art}</svg>
    <div class="scene-plate"><span>секретный регион</span><b>${escapeHtml(region.emoji)} ${escapeHtml(region.name)}</b></div>
    ${marks}
  </div>`;
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
