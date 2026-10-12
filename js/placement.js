// English Quest — Вступительное испытание: «страж ворот» проверяет, что игрок уже знает, и открывает темы
// до стартовой (docs/concept-entry-test-and-key.md, раздел 6). Предлагается карточкой над картой, его можно
// пропустить и пройти заново. Адаптивное: с середины класса, выше или ниже по ответам; не больше 15 заданий.
// Ребёнку — «Ворота открыты!», награда и первая локация; разбор по навыкам — взрослому (placementAdultHtml).
// Вопросы и подсчёт — placementPart / placementNext / placementResult в js/stats.js.
import { CHARACTERS, LESSONS, LOCATION_ART, PLACEMENT, REGIONS, SKILLS } from './eq.js';
import { runQuiz } from './checkpoint.js';
import { heroPic } from './heroes.js';
import { renderHUD, reward } from './hud.js';
import { logSkill } from './mistakes.js';
import { saveState, state } from './state.js';
import { SKILL_PLACEMENT, lessonsOf, placementNext, placementPart, placementResult, GRADES } from './stats.js';
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
        <p>Проверим, что ты уже знаешь? Не больше ${PLACEMENT.maxTasks} коротких вопросов — и я открою тебе ворота.</p>
        <div class="placement-actions"><button type="button" class="btn" data-placement="go">Пройти испытание</button>
          <button type="button" class="btn secondary" data-placement="skip">Не сейчас — начну сначала</button></div>
      </div></div>`;
  return `<button type="button" class="placement-again" data-placement="go">🛡️ Испытание стража ворот${state.placement.grade ? ' — пройти заново' : ''}</button>`;
}

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
      <p>Я ${escapeHtml(guard().name)}, страж ворот. Сначала скажи: в каком ты классе? Вопросы будут по учебнику твоего класса. Не знаешь ответа — нажми «Не знаю», это не экзамен: ворота откроются в любом случае.</p></div>
    <div class="placement-grades">${GRADES.map(g => `<button type="button" class="btn placement-grade" data-pg="${g}" style="--region-color:${region(g)?.color || 'var(--grass)'}">
      <b>${g} класс</b><small>${escapeHtml(region(g)?.name || '')}</small></button>`).join('')}</div>`);
  document.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => runPlacement(+b.dataset.pg, rerender));
}

function runPlacement(grade, rerender){
  const answers = [], used = new Set(), queue = [];
  const addPart = () => { const p = placementNext(grade, answers); if (p == null) return; const items = placementPart(grade, p, used); items.forEach(x => x.skill && used.add(x.skill)); queue.push(...items); };
  addPart();
  const header = `<h2>🛡️ Испытание стража · ${grade} класс</h2>
    <div class="lead">Не больше ${PLACEMENT.maxTasks} вопросов. Ошибки не попадут в «Мои ошибки» — это просто проверка.</div>`;
  runQuiz({ header, lessons: lessonsOf(grade), queue, log: false, dontKnow: true, total: PLACEMENT.maxTasks,
    onAnswer(item, ok){
      answers.push({ part: item.part, ok, skill: item.skill || null });
      if (ok && item.type === 'grammar') logSkill(item.q, true);   // верный ответ — в мастерство навыка; неверный навык «трудным» не делает
      if (answers.length === queue.length) addPart();               // часть закончена — следующая по ответам
    },
    onFinish(){
      const first = !state.placement?.grade;
      const res = placementResult(grade, answers);
      state.placement = res;
      if (first) reward(PLACEMENT.reward.xp, PLACEMENT.reward.coins, { bonus: true }); else saveState();   // награда — один раз
      showResult(res, first, rerender);
    } });
}

// Ребёнку — без «сдал / не сдал»: ворота открыты, первая локация, награда
function showResult(res, first, rerender){
  const start = lessonsOf(res.grade)[res.startIdx], place = (start.island || LOCATION_ART[start.id])?.name;
  confetti();
  openModal(`
    <h2>🛡️ Ворота открыты!</h2>
    <div class="placement-letter"><span class="placement-hero">${heroPic(guard(), 'praise')}</span>
      <p>Молодец! Я открываю тебе ворота. Твой путь начинается здесь: <b>${escapeHtml(place ? `${place} — ${start.title}` : start.title)}</b>.${res.startIdx ? ' Темы до неё тоже открыты — можно заглянуть в любую.' : ''}</p></div>
    ${first ? `<p class="placement-reward">Награда стража: <b>+${PLACEMENT.reward.xp} XP, +${PLACEMENT.reward.coins} 🪙</b></p>` : ''}
    <div class="controls"><button class="btn" data-pgo="${res.grade}">В путь!</button></div>`);
  document.querySelectorAll('[data-pgo]').forEach(b => b.onclick = () => {
    state.settings.mapGrade = +b.dataset.pgo; state.settings.mapView = null;
    saveState(); closeModal(); renderHUD(); rerender();
    document.querySelector('#lessons .path-mark.current')?.scrollIntoView({ block: 'center' });
  });
}

// Взрослому (панель репетитора): части, стартовая тема и навыки «освоено / проверим в игре / учим»
export function placementAdultHtml(st){
  const p = st.placement;
  if (!p) return '<p class="t-muted">Ещё не проходил. Ребёнок увидит предложение стража ворот над картой.</p>';
  if (!p.grade) return '<p class="t-muted">Ребёнок пропустил испытание. Его можно пройти в любой момент — кнопка над картой.</p>';
  const start = LESSONS.find(l => l.id === p.start);
  const skills = Object.entries(p.skills || {}).filter(([c]) => SKILLS[c]);
  return `<p>${p.grade} класс, ${new Date(p.at).toLocaleDateString('ru-RU')}: верно <b>${p.right}</b> из ${p.total}. Старт — тема ${p.startIdx + 1} «${escapeHtml(start?.title || p.start)}»; темы до неё открыты.</p>
    <ul class="placement-parts" role="list">${p.parts.map(x => {
      const a = LESSONS.find(l => l.id === x.from), b = LESSONS.find(l => l.id === x.to);
      return `<li class="${x.passed ? 'ok' : ''}"><span aria-hidden="true">${x.passed ? '✅' : '📘'}</span> Часть ${x.part + 1}: ${escapeHtml(a?.title || '')}${a !== b ? ` — ${escapeHtml(b?.title || '')}` : ''} <small>${x.right} из ${x.total}${x.passed ? ', сдана' : ', учим'}</small></li>`;
    }).join('')}</ul>
    ${skills.length ? `<ul class="t-hard" role="list">${skills.map(([c, v]) => `<li><span class="t-hard-main">${v === 'mastered' ? '✅' : v === 'check' ? '🔍' : '📘'} ${escapeHtml(SKILLS[c].title)} <span class="t-muted">${c}</span></span><span class="t-muted">${SKILL_PLACEMENT[v]}</span></li>`).join('')}</ul>` : ''}
    <p class="t-muted">«Освоено» — оба задания на навык верно; «проверим в игре» — одно из двух; «учим» — ни одного. Части, которые испытание не проверяло, ниже стартовой считаются знакомыми.</p>`;
}
