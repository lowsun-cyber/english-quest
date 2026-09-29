// English Quest — Домашние задания: ссылка #hw&…, назначение, карточка у ученика.
import { LESSONS } from './eq.js';
import { startExercise } from './exercises.js';
import { reward } from './hud.js';
import { saveState, state } from './state.js';
import { speak } from './tts.js';
import { confetti, toast } from './ui.js';
import { daysLabel, escapeHtml, fmtDay, parseDay, startOfDay } from './util.js';
import { EX_NAMES, EX_ORDER, homeworkDone, makeHomeworkFor } from './stats.js';

// ---------- ДОМАШНЕЕ ЗАДАНИЕ ----------
export { EX_NAMES, EX_ORDER };   // общие с админ-панелью (stats.js)

export function dueLabel(s){
  if (!s) return '';
  if (parseDay(s) < startOfDay(Date.now())) return `срок был ${fmtDay(s)}`;
  return `сдать ${daysLabel(parseDay(s))} (${fmtDay(s)})`;
}

export function makeHomework(spec){ return makeHomeworkFor(state, spec); }
export function homeworkTaskDone(hw, ex){ return homeworkDone(state, hw, ex); }

export function assignHomework(spec){
  const lesson = LESSONS.find(l => l.id === spec.lessonId);
  const tasks = (spec.tasks || []).filter(ex => EX_NAMES[ex]);
  if (!lesson || !tasks.length) return false;
  const hw = makeHomework({ ...spec, tasks });
  if (state.homework && state.homework.id === hw.id) return 'same';
  state.homework = hw;
  saveState();
  renderHomework();
  return true;
}

export function homeworkLink(spec){
  const p = new URLSearchParams({ lesson: spec.lessonId, tasks: spec.tasks.join(',') });
  if (spec.due) p.set('due', spec.due);
  if (spec.note) p.set('note', spec.note);
  return location.href.split('#')[0] + '#hw&' + p.toString();
}

// Ссылка вида index.html#hw&lesson=g2-hello&tasks=vocab,listen&due=2026-10-01&note=...
export function applyHomeworkFromHash(){
  if (!location.hash.startsWith('#hw')) return;
  const p = new URLSearchParams(location.hash.slice(1).replace(/^hw&?/, ''));
  const due = p.get('due');
  const res = assignHomework({
    lessonId: p.get('lesson'),
    tasks: (p.get('tasks') || '').split(','),
    due: /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? due : '',
    note: (p.get('note') || '').slice(0, 300),
  });
  history.replaceState(null, '', location.pathname + location.search);
  if (res === true){
    toast('📬 Новое домашнее задание!');
    setTimeout(() => document.getElementById('homework-sec')?.scrollIntoView({ behavior: 'smooth' }), 400);
  } else if (res === 'same') toast('Это задание уже получено');
  else toast('Ссылка на задание не распознана');
}

export function checkHomework(){
  const hw = state.homework;
  if (!hw || hw.doneAt) { renderHomework(); return; }
  if (hw.tasks.every(ex => homeworkTaskDone(hw, ex))){
    hw.doneAt = Date.now();
    confetti();
    toast('🎉 Домашнее задание выполнено! +30 XP');
    reward(30, 10, { bonus: true });
  }
  renderHomework();
}

export function renderHomework(){
  const sec = document.getElementById('homework-sec');
  const wrap = document.getElementById('homework');
  if (!sec || !wrap) return;
  const hw = state.homework;
  const lesson = hw && LESSONS.find(l => l.id === hw.lessonId);
  if (!hw || !lesson){ sec.hidden = true; return; }
  sec.hidden = false;
  const doneN = hw.tasks.filter(ex => homeworkTaskDone(hw, ex)).length;
  document.getElementById('hw-due').textContent = hw.doneAt ? 'Выполнено ✓' : (dueLabel(hw.due) || `Сделано ${doneN} из ${hw.tasks.length}`);
  wrap.innerHTML = `
    <div class="hw-card${hw.doneAt ? ' done' : ''}">
      <div class="hw-head">
        <span class="hw-icon" aria-hidden="true">${lesson.words[0]?.emoji || '📘'}</span>
        <div>
          <div class="hw-title">${escapeHtml(lesson.title)}</div>
          <div class="hw-sub">${escapeHtml(lesson.subtitle)} · ${lesson.grade} класс · сделано ${doneN} из ${hw.tasks.length}</div>
        </div>
      </div>
      ${hw.note ? `<p class="hw-note"><span aria-hidden="true">💬</span> ${escapeHtml(hw.note)}</p>` : ''}
      <div class="hw-tasks">
        ${hw.tasks.map(ex => {
          const d = homeworkTaskDone(hw, ex);
          return `<button class="hw-task${d ? ' done' : ''}" data-ex="${ex}">${d ? '✓ ' : ''}${EX_NAMES[ex]}</button>`;
        }).join('')}
      </div>
      ${hw.doneAt ? `<div class="hw-finish"><strong>🎉 Задание выполнено!</strong><button class="icon-btn" id="hw-clear">Убрать задание</button></div>` : ''}
    </div>`;
  wrap.querySelectorAll('.hw-task').forEach(b => b.onclick = () => startExercise(lesson, b.dataset.ex));
  const clr = document.getElementById('hw-clear');
  if (clr) clr.onclick = () => { state.homework = null; saveState(); renderHomework(); };
}
