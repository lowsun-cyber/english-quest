// English Quest — Карта уровней и экран темы.
import { startCheckpoint } from './checkpoint.js';
import { CHARACTERS, LESSONS } from './eq.js';
import { lessonHeader, startExercise } from './exercises.js';
import { EX_NAMES } from './homework.js';
import { isLessonComplete } from './hud.js';
import { saveState, state } from './state.js';
import { speak } from './tts.js';
import { openModal, toast } from './ui.js';
import { escapeHtml } from './util.js';

// ---------- КАРТА УРОКОВ ----------
// Каждый класс — дорожка из 8 тем. После каждых 4 тем — проверка (💎 / 🏆 в инвентарь).
// Тема открывается, когда пройдена предыдущая (isLessonComplete), а первая тема части —
// когда сдана проверка предыдущей части. Первая тема класса открыта всегда.
// Репетитор может открыть всё сразу (state.settings.unlockAll).
export const PARTS = ['vocab', 'listen', 'match', 'spell', 'grammar', 'reading', 'speak'];
export const BLOCK = 4;
export const CHECKPOINT_SIZE = 10;
export const CHECKPOINT_PASS = 7;
export const MAP_OFFSETS = [0, 1, 1.6, 1, 0, -1, -1.6, -1]; // зигзаг дорожки, в шагах --step

export function lessonsOf(grade){ return LESSONS.filter(l => l.grade === grade).sort((a, b) => a.order - b.order); }
export function checkpointsOf(grade){
  const ls = lessonsOf(grade), out = [];
  for (let i = 0; i < ls.length; i += BLOCK){
    const part = i / BLOCK + 1;
    out.push({ id: `g${grade}-p${part}`, grade, part, lessons: ls.slice(i, i + BLOCK),
      emoji: part === 1 ? '💎' : '🏆', title: `Проверка: ${grade} класс, часть ${part}` });
  }
  return out;
}
export const CHECKPOINTS = [...new Set(LESSONS.map(l => l.grade))].flatMap(checkpointsOf);
export const GRADES = [...new Set(LESSONS.map(l => l.grade))].sort();

export function checkpointPassed(cp){ return !!state.checkpoints[cp.id]?.passedAt; }
export function partsDone(l){ const p = state.lessonProgress[l.id] || {}; return PARTS.filter(ex => p[ex]).length; }

export function mapNodes(grade){
  const cps = checkpointsOf(grade), nodes = [];
  lessonsOf(grade).forEach((l, i) => {
    nodes.push({ kind: 'lesson', lesson: l });
    if ((i + 1) % BLOCK === 0) nodes.push({ kind: 'checkpoint', cp: cps[(i + 1) / BLOCK - 1] });
  });
  return nodes;
}

// Почему узел закрыт; null — открыт.
export function lockReason(node){
  if (state.settings.unlockAll) return null;
  if (node.kind === 'checkpoint'){
    const left = node.cp.lessons.filter(l => !isLessonComplete(l));
    return left.length ? `Сначала пройди: ${left.map(l => `«${l.title}»`).join(', ')}` : null;
  }
  const ls = lessonsOf(node.lesson.grade), i = ls.indexOf(node.lesson);
  if (i === 0) return null;
  if (i % BLOCK === 0){
    const cp = checkpointsOf(node.lesson.grade)[i / BLOCK - 1];
    return checkpointPassed(cp) ? null : `Сначала сдай «${cp.title}»`;
  }
  return isLessonComplete(ls[i - 1]) ? null : `Сначала пройди тему «${ls[i - 1].title}»`;
}
export function nodeDone(n){ return n.kind === 'lesson' ? isLessonComplete(n.lesson) : checkpointPassed(n.cp); }
export function currentNode(grade){ return mapNodes(grade).find(n => !lockReason(n) && !nodeDone(n)) || null; }

export function mapGrade(){
  if (state.settings.mapGrade) return state.settings.mapGrade;
  const hl = state.homework && LESSONS.find(l => l.id === state.homework.lessonId);
  return hl ? hl.grade : GRADES[0];
}

export function renderMap(){
  const wrap = document.getElementById('lessons');
  if (!wrap) return;
  const grade = mapGrade();
  document.querySelectorAll('#grade-tabs .tab').forEach(t => {
    const on = +t.dataset.grade === grade;
    t.classList.toggle('active', on);
    t.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const nodes = mapNodes(grade);
  const cur = nodes.find(n => !lockReason(n) && !nodeDone(n));
  wrap.innerHTML = `<ol class="map" role="list">${nodes.map((n, i) => {
    const locked = lockReason(n), done = nodeDone(n), isCur = n === cur;
    const st = locked ? 'locked' : done ? 'done' : isCur ? 'current' : 'open';
    const x = MAP_OFFSETS[i % MAP_OFFSETS.length], px = MAP_OFFSETS[(i - 1 + MAP_OFFSETS.length) % MAP_OFFSETS.length];
    let emoji, title, sub, label;
    if (n.kind === 'lesson'){
      const pd = partsDone(n.lesson);
      emoji = n.lesson.words[0]?.emoji || '📘';
      title = escapeHtml(n.lesson.title);
      sub = `${pd}/${PARTS.length}`;
      label = `${n.lesson.title}, ${n.lesson.subtitle}. ${locked ? 'Закрыто. ' + locked : done ? 'Тема пройдена.' : `Сделано ${pd} из ${PARTS.length}.`}`;
    } else {
      const best = state.checkpoints[n.cp.id]?.best;
      emoji = n.cp.emoji;
      title = 'Проверка';
      sub = best != null ? `лучший: ${best}/${CHECKPOINT_SIZE}` : `${CHECKPOINT_SIZE} вопросов`;
      label = `${n.cp.title}. ${locked ? 'Закрыто. ' + locked : done ? `Сдана, лучший результат ${best} из ${CHECKPOINT_SIZE}.` : `Нужно ${CHECKPOINT_PASS} из ${CHECKPOINT_SIZE}.`}`;
    }
    return `
      <li class="map-step" style="--x:${x}; --px:${px}">
        ${i > 0 ? '<span class="map-stones" aria-hidden="true"><i></i><i></i></span>' : ''}
        <button class="map-node ${n.kind} ${st}" data-i="${i}" aria-label="${escapeHtml(label)}">
          <span class="mn-block" aria-hidden="true">${emoji}${done ? '<span class="mn-badge">✓</span>' : ''}${locked ? '<span class="mn-lock">🔒</span>' : ''}</span>
          ${isCur ? '<span class="mn-now" aria-hidden="true">Сейчас</span>' : ''}
          <span class="mn-title" aria-hidden="true">${title}</span>
          <span class="mn-sub" aria-hidden="true">${sub}</span>
        </button>
      </li>`;
  }).join('')}</ol>`;
  wrap.querySelectorAll('.map-node').forEach(b => b.onclick = () => openNode(nodes[+b.dataset.i]));
}

export function openNode(n){
  const locked = lockReason(n);
  if (locked){ toast(`🔒 ${locked}`); return; }
  if (n.kind === 'checkpoint') startCheckpoint(n.cp);
  else openLessonHub(n.lesson);
}

document.querySelectorAll('#grade-tabs .tab').forEach(t => {
  t.addEventListener('click', () => {
    state.settings.mapGrade = +t.dataset.grade;
    saveState();
    renderMap();
  });
});

// ---------- ЭКРАН ТЕМЫ ----------
export const HUB_EXS = ['cards', ...PARTS];
export function openLessonHub(lesson){
  const guide = CHARACTERS[lesson.guide] || CHARACTERS.harlow;
  const p = state.lessonProgress[lesson.id] || {};
  const next = HUB_EXS.find(ex => !p[ex]);
  openModal(`
    ${lessonHeader(lesson, guide)}
    <div class="hub-progress">Сделано ${partsDone(lesson)} из ${PARTS.length}${isLessonComplete(lesson) ? ' · тема пройдена ✓' : ''}</div>
    <div class="hub-grid">
      ${HUB_EXS.map(ex => {
        const [em, ...rest] = EX_NAMES[ex].split(' ');
        return `<button class="hub-ex${p[ex] ? ' done' : ''}${ex === next ? ' next' : ''}" data-ex="${ex}">
          <span class="hub-em" aria-hidden="true">${em}</span>
          <span class="hub-name">${rest.join(' ')}</span>
          <span class="hub-state">${p[ex] ? '✓ сделано' : ex === next ? 'начни здесь' : ''}</span>
        </button>`;
      }).join('')}
    </div>
  `);
  document.querySelectorAll('.hub-ex').forEach(b => b.onclick = () => startExercise(lesson, b.dataset.ex));
}
