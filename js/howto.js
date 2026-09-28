// English Quest — страница «How to»: тема как у ученика и списки из контента (всегда актуальные).
const { RANKS, CHARACTERS, LESSONS, MAX_LEVEL, heroIntro } = window.EQ;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// тема — как у выбранного ученика (светлая/тёмная)
try {
  const idx = JSON.parse(localStorage.getItem('english_quest_profiles') || 'null');
  const id = idx?.active || 'main';
  const st = JSON.parse(localStorage.getItem(id === 'main' ? 'english_quest_v2' : `english_quest_v2__${id}`) || 'null');
  if (st?.settings?.theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  localStorage.setItem('eq_howto_seen', '1');   // снимает метку «новое» с кнопки ❓
} catch (e) {}

document.querySelectorAll('[data-ht="maxLevel"]').forEach(el => { el.textContent = MAX_LEVEL; });

document.getElementById('ht-ranks').innerHTML = RANKS.map((r, i) => {
  const to = RANKS[i + 1] ? RANKS[i + 1].min - 1 : MAX_LEVEL;
  return `<div class="ht-rank" style="--rank-color:${r.color}"><span class="ht-rank-em">${r.emoji}</span><b>${esc(r.title)}</b><small>уровни ${r.min}–${to}</small></div>`;
}).join('');

document.getElementById('ht-team').innerHTML = Object.values(CHARACTERS).map(c => `
  <div class="ht-hero-card">
    <span class="ht-hero-av" style="background:${c.color}">${c.emoji}</span>
    <div><b>${esc(c.name)}</b> · <span class="t-muted">${esc(c.subtitle)}</span><p>${esc(heroIntro(c).ru)}</p></div>
  </div>`).join('');

const grades = [...new Set(LESSONS.map(l => l.grade))];
document.getElementById('ht-topics').innerHTML = grades.map(g => {
  const ls = LESSONS.filter(l => l.grade === g).sort((a, b) => a.order - b.order);
  const items = [];
  ls.forEach((l, i) => {
    items.push(`<li>${l.words[0]?.emoji || '📘'} <b>${esc(l.title)}</b> — ${esc(l.subtitle)}</li>`);
    if ((i + 1) % 4 === 0) items.push(`<li class="ht-cp">${(i + 1) === 4 ? '💎' : '🏆'} Проверка: 10 вопросов по темам выше</li>`);
  });
  return `<div class="ht-grade"><h4 class="ht-h4">${g} класс</h4><ol>${items.join('')}</ol></div>`;
}).join('');
