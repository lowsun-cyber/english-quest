// English Quest — Нижнее меню (docs/design-v2, эскиз 31/34): Карта · Клиника · Сундук · Ошибки.
// Разделы — на главной странице: пункт прокручивает к своему разделу и подсвечивается, когда раздел на экране.
// На «Ошибках» — сколько ошибок ждут повторения.
import { state } from './state.js';
import { mistakeList } from './stats.js';

const nav = document.getElementById('bottom-nav');
const reduce = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function setCurrent(link){
  nav.querySelectorAll('[data-nav]').forEach(x => x.removeAttribute('aria-current'));
  link?.setAttribute('aria-current', 'true');
}

if (nav){
  nav.addEventListener('click', (e) => {
    const item = e.target.closest('[data-nav]');
    if (!item) return;
    const target = document.querySelector(item.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'start' });
    setCurrent(item);
  });
  // подсветка: последний раздел, верх которого уже поднялся в верхние 40% экрана; в начале страницы — «Карта»,
  // в самом низу — последний видимый
  const links = [...nav.querySelectorAll('a[data-nav]')];
  const pairs = links.map(a => [a, document.querySelector(a.getAttribute('href'))]).filter(([, s]) => s);
  let ticking = false;
  const update = () => {
    ticking = false;
    // внизу страницы последние разделы не поднимаются к верху экрана — тогда берём последний видимый
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    const line = atBottom ? window.innerHeight - 40 : window.innerHeight * 0.4;
    const passed = pairs.filter(([, s]) => s.getBoundingClientRect().top <= line && s.getBoundingClientRect().bottom > 0)
      .sort((x, y) => x[1].getBoundingClientRect().top - y[1].getBoundingClientRect().top);
    setCurrent(passed.length ? passed[passed.length - 1][0] : links[0]);
  };
  window.addEventListener('scroll', () => { if (!ticking){ ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

// сколько ошибок ждут повторения — значок на «Ошибках»
export function renderNavBadge(){
  const b = document.getElementById('nav-due');
  if (!b || !state) return;
  const due = mistakeList(state).filter(x => x.m.due <= Date.now()).length;
  b.hidden = !due;
  b.textContent = due > 99 ? '99+' : String(due);
  b.closest('a')?.setAttribute('aria-label', due ? `Ошибки: ${due} ждут повторения` : 'Ошибки');
}
document.addEventListener('eq:mistakes', renderNavBadge);
