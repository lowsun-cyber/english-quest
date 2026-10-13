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
    <p class="t-muted">«Освоено» — оба задания на навык верно; «проверим в игре» — одно из двух; «учим» — ни одного. Части, которые испытание не проверяло, ниже стартовой считаются знакомыми.</p>
    <div class="controls"><button type="button" class="btn secondary" id="t-pl-png">🖼️ Сохранить итог картинкой</button></div>`;
}

// ---------- итог картинкой (концепция, раздел 3: «сохранить картинкой» — без почты и без сервера) ----------
// Картинка всегда светлая, как лист для печати: цвета — светлой темы style.css (--bg, --surface, --ink, --ink-2, --grass-2, --violet, --violet-2)
const PAPER = { bg: '#cfe9f6', surface: '#fffdf6', ink: '#1c2b1a', ink2: '#3a4a38', grass: '#2e8a3d', violet: '#a870ff', violet2: '#7c4bd6' };
const W = 1080, PAD = 64;

// Строки по ширине: перенос по словам
function wrap(ctx, text, max){
  const out = []; let line = '';
  for (const w of String(text).split(' ')){
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > max && line){ out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

// Холст с итогом испытания: класс и дата, «верно N из M», стартовая тема, части, навыки тремя группами
export async function placementCanvas(st, who = ''){
  const p = st.placement;
  if (!p?.grade) return null;
  try { await document.fonts?.ready; } catch (e) {}
  const font = (size, weight = 700) => `${weight} ${size}px 'Baloo 2', 'Nunito', system-ui, sans-serif`;
  const start = LESSONS.find(l => l.id === p.start);
  const skills = Object.entries(p.skills || {}).filter(([c]) => SKILLS[c]);
  const groups = [['mastered', '✅ Освоено'], ['check', '🔍 Проверим в игре'], ['learn', '📘 Учим']]
    .map(([k, title]) => ({ title, items: skills.filter(([, v]) => v === k).map(([c]) => `${SKILLS[c].title} (${c})`) }))
    .filter(g => g.items.length);
  // строки: [текст, размер, жирность, цвет, отступ сверху, сдвиг слева]
  const rows = [];
  const add = (text, size, weight, color, gap = 0, indent = 0) => rows.push({ text, size, weight, color, gap, indent });
  add('🛡️ Испытание стража ворот', 54, 800, PAPER.ink);
  add([who, `${p.grade} класс`, new Date(p.at).toLocaleDateString('ru-RU')].filter(Boolean).join(' · '), 34, 600, PAPER.ink2, 6);
  add(`Верно ${p.right} из ${p.total}`, 40, 800, PAPER.ink, 22);
  add(`Старт — тема ${p.startIdx + 1} «${start?.title || p.start}»${p.startIdx ? ', темы до неё открыты' : ''}`, 34, 700, PAPER.grass, 10);
  add('Части класса', 36, 800, PAPER.ink, 30);
  for (const x of p.parts){
    const a = LESSONS.find(l => l.id === x.from), b = LESSONS.find(l => l.id === x.to);
    add(`${x.passed ? '✅' : '📘'} Часть ${x.part + 1}: ${a?.title || ''}${a !== b ? ` — ${b?.title || ''}` : ''} · ${x.right} из ${x.total}${x.passed ? ', сдана' : ', учим'}`, 30, 600, PAPER.ink, 8, 8);
  }
  for (const g of groups){
    add(g.title, 34, 800, PAPER.ink, 28);
    for (const t of g.items) add('• ' + t, 30, 600, PAPER.ink, 6, 8);
  }
  add('«Освоено» — оба задания на навык верно, «проверим в игре» — одно из двух, «учим» — ни одного. Это стартовая точка, не оценка: программа уточняется по ходу игры.', 24, 600, PAPER.ink2, 34);
  add('English Quest — английский для 2–4 класса по Spotlight', 24, 700, PAPER.violet2, 10);   // текст — тёмный фиолетовый (контраст ≥ 4.5)

  // раскладка: сначала считаем высоту с переносами, потом рисуем
  const measure = document.createElement('canvas').getContext('2d');
  const inner = W - PAD * 2 - 40;
  let h = PAD + 40;
  for (const r of rows){
    measure.font = font(r.size, r.weight);
    r.lines = wrap(measure, r.text, inner - r.indent);
    h += r.gap + r.lines.length * Math.round(r.size * 1.3);
  }
  h += 40 + PAD;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = PAPER.bg; ctx.fillRect(0, 0, W, h);
  // карточка: жёсткая тень и контур 6 px, как в игре; слева полоса стража (эпическая редкость)
  const box = [PAD - 24, PAD - 24, W - (PAD - 24) * 2, h - (PAD - 24) * 2];
  ctx.fillStyle = PAPER.ink; ctx.fillRect(box[0] + 10, box[1] + 10, box[2], box[3]);
  ctx.fillStyle = PAPER.surface; ctx.fillRect(...box);
  ctx.fillStyle = PAPER.violet; ctx.fillRect(box[0], box[1], 18, box[3]);
  ctx.strokeStyle = PAPER.ink; ctx.lineWidth = 6; ctx.strokeRect(...box);
  let y = PAD + 40;
  ctx.textBaseline = 'top';
  for (const r of rows){
    y += r.gap;
    ctx.font = font(r.size, r.weight); ctx.fillStyle = r.color;
    for (const line of r.lines){ ctx.fillText(line, PAD + 20 + r.indent, y); y += Math.round(r.size * 1.3); }
  }
  return cv;
}

// Кнопка в панели для взрослых: PNG скачивается на устройство — без почты и без сервера
export function wirePlacementAdult(st, who){
  const btn = document.getElementById('t-pl-png');
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const cv = await placementCanvas(st, who);
      const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `english-quest-ispytanie-${st.placement.grade}-klass-${new Date(st.placement.at).toISOString().slice(0, 10)}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } finally { btn.disabled = false; }
  };
}
