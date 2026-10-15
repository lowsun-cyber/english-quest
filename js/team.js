// English Quest — Командный квест по сети (docs/design-v2/CONCEPT.md, «Командный add-on»; сервер — server/src/rooms.php).
// 2–4 игрока с разных устройств вместе против квеста: вылечить пациента или победить босса. Комната — по коду
// (и QR); каждый выбирает героя (герои не повторяются) и отвечает на свои задания своего класса — подбирает
// устройство из своих тем. На сервер уходит только «верно / неверно»: верный ответ любого игрока двигает общую
// шкалу. Ошибки и мастерство — в профиль того, кто отвечал (как в обычном квесте). Подсказки — из общего запаса.
// Устройство опрашивает комнату раз в 1,5 с. В конце каждый получает свой приз и командный.
// За одним устройством (без сервера): игроки — профили устройства, ходят по очереди; на время хода текущим
// становится профиль того, кто отвечает, — ошибки, мастерство и призы попадают ему. Можно позвать взрослого:
// он отвечает на задания уровня ребёнка без своего прогресса и призов, а ребёнок слышит озвученные ответы.
import { api, ApiError } from './api.js';
import { CHARACTERS, CLINIC_PATIENTS, teamLine } from './eq.js';
import { checkAchievements } from './achievements.js';
import { applyLoadedState } from './backup.js';
import { runQuiz } from './checkpoint.js';
import { cloudLink, cloudOn, openAccount } from './cloud.js';
import { heroPic, playerHero, sayRow } from './heroes.js';
import { renderProfileChip } from './profiles.js';
import { renderHUD, reward } from './hud.js';
import { currentNode } from './map.js';
import { qrSvg } from './qr.js';
import { activeId, deleteStoredState, freshState, loadState, profiles, saveState, setState, state, takeDeviceSettings } from './state.js';
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

// Кнопка над картой: за одним устройством можно играть и без сервера
export function teamButton(){
  return '<button type="button" class="team-btn" data-team>👥 Играть командой</button>';
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

// ---------- вход: за одним устройством или по сети ----------
export function openTeam(code = ''){
  if (code) return openNetwork(code);
  if (cur && !cur.local) return reopen();
  openModal(`
    <h2>👥 Играть командой</h2>
    <p>Вместе против квеста! Каждый верный ответ любого игрока помогает всей команде.</p>
    <div class="team-modes">
      <button class="team-mode" data-how="local"><span aria-hidden="true">📱</span><b>На этом устройстве</b><small>По очереди: передаём планшет друг другу. Можно позвать маму или папу</small></button>
      ${cloudOn() ? '<button class="team-mode" data-how="net"><span aria-hidden="true">🌐</span><b>Каждый со своего устройства</b><small>Комната по коду, все отвечают одновременно</small></button>' : ''}
    </div>`);
  document.querySelector('[data-how="local"]').onclick = openLocal;
  const net = document.querySelector('[data-how="net"]');
  if (net) net.onclick = () => openNetwork();
}

// По сети: создать комнату или войти по коду
function openNetwork(code = ''){
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
    <h2>🌐 Командный квест по сети</h2>
    <p>Каждый отвечает на свои задания на своём устройстве, а каждый верный ответ любого игрока помогает всей команде.</p>
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
    milestones();
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
  if (cur.local){ if (cur.phase === 'play'){ restoreLocal(); toast('👥 Командная игра остановлена. Ответы уже сохранены у тех, кто отвечал.'); } return; }
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
    </div>
    ${cur.say ? `<div class="team-say">${sayRow(cur.say)}</div>` : ''}`;
}
// Реплика героя в шапке (TEAM_LINES в content.js): говорит герой игрока, за одним устройством — того, чей ход.
// Облачко с кнопкой «послушать», как у других реплик: само не звучит, чтобы не перебивать слова заданий.
function say(kind){
  const h = who(cur.room, cur.room.me)?.hero, line = h && teamLine(h, kind);
  if (line) cur.say = line;
  return !!line;
}
// половина шкалы и «осталось чуть-чуть» — по одному разу за квест
function milestones(){
  const r = cur.room;
  if (r.progress >= r.goal) return false;
  if (!cur.near && r.goal - r.progress <= 2){ cur.near = cur.half = true; return say('near'); }
  if (!cur.half && r.progress * 2 >= r.goal){ cur.half = true; return say('half'); }
  return false;
}
const winLine = (heroId, room) => heroId ? sayRow(teamLine(heroId, room.mode === 'boss' ? 'win-boss' : 'win-patient'), { mood: 'praise' }) : '';
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
    // подсказка убирает два неверных варианта — у вопроса из двух вариантов её не тратим
    const wrong = [...document.querySelectorAll('.options .opt:not(:disabled)')].filter(o => o.dataset.o !== cur.answer);
    if (wrong.length < 2){ toast('💡 Здесь всего два варианта — подсказка сохранится для трудного вопроса'); return; }
    b.disabled = true;
    try {
      if (cur.local){
        if (cur.room.hints < 1) return;
        cur.room.hints--;
        localEvent('hint', cur.room.me);
      } else update(await api(`/rooms/${cur.id}/hint`, { token: token(), body: {} }));
      shuffle(wrong).slice(0, 2).forEach(o => { o.disabled = true; o.classList.add('opt-off'); o.setAttribute('aria-hidden', 'true'); });
      say('hint'); if (cur.local) cur.keepSay = true;
      paintHud();
    } catch (e){ toast('💡 ' + e.message); paintHud(); }
  };
}
function startPlay(){
  if (!cur.say) say('start');
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
  const id = room.id, win = winLine(me?.hero, room);
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
    ${win}
    ${first ? `<p class="placement-reward">Командный приз: <b>+${TEAM_PRIZE.xp + 2 * (me?.ok || 0)} XP, +${TEAM_PRIZE.coins} 🪙</b></p>` : ''}
    <div class="controls"><button class="btn" id="team-done">Ура!</button></div>`));
  cur = null;
  document.getElementById('team-done').onclick = () => { closeModal(); renderHUD(); };
}

// ---------- за одним устройством ----------
const GUEST = 'team-guest';   // взрослый без профиля: его ход идёт на временном прогрессе, который потом стирается

function openLocal(){
  hookClose();
  const list = profiles.list;
  openModal(`
    <h2>📱 Командный квест на этом устройстве</h2>
    <p>Игроки отвечают по очереди и передают устройство друг другу. Вопросы — по темам каждого игрока, все ответы звучат вслух.</p>
    <h3 class="team-h">Кто играет (2–4)</h3>
    <div class="team-who">
      ${list.map(p => `<label class="team-who-item"><input type="checkbox" value="${escapeHtml(p.id)}" ${p.id === activeId() ? 'checked' : ''} /><span aria-hidden="true">${escapeHtml(p.avatar)}</span><b>${escapeHtml(p.name)}</b></label>`).join('')}
      <label class="team-who-item"><input type="checkbox" value="${GUEST}" ${list.length < 2 ? 'checked' : ''} /><span aria-hidden="true">🧑</span><b>Взрослый</b><small>без своего прогресса и призов</small></label>
    </div>
    ${list.length < 2 ? '<p class="t-muted">На устройстве один игрок — можно играть вместе со взрослым. Ещё игроков добавляет взрослый в «Для взрослых» → «Ученики».</p>' : ''}
    <h3 class="team-h">Против кого</h3>
    <div class="team-modes">
      <button class="team-mode" data-mode="patient" aria-pressed="true"><span aria-hidden="true">🏥</span><b>Вылечить пациента</b></button>
      <button class="team-mode" data-mode="boss" aria-pressed="false"><span aria-hidden="true">${BOSS.emoji}</span><b>Победить босса</b></button>
    </div>
    <p class="gate-err" id="team-err" role="alert" hidden></p>
    <div class="controls"><button class="btn" id="team-local-go">▶ Начать</button></div>`);
  let mode = 'patient';
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  });
  document.getElementById('team-local-go').onclick = async () => {
    const ids = [...document.querySelectorAll('.team-who input:checked')].map(i => i.value);
    const err = document.getElementById('team-err');
    if (ids.length < 2 || ids.length > 4){ err.textContent = ids.length < 2 ? 'Отметьте хотя бы двух игроков.' : 'Не больше четырёх игроков.'; err.hidden = false; return; }
    if (!ids.some(id => id !== GUEST)){ err.textContent = 'Нужен хотя бы один игрок с профилем.'; err.hidden = false; return; }
    await startLocal(ids, mode);
  };
}

// Темы игрока: на время расчёта текущим становится его прогресс (темы считаются по карте игрока)
function lessonsFor(pid, st){
  const keep = state, keepId = profiles.active;
  setState(st); profiles.active = pid;
  try { return myLessons(); } finally { setState(keep); profiles.active = keepId; }
}

async function startLocal(ids, mode){
  await saveState();
  const origin = activeId(), originState = state;
  const states = {}, pools = {}, used = new Set(), players = [];
  for (const pid of ids.filter(x => x !== GUEST)){
    states[pid] = pid === origin ? state : takeDeviceSettings(await loadState(pid));
    pools[pid] = lessonsFor(pid, states[pid]);
  }
  // взрослый отвечает на задания уровня детей — из их тем
  pools[GUEST] = [...new Set(Object.values(pools).flat())];
  const free = want => { const h = !used.has(want) ? want : heroes().find(c => !used.has(c.id))?.id; used.add(h); return h; };
  for (const pid of ids){
    const p = profiles.list.find(x => x.id === pid);
    players.push({ id: pid, name: p ? p.name : 'Взрослый', avatar: p ? p.avatar : '🧑', hero: free(pid === GUEST ? 'harlow' : playerHero(states[pid]).id), ok: 0, bad: 0, online: true, guest: pid === GUEST });
  }
  const room = { id: 'local' + Date.now().toString(36), mode, status: 'play', goal: 6 * players.length, progress: 0, hints: 3, players, events: [], me: ids[0] };
  cur = { local: true, id: room.id, room, phase: 'play', seq: 0, answer: null, finished: false, states, pools, origin, originState, guestState: freshState() };
  localEvent('start', ids[0]);
  say('start'); cur.keepSay = true;   // первый ход — без «твой ход», уже сказано «начинаем»
  // очередь: по одному вопросу каждому по кругу; вид вопроса меняется от круга к кругу
  const queue = [];
  let n = 0;
  const more = k => { for (let i = 0; i < k; i++, n++){ const pid = ids[n % ids.length]; const it = makeItems(pools[pid], 3)[Math.floor(n / ids.length) % 3]; queue.push({ ...it, pid }); } };
  more(ids.length * 3);
  ours(() => runQuiz({
    header: () => turnHtml() + `<div id="team-hud" class="team-hud">${hudHtml()}</div>`,
    lessons: [...new Set(Object.values(pools).flat())], queue, hideProgress: true,
    stop: () => !cur || cur.phase !== 'play',
    before: item => switchTo(item.pid),
    onShow: (item, answer) => { if (cur) cur.answer = answer; wireHint(); },
    onAnswer: (item, ok) => {
      if (!cur) return;
      if (queue.length - queue.indexOf(item) < ids.length + 1) more(ids.length * 2);
      const p = who(cur.room, item.pid);
      if (ok){ cur.room.progress++; p.ok++; localEvent('ok', item.pid); } else p.bad++;
      if (cur.room.progress >= cur.room.goal){ cur.room.status = 'done'; cur.phase = 'done'; localEvent('done', item.pid); }
      if (milestones()) cur.keepSay = true;   // «половина» и «чуть-чуть» важнее «твой ход»
      paintHud();
    },
    onFinish: () => { if (cur?.local && cur.phase === 'done') finishLocal(); },
  }));
}
function localEvent(k, s){
  const ev = cur.room.events;
  ev.push({ n: (ev.at(-1)?.n || 0) + 1, k, s, at: Date.now() });
  if (ev.length > 12) ev.shift();
}
// Чей ход: прогресс этого игрока становится текущим (взрослый — временный)
function switchTo(pid){
  if (!cur?.local || (cur.room.me === pid && activeId() === pid)) return;
  // забрать актуальный прогресс уходящего игрока (синхронизация могла заменить объект)
  if (activeId() === cur.room.me && cur.states[cur.room.me]) cur.states[cur.room.me] = state;
  saveState();
  profiles.active = pid;
  setState(pid === GUEST ? cur.guestState : cur.states[pid]);
  cur.room.me = pid;
  if (cur.keepSay) cur.keepSay = false; else say('turn');
  renderHUD();
}
function turnHtml(){
  const p = who(cur.room, cur.room.me), h = heroOf(p);
  return `<h2>👥 Командный квест</h2>
    <div class="team-turn" style="--hero-color:${h?.color || 'var(--diamond)'}">${h ? heroPic(h, 'thinking') : ''}<span>Отвечает: <b>${escapeHtml(p.avatar)} ${escapeHtml(p.name)}</b></span></div>`;
}
// Вернуть игрока, который был до игры, и стереть временный прогресс взрослого
function restoreLocal(){
  if (!cur?.local) return;
  if (activeId() === cur.room.me && cur.states[cur.room.me]) cur.states[cur.room.me] = state;
  saveState();
  profiles.active = cur.origin;
  setState(cur.states[cur.origin] || cur.originState);
  deleteStoredState(GUEST);
  cur = null;
  applyLoadedState();
  renderProfileChip();
}
function finishLocal(){
  if (!cur || cur.finished) return;
  cur.finished = true;
  const room = cur.room, f = foe(room);
  const win = winLine(room.players.find(x => !x.guest)?.hero, room);
  for (const p of room.players.filter(x => !x.guest)){
    switchTo(p.id);
    state.teamGames ||= {};
    state.teamGames[room.id] = { at: Date.now(), mode: room.mode, ok: p.ok, team: room.players.length, local: true };
    reward(TEAM_PRIZE.xp + 2 * p.ok, TEAM_PRIZE.coins, { bonus: true });
    checkAchievements();
    saveState();
  }
  restoreLocal();
  confetti();
  const best = [...room.players].sort((a, b) => b.ok - a.ok);
  ours(() => openModal(`
    <h2>${f.kind === 'boss' ? `🏆 ${escapeHtml(f.name)} побеждён!` : `🎉 ${escapeHtml(f.name)} здоров!`}</h2>
    <p>Команда справилась вместе: ${room.goal} верных ответов на всех.</p>
    <ul class="team-players team-final" role="list">${best.map(p => `<li>${heroOf(p) ? heroPic(heroOf(p), 'praise') : ''}<b>${escapeHtml(p.avatar)} ${escapeHtml(p.name)}</b><span>верно: ${p.ok}${p.guest ? '' : ` · +${TEAM_PRIZE.xp + 2 * p.ok} XP`}</span></li>`).join('')}</ul>
    ${win}
    <p class="placement-reward">Командный приз каждому ребёнку: <b>+${TEAM_PRIZE.xp} XP, +${TEAM_PRIZE.coins} 🪙</b> и по 2 XP за свой верный ответ.</p>
    <div class="controls"><button class="btn" id="team-done">Ура!</button></div>`));
  document.getElementById('team-done').onclick = () => { closeModal(); renderHUD(); };
}
