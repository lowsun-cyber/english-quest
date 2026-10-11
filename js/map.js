// English Quest — Карта уровней и экран темы.
import { startCheckpoint } from './checkpoint.js';
import { CHARACTERS, LESSONS, QUEST_PASS_PCT, SECRET_REGIONS, isNewItem, regionOfGrade } from './eq.js';
import { lessonHeader, startExercise } from './exercises.js';
import { renderSecret } from './mines.js';
import { EX_NAMES } from './homework.js';
import { isLessonComplete } from './hud.js';
import { saveState, state } from './state.js';
import { speak } from './tts.js';
import { openModal, toast } from './ui.js';
import { escapeHtml } from './util.js';
import { BLOCK, CHECKPOINTS, CHECKPOINT_PASS, CHECKPOINT_SIZE, GRADES, PARTS, checkpointsOf, lessonQuests, lessonsOf, mistakeList, questIsNew, questKey, questLock, questPassed, questTitle, rarityOf, regionRanks, revengeItems, revengeReady, secretRegionState, skillStats } from './stats.js';

// ---------- КАРТА УРОКОВ ----------
// Каждый класс — дорожка своего региона (Зелёная долина, Город мастеров, Большая экспедиция). После каждых 4 тем — проверка (💎 / 🏆 в инвентарь).
// Тема открывается, когда пройдена предыдущая (isLessonComplete), а первая тема части —
// когда сдана проверка предыдущей части. Первая тема класса открыта всегда.
// Репетитор может открыть всё сразу (state.settings.unlockAll).
export const MAP_OFFSETS = [0, 1, 1.6, 1, 0, -1, -1.6, -1]; // зигзаг дорожки, в шагах --step
// уроки, части и проверки — общие с админ-панелью (stats.js)
export { PARTS, BLOCK, CHECKPOINT_SIZE, CHECKPOINT_PASS, lessonsOf, checkpointsOf, CHECKPOINTS, GRADES };

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
    if (checkpointPassed(node.cp)) return null;
    const left = node.cp.lessons.filter(l => !isLessonComplete(l));
    return left.length ? `Сначала пройди: ${left.map(l => `«${l.title}»`).join(', ')}` : null;
  }
  const ls = lessonsOf(node.lesson.grade), i = ls.indexOf(node.lesson);
  if (i === 0) return null;
  // начатое остаётся открытым — даже если перед темой потом добавили новую
  if (Object.keys(state.lessonProgress[node.lesson.id] || {}).length) return null;
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
  const secret = SECRET_REGIONS.find(r => r.id === state.settings.mapView);
  document.querySelectorAll('#grade-tabs .tab[data-secret]').forEach(t => {
    const r = SECRET_REGIONS.find(x => x.id === t.dataset.secret), open = r && secretRegionState(r, state).open;
    t.innerHTML = open ? `<span aria-hidden="true">${r.emoji}</span> ${escapeHtml(r.name)} <small>секретный регион</small>` : '<span aria-hidden="true">❔</span> ??? <small>тайное место</small>';
    t.classList.toggle('active', r === secret);
    t.setAttribute('aria-pressed', r === secret ? 'true' : 'false');
  });
  if (secret){ renderSecret(wrap, secret, renderMap); updateContinue(); return; }
  document.querySelectorAll('#grade-tabs .tab[data-grade]').forEach(t => {
    const on = +t.dataset.grade === grade, rg = regionOfGrade(+t.dataset.grade);
    if (rg) t.innerHTML = `<span aria-hidden="true">${rg.emoji}</span> ${rg.name} <small>${t.dataset.grade} класс</small>`;
    t.classList.toggle('active', on);
    t.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const nodes = mapNodes(grade);
  const cur = nodes.find(n => !lockReason(n) && !nodeDone(n));
  const rr = regionRanks(state).find(r => r.region.grade === grade);
  const head = rr ? `<div class="region-head" style="--region-color:${rr.region.color}">
      <b>${rr.region.emoji} ${rr.region.name}</b> <span class="t-muted">· Spotlight ${grade}</span>
      <span class="region-rank">${rr.rank ? `${rr.rank.emoji} ${rr.rank.title}` : 'Звания пока нет'}${rr.next ? ` · дальше «${rr.next.title}»: ${rr.nextNeed}` : ' · все звания региона ✓'}</span>
    </div>` : '';
  const revenge = revengeReady(state) ? `<button class="revenge-banner" data-revenge>⚔️ <b>Квест-реванш!</b> ${revengeItems(state).length} самых трудных слов и вопросов — одолей их</button>` : '';
  wrap.innerHTML = `${revenge}${head}<ol class="map" role="list">${nodes.map((n, i) => {
    const locked = lockReason(n), done = nodeDone(n), isCur = n === cur;
    // «Новое»: тема из пакета или новые квесты в теме (пакеты локаций, 14 дней)
    const fresh = n.kind === 'lesson' && ((isNewItem(n.lesson.addedAt) && !partsDone(n.lesson) && !state.lessonProgress[n.lesson.id]) || lessonQuests(n.lesson).some(q => questIsNew(n.lesson, q.kind, state)));
    const st = locked ? 'locked' : done ? 'done' : isCur ? 'current' : 'open';
    const x = MAP_OFFSETS[i % MAP_OFFSETS.length], px = MAP_OFFSETS[(i - 1 + MAP_OFFSETS.length) % MAP_OFFSETS.length];
    let emoji, title, sub, label;
    if (n.kind === 'lesson'){
      const pd = partsDone(n.lesson);
      emoji = n.lesson.words[0]?.emoji || '📘';
      title = escapeHtml(n.lesson.title);
      sub = `${pd}/${PARTS.length}`;
      label = `${fresh ? 'Новое! ' : ''}${n.lesson.title}, ${n.lesson.subtitle}. ${locked ? 'Закрыто. ' + locked : done ? 'Тема пройдена.' : `Сделано ${pd} из ${PARTS.length}.`}`;
    } else {
      const best = state.checkpoints[n.cp.id]?.best;
      emoji = n.cp.emoji;
      title = 'Босс';
      sub = best != null ? `лучший: ${best}/${CHECKPOINT_SIZE}` : `${CHECKPOINT_SIZE} вопросов`;
      label = `${n.cp.title}. ${locked ? 'Закрыто. ' + locked : done ? `Сдана, лучший результат ${best} из ${CHECKPOINT_SIZE}.` : `Нужно ${CHECKPOINT_PASS} из ${CHECKPOINT_SIZE}.`}`;
    }
    return `
      <li class="map-step" style="--x:${x}; --px:${px}">
        ${i > 0 ? '<span class="map-stones" aria-hidden="true"><i></i><i></i></span>' : ''}
        <button class="map-node ${n.kind} ${st}" data-i="${i}" aria-label="${escapeHtml(label)}">
          <span class="mn-block" aria-hidden="true">${emoji}${done ? '<span class="mn-badge">✓</span>' : ''}${locked ? '<span class="mn-lock">🔒</span>' : ''}</span>
          ${isCur ? '<span class="mn-now" aria-hidden="true">Сейчас</span>' : ''}
          ${fresh ? '<span class="new-badge mn-new" aria-hidden="true">Новое</span>' : ''}
          <span class="mn-title" aria-hidden="true">${title}</span>
          <span class="mn-sub" aria-hidden="true">${sub}</span>
        </button>
      </li>`;
  }).join('')}</ol>`;
  wrap.querySelectorAll('.map-node').forEach(b => b.onclick = () => openNode(nodes[+b.dataset.i]));
  updateContinue();
}

export function openNode(n){
  const locked = lockReason(n);
  if (locked){ toast(`🔒 ${locked}`); return; }
  if (n.kind === 'checkpoint') startCheckpoint(n.cp);
  else openLessonHub(n.lesson);
}

document.querySelectorAll('#grade-tabs .tab').forEach(t => {
  t.addEventListener('click', () => {
    if (t.dataset.secret){ state.settings.mapView = t.dataset.secret; saveState(); renderMap(); return; }
    state.settings.mapView = null;
    state.settings.mapGrade = +t.dataset.grade;
    saveState();
    renderMap();
  });
});

// ---------- «ПРОДОЛЖИТЬ»: ЧТО ДЕЛАТЬ ДАЛЬШЕ ----------
// Сначала повторение (реванш, затем «Мои ошибки», которым пора), потом незакрытое в текущей теме:
// грамматика, если её навык слабый, иначе первый открытый непройденный квест; потом следующая тема или босс.
export function nextStep(){
  if (revengeReady(state)) return { kind: 'revenge', label: '⚔️ Квест-реванш', hint: 'сначала трудные слова' };
  const due = mistakeList(state).filter(x => x.m.due <= Date.now()).length;
  if (due) return { kind: 'review', label: `🔁 Повторить ошибки (${due})`, hint: 'сначала повторение' };
  const n = currentNode(mapGrade());
  if (!n) return { kind: 'map', label: '🗺️ К карте', hint: '' };
  if (n.kind === 'checkpoint') return { kind: 'node', node: n, label: '🐉 На босса!', hint: n.cp.title };
  const l = n.lesson, open = lessonQuests(l).filter(q => !questLock(l, q.kind, state) && !questPassed(state, l, q.kind));
  const weak = new Set(skillStats(state).filter(x => x.weak).map(x => x.code));
  const q = open.find(q => q.kind === 'grammar' && l.grammar.some(g => weak.has(g.skill))) || open.find(q => !state.lessonProgress[l.id]?.[q.kind]) || open[0];
  if (!q) return { kind: 'node', node: n, label: `▶ ${l.title}`, hint: '' };
  return { kind: 'quest', lesson: l, quest: q.kind, label: `▶ ${l.title}: ${questTitle(l, q.kind).split(' ').slice(1).join(' ')}`, hint: '' };
}
export function runNextStep(){
  const s = nextStep();
  if (s.kind === 'revenge' || s.kind === 'review') document.dispatchEvent(new Event(s.kind === 'revenge' ? 'eq:revenge' : 'eq:review'));
  else if (s.kind === 'quest') startExercise(s.lesson, s.quest);
  else if (s.kind === 'node') openNode(s.node);
  else document.getElementById('lessons-sec')?.scrollIntoView({ behavior: 'smooth' });
}
export function updateContinue(){
  const b = document.getElementById('btn-hero-start');
  if (!b || !state) return;
  const s = nextStep();
  b.textContent = s.label;
  b.title = s.hint || '';
}
document.addEventListener('eq:mistakes', updateContinue);

// ---------- ЭКРАН ТЕМЫ: ДОСКА КВЕСТОВ ----------
// Каждое упражнение — квест с редкостью (рамка цвета редкости), призом и условием открытия.
export function openLessonHub(lesson){
  const guide = CHARACTERS[lesson.guide] || CHARACTERS.harlow;
  const p = state.lessonProgress[lesson.id] || {};
  const qs = lessonQuests(lesson);
  const next = qs.find(q => !p[q.kind] && !questLock(lesson, q.kind, state));
  const card = q => {
    const r = rarityOf(q.rarity), lock = questLock(lesson, q.kind, state), res = state.quests[questKey(lesson, q.kind)];
    const passed = (res?.best ?? -1) >= QUEST_PASS_PCT;
    const [em, ...rest] = questTitle(lesson, q.kind).split(' '), fresh = questIsNew(lesson, q.kind, state);
    const status = lock ? `🔒 ${lock}` : passed ? `✓ пройден · лучший ${res.best}%` : res ? `лучший ${res.best}% · нужно ${QUEST_PASS_PCT}%` : p[q.kind] ? '✓ сделано' : q === next ? 'начни здесь' : '';
    const prize = passed ? 'награда получена' : `приз: ${r.coins ? `+${r.xp} XP, +${r.coins} 🪙` : r.prize}`;
    return `<button class="hub-ex quest-card rarity-${q.rarity}${passed || p[q.kind] ? ' done' : ''}${q === next ? ' next' : ''}${lock ? ' locked' : ''}" data-ex="${q.kind}" style="--rarity:${r.color}"
        aria-label="${escapeHtml(`${rest.join(' ')}. ${fresh ? 'Новое! ' : ''}${r.title} квест. ${status || prize}`)}">
      <span class="quest-rarity">${r.title}</span>${fresh ? '<span class="new-badge">Новое</span>' : ''}
      <span class="hub-em" aria-hidden="true">${lock ? '🔒' : em}</span>
      <span class="hub-name">${rest.join(' ')}</span>
      <span class="hub-state">${escapeHtml(status)}</span>
      <span class="quest-prize">${escapeHtml(prize)}</span>
    </button>`;
  };
  openModal(`
    ${lessonHeader(lesson, guide, '', 'happy')}
    <div class="hub-progress">Сделано ${partsDone(lesson)} из ${PARTS.length}${isLessonComplete(lesson) ? ' · тема пройдена ✓' : ''} · квестов пройдено на ${QUEST_PASS_PCT}%: ${qs.filter(q => (state.quests[questKey(lesson, q.kind)]?.best ?? -1) >= QUEST_PASS_PCT).length} из ${qs.length}</div>
    <div class="hub-grid">${qs.map(card).join('')}</div>
    <p class="t-muted quest-legend">Редкие квесты открываются, когда два обычных пройдены на ${QUEST_PASS_PCT}%, эпические — после редких. Награда за редкость — один раз.</p>
  `);
  document.querySelectorAll('.hub-ex').forEach(b => b.onclick = () => {
    const why = questLock(lesson, b.dataset.ex, state);
    if (why){ toast(`🔒 ${why}`); return; }
    startExercise(lesson, b.dataset.ex);
  });
}
