// English Quest — Кабинет учителя: вход по коду, ученики, подключение устройств, учителя.
// Отдельная страница: не тянет модули приложения, только запросы к серверу и данные из content.js.
import { api, ApiError, deviceLabel } from './api.js';
import { API_BASE, TEACHER_KEY } from './config.js';

const { levelFromXp, LESSONS } = window.EQ;
const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐯', '🐨', '🐵', '🦄', '🐙', '🐧', '🐢', '🐝'];
const main = document.getElementById('tc-main');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const appUrl = new URL('./', location.href).href;
const ROLE = { owner: 'владелец', admin: 'администратор', teacher: 'учитель' };

// тема — как у ученика на этом устройстве
try {
  const idx = JSON.parse(localStorage.getItem('english_quest_profiles') || 'null');
  const id = idx?.active || 'main';
  const st = JSON.parse(localStorage.getItem(id === 'main' ? 'english_quest_v2' : `english_quest_v2__${id}`) || 'null');
  if (st?.settings?.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
} catch (e) {}

function toast(msg){
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
async function copy(text){
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
}
const getToken = () => { try { return localStorage.getItem(TEACHER_KEY); } catch (e) { return null; } };
const setToken = t => { try { t ? localStorage.setItem(TEACHER_KEY, t) : localStorage.removeItem(TEACHER_KEY); } catch (e) {} };
const call = (path, body) => api(path, { token: getToken(), body });

let me = null;

// ---------- вход ----------
function renderLogin(message = ''){
  document.getElementById('tc-logout').hidden = true;
  document.getElementById('tc-who').textContent = 'Кабинет English Quest';
  main.innerHTML = `
    <section class="ht-card tc-login">
      <h2 class="tc-h">Вход для учителя</h2>
      <p>Введите код входа, который дал администратор. Код одноразовый: после входа это устройство запомнится.</p>
      <form id="tc-login-form" class="cl-form">
        <label>Код входа <input id="tc-code" autocomplete="one-time-code" autocapitalize="characters" placeholder="ABCD-EFGH" maxlength="12" required /></label>
        <button class="btn" type="submit">Войти</button>
      </form>
      <p class="gate-err" id="tc-err" role="alert"${message ? '' : ' hidden'}>${esc(message)}</p>
    </section>`;
  document.getElementById('tc-login-form').onsubmit = (e) => { e.preventDefault(); login(document.getElementById('tc-code').value); };
  document.getElementById('tc-code').focus();
}
async function login(code){
  try {
    const r = await api('/login', { body: { code, label: deviceLabel() } });
    setToken(r.token);
    await start();
  } catch (e) { renderLogin(e.message); }
}

// ---------- ученики ----------
function studentRow(s){
  const w = s.summary.week;
  const min = Math.round(w.sec / 60);
  const pct = w.ok + w.bad ? Math.round(w.ok * 100 / (w.ok + w.bad)) + '%' : '—';
  const last = s.summary.lastDay ? s.summary.lastDay.split('-').reverse().slice(0, 2).join('.') : 'ещё не занимался';
  const hw = s.summary.homework, hwLesson = hw && LESSONS.find(l => l.id === hw.lessonId);
  return `
    <tr data-id="${esc(s.id)}">
      <td><span class="tc-av" aria-hidden="true">${esc(s.avatar)}</span> <b>${esc(s.name)}</b></td>
      <td>${levelFromXp(s.summary.xp)}</td>
      <td>${min} мин · ${w.days}/7 дн.</td>
      <td>${pct}</td>
      <td>${esc(last)}</td>
      <td>${hwLesson ? `${hw.doneAt ? '✓' : '○'} ${esc(hwLesson.title)}` : '<span class="t-muted">нет</span>'}</td>
      <td>${s.devices || '<span class="t-muted">0</span>'}</td>
      <td class="tc-acts">
        <a class="icon-btn" href="${esc(appUrl)}#view=${esc(s.id)}" title="Статистика, темы, ошибки, домашнее задание">📊 Прогресс</a>
        <button class="icon-btn" data-act="code">🔗 Подключить устройство</button>
        <button class="icon-btn" data-act="devices">📱 Устройства</button>
        <button class="icon-btn" data-act="rename">✏️</button>
        <button class="icon-btn" data-act="delete" aria-label="Удалить ${esc(s.name)}">🗑</button>
      </td>
    </tr>
    <tr class="tc-detail" id="tc-detail-${esc(s.id)}" hidden><td colspan="8"></td></tr>`;
}

async function renderHome(){
  const [{ students }, users] = await Promise.all([call('/students'), me.role === 'teacher' ? Promise.resolve(null) : call('/users')]);
  const next = AVATARS.find(a => !students.some(s => s.avatar === a)) || AVATARS[0];
  main.innerHTML = `
    <section class="ht-card">
      <div class="tc-head">
        <h2 class="tc-h">Ученики <span class="t-muted">(${students.length})</span></h2>
        <button class="icon-btn" id="tc-refresh">🔄 Обновить</button>
      </div>
      ${students.length ? `
        <div class="t-table-wrap">
          <table class="t-table tc-table">
            <thead><tr><th>Ученик</th><th>Уровень</th><th>За 7 дней</th><th>Верно</th><th>Последнее занятие</th><th>Домашка</th><th>Устройства</th><th></th></tr></thead>
            <tbody>${students.map(studentRow).join('')}</tbody>
          </table>
        </div>` : '<p class="t-muted">Пока нет учеников — добавьте первого ниже.</p>'}
      <form class="pf-add tc-add" id="tc-add">
        <h3 class="ht-h4">Добавить ученика</h3>
        <label>Имя или прозвище <input id="tc-add-name" maxlength="20" autocomplete="off" placeholder="Например, Маша" required /></label>
        <p class="t-muted">Фамилию и другие личные данные не вводите — имени достаточно.</p>
        <fieldset class="pf-avatars"><legend>Аватар</legend>
          ${AVATARS.map(a => `<label class="pf-av-pick"><input type="radio" name="tc-av" value="${a}" ${a === next ? 'checked' : ''} /><span>${a}</span></label>`).join('')}
        </fieldset>
        <button class="btn" type="submit">➕ Добавить</button>
      </form>
    </section>

    <section class="ht-card">
      <h2 class="tc-h">Как подключить ученика</h2>
      <ol class="ht-steps">
        <li>Нажмите <b class="ht-chip">🔗 Подключить устройство</b> у ученика — появятся ссылка и код.</li>
        <li>Отправьте ссылку родителю. Её нужно открыть <b>на устройстве ребёнка</b> и нажать «Подключить».<br><span class="t-muted">Или введите код на устройстве: панель «Для репетитора и родителей» → «Сервер учителя».</span></li>
        <li>Готово: прогресс сохраняется на сервере сам, а здесь видно, что ребёнок сделал. Код действует 7 дней и подходит один раз; для второго устройства создайте ещё один.</li>
      </ol>
    </section>

    ${users ? `
    <section class="ht-card">
      <h2 class="tc-h">Учителя</h2>
      <ul class="tc-users" role="list">
        ${users.users.map(u => `<li><b>${esc(u.name)}</b> <span class="t-muted">— ${ROLE[u.role] || u.role}${u.id === me.id ? ', это вы' : ''}</span>
          ${u.id === me.id ? '' : `<button class="icon-btn" data-user="${esc(u.id)}">🔑 Новый код входа</button>`}</li>`).join('')}
      </ul>
      <form class="cl-form" id="tc-user-add">
        <label>Добавить учителя <input id="tc-user-name" maxlength="60" autocomplete="off" placeholder="Имя и отчество" required /></label>
        <button class="btn secondary" type="submit">➕ Добавить</button>
      </form>
      <div id="tc-user-code"></div>
      <p class="t-muted">Учитель видит только своих учеников. Код входа отправьте ему лично — он действует 7 дней и подходит один раз.</p>
    </section>` : ''}`;

  document.getElementById('tc-refresh').onclick = () => renderHome().catch(fail);
  document.getElementById('tc-add').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('tc-add-name').value.trim();
    const avatar = document.querySelector('input[name=tc-av]:checked')?.value;
    try { await call('/students', { name, avatar }); toast(`${avatar} Добавлен ученик «${name}»`); await renderHome(); } catch (err) { fail(err); }
  };
  main.querySelectorAll('.tc-table [data-act]').forEach(btn => btn.onclick = () => studentAction(btn.closest('tr').dataset.id, btn.dataset.act, students).catch(fail));
  const userForm = document.getElementById('tc-user-add');
  if (userForm) userForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await call('/users', { name: document.getElementById('tc-user-name').value.trim() });
      await renderHome();
      showLoginCode(r.user.name, r.login);
    } catch (err) { fail(err); }
  };
  main.querySelectorAll('[data-user]').forEach(btn => btn.onclick = async () => {
    try { const c = await call(`/users/${btn.dataset.user}/code`, {}); showLoginCode(btn.closest('li').querySelector('b').textContent, c); } catch (err) { fail(err); }
  });
}

function codeBox(title, code, link, note){
  return `
    <div class="tc-code-box">
      <p>${title}</p>
      <p class="tc-code">${esc(code.code)}</p>
      <input class="t-link" readonly value="${esc(link)}" aria-label="Ссылка" />
      <div class="controls"><button class="btn gold" data-copy="${esc(link)}">📋 Скопировать ссылку</button></div>
      <p class="t-muted">${note} Действует до ${new Date(code.expires).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}.</p>
    </div>`;
}
function wireCopy(root){
  root.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => toast(await copy(b.dataset.copy) ? '📋 Скопировано' : 'Скопируйте из поля'));
}
function showLoginCode(name, code){
  const box = document.getElementById('tc-user-code');
  box.innerHTML = codeBox(`Код входа для <b>${esc(name)}</b>:`, code, `${new URL('teacher.html', appUrl).href}#login=${code.code}`, 'Ссылка сразу открывает кабинет и входит.');
  wireCopy(box);
}

async function studentAction(id, act, students){
  const s = students.find(x => x.id === id);
  const detail = document.getElementById(`tc-detail-${id}`);
  const cell = detail.firstElementChild;
  if (act === 'code'){
    const c = await call(`/students/${id}/code`, {});
    cell.innerHTML = codeBox(`Подключение устройства для <b>${esc(s.avatar)} ${esc(s.name)}</b>. Отправьте ссылку родителю — открыть её нужно на устройстве ребёнка:`, c, `${appUrl}#link=${c.code}`, 'Код подходит для одного устройства.');
    detail.hidden = false;
    wireCopy(cell);
  } else if (act === 'devices'){
    const { devices } = await call(`/students/${id}/devices`);
    cell.innerHTML = devices.length ? `
      <ul class="tc-devices" role="list">${devices.map(d => `
        <li>📱 ${esc(d.label || 'Устройство')} <span class="t-muted">— был в сети ${new Date(d.lastUsed).toLocaleDateString('ru-RU')}</span>
        <button class="icon-btn" data-dev="${esc(d.id)}">Отключить</button></li>`).join('')}</ul>`
      : '<p class="t-muted">Устройств пока нет — нажмите «Подключить устройство».</p>';
    detail.hidden = false;
    cell.querySelectorAll('[data-dev]').forEach(b => b.onclick = async () => {
      if (!confirm('Отключить это устройство? Прогресс на нём останется, но перестанет сохраняться на сервере.')) return;
      try { await call(`/devices/${b.dataset.dev}/delete`, {}); toast('Устройство отключено'); await renderHome(); } catch (err) { fail(err); }
    });
  } else if (act === 'rename'){
    const name = prompt('Новое имя ученика:', s.name);
    if (!name || !name.trim()) return;
    await call(`/students/${id}`, { name });
    await renderHome();
  } else if (act === 'delete'){
    if (!confirm(`Удалить ученика «${s.name}» с сервера? Прогресс на сервере и подключения устройств удалятся навсегда. На самих устройствах прогресс останется.`)) return;
    await call(`/students/${id}/delete`, {});
    toast(`Ученик «${s.name}» удалён`);
    await renderHome();
  }
}

function fail(e){
  if (e instanceof ApiError && e.status === 401){ setToken(null); renderLogin('Нужно войти заново.'); return; }
  toast(e.message || 'Что-то пошло не так');
}

async function start(){
  if (!API_BASE){
    main.innerHTML = `<section class="ht-card"><h2 class="tc-h">Сервер ещё не подключён</h2><p>Кабинет заработает, когда сервер English Quest будет установлен и указан в приложении.</p></section>`;
    return;
  }
  const hash = /^#login=([A-Za-z0-9-]{8,12})$/.exec(location.hash);
  if (hash){ history.replaceState(null, '', location.pathname); return login(hash[1]); }
  if (!getToken()) return renderLogin();
  try {
    const r = await call('/me');
    me = r.user;
    document.getElementById('tc-who').textContent = `${me.name} · ${r.org.name}`;
    const out = document.getElementById('tc-logout');
    out.hidden = false;
    out.onclick = async () => { try { await call('/logout', {}); } catch (e) {} setToken(null); renderLogin(); };
    await renderHome();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401){ setToken(null); return renderLogin('Нужно войти заново.'); }
    main.innerHTML = `<section class="ht-card"><h2 class="tc-h">Нет связи с сервером</h2><p>${esc(e.message)}</p><div class="controls"><button class="btn" id="tc-retry">Повторить</button></div></section>`;
    document.getElementById('tc-retry').onclick = start;
  }
}
start();
