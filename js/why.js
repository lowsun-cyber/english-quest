// English Quest — Разбор неверного ответа: готовое объяснение выбранного варианта (q.why), иначе —
// что значит выбранное и что было нужно, или правило.
import { SKILLS } from './eq.js';
import { lessonWords } from './stats.js';
import { escapeHtml } from './util.js';

// Под вопросом — коротко, почему неверно (тип ошибки — classifyError в stats.js).
export const WHY_MS = 2800;   // после ошибки задание держится дольше, чтобы ребёнок успел прочитать разбор
export function whyWrong({ lesson, error, answer, chosen, q }){
  const word = en => lesson?.words.find(w => w.en === en) || lessonWords().get(en);
  const en = x => `<b lang="en">${escapeHtml(x)}</b>`;
  const a = word(answer), c = chosen && word(chosen);
  let html = '';
  // верное предложение целиком; точку ставим, только если в конце нет знака
  const full = () => { const t = q.q ? q.q.replace('___', q.a) : answer; return `${en(t)}${/[.!?]$/.test(t) ? '' : '.'}`; };
  // готовое объяснение именно этого неверного варианта (q.why в content.js и в пакетах локаций)
  const own = q?.why && chosen != null ? q.why[chosen] : null;
  if (own) html = `${escapeHtml(own)} Правильно: ${full()}`;
  else if (error === 'similar' && a && c) html = `Похожие слова! ${en(chosen)} — «${escapeHtml(c.ru)}», а нужно ${en(answer)} — «${escapeHtml(a.ru)}».`;
  else if (error === 'unknown' && a && c) html = `${en(chosen)} — это «${escapeHtml(c.ru)}». А нужно ${en(answer)} — «${escapeHtml(a.ru)}».`;
  else if (error === 'unknown' && a) html = `${en(answer)} — это «${escapeHtml(a.ru)}». Запомни!`;
  else if (error === 'spelling') html = `Правильно пишется: ${en(answer)}. Сравни буква за буквой.`;
  else if (error === 'form' && q) html = `Правильно: ${full()}${SKILLS[q.skill] ? ` Правило: ${escapeHtml(SKILLS[q.skill].title)}.` : ''}`;
  else if (error === 'meaning') html = `Правильный ответ: ${en(answer)}. Найди его в тексте.`;
  if (!html) return;
  const box = document.createElement('div');
  box.className = 'why';
  box.setAttribute('role', 'status');
  box.innerHTML = `<span aria-hidden="true">💡</span> ${html}`;
  document.querySelector('#modal .question')?.appendChild(box);
}
