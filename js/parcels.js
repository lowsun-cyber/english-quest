// English Quest — «Посылка от Dr. Harlow» у ученика: баннер на карте, письмо с особыми квестами и призом,
// прохождение квеста, уникальный приз в сундуке. Данные и проверка — js/aipack.js.
import { CHARACTERS, QUEST_PASS_PCT } from './eq.js';
import { parcelsOf, questSize, specialKey } from './aipack.js';
import { runQuiz } from './checkpoint.js';
import { heroPic } from './heroes.js';
import { renderHUD, reward } from './hud.js';
import { activeProfile, saveState, state } from './state.js';
import { rarityOf } from './stats.js';
import { closeModal, confetti, openModal, toast } from './ui.js';
import { escapeHtml } from './util.js';

const dateOf = t => { const d = new Date(t); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; };

const R = () => rarityOf('special');
// Баннер над картой: есть посылка с непройденными квестами
export function parcelBanner(){
  const open = state ? parcelsOf(state).filter(x => !x.done) : [];
  if (!open.length) return '';
  const x = open[0], fresh = !x.entry.opened;
  return `<button class="parcel-banner${fresh ? ' fresh' : ''}" data-parcel="${escapeHtml(x.pack.id)}">📦 <b>${fresh ? 'Посылка от Dr. Harlow!' : escapeHtml(x.pack.title)}</b> ${fresh ? 'Открой — внутри особые квесты и приз' : `осталось квестов: ${x.left} из ${x.quests.length}`}</button>`;
}
export function bindParcelBanner(wrap, rerender){
  wrap.querySelectorAll('[data-parcel]').forEach(b => b.onclick = () => openParcel(b.dataset.parcel, rerender));
}

export function openParcel(id, rerender = () => {}){
  const x = parcelsOf(state).find(p => p.pack.id === id);
  if (!x) return;
  if (!x.entry.opened){ state.parcels[id].opened = Date.now(); saveState(); }
  const r = R(), p = x.pack;
  openModal(`
    <h2>📦 ${escapeHtml(p.title)}</h2>
    <div class="parcel-letter">
      <span class="parcel-hero">${heroPic(CHARACTERS.harlow, 'happy')}</span>
      <p>${escapeHtml(p.note)}</p>
    </div>
    <div class="parcel-prize" style="--rarity:${r.color}">
      <span class="parcel-prize-em" aria-hidden="true">${escapeHtml(p.reward.emoji)}</span>
      <span><small>Приз за всю посылку — ${x.done ? 'получен!' : 'пройди все квесты'}</small><b>${escapeHtml(p.reward.title)}</b></span>
    </div>
    <ul class="parcel-quests" role="list">
      ${x.quests.map(({ q, res, passed }) => `<li class="parcel-quest${passed ? ' done' : ''}" style="--rarity:${r.color}; --rarity-pill:${r.pill}">
        <span class="parcel-q-em" aria-hidden="true">${escapeHtml(q.emoji)}</span>
        <span class="parcel-q-text"><span class="quest-pill">${r.title.toUpperCase()}</span><b>${escapeHtml(q.title)}</b>
          <small>${questSize(q)} заданий · нужно ${QUEST_PASS_PCT}%${res ? ` · лучший ${res.best}%` : ''}${passed ? '' : ` · приз: +${r.xp} XP, +${r.coins} 🪙`}</small></span>
        <button type="button" class="btn ${passed ? 'secondary' : ''}" data-sq="${escapeHtml(q.id)}">${passed ? 'Ещё раз' : 'Играть'}</button>
      </li>`).join('')}
    </ul>
    <div class="controls"><button class="btn secondary" id="parcel-close">К карте</button></div>`);
  document.getElementById('parcel-close').onclick = () => { closeModal(); rerender(); };
  document.querySelectorAll('[data-sq]').forEach(b => b.onclick = () => playSpecial(id, b.dataset.sq, rerender));
}

export function playSpecial(id, qid, rerender = () => {}){
  const x = parcelsOf(state).find(p => p.pack.id === id), q = x?.pack.quests.find(y => y.id === qid);
  if (!q) return;
  const p = x.pack, r = R(), words = q.words || [], grammar = q.grammar || [], size = questSize(q);
  const header = `<h2>${escapeHtml(q.emoji)} ${escapeHtml(q.title)}</h2>
    <div class="lead">Особый квест из посылки Dr. Harlow. Нужно ${QUEST_PASS_PCT}%.</div>`;
  const lesson = { id: `sp:${p.id}`, title: q.title, words, grammar };
  runQuiz({ header, lessons: [lesson], size, record: false,
    mix: { word: Math.ceil(words.length / 2), listen: Math.floor(words.length / 2), grammar: grammar.length },
    onFinish(right, total){
      const key = specialKey(p, q), pct = Math.round(right * 100 / total);
      const res = state.quests[key] || { best: 0, runs: 0 };
      res.best = Math.max(res.best || 0, pct); res.last = pct; res.at = Date.now(); res.runs = (res.runs || 0) + 1;
      const first = pct >= QUEST_PASS_PCT && !res.passedAt;
      if (first) res.passedAt = Date.now();
      state.quests[key] = res;
      const after = parcelsOf(state).find(y => y.pack.id === id), all = first && after?.done;
      if (first){ confetti(); reward(r.xp, r.coins, { bonus: true }); } else saveState();
      const who = activeProfile().name;
      openModal(`
        ${header}
        <div class="question checkpoint-result ${pct >= QUEST_PASS_PCT ? 'pass' : 'fail'}">
          <span class="cp-big" aria-hidden="true">${all ? escapeHtml(p.reward.emoji) : pct >= QUEST_PASS_PCT ? escapeHtml(q.emoji) : '💪'}</span>
          <h3>${all ? 'Посылка пройдена!' : pct >= QUEST_PASS_PCT ? 'Особый квест пройден!' : 'Почти получилось'}</h3>
          <p>Верно: <b>${right}</b> из ${total} (${pct}%).</p>
          ${first ? `<p>Награда: +${r.xp} XP, +${r.coins} 🪙.</p>` : ''}
          ${all ? `<p class="parcel-won">Уникальный приз: <b>${escapeHtml(p.reward.emoji)} ${escapeHtml(p.reward.title)}</b>${who ? ` — ${escapeHtml(who)}` : ''}, ${dateOf(Date.now())}. Он в сундуке!</p>` : ''}
        </div>
        <div class="controls">
          ${pct >= QUEST_PASS_PCT ? '' : '<button class="btn" id="sq-retry">🔁 Попробовать снова</button>'}
          <button class="btn ${pct >= QUEST_PASS_PCT ? '' : 'secondary'}" id="sq-back">К посылке</button>
        </div>`);
      if (all) toast(`${p.reward.emoji} Уникальный приз: ${p.reward.title}!`);
      document.getElementById('sq-retry')?.addEventListener('click', () => playSpecial(id, qid, rerender));
      document.getElementById('sq-back').onclick = () => openParcel(id, rerender);
      renderHUD();
      renderSpecials();
      rerender();
    } });
}

// Уникальные призы посылок — в «Сундуке достижений», с именем игрока и датой
export function renderSpecials(){
  const wrap = document.getElementById('specials');
  if (!wrap || !state) return;
  const won = parcelsOf(state).filter(x => x.done), r = R(), who = activeProfile().name;
  wrap.hidden = !won.length;
  wrap.innerHTML = won.length ? `<h3>Уникальные призы</h3><ul class="ach-grid" role="list">${won.map(x => `
    <li class="ach got rarity-special" style="--rarity:${r.color}" aria-label="${escapeHtml(`${x.pack.reward.title}. Уникальный приз${who ? `, ${who}` : ''}, ${dateOf(x.doneAt)}`)}">
      <span class="ach-em" aria-hidden="true">${escapeHtml(x.pack.reward.emoji)}</span>
      <b>${escapeHtml(x.pack.reward.title)}</b>
      <small>${who ? `${escapeHtml(who)} · ` : ''}${dateOf(x.doneAt)}</small>
    </li>`).join('')}</ul>` : '';
}
