// English Quest — «Моя клиника» (итерация 4, эскиз docs/design-v2/boards/33-screen-clinic).
// Дом с комнатами: построенные, строящиеся (материалы по рецепту), закрытые (рецепт — за эпические квесты)
// и секретная (открывается в «Шахтах»). Ниже — пациенты региона, альбом слов и помощники.
// Всё заработанное считает clinicState() в stats.js; здесь только показ и кнопка «Строить».
import { MATERIALS, heroLine, regionOfGrade } from './eq.js';
import { heroPic, sayRow } from './heroes.js';
import { activeProfile, saveState, state } from './state.js';
import { buildRoom, clinicState, playerGrade } from './stats.js';
import { confetti, toast } from './ui.js';
import { escapeHtml } from './util.js';

const K = '#1c2b1a';
// значки материалов — как в эскизе
export const MAT_ICON = {
  blocks: `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" fill="#c58a4a" stroke="${K}" stroke-width="2.5"/><path d="M4 12h16M12 4v8" stroke="#a8743f" stroke-width="2"/></svg>`,
  boards: `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="5" fill="#e0aa6e" stroke="${K}" stroke-width="2"/><rect x="3" y="13" width="18" height="5" fill="#e0aa6e" stroke="${K}" stroke-width="2"/></svg>`,
  glass: `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" fill="#bfe8f7" stroke="${K}" stroke-width="2.5"/><path d="M8 15l6-6M11 17l5-5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`,
  crystals: `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l6 7-6 11-6-11z" fill="#5ce0e6" stroke="${K}" stroke-width="2" stroke-linejoin="round"/></svg>`,
};
// мордочки пациентов (эскиз 33)
const FACE = {
  kitten: `<path d="M5 9 L6 3 L10 7 M19 9 L18 3 L14 7" fill="none" stroke="${K}" stroke-width="2" stroke-linejoin="round"/><circle cx="9" cy="12" r="1.6" fill="${K}"/><circle cx="15" cy="12" r="1.6" fill="${K}"/><path d="M10 16 q2 2 4 0" fill="none" stroke="${K}" stroke-width="1.8" stroke-linecap="round"/>`,
  puppy: `<path d="M5 6 q-3 5 1 9 M19 6 q3 5 -1 9" fill="none" stroke="${K}" stroke-width="2" stroke-linecap="round"/><circle cx="9" cy="11" r="1.6" fill="${K}"/><circle cx="15" cy="11" r="1.6" fill="${K}"/><ellipse cx="12" cy="15" rx="2.2" ry="1.6" fill="${K}"/>`,
  bunny: `<rect x="7.5" y="0.5" width="3" height="7" rx="1.5" fill="#efe8e2" stroke="${K}" stroke-width="1.6"/><rect x="13.5" y="0.5" width="3" height="7" rx="1.5" fill="#efe8e2" stroke="${K}" stroke-width="1.6"/><circle cx="9" cy="12" r="1.6" fill="${K}"/><circle cx="15" cy="12" r="1.6" fill="${K}"/><circle cx="12" cy="15.5" r="1.4" fill="#ff9cc0"/>`,
  duckling: `<circle cx="9" cy="11" r="1.6" fill="${K}"/><circle cx="15" cy="11" r="1.6" fill="${K}"/><path d="M8.5 15 h7 l-3.5 3z" fill="#ff9a3c" stroke="${K}" stroke-width="1.5" stroke-linejoin="round"/>`,
  piglet: `<circle cx="9" cy="10.5" r="1.6" fill="${K}"/><circle cx="15" cy="10.5" r="1.6" fill="${K}"/><ellipse cx="12" cy="15" rx="3.2" ry="2.4" fill="#ff9cc0" stroke="${K}" stroke-width="1.5"/><circle cx="11" cy="15" r=".7" fill="${K}"/><circle cx="13" cy="15" r=".7" fill="${K}"/>`,
};
const face = (a, cured) => `<span class="clinic-patient${cured ? '' : ' sick'}" style="--pt:${a.color}" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30">${FACE[a.id] || ''}</svg>${cured ? '' : '<b>?</b>'}</span>`;
const LOCK = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="3"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
const matTitle = id => MATERIALS.find(m => m.id === id)?.title.toLowerCase() || id;

function roomHtml(r, cs){
  const { room } = r, furn = cs.furniture.filter(f => f.room === room.id);
  if (r.state === 'built'){
    const items = furn.map(f => `<span title="${escapeHtml(f.title)}">${f.emoji}</span>`).join('');
    return `<li class="clinic-room built" style="--room:${room.bg}" aria-label="${escapeHtml(`${room.title} — построена${furn.length ? `, мебель: ${furn.map(f => f.title).join(', ')}` : ''}`)}">
      <span class="clinic-room-art" aria-hidden="true">${r.host ? heroPic(r.host, 'full') : `<span class="clinic-room-em">${room.emoji}</span>`}</span>
      ${items ? `<span class="clinic-furn" aria-hidden="true">${items}</span>` : ''}
      <b>${escapeHtml(room.title)}</b></li>`;
  }
  if (r.state === 'secret') return `<li class="clinic-room secret" aria-label="Секретная комната — откроется в Шахтах">
      <span class="clinic-q" aria-hidden="true">?</span><b>Секретная комната</b><small>откроется в Шахтах</small></li>`;
  if (r.state === 'locked') return `<li class="clinic-room locked" aria-label="${escapeHtml(`${room.title} — нужен рецепт: эпических квестов ${room.recipe}, пройдено ${cs.counts.epic}`)}">
      <span class="clinic-lock" aria-hidden="true">${LOCK}</span><b>${escapeHtml(room.title)}</b><small>рецепт: эпических квестов ${Math.min(cs.counts.epic, room.recipe)} из ${room.recipe}</small></li>`;
  // строится: полоска по самому нужному материалу и кнопка
  const total = r.need.reduce((n, x) => n + x.need, 0), have = r.need.reduce((n, x) => n + x.have, 0);
  const lines = r.need.map(x => `${MAT_ICON[x.id]}<span>${x.have} из ${x.need}</span>`).join('');
  const label = `${room.title} — строится: ${r.need.map(x => `${matTitle(x.id)} ${x.have} из ${x.need}`).join(', ')}`;
  return `<li class="clinic-room building" aria-label="${escapeHtml(label)}">
      <b>${escapeHtml(room.title)}</b>
      <span class="clinic-bar" aria-hidden="true"><i style="transform:scaleX(${total ? (have / total).toFixed(3) : 0})"></i></span>
      <span class="clinic-need" aria-hidden="true">${lines}</span>
      <button type="button" class="btn clinic-build" data-room="${room.id}"${r.canBuild ? '' : ' aria-disabled="true"'}>Строить</button></li>`;
}

// Реплика над клиникой: событие стройки (один раз) → новый вылеченный пациент → можно строить → ждёт пациент
let clinicEvent = null, seenCured = null;   // seenCured — { profile, n }: сколько было вылечено при прошлом показе
function clinicLine(cs, pat, cured){
  const profile = activeProfile().id, before = seenCured?.profile === profile ? seenCured.n : null;
  seenCured = { profile, n: cured };
  if (clinicEvent){ const e = clinicEvent; clinicEvent = null; return heroLine(e.hero, e.kind, { id: e.id }); }
  if (before != null && cured > before) return heroLine('luna', 'clinic', { id: 'cured' });
  if (cs.rooms.some(r => r.state === 'building' && r.canBuild)) return heroLine('max', 'build', { id: 'ready' });
  return pat.list.some(x => !x.cured) ? heroLine('luna', 'clinic', { id: 'patient' }) : null;
}

export function renderClinic(){
  const wrap = document.getElementById('clinic');
  if (!wrap || !state) return;
  const cs = clinicState(state);
  const name = (activeProfile().name || '').trim();
  const sign = (name ? `КЛИНИКА · ${name}` : 'МОЯ КЛИНИКА').toUpperCase().slice(0, 22);
  const mats = Object.entries(cs.have).map(([id, n]) => `<span class="clinic-mat" title="${escapeHtml(matTitle(id))}">${MAT_ICON[id]}<b>${n}</b><span class="sr-only"> ${escapeHtml(matTitle(id))}</span></span>`).join('');
  const grade = playerGrade(state), pat = cs.patients.find(p => p.grade === grade) || cs.patients[0];
  const cured = pat.list.filter(x => x.cured);
  const shown = [...cured.slice(-6).map(x => face(x.animal, true)), ...pat.list.filter(x => !x.cured).slice(0, Math.max(1, 8 - Math.min(6, cured.length))).map(x => face(x.animal, false))].join('');
  const alb = cs.album.find(a => a.grade === grade) || cs.album[0];
  const albPct = alb.total ? alb.got / alb.total : 0;
  const nextHelper = cs.helpers.find(h => !h.got);
  const helpers = cs.helpers.map(h => `<span class="clinic-helper${h.got ? '' : ' off'}" title="${escapeHtml(h.got ? h.hero.name : '???')}">${heroPic(h.hero, 'full', { label: h.got ? h.hero.name : '' })}</span>`).join('');
  const helpNote = nextHelper ? (nextHelper.minesBoss ? 'ещё один — за босса Шахт' : `следующий — за ${nextHelper.bosses}-го босса (побеждено ${cs.counts.bosses})`) : 'все помощники в сборе!';
  document.getElementById('clinic-mats').innerHTML = mats;
  wrap.innerHTML = `
    ${sayRow(clinicLine(cs, pat, cured.length))}
    <div class="clinic-house">
      <svg class="clinic-roof" viewBox="0 0 358 54" aria-hidden="true"><path d="M8 52 L179 6 L350 52 Z" fill="#e5483b" stroke="${K}" stroke-width="3"/><rect x="104" y="26" width="150" height="22" rx="3" fill="#fffdf6" stroke="${K}" stroke-width="2.5"/><text x="179" y="42" text-anchor="middle" font-family="'Baloo 2', system-ui, sans-serif" font-weight="800" font-size="13" fill="${K}">${escapeHtml(sign)}</text></svg>
      <ul class="clinic-rooms" role="list">${cs.rooms.map(r => roomHtml(r, cs)).join('')}</ul>
      <div class="clinic-base" aria-hidden="true"></div>
    </div>
    <div class="clinic-card">
      <h3>Пациенты <small>вылечено ${cured.length} из ${pat.total} · ${escapeHtml(regionOfGrade(pat.grade)?.name || `${pat.grade} класс`)}</small></h3>
      <div class="clinic-patients" aria-hidden="true">${shown}</div>
      <p class="t-muted">Пройди тему на карте — её пациент выздоровеет и переедет в клинику.</p>
    </div>
    <div class="clinic-row">
      <div class="clinic-card">
        <h3>Альбом слов</h3>
        <span class="clinic-bar wide" aria-hidden="true"><i style="transform:scaleX(${albPct.toFixed(3)})"></i></span>
        <p>${alb.got} из ${alb.total} карточек</p>
        <p class="t-muted">Карточка — слово, которое ты знаешь твёрдо.</p>
      </div>
      <div class="clinic-card">
        <h3>Помощники</h3>
        <div class="clinic-helpers">${helpers}</div>
        <p class="t-muted">${helpNote}</p>
      </div>
    </div>`;
  wrap.querySelectorAll('.clinic-build').forEach(b => b.onclick = () => onBuild(b.dataset.room));
}

function onBuild(id){
  const cs = clinicState(state), r = cs.rooms.find(x => x.room.id === id);
  if (!r) return;
  if (!r.canBuild){
    const miss = r.need.filter(x => x.have < x.need).map(x => `${matTitle(x.id)}: ещё ${x.need - x.have}`).join(', ');
    toast(`🧱 Не хватает материалов — ${miss}. Проходи квесты на карте!`);
    const short = id => r.need.some(x => x.id === id && x.have < x.need);
    clinicEvent = short('boards') ? { hero: 'max', kind: 'build', id: 'boards' } : short('blocks') ? { hero: 'luna', kind: 'clinic', id: 'blocks' } : null;
    if (clinicEvent) renderClinic();
    return;
  }
  const next = buildRoom(state, id);
  if (!next) return;
  state.clinic = next;
  saveState();
  clinicEvent = { hero: 'luna', kind: 'clinic', id: 'built' };
  renderClinic();
  confetti();
  toast(`🏗️ Построено: ${r.room.title}!`);
  document.getElementById('clinic-title')?.focus({ preventScroll: true });
}
