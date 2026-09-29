// English Quest — Админ-панель (admin/): ученики, их прогресс и домашка, репетиторы, выгрузка в PDF.
// Отдельная страница: не тянет модули приложения — только запросы к серверу, контент и stats.js.
// Владелец и администраторы видят всех и управляют репетиторами; репетитор — только своих учеников.
import { api, ApiError, deviceLabel } from './api.js';
import { API_BASE, TEACHER_KEY } from './config.js';
import { LESSONS, levelFromXp } from './eq.js';
import { CHECKPOINT_SIZE, EX_NAMES, EX_ORDER, GRADES, PARTS, homeworkDone, makeHomeworkFor, reportText, studentStats } from './stats.js';
import { WEEKDAYS, fmtDay } from './util.js';

const main = document.getElementById('adm-main');
const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐯', '🐨', '🐵', '🦄', '🐙', '🐧', '🐢', '🐝'];
const ROLE = { owner: 'Владелец', admin: 'Администратор', teacher: 'Репетитор' };
const appUrl = new URL('../', location.href).href;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = t => t ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
const fmtDateTime = t => t ? new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '—';
const dayShort = k => k ? k.split('-').reverse().slice(0, 2).join('.') : '—';

export const eqAdmin = window.eqAdmin = { lastPdf: null };   // для автотеста: что выгрузили последним

// ---------- тема, сообщения, буфер ----------
const THEME_KEY = 'eq_admin_theme';
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('adm-theme').textContent = t === 'dark' ? '☀️' : '🌙';
}
try { applyTheme(localStorage.getItem(THEME_KEY) || 'light'); } catch (e) { applyTheme('light'); }
document.getElementById('adm-theme').onclick = () => {
  const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  applyTheme(t);
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
};
function toast(msg){
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
async function copy(text){ try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; } }

// ---------- сервер ----------
const getToken = () => { try { return localStorage.getItem(TEACHER_KEY); } catch (e) { return null; } };
const setToken = t => { try { t ? localStorage.setItem(TEACHER_KEY, t) : localStorage.removeItem(TEACHER_KEY); } catch (e) {} };
const call = (path, body) => api(path, { token: getToken(), body });

let me = null, org = null, users = [], students = [];
const isAdmin = () => me && (me.role === 'owner' || me.role === 'admin');
const userName = id => users.find(u => u.id === id)?.name || (id === me?.id ? me.name : '—');

function fail(e){
  if (e instanceof ApiError && e.status === 401){ setToken(null); renderLogin('Нужно войти заново.'); return; }
  toast(e.message || 'Что-то пошло не так');
}

// ---------- вход ----------
function renderLogin(message = ''){
  me = null;
  document.getElementById('adm-nav').hidden = true;
  document.getElementById('adm-me').hidden = true;
  main.innerHTML = `
    <section class="adm-card adm-login">
      <h1 class="adm-h1">Вход</h1>
      <p>Введите код входа, который выдал администратор. Код одноразовый — после входа это устройство запомнится.</p>
      <form id="adm-login-form" class="cl-form">
        <label>Код входа <input id="adm-code" autocomplete="one-time-code" autocapitalize="characters" placeholder="ABCD-EFGH" maxlength="12" required /></label>
        <button class="btn" type="submit">Войти</button>
      </form>
      <p class="gate-err" role="alert"${message ? '' : ' hidden'}>${esc(message)}</p>
    </section>`;
  document.getElementById('adm-login-form').onsubmit = (e) => { e.preventDefault(); login(document.getElementById('adm-code').value); };
  document.getElementById('adm-code').focus();
}
async function login(code){
  try {
    const r = await api('/login', { body: { code, label: deviceLabel() } });
    setToken(r.token);
    await start();
  } catch (e) { renderLogin(e.message); }
}

// ---------- ученики: список ----------
let filter = { q: '', teacher: '' };
function studentRows(list){
  return list.map(s => {
    const w = s.summary.week;
    const pct = w.ok + w.bad ? Math.round(w.ok * 100 / (w.ok + w.bad)) + '%' : '—';
    const hw = s.summary.homework, hl = hw && LESSONS.find(l => l.id === hw.lessonId);
    return `
      <tr data-id="${esc(s.id)}" class="adm-row" tabindex="0">
        <td><span class="adm-av" aria-hidden="true">${esc(s.avatar)}</span> <a href="#student/${esc(s.id)}"><b>${esc(s.name)}</b></a></td>
        ${isAdmin() ? `<td>${esc(userName(s.teacherId))}</td>` : ''}
        <td>${levelFromXp(s.summary.xp)}</td>
        <td>${Math.round(w.sec / 60)} мин · ${w.days}/7 дн.</td>
        <td>${pct}</td>
        <td>${s.summary.lastDay ? dayShort(s.summary.lastDay) : '<span class="t-muted">не занимался</span>'}</td>
        <td>${hl ? `${hw.doneAt ? '✓' : '○'} ${esc(hl.title)}` : '<span class="t-muted">нет</span>'}</td>
        <td>${s.devices}</td>
      </tr>`;
  }).join('');
}
function filtered(){
  const q = filter.q.trim().toLowerCase();
  return students.filter(s => (!q || s.name.toLowerCase().includes(q)) && (!filter.teacher || s.teacherId === filter.teacher));
}
async function renderStudents(){
  setTab('students');
  ({ students } = await call('/students'));
  const next = AVATARS.find(a => !students.some(s => s.avatar === a)) || AVATARS[0];
  const teachers = users;   // вести учеников может любой взрослый, включая владельца
  main.innerHTML = `
    <section class="adm-card">
      <div class="adm-head">
        <h1 class="adm-h1">Ученики <span class="t-muted">${students.length}</span></h1>
        <div class="adm-tools">
          <input type="search" id="adm-q" placeholder="Поиск по имени" value="${esc(filter.q)}" aria-label="Поиск по имени" />
          ${isAdmin() ? `<select id="adm-teacher" aria-label="Репетитор"><option value="">Все репетиторы</option>${teachers.map(u => `<option value="${esc(u.id)}" ${filter.teacher === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
          <button class="btn secondary" id="adm-pdf-all" ${students.length ? '' : 'disabled'}>PDF по всем</button>
        </div>
      </div>
      ${students.length ? `
        <div class="t-table-wrap">
          <table class="t-table adm-table">
            <thead><tr><th>Ученик</th>${isAdmin() ? '<th>Репетитор</th>' : ''}<th>Уровень</th><th>За 7 дней</th><th>Верно</th><th>Последнее занятие</th><th>Домашка</th><th>Устройства</th></tr></thead>
            <tbody id="adm-tbody">${studentRows(filtered())}</tbody>
          </table>
        </div>` : '<p class="t-muted">Учеников пока нет — добавьте первого.</p>'}
    </section>

    <section class="adm-card">
      <h2 class="adm-h2">Новый ученик</h2>
      <form class="adm-form" id="adm-add">
        <label>Имя или прозвище <input id="adm-add-name" maxlength="20" autocomplete="off" placeholder="Например, Маша" required /></label>
        ${isAdmin() ? `<label>Репетитор <select id="adm-add-teacher">${teachers.map(u => `<option value="${esc(u.id)}" ${u.id === me.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>` : ''}
        <fieldset class="pf-avatars"><legend>Аватар</legend>
          ${AVATARS.map(a => `<label class="pf-av-pick"><input type="radio" name="adm-av" value="${a}" ${a === next ? 'checked' : ''} /><span>${a}</span></label>`).join('')}
        </fieldset>
        <p class="t-muted adm-wide">Фамилию и другие личные данные не вводите — имени достаточно.</p>
        <div class="adm-wide"><button class="btn" type="submit">Добавить ученика</button></div>
      </form>
      <p class="t-muted">После добавления откройте ученика и нажмите «Подключить устройство» — появится ссылка для родителя.</p>
    </section>`;

  const redraw = () => { const tb = document.getElementById('adm-tbody'); if (tb){ tb.innerHTML = studentRows(filtered()); wireRows(); } };
  document.getElementById('adm-q').oninput = (e) => { filter.q = e.target.value; redraw(); };
  const ts = document.getElementById('adm-teacher');
  if (ts) ts.onchange = (e) => { filter.teacher = e.target.value; redraw(); };
  document.getElementById('adm-pdf-all').onclick = (e) => exportPdf(filtered().map(s => s.id), e.target);
  document.getElementById('adm-add').onsubmit = async (e) => {
    e.preventDefault();
    const body = { name: document.getElementById('adm-add-name').value.trim(), avatar: document.querySelector('input[name=adm-av]:checked')?.value };
    const t = document.getElementById('adm-add-teacher');
    if (t) body.teacherId = t.value;
    try { const r = await call('/students', body); toast(`Добавлен ученик «${r.student.name}»`); location.hash = `#student/${r.student.id}`; } catch (err) { fail(err); }
  };
  wireRows();
}
function wireRows(){
  main.querySelectorAll('.adm-row').forEach(tr => {
    tr.onclick = (e) => { if (!e.target.closest('a')) location.hash = `#student/${tr.dataset.id}`; };
    tr.onkeydown = (e) => { if (e.key === 'Enter') location.hash = `#student/${tr.dataset.id}`; };
  });
}

// ---------- ученик: карточка ----------
let period = 7;
function chart(days, goal){
  const mins = days.map(d => d.sec / 60);
  const label = m => m > 0 && m < 1 ? '<1' : String(Math.round(m));
  const max = Math.max(...mins, goal || 0, 1);
  const peak = mins.indexOf(Math.max(...mins));
  const dense = days.length > 10;
  return `
    <figure class="t-chart adm-chart${dense ? ' dense' : ''}">
      <figcaption>Минуты занятий по дням</figcaption>
      ${mins.every(m => m === 0) ? '<p class="t-muted bars-empty">За этот период занятий не было.</p>' : ''}
      <div class="bars" aria-hidden="true">
        ${goal ? `<span class="goal-line" style="bottom:${Math.round(goal * 100 / max)}%"><i>цель ${goal} мин</i></span>` : ''}
        ${days.map((d, i) => `
          <div class="bar-col" title="${fmtDay(d.key)}: ${label(mins[i])} мин, верно ${d.ok}, ошибок ${d.bad}">
            <span class="bar-val">${i === peak && mins[i] ? label(mins[i]) : ''}</span>
            <span class="bar" style="height:${mins[i] ? Math.max(4, Math.round(mins[i] * 100 / max)) : 0}%"></span>
          </div>`).join('')}
      </div>
      <div class="bar-days" aria-hidden="true">${days.map((d, i) => `<span>${dense ? (i % 5 === 4 || i === days.length - 1 ? fmtDay(d.key) : '') : WEEKDAYS[new Date(d.t).getDay()]}${d.goalMet ? '<b class="day-met">✓</b>' : ''}</span>`).join('')}</div>
      <table class="sr-only">
        <caption>Минуты занятий по дням</caption>
        <tr><th>День</th><th>Минуты</th><th>Цель выполнена</th><th>Верных</th><th>Ошибок</th></tr>
        ${days.map((d, i) => `<tr><td>${fmtDay(d.key)}</td><td>${label(mins[i])}</td><td>${d.goalMet ? 'да' : d.frozen ? 'заморозка' : 'нет'}</td><td>${d.ok}</td><td>${d.bad}</td></tr>`).join('')}
      </table>
    </figure>`;
}

async function renderStudent(id){
  setTab('students');
  const [p, dv] = await Promise.all([call(`/students/${id}/progress`), call(`/students/${id}/devices`)]);
  if (!students.length) ({ students } = await call('/students'));
  const s = students.find(x => x.id === id) || { ...p.student, devices: dv.devices.length };
  const st = p.state || {};
  const S = studentStats(st, period);
  const hw = st.homework, hwLesson = hw && LESSONS.find(l => l.id === hw.lessonId);
  const due = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const worst = S.lessons.filter(x => x.wrong > 0).sort((a, b) => b.wrong - a.wrong).slice(0, 3).map(x => x.l.id);

  main.innerHTML = `
    <p><a href="#students" class="adm-back">← Все ученики</a></p>
    <section class="adm-card">
      <div class="adm-head">
        <div>
          <h1 class="adm-h1"><span class="adm-av" aria-hidden="true">${esc(s.avatar)}</span> ${esc(s.name)}</h1>
          <p class="t-muted">${isAdmin() ? `Репетитор: ${esc(userName(s.teacherId))} · ` : ''}Уровень ${S.level} · ${esc(S.rank?.title || '')} · обновлено ${p.updated ? fmtDateTime(p.updated) : 'ещё не занимался'}</p>
        </div>
        <div class="adm-tools">
          <button class="btn gold" id="adm-pdf">Выгрузить PDF</button>
          <button class="btn secondary" id="adm-json">JSON</button>
          <a class="btn secondary" href="${esc(appUrl)}?view=${esc(id)}#view=${esc(id)}">В приложении</a>
        </div>
      </div>

      <div class="adm-period" role="group" aria-label="Период">
        ${[7, 30].map(n => `<button class="tab${n === period ? ' active' : ''}" data-period="${n}" aria-pressed="${n === period}">${n} дней</button>`).join('')}
      </div>
      <div class="t-tiles">
        <div class="t-tile"><span class="t-num">${S.min}</span><span class="t-lbl">минут за ${period} дней</span></div>
        <div class="t-tile"><span class="t-num">${S.active}<small>/${period}</small></span><span class="t-lbl">дней с занятиями</span></div>
        <div class="t-tile"><span class="t-num">${S.total}</span><span class="t-lbl">ответов</span></div>
        <div class="t-tile"><span class="t-num">${S.pct === null ? '—' : S.pct + '%'}</span><span class="t-lbl">верных ответов</span></div>
        <div class="t-tile"><span class="t-num">🔥 ${S.streak}</span><span class="t-lbl">серия · рекорд ${S.best} · 🧊 ${S.freezes}</span></div>
        <div class="t-tile"><span class="t-num">${S.metDays}<small>/${period}</small></span><span class="t-lbl">дней с целью (${S.goal} мин)</span></div>
        <div class="t-tile"><span class="t-num">${S.lessonsDone}<small>/${LESSONS.length}</small></span><span class="t-lbl">тем пройдено</span></div>
        <div class="t-tile"><span class="t-num">${S.xp}</span><span class="t-lbl">XP · ${S.gold} золота</span></div>
      </div>
      <p class="t-muted adm-alltime">За всё время: ${S.allTime.min} мин, ${S.allTime.activeDays} дн. с занятиями${S.allTime.first ? ` (с ${dayShort(S.allTime.first)})` : ''}, ответов ${S.allTime.ok + S.allTime.bad}${S.allTime.pct !== null ? `, верных ${S.allTime.pct}%` : ''}, выучено после ошибок ${S.mastered}.</p>
      ${chart(S.days, S.goal)}
    </section>

    <section class="adm-card">
      <h2 class="adm-h2">Домашнее задание</h2>
      ${hwLesson ? `
        <div class="t-hw-current">
          <div><b>${esc(hwLesson.title)}</b> · ${hw.tasks.map(ex => `${homeworkDone(st, hw, ex) ? '✓' : '○'} ${EX_NAMES[ex]}`).join(' · ')}
          <div class="t-muted">${hw.doneAt ? `Выполнено ${fmtDateTime(hw.doneAt)}` : hw.due ? `Срок ${fmtDay(hw.due)}` : 'Без срока'}${hw.note ? ` · «${esc(hw.note)}»` : ''}</div></div>
          <button class="icon-btn" id="adm-hw-cancel">${hw.doneAt ? 'Убрать' : 'Отменить'}</button>
        </div>` : '<p class="t-muted">Сейчас задания нет.</p>'}
      <form class="t-hw-form" id="adm-hw">
        <label>Тема
          <select id="adm-hw-lesson">
            ${GRADES.map(g => `<optgroup label="${g} класс">${LESSONS.filter(l => l.grade === g).map(l => `<option value="${l.id}">${esc(l.title)} — ${esc(l.subtitle)}</option>`).join('')}</optgroup>`).join('')}
          </select>
        </label>
        <fieldset><legend>Упражнения</legend>
          <div class="t-checks">${EX_ORDER.map(ex => `<label class="t-check"><input type="checkbox" value="${ex}" ${['vocab', 'listen', 'match'].includes(ex) ? 'checked' : ''}/> ${EX_NAMES[ex]}</label>`).join('')}</div>
        </fieldset>
        <div class="t-row">
          <label>Срок <input type="date" id="adm-hw-due" value="${due}" /></label>
          <label class="t-grow">Комментарий для ученика <input type="text" id="adm-hw-note" maxlength="300" placeholder="Например: повтори слова про семью" /></label>
        </div>
        <div class="controls">
          <button class="btn" type="submit">Назначить</button>
          <button class="btn secondary" type="button" id="adm-hw-link">Скопировать ссылку</button>
        </div>
        <p class="t-muted" id="adm-hw-hint">«Назначить» — задание придёт на подключённые устройства ученика при следующей синхронизации. Ссылка — для учеников без подключения.</p>
      </form>
    </section>

    <section class="adm-card">
      <h2 class="adm-h2">Темы</h2>
      <div class="t-table-wrap">
        <table class="t-table">
          <thead><tr><th>Тема</th><th>Класс</th>${PARTS.map(ex => `<th title="${esc(EX_NAMES[ex])}">${EX_NAMES[ex].split(' ')[0]}</th>`).join('')}<th>Пройдена</th><th>Ошибок</th></tr></thead>
          <tbody>${S.lessons.map(x => `
            <tr class="${worst.includes(x.l.id) ? 'hot' : ''}${x.parts ? '' : ' idle'}">
              <td>${esc(x.l.title)}</td><td>${x.l.grade}</td>
              ${PARTS.map(ex => `<td>${x.p[ex] ? x.p[ex] : '·'}</td>`).join('')}
              <td>${x.done ? '✓' : ''}</td><td>${x.wrong || '—'}</td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </section>

    <section class="adm-card adm-cols">
      <div>
        <h2 class="adm-h2">Проверки</h2>
        <ul class="t-cps" role="list">${S.checkpoints.map(({ cp, r }) => `<li>${esc(cp.title)} — ${r?.passedAt ? `<b>сдана</b> ${fmtDate(r.passedAt)} (лучший ${r.best}/${CHECKPOINT_SIZE})` : r ? `не сдана (лучший ${r.best}/${CHECKPOINT_SIZE})` : '<span class="t-muted">не начата</span>'}</li>`).join('')}</ul>
      </div>
      <div>
        <h2 class="adm-h2">Трудные слова и вопросы <span class="t-muted">${S.hard.length}</span></h2>
        ${S.hard.length ? `<ul class="t-hard" role="list">${S.hard.map(({ m, data }) => `
          <li><span class="t-hard-main">${m.type === 'word' ? `<b>${esc(data.word.en)}</b> — ${esc(data.word.ru)}` : esc(data.q.q)}</span><span class="t-muted">ошибок: ${m.wrong}</span></li>`).join('')}</ul>`
          : '<p class="t-muted">Нет — ошибок не было или все выучены.</p>'}
      </div>
    </section>

    <section class="adm-card adm-cols">
      <div>
        <h2 class="adm-h2">Отчёт</h2>
        <textarea class="t-report" id="adm-report" readonly rows="8" aria-label="Текст отчёта">${esc(reportText(st, s.name, S))}</textarea>
        <div class="controls"><button class="btn secondary" id="adm-report-copy">Скопировать</button></div>
      </div>
      <div>
        <h2 class="adm-h2">Устройства <span class="t-muted">${dv.devices.length}</span></h2>
        ${dv.devices.length ? `<ul class="tc-devices" role="list">${dv.devices.map(d => `<li>${esc(d.label || 'Устройство')} <span class="t-muted">— в сети ${fmtDate(d.lastUsed)}</span> <button class="icon-btn" data-dev="${esc(d.id)}">Отключить</button></li>`).join('')}</ul>` : '<p class="t-muted">Устройств пока нет.</p>'}
        <div class="controls"><button class="btn" id="adm-code-btn">Подключить устройство</button></div>
        <div id="adm-code-box"></div>
      </div>
    </section>

    <section class="adm-card">
      <h2 class="adm-h2">Настройки ученика</h2>
      <form class="adm-form" id="adm-edit">
        <label>Имя <input id="adm-edit-name" maxlength="20" value="${esc(s.name)}" required /></label>
        ${isAdmin() ? `<label>Репетитор <select id="adm-edit-teacher">${users.map(u => `<option value="${esc(u.id)}" ${u.id === s.teacherId ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>` : ''}
        <fieldset class="pf-avatars"><legend>Аватар</legend>
          ${AVATARS.map(a => `<label class="pf-av-pick"><input type="radio" name="adm-edit-av" value="${a}" ${a === s.avatar ? 'checked' : ''} /><span>${a}</span></label>`).join('')}
        </fieldset>
        <div class="adm-wide controls"><button class="btn" type="submit">Сохранить</button><button class="btn rose" type="button" id="adm-del">Удалить ученика</button></div>
      </form>
    </section>`;

  main.querySelectorAll('[data-period]').forEach(b => b.onclick = () => { period = +b.dataset.period; renderStudent(id).catch(fail); });
  document.getElementById('adm-pdf').onclick = (e) => exportPdf([id], e.target);
  document.getElementById('adm-json').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'english-quest', format: 1, exportedAt: Date.now(), profile: { name: s.name, avatar: s.avatar }, state: st }, null, 1)], { type: 'application/json' });
    download(blob, `english-quest-${fileSafe(s.name)}-${new Date().toISOString().slice(0, 10)}.json`);
  };
  document.getElementById('adm-report-copy').onclick = async () => toast(await copy(document.getElementById('adm-report').value) ? 'Отчёт скопирован' : 'Скопируйте из поля');

  const readSpec = () => ({
    lessonId: document.getElementById('adm-hw-lesson').value,
    tasks: [...document.querySelectorAll('#adm-hw .t-checks input:checked')].map(i => i.value),
    due: document.getElementById('adm-hw-due').value,
    note: document.getElementById('adm-hw-note').value.trim(),
  });
  const hint = document.getElementById('adm-hw-hint');
  document.getElementById('adm-hw').onsubmit = async (e) => {
    e.preventDefault();
    const spec = readSpec();
    if (!spec.tasks.length){ hint.textContent = 'Выберите хотя бы одно упражнение.'; return; }
    try {
      await call(`/students/${id}/homework`, { base: p.version, homework: makeHomeworkFor(st, spec) });
      toast('Задание назначено');
      await renderStudent(id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409){ toast('Ученик только что занимался — данные обновлены, назначьте ещё раз'); await renderStudent(id); }
      else fail(err);
    }
  };
  document.getElementById('adm-hw-link').onclick = async () => {
    const spec = readSpec();
    if (!spec.tasks.length){ hint.textContent = 'Выберите хотя бы одно упражнение.'; return; }
    const q = new URLSearchParams({ lesson: spec.lessonId, tasks: spec.tasks.join(',') });
    if (spec.due) q.set('due', spec.due);
    if (spec.note) q.set('note', spec.note);
    const link = `${appUrl}#hw&${q}`;
    hint.textContent = (await copy(link)) ? 'Ссылка скопирована — отправьте её ученику.' : `Скопируйте ссылку: ${link}`;
  };
  const cancel = document.getElementById('adm-hw-cancel');
  if (cancel) cancel.onclick = async () => {
    try { await call(`/students/${id}/homework`, { base: p.version, homework: null }); toast('Задание убрано'); await renderStudent(id); }
    catch (err) { if (err instanceof ApiError && err.status === 409) await renderStudent(id); else fail(err); }
  };

  main.querySelectorAll('[data-dev]').forEach(b => b.onclick = async () => {
    if (!confirm('Отключить это устройство? Прогресс на нём останется, но перестанет сохраняться на сервере.')) return;
    try { await call(`/devices/${b.dataset.dev}/delete`, {}); toast('Устройство отключено'); await renderStudent(id); } catch (err) { fail(err); }
  });
  document.getElementById('adm-code-btn').onclick = async () => {
    try {
      const c = await call(`/students/${id}/code`, {});
      const box = document.getElementById('adm-code-box');
      box.innerHTML = codeBox(`Отправьте ссылку родителю — открыть её нужно на устройстве ребёнка. Или введите код в приложении: панель для взрослых → «Сервер учителя».`, c, `${appUrl}#link=${c.code}`, 'Код подходит для одного устройства.');
      wireCopy(box);
    } catch (err) { fail(err); }
  };
  document.getElementById('adm-edit').onsubmit = async (e) => {
    e.preventDefault();
    const body = { name: document.getElementById('adm-edit-name').value.trim(), avatar: document.querySelector('input[name=adm-edit-av]:checked')?.value };
    const t = document.getElementById('adm-edit-teacher');
    if (t) body.teacherId = t.value;
    try { await call(`/students/${id}`, body); students = []; toast('Сохранено'); await renderStudent(id); } catch (err) { fail(err); }
  };
  document.getElementById('adm-del').onclick = async () => {
    if (!confirm(`Удалить ученика «${s.name}» с сервера? Прогресс на сервере и подключения устройств удалятся навсегда. На самих устройствах прогресс останется.\n\nСовет: сначала выгрузите PDF или JSON.`)) return;
    try { await call(`/students/${id}/delete`, {}); toast(`Ученик «${s.name}» удалён`); location.hash = '#students'; } catch (err) { fail(err); }
  };
}

function codeBox(title, code, link, note){
  return `
    <div class="tc-code-box">
      <p>${title}</p>
      <p class="tc-code">${esc(code.code)}</p>
      <input class="t-link" readonly value="${esc(link)}" aria-label="Ссылка" />
      <div class="controls"><button class="btn gold" data-copy="${esc(link)}">Скопировать ссылку</button></div>
      <p class="t-muted">${note} Действует до ${fmtDate(code.expires)}.</p>
    </div>`;
}
function wireCopy(root){
  root.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => toast(await copy(b.dataset.copy) ? 'Скопировано' : 'Скопируйте из поля'));
}

// ---------- репетиторы и администраторы ----------
async function renderUsers(){
  if (!isAdmin()){ location.hash = '#students'; return; }
  setTab('users');
  ({ users } = await call('/users'));
  const canRole = me.role === 'owner';
  const canManage = u => u.id !== me.id && u.role !== 'owner' && (me.role === 'owner' || u.role === 'teacher');
  main.innerHTML = `
    <section class="adm-card">
      <h1 class="adm-h1">Репетиторы и администраторы <span class="t-muted">${users.length}</span></h1>
      <div class="t-table-wrap">
        <table class="t-table adm-table">
          <thead><tr><th>Имя</th><th>Роль</th><th>Учеников</th><th>Последний вход</th><th>Добавлен</th><th></th></tr></thead>
          <tbody>${users.map(u => `
            <tr data-user="${esc(u.id)}">
              <td><b>${esc(u.name)}</b>${u.id === me.id ? ' <span class="t-muted">— это вы</span>' : ''}</td>
              <td>${canRole && canManage(u) ? `<select data-role aria-label="Роль ${esc(u.name)}"><option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>Репетитор</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Администратор</option></select>` : ROLE[u.role]}</td>
              <td>${u.students}</td>
              <td>${u.lastSeen ? fmtDate(u.lastSeen) : '<span class="t-muted">не входил</span>'}</td>
              <td>${fmtDate(u.created)}</td>
              <td class="tc-acts">
                ${canManage(u) || u.id === me.id ? '<button class="icon-btn" data-act="rename">Переименовать</button>' : ''}
                ${canManage(u) ? '<button class="icon-btn" data-act="code">Код входа</button><button class="icon-btn" data-act="delete">Удалить</button>' : ''}
              </td>
            </tr>
            <tr class="tc-detail" id="adm-u-${esc(u.id)}" hidden><td colspan="6"></td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>
    <section class="adm-card">
      <h2 class="adm-h2">Новая учётная запись</h2>
      <form class="adm-form" id="adm-user-add">
        <label>Имя <input id="adm-user-name" maxlength="60" autocomplete="off" placeholder="Имя и отчество" required /></label>
        <label>Роль <select id="adm-user-role"><option value="teacher">Репетитор</option>${canRole ? '<option value="admin">Администратор</option>' : ''}</select></label>
        <div class="adm-wide"><button class="btn" type="submit">Создать</button></div>
      </form>
      <div id="adm-user-code"></div>
      <p class="t-muted">Репетитор видит только своих учеников. Администратор — всех учеников и управляет репетиторами. Код входа отправьте лично: он действует 7 дней и подходит один раз.</p>
    </section>`;

  const loginLink = c => `${new URL('./', location.href).href}#login=${c.code}`;
  document.getElementById('adm-user-add').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await call('/users', { name: document.getElementById('adm-user-name').value.trim(), role: document.getElementById('adm-user-role').value });
      await renderUsers();
      const box = document.getElementById('adm-user-code');
      box.innerHTML = codeBox(`Код входа для <b>${esc(r.user.name)}</b>:`, r.login, loginLink(r.login), 'Ссылка сразу открывает панель и входит.');
      wireCopy(box);
    } catch (err) { fail(err); }
  };
  main.querySelectorAll('[data-user]').forEach(tr => {
    const u = users.find(x => x.id === tr.dataset.user);
    const cell = document.getElementById(`adm-u-${u.id}`);
    const role = tr.querySelector('[data-role]');
    if (role) role.onchange = async () => {
      try { await call(`/users/${u.id}`, { role: role.value }); toast(`${u.name}: ${ROLE[role.value].toLowerCase()}`); await renderUsers(); } catch (err) { fail(err); }
    };
    tr.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
      try {
        if (b.dataset.act === 'rename'){
          const name = prompt('Новое имя:', u.name);
          if (!name || !name.trim()) return;
          await call(`/users/${u.id}`, { name });
          if (u.id === me.id) me.name = name.trim();
          await renderUsers(); renderMe();
        } else if (b.dataset.act === 'code'){
          const c = await call(`/users/${u.id}/code`, {});
          cell.firstElementChild.innerHTML = codeBox(`Новый код входа для <b>${esc(u.name)}</b>. Старые входы на его устройствах продолжат работать.`, c, loginLink(c), 'Ссылка сразу открывает панель и входит.');
          cell.hidden = false;
          wireCopy(cell);
        } else if (b.dataset.act === 'delete'){
          const others = users.filter(x => x.id !== u.id);
          cell.firstElementChild.innerHTML = `
            <form class="adm-form" id="adm-del-form">
              <p class="adm-wide">Удалить <b>${esc(u.name)}</b>? Входы на всех его устройствах перестанут работать.${u.students ? ` Его ученики (${u.students}) перейдут:` : ''}</p>
              ${u.students ? `<label>Кому передать учеников <select id="adm-del-to">${others.map(x => `<option value="${esc(x.id)}" ${x.id === me.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>` : ''}
              <div class="adm-wide controls"><button class="btn rose" type="submit">Удалить</button><button class="icon-btn" type="button" id="adm-del-cancel">Отмена</button></div>
            </form>`;
          cell.hidden = false;
          document.getElementById('adm-del-cancel').onclick = () => { cell.hidden = true; };
          document.getElementById('adm-del-form').onsubmit = async (e) => {
            e.preventDefault();
            const to = document.getElementById('adm-del-to');
            try { await call(`/users/${u.id}/delete`, to ? { transferTo: to.value } : {}); toast(`${u.name} удалён(а)`); await renderUsers(); } catch (err) { fail(err); }
          };
        }
      } catch (err) { fail(err); }
    });
  });
}

// ---------- выгрузка ----------
const fileSafe = s => String(s).replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'student';
function download(blob, name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
async function exportPdf(ids, btn){
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = 'Готовлю PDF…';
  try {
    const { buildPdf } = await import('./admin-pdf.js');
    const items = [];
    for (const id of ids){
      const [p, dv] = await Promise.all([call(`/students/${id}/progress`), call(`/students/${id}/devices`)]);
      const s = students.find(x => x.id === id) || p.student;
      items.push({ student: { ...p.student, teacherName: isAdmin() ? userName(s.teacherId) : me.name }, state: p.state || {}, updated: p.updated, devices: dv.devices });
    }
    const blob = await buildPdf(items, { org: org?.name || '', by: me.name });
    const name = ids.length === 1 ? `english-quest-${fileSafe(items[0].student.name)}-${new Date().toISOString().slice(0, 10)}.pdf` : `english-quest-ученики-${new Date().toISOString().slice(0, 10)}.pdf`;
    download(blob, name);
    eqAdmin.lastPdf = { name, size: blob.size, count: items.length };
    toast('PDF готов');
  } catch (e) { fail(e.message ? e : new Error('Не получилось собрать PDF')); }
  finally { btn.disabled = false; btn.textContent = old; }
}

// ---------- навигация ----------
function setTab(tab){
  document.querySelectorAll('.adm-nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
}
function renderMe(){
  document.getElementById('adm-who').textContent = `${me.name} · ${ROLE[me.role]}`;
  document.getElementById('adm-title').textContent = isAdmin() ? 'Админ-панель' : 'Кабинет репетитора';
}
async function route(){
  if (!me) return;
  const h = location.hash;
  try {
    const m = /^#student\/(s[0-9a-f]{16})$/.exec(h);
    if (m) await renderStudent(m[1]);
    else if (h === '#users') await renderUsers();
    else await renderStudents();
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404){ toast(e.message); location.hash = '#students'; }
    else fail(e);
  }
}
window.addEventListener('hashchange', route);

async function start(){
  if (!API_BASE){
    main.innerHTML = `<section class="adm-card"><h1 class="adm-h1">Сервер ещё не подключён</h1><p>Панель заработает, когда сервер English Quest будет установлен и указан в приложении (js/config.js).</p></section>`;
    return;
  }
  const hash = /^#login=([A-Za-z0-9-]{8,12})$/.exec(location.hash);
  if (hash){ history.replaceState(null, '', location.pathname); return login(hash[1]); }
  if (!getToken()) return renderLogin();
  try {
    const r = await call('/me');
    me = r.user; org = r.org;
    users = isAdmin() ? (await call('/users')).users : [{ ...me }];
    renderMe();
    document.getElementById('adm-nav').hidden = false;
    document.getElementById('adm-tab-users').hidden = !isAdmin();
    document.getElementById('adm-me').hidden = false;
    document.getElementById('adm-logout').onclick = async () => { try { await call('/logout', {}); } catch (e) {} setToken(null); renderLogin(); };
    await route();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401){ setToken(null); return renderLogin('Нужно войти заново.'); }
    main.innerHTML = `<section class="adm-card"><h1 class="adm-h1">Нет связи с сервером</h1><p>${esc(e.message)}</p><div class="controls"><button class="btn" id="adm-retry">Повторить</button></div></section>`;
    document.getElementById('adm-retry').onclick = start;
  }
}
start();
