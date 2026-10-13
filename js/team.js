// English Quest — Командный квест по сети (docs/design-v2/CONCEPT.md, «Командный add-on»; сервер — server/src/rooms.php).
// 2–4 игрока с разных устройств вместе против квеста: вылечить пациента или победить босса. Комната — по коду
// (и QR); каждый выбирает героя (герои не повторяются) и отвечает на свои задания своего класса — подбирает
// устройство из своих тем. На сервер уходит только «верно / неверно»: верный ответ любого игрока двигает общую
// шкалу. Ошибки и мастерство — в профиль того, кто отвечал (как в обычном квесте). Подсказки — из общего запаса.
// Устройство опрашивает комнату раз в 1,5 с. В конце каждый получает свой приз и командный.
import { api, ApiError } from './api.js';
import { CHARACTERS, CLINIC_PATIENTS } from './eq.js';
import { checkAchievements } from './achievements.js';
import { runQuiz } from './checkpoint.js';
import { cloudLink, cloudOn, openAccount } from './cloud.js';
import { heroPic, playerHero } from './heroes.js';
import { renderHUD, reward } from './hud.js';
import { currentNode } from './map.js';
import { qrSvg } from './qr.js';
import { saveState, state } from './state.js';
import { lessonsOf, playerGrade } from './stats.js';
import { closeModal, confetti, modalClosedHooks, openModal, toast } from './ui.js';
import { escapeHtml, shuffle } from './util.js';

const POLL_MS = 1500;
const TEAM_PRIZE = { xp: 20, coins: 15 };     // командный приз каждому; плюс по 2 XP за свой верный ответ
const PATIENT_EMOJI = { kitten: '🐱', puppy: '🐶', bunny: '🐰', duckling: '🐥', piglet: '🐷' };
const BOSS = { emoji: '🐲', name: 'Дракон Путаницы' };
const heroes = () => Object.values(CHARACTERS).filter(c => c.playable);

// одна комната на устройство: { id, room, timer, phase: 'lobby' | 'play' | 'done', seq, answer, finished }
let cur = null;
const token = () => cloudLink()?.token;

// Кнопка над картой (только если есть сервер)
export function teamButton(){
  return cloudOn() ? '<button type="button" class="team-btn" data-team>👥 Играть командой</button>' : '';
}

// Пациент или босс — одинаковый на всех устройствах (по номеру комнаты)
function foe(room){
  if (room.mode === 'boss') return { ...BOSS, label: 'Сила босса', kind: 'boss' };
  const h = [...room.id].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const p = CLINIC_PATIENTS[h % CLINIC_PATIENTS.length];
  return { emoji: PATIENT_EMOJI[p.id] || '🐾', name: p.title, label: 'Здоровье пациента', kind: 'patient' };
}
const who = (room, id) => room.players.find(p => p.id === id);
const heroOf = p => CHARACTERS[p?.hero] || null;

// ---------- вход: создать комнату или войти по коду ----------
export function openTeam(code = ''){
  if (!cloudOn()) return;
  if (!cloudLink()){
    openModal(`
      <h2>👥 Играть командой</h2>
      <p>Командный квест идёт через сервер: друзья играют каждый на своём устройстве. Чтобы играть, взрослый сохраняет прогресс («Для взрослых» → «Ключ семьи») или ты входишь по логину от учителя.</p>
      <div class="controls"><button class="btn" id="team-login">🔑 Войти</button><button class="btn secondary" id="team-close">Закрыть</button></div>`);
    document.getElementById('team-login').onclick = () => { closeModal(); openAccount(); };
    document.getElementById('team-close').onclick = closeModal;
    return;
  }
  if (cur && !code) return reopen();
  openModal(`
    <h2>👥 Играть командой</h2>
    <p>Вместе против квеста! Каждый отвечает на свои задания, а каждый верный ответ любого игрока помогает всей команде.</p>
    <div class="team-modes">
      <button class="team-mode" data-mode="patient"><span aria-hidden="true">🏥</span><b>Вылечить пациента</b><small>Каждый верный ответ лечит</small></button>
      <button class="team-mode" data-mode="boss"><span aria-hidden="true">${BOSS.emoji}</span><b>Победить босса</b><small>Каждый верный ответ — удар по боссу</small></button>
    </div>
    <form class="cl-form team-join" id="team-join">
      <label>Код комнаты от друга <input id="team-code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="6" placeholder="K7M2" value="${escapeHtml(code)}" /></label>
      <button class="btn secondary" type="submit">Войти в комнату</button>
    </form>
    <p class="gate-err" id="team-err" role="alert" hidden></p>`);
  const err = msg => { const e = document.getElementById('team-err'); e.textContent = msg; e.hidden = false; };
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { enter(await api('/rooms', { token: token(), body: { mode: b.dataset.mode } })); }
    catch (e){ err(e.message); b.disabled = false; }
  });
  document.getElementById('team-join').onsubmit = async (e) => {
    e.preventDefault();
    const v = document.getElementById('team-code').value.trim();
    if (!v){ document.getElementById('team-code').focus(); return; }
    try { enter(await api('/rooms/join', { token: token(), body: { code: v } })); }
    catch (ex){ err(ex.message); }
  };
  if (code) document.getElementById('team-join').requestSubmit();
}

// Ссылка из QR-кода комнаты: …/#room=K7M2
export function teamFromHash(){
  const m = /^#room=([A-Za-z0-9]{4,6})$/.exec(location.hash);
  if (!m || !cloudOn()) return false;
  history.replaceState(null, '', location.pathname + location.search);
  openTeam(m[1].toUpperCase());
  return true;
}

function enter(room){
  hookClose();
  stop();
  cur = { id: room.id, room, timer: null, phase: room.status === 'lobby' ? 'lobby' : 'play', seq: lastSeq(room), answer: null, finished: false };
  if (room.status === 'done') return finish();
  if (cur.phase === 'lobby') renderLobby(); else startPlay();
  cur.timer = setInterval(poll, POLL_MS);
}
const lastSeq = room => room.events.at(-1)?.n || 0;
function stop(){ if (cur?.timer) clearInterval(cur.timer); }
function reopen(){ if (cur.phase === 'lobby') renderLobby(); else if (cur.phase === 'play') startPlay(); }

async function poll(){
  if (!cur || document.hidden) return;
  const id = cur.id;
  let room;
  try { room = await api(`/rooms/${id}`, { token: token() }); }
  catch (e){
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)){ stop(); cur = null; toast('👥 Комната закрылась'); }
    return;   // нет связи — попробуем в следующий раз
  }
  if (!cur || cur.id !== id) return;
  update(room);
}
// Новое состояние: события ленты, переход ожидание → игра → итог
function update(room){
  const prev = cur.room;
  cur.room = room;
  const fresh = room.events.filter(e => e.n > cur.seq);
  cur.seq = lastSeq(room);
  if (cur.phase === 'lobby'){
    if (room.status === 'play'){ cur.phase = 'play'; startPlay(); }
    else if (room.version !== prev.version && document.getElementById('team-lobby')) renderLobby();
  } else if (cur.phase === 'play'){
    paintHud(fresh);
    if (room.status === 'done'){ cur.phase = 'done'; if (!cur.answering) finish(); }
  }
}

// ---------- ожидание: код и QR, игроки, выбор героя, «Начать» ----------
function renderLobby(){
  const room = cur.room, me = who(room, room.me), host = room.host === room.me;
  const taken = Object.fromEntries(room.players.filter(p => p.hero && p.id !== room.me).map(p => [p.hero, p.name]));
  const ready = room.players.length >= room.min && room.players.every(p => p.hero);
  const f = foe(room);
  ours(() => openModal(`
    <h2>👥 Командный квест</h2>
    <div id="team-lobby" class="team-lobby">
      <p class="team-goal"><span aria-hidden="true">${f.emoji}</span> ${room.mode === 'boss' ? `Победить босса: <b>${escapeHtml(f.name)}</b>` : `Вылечить пациента: <b>${escapeHtml(f.name)}</b>`}</p>
      <div class="team-code-box">
        <div><small>Код комнаты</small><b class="team-code">${escapeHtml(room.code)}</b><small>Друзья вводят код у себя: «👥 Играть командой» → «Код комнаты».</small></div>
        ${qrSvg(`${location.origin}${location.pathname}#room=${room.code}`, `QR-код комнаты ${room.code}`)}
      </div>
      <h3 class="team-h">Команда: ${room.players.length} из ${room.max}</h3>
      <ul class="team-players" role="list">${room.players.map(p => `<li class="${p.online ? '' : 'off'}">
        <span class="team-av" aria-hidden="true">${escapeHtml(p.avatar)}</span>
        <b>${escapeHtml(p.name)}${p.id === room.me ? ' (ты)' : ''}${p.id === room.host ? ' 👑' : ''}</b>
        <span class="team-hero">${heroOf(p) ? `${heroPic(heroOf(p))} ${escapeHtml(heroOf(p).name)}` : '<span class="t-muted">выбирает героя…</span>'}</span>
        ${p.online ? '' : '<span class="t-muted">нет связи</span>'}</li>`).join('')}</ul>
      <h3 class="team-h">Твой герой</h3>
      <div class="team-heroes">${heroes().map(c => `<button class="team-hero-pick${me?.hero === c.id ? ' on' : ''}" data-hero="${c.id}" ${taken[c.id] ? 'disabled' : ''} aria-pressed="${me?.hero === c.id}">
        ${heroPic(c)}<span>${escapeHtml(c.name)}</span>${taken[c.id] ? `<small>занят: ${escapeHtml(taken[c.id])}</small>` : ''}</button>`).join('')}</div>
      <p class="gate-err" id="team-err" role="alert" hidden></p>
      <div class="controls">
        ${host ? `<button class="btn" id="team-start" ${ready ? '' : 'disabled'}>▶ Начать квест</button>` : ''}
        <button class="icon-btn" id="team-leave">Выйти из комнаты</button>
      </div>
      <p class="t-muted">${host ? (ready ? 'Все готовы — можно начинать!' : room.players.length < room.min ? 'Ждём хотя бы одного друга.' : 'Ждём, пока все выберут героя.') : `Начнёт ${escapeHtml(who(room, room.host)?.name || 'создатель комнаты')}, когда все выберут героя.`}</p>
    </div>`));
  const err = msg => { const e = document.getElementById('team-err'); e.textContent = msg; e.hidden = false; };
  // свой герой по умолчанию — герой игрока, если свободен
  if (!me?.hero){ const mine = playerHero(state).id; if (!taken[mine]) pickHero(mine, err); }
  document.querySelectorAll('[data-hero]').forEach(b => b.onclick = () => pickHero(b.dataset.hero, err));
  const start = document.getElementById('team-start');
  if (start) start.onclick = async () => {
    start.disabled = true;
    try { update(await api(`/rooms/${cur.id}/start`, { token: token(), body: {} })); }
    catch (e){ err(e.message); start.disabled = false; }
  };
  document.getElementById('team-leave').onclick = leave;
}
async function pickHero(hero, err){
  try { update(await api(`/rooms/${cur.id}/hero`, { token: token(), body: { hero } })); renderLobby(); }
  catch (e){ err(e.message); }
}
async function leave(){
  const id = cur?.id;
  stop(); cur = null;
  ours(closeModal);
  try { await api(`/rooms/${id}/leave`, { token: token(), body: {} }); } catch (e) {}
}

// окно закрыл ребёнок (крестик, Escape) — перестаём опрашивать; вернуться можно кнопкой или по коду
let quiet = false;
function ours(fn){ quiet = true; try { fn(); } finally { quiet = false; } }
// подписка — при первом входе в комнату: на верхнем уровне модуля ui.js может быть ещё не готов (модули импортируют друг друга по кругу)
let hooked = false;
function hookClose(){ if (!hooked){ hooked = true; modalClosedHooks.add(onClosed); } }
function onClosed(){
  if (quiet || !cur) return;
  if (cur.phase === 'lobby') leave();
  else if (cur.phase === 'play'){ stop(); cur.timer = null; toast('👥 Ты вышел из командного квеста. Вернуться — «Играть командой» и тот же код.'); cur = null; }
}

// ---------- игра ----------
// Свои темы: до текущей на карте своего класса, последние 8
function myLessons(){
  const g = playerGrade(state), ls = lessonsOf(g), node = currentNode(g);
  const last = node?.lesson ? ls.indexOf(node.lesson) : node?.cp ? ls.indexOf(node.cp.lessons.at(-1)) : ls.length - 1;
  const i = Math.max(1, last);
  return ls.slice(Math.max(0, i - 7), i + 1);
}
function makeItems(ls, n){
  const words = shuffle(ls.flatMap(l => l.words.map(w => ({ w, l }))));
  const grammar = shuffle(ls.flatMap(l => (l.grammar || []).map(q => ({ q, l }))));
  const out = [];
  for (let i = 0; i < n; i++){
    const k = i % 3;
    if (k === 2 && grammar.length) out.push({ type: 'grammar', ...grammar[i % grammar.length] });
    else out.push({ type: k === 1 ? 'listen' : 'word', ...words[i % words.length] });
  }
  return out;
}
function hudHtml(){
  const room = cur.room, f = foe(room), pct = Math.round(room.progress * 100 / Math.max(1, room.goal));
  const val = f.kind === 'boss' ? room.goal - room.progress : room.progress;
  return `
    <div class="team-bar team-${f.kind}" role="img" aria-label="${f.label}: ${val} из ${room.goal}">
      <span class="team-foe" aria-hidden="true">${f.emoji}</span>
      <span class="team-meter"><span style="width:${f.kind === 'boss' ? 100 - pct : pct}%"></span></span>
      <b>${val}<small>/${room.goal}</small></b>
    </div>
    <ul class="team-score" role="list">${room.players.map(p => `<li class="${p.id === room.me ? 'me' : ''}${p.online ? '' : ' off'}">${heroOf(p) ? heroPic(heroOf(p)) : ''}<span>${escapeHtml(p.name)}</span><b>${p.ok}</b></li>`).join('')}</ul>
    <div class="team-row">
      <p class="team-feed" aria-live="polite">${feedLine(room.events.at(-1)) || (f.kind === 'boss' ? `Победим ${escapeHtml(f.name)} вместе!` : `Вылечим: ${escapeHtml(f.name)}!`)}</p>
      <button class="btn secondary team-hint" id="team-hint" ${room.hints ? '' : 'disabled'}>💡 Подсказка · ${room.hints}</button>
    </div>`;
}
function feedLine(e){
  if (!e) return '';
  const room = cur.room, p = who(room, e.s), h = heroOf(p), name = p ? `${h ? h.emoji + ' ' : ''}${escapeHtml(p.name)}` : 'Игрок';
  const boss = room.mode === 'boss';
  return { ok: boss ? `${name}: удар по боссу!` : `${name}: пациенту лучше!`, hint: `${name}: подсказка 💡`, join: `${name} в команде`, leave: `${name}: выход из команды`,
    start: 'Квест начался!', done: boss ? 'Босс побеждён!' : 'Пациент здоров!' }[e.k] || '';
}
function paintHud(){
  const el = document.getElementById('team-hud');
  if (!el) return;
  el.innerHTML = hudHtml();
  wireHint();
}
function wireHint(){
  const b = document.getElementById('team-hint');
  if (!b) return;
  b.onclick = async () => {
    b.disabled = true;
    try {
      update(await api(`/rooms/${cur.id}/hint`, { token: token(), body: {} }));
      // подсказка: убрать два неверных варианта текущего вопроса
      const wrong = [...document.querySelectorAll('.options .opt:not(:disabled)')].filter(o => o.dataset.o !== cur.answer);
      shuffle(wrong).slice(0, Math.min(2, wrong.length - 1)).forEach(o => { o.disabled = true; o.classList.add('opt-off'); o.setAttribute('aria-hidden', 'true'); });
      paintHud();
    } catch (e){ toast('💡 ' + e.message); paintHud(); }
  };
}
function startPlay(){
  const ls = myLessons();
  const queue = makeItems(ls, 12);
  ours(() => runQuiz({
    header: () => `<h2>👥 Командный квест</h2><div id="team-hud" class="team-hud">${hudHtml()}</div>`,
    lessons: ls, queue, hideProgress: true,
    stop: () => !cur || cur.phase !== 'play',
    onShow: (item, answer) => { if (cur) cur.answer = answer; quiet = false; wireHint(); },
    onAnswer: async (item, ok) => {
      if (!cur) return;
      if (queue.length - queue.indexOf(item) < 4) queue.push(...makeItems(ls, 8));   // вопросы не кончаются, пока команда играет
      cur.answering = true;
      try { update(await api(`/rooms/${cur.id}/answer`, { token: token(), body: { ok } })); } catch (e) {}
      finally { if (cur) cur.answering = false; }
    },
    onFinish: () => { if (cur?.phase === 'done' || cur?.room.status === 'done') finish(); },
  }));
  quiet = false;
}

// ---------- итог: свой приз и командный ----------
function finish(){
  if (!cur || cur.finished) return;
  cur.finished = true;
  stop();
  const room = cur.room, me = who(room, room.me), f = foe(room);
  const id = room.id;
  state.teamGames ||= {};
  const first = !state.teamGames[id];
  if (first){
    state.teamGames[id] = { at: Date.now(), mode: room.mode, ok: me?.ok || 0, team: room.players.length };
    reward(TEAM_PRIZE.xp + 2 * (me?.ok || 0), TEAM_PRIZE.coins, { bonus: true });
    checkAchievements();
  } else saveState();
  confetti();
  const best = [...room.players].sort((a, b) => b.ok - a.ok);
  ours(() => openModal(`
    <h2>${f.kind === 'boss' ? `🏆 ${escapeHtml(f.name)} побеждён!` : `🎉 ${escapeHtml(f.name)} здоров!`}</h2>
    <p>Команда справилась вместе: ${room.goal} верных ответов на всех.</p>
    <ul class="team-players team-final" role="list">${best.map(p => `<li${p.id === room.me ? ' class="me"' : ''}>${heroOf(p) ? heroPic(heroOf(p), 'praise') : ''}<b>${escapeHtml(p.name)}</b><span>верно: ${p.ok}</span></li>`).join('')}</ul>
    ${first ? `<p class="placement-reward">Командный приз: <b>+${TEAM_PRIZE.xp + 2 * (me?.ok || 0)} XP, +${TEAM_PRIZE.coins} 🪙</b></p>` : ''}
    <div class="controls"><button class="btn" id="team-done">Ура!</button></div>`));
  cur = null;
  document.getElementById('team-done').onclick = () => { closeModal(); renderHUD(); };
}
