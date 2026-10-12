// English Quest — Рисунки героев (assets/heroes/*.svg) и их эмоции; герой-аватар ученика.
// Герои и их файлы описаны данными в content.js (CHARACTERS). Если картинка не загрузилась,
// вместо неё виден эмодзи героя.
import { CHARACTERS, DEFAULT_HERO, heroLine, narratorFor } from './eq.js';
import { state } from './state.js';
import { speak } from './tts.js';
import { escapeHtml } from './util.js';

export const heroById = id => CHARACTERS[id] || CHARACTERS[DEFAULT_HERO];
export const playableHeroes = () => Object.values(CHARACTERS).filter(c => c.playable);
// герой-аватар ученика (state.hero); неизвестный или старый прогресс без героя — герой по умолчанию
export const playerHero = st => { const c = CHARACTERS[st?.hero]; return c?.playable ? c : CHARACTERS[DEFAULT_HERO]; };

const fileOf = (c, mood) => c.files?.[mood] || c.files?.full || '';

// mood: full | happy | thinking | hint | praise. live — картинка меняет эмоцию по setHeroMood()
export function heroPic(c, mood = 'full', { cls = '', live = false, label = '' } = {}){
  const src = fileOf(c, mood);
  return `<span class="hero-pic ${cls}${src ? '' : ' broken'}" style="--hero-color:${c.color}"${label ? ` role="img" aria-label="${escapeHtml(label)}"` : ' aria-hidden="true"'}>`
    + (src ? `<img class="hero-img" src="${src}" alt="" draggable="false" data-hero="${c.id}"${live ? ` data-mood="${mood}"` : ''} />` : '')
    + `<span class="hero-fallback">${c.emoji}</span></span>`;
}

// Эмоция гида в открытом упражнении: рад — верный ответ, подсказывает — ошибка или подсказка.
// Вместе с картинкой меняется и реплика гида (строки sayRow с live). opts — для reactionLine.
export function setHeroMood(mood, opts = {}){
  document.querySelectorAll('#modal .hero-img[data-mood]').forEach(img => {
    const src = fileOf(heroById(img.dataset.hero), mood);
    if (src && img.dataset.mood !== mood){ img.dataset.mood = mood; img.src = src; }
  });
  document.querySelectorAll('#modal .hero-say[data-say-live]').forEach(row => {
    const line = reactionLine(row.dataset.saySpeaker, mood, opts);
    if (!line) return;
    row.dataset.sayText = line.text; row.dataset.sayLang = line.lang;
    row.querySelector('.hero-say-text').textContent = line.text;
  });
}

// ---------- реплики героев (HERO_LINES, SELF_LINES в content.js) ----------
// Кто говорит: ведущий (Dr. Harlow, а если ребёнок играет за него — Nurse Luna) и герой игрока.
// Подмена ведущего и гида — только когда героя выбрали сами: без выбора герой по умолчанию — Dr. Harlow,
// и тогда у всех новых учеников вела бы Nurse Luna.
export const chosenHeroId = () => CHARACTERS[state?.hero]?.playable ? state.hero : null;
export const narratorHero = () => heroById(narratorFor(chosenHeroId()));
// Упражнение, которое сейчас открыто: у DJ Robo в «Говори» и «Слушай» свои реплики
let sayCtx = {};
export function setSayContext(ctx){ sayCtx = ctx || {}; }
const KIND_OF_MOOD = { happy: 'correct', hint: 'wrong', thinking: 'think', praise: 'praise' };
// Реплика гида к эмоции. opts.skill — навык вопроса (Prof. Owl объясняет правило после ошибки),
// opts.id — особый случай в «Говори» (quiet — тихо, nomic — нет микрофона), opts.perfect — без ошибок.
export function reactionLine(heroId, mood, { skill, id, perfect } = {}){
  const kind = KIND_OF_MOOD[mood] || 'think', ex = sayCtx.ex;
  return ((ex === 'speak' || ex === 'listen') && heroLine(heroId, ex, { id: id || kind }))
    || (kind === 'wrong' && skill && heroLine(heroId, 'grammar', { skill }))
    || (kind === 'praise' && perfect && Math.random() < 0.5 && heroLine(heroId, 'praise', { id: 'perfect' }))
    || heroLine(heroId, kind);
}
const moodOfEmo = emo => emo === 'calm' || !emo ? 'happy' : emo;
// Строка «аватар + реплика»: нажатие — озвучка голосом героя. line — { speaker, text, lang, emo } (heroLine);
// say — что читать вслух, если отличается от показанного; live — реплика меняется по setHeroMood.
export function sayRow(line, { mood, live = false, say } = {}){
  if (!line) return '';
  const c = heroById(line.speaker), m = mood || moodOfEmo(line.emo);
  return `<button type="button" class="lead-guide hero-say" style="--hero-color:${c.color}" data-say-speaker="${c.id}" data-say-lang="${line.lang || 'ru'}" data-say-text="${escapeHtml(say || line.text)}"${live ? ' data-say-live=""' : ''} title="Послушать">
      <span class="mini-avatar">${heroPic(c, m, { live })}</span>
      <span class="txt"><strong>${escapeHtml(c.name)}:</strong> <span class="hero-say-text">${escapeHtml(line.text)}</span></span>
      <span class="hero-say-ico" aria-hidden="true">🔊</span>
    </button>`;
}
// Реплика героя игрока от первого лица (SELF_LINES): win, oops, boss, bosswin…
export const selfRow = kind => sayRow(heroLine(playerHero(state).id, kind, { self: true }));
document.addEventListener('click', (e) => {
  const row = e.target.closest?.('.hero-say');
  if (row) speak(row.dataset.sayText, { lang: row.dataset.sayLang, speaker: row.dataset.saySpeaker });
});
// Эмоция для следующего экрана упражнения (начало урока — «рад»), потом снова «думает»
let pendingMood = null;
export function nextScreenMood(mood){ pendingMood = mood; }
export function takeScreenMood(fallback){ const m = pendingMood || fallback; pendingMood = null; return m; }

// Картинка не загрузилась (нет сети, файл удалён) — показываем эмодзи
document.addEventListener('error', (e) => {
  if (e.target?.classList?.contains('hero-img')) e.target.closest('.hero-pic')?.classList.add('broken');
}, true);
