// English Quest — Режим репетитора: замок, статистика, график, отчёт.
import { GOAL_OPTIONS, checkGoal, renderGoal } from './activity.js';
import { backupSectionHtml, endView, resetSectionHtml, summaryText, wireBackupSection, wireResetSection } from './backup.js';
import { LESSONS } from './eq.js';
import { EX_NAMES, EX_ORDER, assignHomework, dueLabel, homeworkLink, homeworkTaskDone, renderHomework } from './homework.js';
import { renderHUD } from './hud.js';
import { CHECKPOINTS, CHECKPOINT_SIZE, PARTS, renderMap } from './map.js';
import { offlineSectionHtml, wireOfflineSection } from './offline.js';
import { activeProfile, realState, saveState, state } from './state.js';
import { closeModal, openModal, toast } from './ui.js';
import { wireWorksheet, worksheetSectionHtml } from './worksheet.js';
import { lockSectionHtml, openGate, pinResetNote, wireLockSection } from './lock.js';
import { multi, profilesSectionHtml, wireProfilesSection } from './profiles.js';
import { cloudOn, cloudPanelHtml, wireCloudPanel } from './cloud.js';
import { lastDaysOf, reportText, studentStats } from './stats.js';
import { DAY, WEEKDAYS, copyText, dayKey, escapeHtml, fmtDay, plural } from './util.js';

// ---------- РЕЖИМ РЕПЕТИТОРА ----------

export function openTutorGate(){
  openGate(openTutorPanel);
}

export function lastDays(n){ return lastDaysOf(state, n); }

export function tutorStats(){ return studentStats(state); }


export function minutesChart(days, goal){
  const mins = days.map(d => d.sec / 60);
  const label = m => m > 0 && m < 1 ? '<1' : String(Math.round(m));
  const max = Math.max(...mins, goal || 0, 1);
  const peak = mins.indexOf(Math.max(...mins));
  const empty = mins.every(m => m === 0);
  return `
    <figure class="t-chart">
      <figcaption>Минуты занятий по дням</figcaption>
      ${empty ? '<p class="t-muted bars-empty">За неделю занятий пока не было.</p>' : ''}
      <div class="bars" aria-hidden="true">
        ${goal ? `<span class="goal-line" style="bottom:${Math.round(goal * 100 / max)}%"><i>цель ${goal} мин</i></span>` : ''}
        ${days.map((d, i) => `
          <div class="bar-col" title="${WEEKDAYS[new Date(d.t).getDay()]} ${fmtDay(d.key)}: ${label(mins[i])} мин">
            <span class="bar-val">${i === peak && mins[i] ? label(mins[i]) : ''}</span>
            <span class="bar" style="height:${mins[i] ? Math.max(4, Math.round(mins[i] * 100 / max)) : 0}%"></span>
          </div>`).join('')}
      </div>
      <div class="bar-days" aria-hidden="true">${days.map(d => `<span>${WEEKDAYS[new Date(d.t).getDay()]}${d.goalMet ? '<b class="day-met">✓</b>' : d.frozen ? '<b class="day-met" title="день закрыт заморозкой">🧊</b>' : ''}</span>`).join('')}</div>
      <table class="sr-only">
        <caption>Минуты занятий по дням</caption>
        <tr><th>День</th><th>Минуты</th><th>Цель выполнена</th><th>Верных ответов</th><th>Ошибок</th></tr>
        ${days.map((d, i) => `<tr><td>${fmtDay(d.key)}</td><td>${label(mins[i])}</td><td>${d.goalMet ? 'да' : d.frozen ? 'заморозка' : 'нет'}</td><td>${d.ok}</td><td>${d.bad}</td></tr>`).join('')}
      </table>
    </figure>`;
}

export function tutorReport(s){
  const who = realState ? (state._viewMeta?.profile?.name || '') : (multi() || activeProfile().name !== 'Ученик' ? activeProfile().name : '');
  return reportText(state, who, s, pinResetNote() ? [pinResetNote()] : []);
}


export function openTutorPanel(){
  const s = tutorStats();
  const hw = state.homework, hwLesson = hw && LESSONS.find(l => l.id === hw.lessonId);
  const defaultDue = dayKey(Date.now() + 2 * DAY);
  const grades = [...new Set(LESSONS.map(l => l.grade))];
  const worst = s.lessons.filter(x => x.wrong > 0).sort((a,b) => b.wrong - a.wrong).slice(0, 3).map(x => x.l.id);

  openModal(`
    <h2>Режим репетитора</h2>
    <a class="t-guide-link" href="how-to.html#parents" target="_blank" rel="noopener">📖 Гайд для родителей и репетиторов</a>
    ${realState ? `
      <div class="t-view-banner" role="status">
        ${state._viewMeta.source === 'server'
          ? `<b>👀 ${escapeHtml(state._viewMeta.profile.avatar)} ${escapeHtml(state._viewMeta.profile.name)} — прогресс с сервера.</b> ${state._viewMeta.exportedAt ? `Обновлён ${new Date(state._viewMeta.exportedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.` : 'Ученик ещё не занимался.'}`
          : `<b>👀 Просмотр копии.</b> ${escapeHtml(summaryText(state._viewMeta.summary, state._viewMeta.exportedAt))}`}
        Здесь ничего не сохраняется, прогресс на этом устройстве не меняется.
        <button class="btn secondary" id="t-view-close">Вернуться к своему прогрессу</button>
      </div>` : `<div class="lead">${multi() ? `Прогресс ученика: <b>${activeProfile().avatar} ${escapeHtml(activeProfile().name)}</b>. Переключить — в разделе «Ученики» ниже.` : 'Прогресс ученика на этом устройстве.'}</div>`}

    <div class="t-tiles">
      <div class="t-tile"><span class="t-num">${s.min}</span><span class="t-lbl">минут за 7 дней</span></div>
      <div class="t-tile"><span class="t-num">${s.active}<small>/7</small></span><span class="t-lbl">дней с занятиями</span></div>
      <div class="t-tile"><span class="t-num">${s.total}</span><span class="t-lbl">ответов за 7 дней</span></div>
      <div class="t-tile"><span class="t-num">${s.pct === null ? '—' : s.pct + '%'}</span><span class="t-lbl">верных ответов</span></div>
      <div class="t-tile"><span class="t-num">🔥 ${s.streak}</span><span class="t-lbl">${plural(s.streak, 'день', 'дня', 'дней')} подряд · рекорд ${s.best} · 🧊 ${s.freezes}</span></div>
      <div class="t-tile"><span class="t-num">${s.metDays}<small>/7</small></span><span class="t-lbl">дней с выполненной целью</span></div>
    </div>
    ${realState ? `<p class="t-muted t-goal">Цель дня: ${s.goal} мин</p>` : `
      <label class="t-goal">🎯 Цель дня:
        <select id="t-goal">${GOAL_OPTIONS.map(m => `<option value="${m}" ${m === s.goal ? 'selected' : ''}>${m} минут</option>`).join('')}</select>
      </label>`}
    ${minutesChart(s.days, s.goal)}

    <h3 class="t-h">Домашнее задание</h3>
    ${hwLesson ? `
      <div class="t-hw-current">
        <div><b>${escapeHtml(hwLesson.title)}</b> · ${hw.tasks.map(ex => `${homeworkTaskDone(hw, ex) ? '✓' : '○'} ${EX_NAMES[ex]}`).join(' · ')}
        <div class="t-muted">${hw.doneAt ? 'Выполнено ✓' : (dueLabel(hw.due) || 'без срока')}</div></div>
        ${realState ? '' : `<button class="icon-btn" id="t-hw-cancel">${hw.doneAt ? 'Убрать' : 'Отменить'}</button>`}
      </div>` : '<p class="t-muted">Сейчас задания нет.</p>'}
    <form class="t-hw-form" id="t-hw-form">
      <label>Тема
        <select id="t-hw-lesson">
          ${grades.map(g => `<optgroup label="${g} класс">${LESSONS.filter(l => l.grade === g).map(l => `<option value="${l.id}">${escapeHtml(l.title)} — ${escapeHtml(l.subtitle)}</option>`).join('')}</optgroup>`).join('')}
        </select>
      </label>
      <fieldset>
        <legend>Упражнения</legend>
        <div class="t-checks">
          ${EX_ORDER.map(ex => `<label class="t-check"><input type="checkbox" value="${ex}" ${['vocab','listen','match'].includes(ex) ? 'checked' : ''}/> ${EX_NAMES[ex]}</label>`).join('')}
        </div>
      </fieldset>
      <div class="t-row">
        <label>Срок <input type="date" id="t-hw-due" value="${defaultDue}" min="${dayKey()}"/></label>
        <label class="t-grow">Комментарий для ученика <input type="text" id="t-hw-note" maxlength="300" placeholder="Например: повтори слова про семью"/></label>
      </div>
      <div class="controls">
        <button class="btn" type="button" id="t-hw-link">🔗 Скопировать ссылку</button>
        ${realState ? '' : '<button class="btn secondary" type="button" id="t-hw-here">📌 Назначить на этом устройстве</button>'}
      </div>
      <input class="t-link" id="t-hw-out" readonly hidden aria-label="Ссылка на задание"/>
      <p class="t-muted t-hint" id="t-hw-hint"></p>
    </form>

    <h3 class="t-h">Темы</h3>
    <div class="t-table-wrap">
      <table class="t-table">
        <thead><tr><th>Тема</th><th>Класс</th><th>Пройдено</th><th>Ошибок</th></tr></thead>
        <tbody>
          ${s.lessons.map(x => `
            <tr class="${worst.includes(x.l.id) ? 'hot' : ''}${x.parts ? '' : ' idle'}">
              <td>${x.l.words[0]?.emoji || ''} ${escapeHtml(x.l.title)}</td>
              <td>${x.l.grade}</td>
              <td><span class="pips" aria-label="${x.parts} из ${PARTS.length}">${PARTS.map((_, i) => `<span class="pip${i < x.parts ? ' on' : ''}"></span>`).join('')}</span> ${x.parts}/${PARTS.length}</td>
              <td>${x.wrong ? (worst.includes(x.l.id) ? `<b>${x.wrong}</b> ⚠️` : x.wrong) : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>

    ${realState ? '' : `<label class="t-check t-unlock"><input type="checkbox" id="t-unlock" ${state.settings.unlockAll ? 'checked' : ''}/> Открыть все темы на карте (без прохождения по порядку)</label>`}

    <h3 class="t-h">Проверки</h3>
    <ul class="t-cps" role="list">
      ${CHECKPOINTS.map(cp => {
        const r = state.checkpoints[cp.id];
        return `<li>${cp.emoji} ${escapeHtml(cp.title)} — ${r?.passedAt ? `<b>сдана</b> (лучший ${r.best}/${CHECKPOINT_SIZE})` : r ? `не сдана (лучший ${r.best}/${CHECKPOINT_SIZE})` : '<span class="t-muted">не начата</span>'}</li>`;
      }).join('')}
    </ul>

    <h3 class="t-h">Трудные слова и вопросы</h3>
    ${s.hard.length ? `
      <ul class="t-hard" role="list">
        ${s.hard.slice(0, 12).map(({ m, data }) => `
          <li><span class="t-hard-main">${m.type === 'word' ? `${data.word.emoji} <b>${escapeHtml(data.word.en)}</b> — ${escapeHtml(data.word.ru)}` : `${m.type === 'grammar' ? '🧩' : '📖'} ${escapeHtml(data.q.q)}`}</span>
          <span class="t-muted">ошибок: ${m.wrong}</span></li>`).join('')}
      </ul>` : '<p class="t-muted">Пока нет — ошибок не было или все уже выучены.</p>'}
    ${state.mastered ? `<p class="t-muted">Выучено после ошибок: <b>${state.mastered}</b></p>` : ''}

    <h3 class="t-h">Лист для печати</h3>
    ${worksheetSectionHtml()}

    ${realState ? '' : `
    ${cloudOn() ? `<h3 class="t-h">Сервер учителя</h3>
    ${cloudPanelHtml()}` : ''}

    <h3 class="t-h">Перенос и резервная копия</h3>
    ${backupSectionHtml()}

    <h3 class="t-h">Без интернета</h3>
    ${offlineSectionHtml()}

    <h3 class="t-h">Ученики на этом устройстве</h3>
    ${profilesSectionHtml()}

    <h3 class="t-h">Замок панели</h3>
    ${lockSectionHtml()}

    <h3 class="t-h">Сброс прогресса</h3>
    ${resetSectionHtml()}`}

    <h3 class="t-h">Отчёт</h3>
    <p class="t-muted">Короткий текст для мессенджера — например, чтобы родитель отправил его репетитору.</p>
    <div class="controls"><button class="btn gold" id="t-report">📋 Скопировать отчёт</button></div>
    <textarea class="t-report" id="t-report-out" readonly hidden rows="8" aria-label="Текст отчёта"></textarea>
  `, { wide: true });

  const readSpec = () => ({
    lessonId: document.getElementById('t-hw-lesson').value,
    tasks: [...document.querySelectorAll('.t-checks input:checked')].map(i => i.value),
    due: document.getElementById('t-hw-due').value,
    note: document.getElementById('t-hw-note').value.trim(),
  });
  const hint = document.getElementById('t-hw-hint');
  document.getElementById('t-hw-link').onclick = async () => {
    const spec = readSpec();
    if (!spec.tasks.length){ hint.textContent = 'Выберите хотя бы одно упражнение.'; return; }
    const out = document.getElementById('t-hw-out');
    out.value = homeworkLink(spec);
    out.hidden = false;
    const ok = await copyText(out.value, out);
    hint.textContent = (ok ? 'Ссылка скопирована — отправьте её ученику. ' : 'Скопируйте ссылку из поля выше. ')
      + (location.protocol === 'file:' ? 'Сейчас приложение открыто как файл, поэтому ссылка сработает только на этом компьютере. Чтобы она открывалась у ученика, сайт нужно выложить в интернет.' : '');
  };
  const here = document.getElementById('t-hw-here');
  if (here) here.onclick = () => {
    const spec = readSpec();
    if (!spec.tasks.length){ hint.textContent = 'Выберите хотя бы одно упражнение.'; return; }
    const res = assignHomework(spec);
    toast(res === 'same' ? 'Это задание уже назначено' : '📌 Задание назначено');
    openTutorPanel();
  };
  const viewClose = document.getElementById('t-view-close');
  if (viewClose) viewClose.onclick = () => { endView(); openTutorPanel(); };
  wireWorksheet();
  if (!realState){
    wireOfflineSection(); wireBackupSection(); wireResetSection();
    if (cloudOn()) wireCloudPanel();
    wireLockSection(openTutorPanel, closeModal);
    wireProfilesSection(openTutorPanel);
  }
  const goalSel = document.getElementById('t-goal');
  if (goalSel) goalSel.onchange = () => {
    state.settings.dailyGoal = +goalSel.value;
    saveState();
    checkGoal();
    renderGoal(true);
    renderHUD();
    openTutorPanel();
    toast(`🎯 Цель дня: ${goalSel.value} минут`);
  };
  const unlock = document.getElementById('t-unlock');
  if (unlock) unlock.onchange = (e) => {
    state.settings.unlockAll = e.target.checked;
    saveState();
    renderMap();
    toast(e.target.checked ? '🔓 Все темы открыты' : '🔒 Темы снова открываются по порядку');
  };
  const cancel = document.getElementById('t-hw-cancel');
  if (cancel) cancel.onclick = () => { state.homework = null; saveState(); renderHomework(); openTutorPanel(); };
  document.getElementById('t-report').onclick = async () => {
    const out = document.getElementById('t-report-out');
    out.value = tutorReport(s);
    out.hidden = false;
    toast(await copyText(out.value, out) ? '📋 Отчёт скопирован' : 'Скопируйте текст из поля');
  };
}
document.getElementById('btn-tutor').onclick = openTutorGate;
