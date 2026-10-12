// English Quest — Вступительное испытание: «страж ворот» проверяет, что игрок уже знает, и открывает темы
// до стартовой (концепция, «Адаптивная логика»). Предлагается карточкой над картой, его можно пропустить
// и пройти заново. Вопросы и подсчёт — placementPlan / placementResult в js/stats.js.
import { CHARACTERS, LESSONS, PLACEMENT, REGIONS, SKILLS } from './eq.js';
import { runQuiz } from './checkpoint.js';
import { heroPic } from './heroes.js';
import { renderHUD } from './hud.js';
import { logSkill } from './mistakes.js';
import { saveState, state } from './state.js';
import { GRADES, lessonsOf, placementPlan, placementResult } from './stats.js';
import { closeModal, confetti, openModal } from './ui.js';
import { escapeHtml } from './util.js';

const guard = () => CHARACTERS[PLACEMENT.guard] || CHARACTERS.harlow;
const region = g => REGIONS.find(r => r.grade === g);

// Над картой: предложение (пока испытания не было) или маленькая кнопка «пройти заново»
export function placementBanner(){
  if (!state) return '';
  if (!state.placement) return `<div class="placement-card">
      <span class="placement-hero">${heroPic(guard(), 'happy')}</span>
      <div class="placement-text"><b>🛡️ Страж ворот</b>
        <p>Проверим, что ты уже знаешь? ${placementSize()} коротких вопросов — и я открою тебе дорогу дальше по карте.</p>
        <div class="placement-actions"><button type="button" class="btn" data-placement="go">Пройти испытание</button>
          <button type="button" class="btn secondary" data-placement="skip">Не сейчас — начну сначала</button></div>
      </div></div>`;
  return `<button type="button" class="placement-again" data-placement="go">🛡️ Испытание стража ворот${state.placement.grade ? ' — пройти заново' : ''}</button>`;
}
const placementSize = () => { const n = GRADES.map(g => placementPlan(g).length), a = Math.min(...n), b = Math.max(...n); return a === b ? String(a) : `${a}–${b}`; };

export function onPlacementClick(btn, rerender){
  if (btn.dataset.placement === 'skip'){
    state.placement = { skipped: Date.now() };
    saveState(); rerender();
    return;
  }
  chooseGrade(rerender);
}

function chooseGrade(rerender){
  openModal(`
    <h2>🛡️ Испытание стража ворот</h2>
    <div class="placement-letter"><span class="placement-hero">${heroPic(guard(), 'happy')}</span>
      <p>Я ${escapeHtml(guard().name)}, страж ворот. Сначала скажи: в каком ты классе? Вопросы будут по учебнику твоего класса — от простых к сложным. Не знаешь ответа — выбирай наугад, это не экзамен.</p></div>
    <div class="placement-grades">${GRADES.map(g => `<button type="button" class="btn placement-grade" data-pg="${g}" style="--region-color:${region(g)?.color || 'var(--grass)'}">
      <b>${g} класс</b><small>${escapeHtml(region(g)?.name || '')}</small></button>`).join('')}</div>`);
  document.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => runPlacement(+b.dataset.pg, rerender));
}

function runPlacement(grade, rerender){
  const queue = placementPlan(grade), answers = [];
  const header = `<h2>🛡️ Испытание стража · ${grade} класс</h2>
    <div class="lead">${queue.length} вопросов. Ошибки не попадут в «Мои ошибки» — это просто проверка.</div>`;
  runQuiz({ header, lessons: lessonsOf(grade), queue, log: false,
    onAnswer(item, ok){
      answers.push({ part: item.part, ok, skill: item.type === 'grammar' ? item.q.skill : null });
      if (ok && item.type === 'grammar') logSkill(item.q, true);   // верный ответ — в мастерство навыка; неверный навык «трудным» не делает
    },
    onFinish(){
      const res = placementResult(grade, answers);
      state.placement = res;
      saveState();
      showResult(res, rerender);
    } });
}

function showResult(res, rerender){
  const ls = lessonsOf(res.grade), start = ls[res.startIdx];
  const known = Object.entries(res.skills).filter(([, v]) => v).map(([k]) => SKILLS[k]?.title).filter(Boolean);
  const prev = res.prev && region(res.prev);
  if (res.passed) confetti();
  openModal(`
    <h2>🛡️ Итог испытания</h2>
    <div class="placement-letter"><span class="placement-hero">${heroPic(guard(), res.passed ? 'praise' : 'happy')}</span>
      <p>${prev ? `Хорошее начало! Давай начнём с региона «${escapeHtml(prev.name)}» — там всё, что пригодится для ${res.grade} класса.`
        : res.passed ? `Отлично! Открываю дорогу: начинай с темы «${escapeHtml(start.title)}». Темы до неё тоже открыты — можно вернуться в любую.`
        : `Начнём с самого начала — с темы «${escapeHtml(start.title)}». Вперёд!`}</p></div>
    <p>Верно: <b>${res.right}</b> из ${res.total}.</p>
    <ul class="placement-parts" role="list">${res.parts.map((p, i) => {
      const a = LESSONS.find(l => l.id === p.from), b = LESSONS.find(l => l.id === p.to), ok = i < res.passed;
      return `<li class="${ok ? 'ok' : ''}"><span aria-hidden="true">${ok ? '✅' : '🔒'}</span> Часть ${i + 1}: ${escapeHtml(a.title)}${a !== b ? ` — ${escapeHtml(b.title)}` : ''} <small>${p.right} из ${p.total}</small><span class="sr-only">${ok ? ', открыта' : ''}</span></li>`;
    }).join('')}</ul>
    ${known.length ? `<p class="t-muted">Ты уже знаешь: ${known.map(escapeHtml).join(', ')}.</p>` : ''}
    <div class="controls">
      ${prev ? `<button class="btn" data-pgo="${res.prev}">В регион «${escapeHtml(prev.name)}»</button><button class="btn secondary" data-pgo="${res.grade}">Остаться в ${res.grade} классе</button>`
        : `<button class="btn" data-pgo="${res.grade}">В путь!</button>`}
    </div>`);
  document.querySelectorAll('[data-pgo]').forEach(b => b.onclick = () => {
    state.settings.mapGrade = +b.dataset.pgo; state.settings.mapView = null;
    saveState(); closeModal(); renderHUD(); rerender();
    document.querySelector('#lessons .path-mark.current')?.scrollIntoView({ block: 'center' });
  });
}
