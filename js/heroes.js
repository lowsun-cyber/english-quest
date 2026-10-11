// English Quest — Рисунки героев (assets/heroes/*.svg) и их эмоции; герой-аватар ученика.
// Герои и их файлы описаны данными в content.js (CHARACTERS). Если картинка не загрузилась,
// вместо неё виден эмодзи героя.
import { CHARACTERS, DEFAULT_HERO } from './eq.js';
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

// Эмоция гида в открытом упражнении: рад — верный ответ, подсказывает — ошибка или подсказка
export function setHeroMood(mood){
  document.querySelectorAll('#modal .hero-img[data-mood]').forEach(img => {
    const src = fileOf(heroById(img.dataset.hero), mood);
    if (src && img.dataset.mood !== mood){ img.dataset.mood = mood; img.src = src; }
  });
}
// Эмоция для следующего экрана упражнения (начало урока — «рад»), потом снова «думает»
let pendingMood = null;
export function nextScreenMood(mood){ pendingMood = mood; }
export function takeScreenMood(fallback){ const m = pendingMood || fallback; pendingMood = null; return m; }

// Картинка не загрузилась (нет сети, файл удалён) — показываем эмодзи
document.addEventListener('error', (e) => {
  if (e.target?.classList?.contains('hero-img')) e.target.closest('.hero-pic')?.classList.add('broken');
}, true);
