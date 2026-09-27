// English Quest — Печатный лист «Трудные слова» для занятия на бумаге.
import { LESSONS } from './eq.js';
import { mistakeEntries } from './mistakes.js';
import { state } from './state.js';
import { escapeHtml, shuffle } from './util.js';

// Столько помещается на одну страницу А4 вместе со всеми тремя заданиями
const MAX_WORDS = 10;
const MAX_MATCH = 6;
const MAX_GRAMMAR = 4;

// Что печатаем: трудные слова (по числу ошибок) или все слова одной темы.
function collect(source, lessonId){
  if (source === 'lesson'){
    const l = LESSONS.find(x => x.id === lessonId) || LESSONS[0];
    return { title: `Слова темы «${l.title}»`, words: l.words.slice(0, MAX_WORDS), grammar: l.grammar.slice(0, MAX_GRAMMAR) };
  }
  const hard = mistakeEntries().sort((a, b) => b.m.wrong - a.m.wrong);
  return {
    title: 'Трудные слова',
    words: hard.filter(x => x.m.type === 'word').slice(0, MAX_WORDS).map(x => x.data.word),
    grammar: hard.filter(x => x.m.type === 'grammar').slice(0, MAX_GRAMMAR).map(x => x.data.q),
  };
}

// «t _ _ _ _   b _ _ _» — первая буква и черточки, пробелы между словами сохраняются
function hint(en){
  return en.split(' ').map(w => [...w].map((c, i) => i === 0 ? c : /[a-z]/i.test(c) ? '_' : c).join(' ')).join(' ');
}

export function worksheetSectionHtml(){
  const hardWords = mistakeEntries().filter(x => x.m.type === 'word').length;
  const grades = [...new Set(LESSONS.map(l => l.grade))];
  const startedLesson = LESSONS.find(l => state.lessonProgress[l.id]) || LESSONS[0];
  return `
    <form class="t-ws" id="t-ws">
      <p class="t-muted">Лист А4 для занятия на бумаге: напиши слово по картинке, соедини, вставь пропущенное. Ответы — на отдельной странице.</p>
      <fieldset>
        <legend>Какие слова</legend>
        <label class="t-check"><input type="radio" name="ws-src" value="hard" ${hardWords ? 'checked' : 'disabled'} /> Трудные слова (${hardWords})</label>
        <label class="t-check"><input type="radio" name="ws-src" value="lesson" ${hardWords ? '' : 'checked'} /> Слова темы</label>
        <select id="t-ws-lesson" aria-label="Тема для листа">
          ${grades.map(g => `<optgroup label="${g} класс">${LESSONS.filter(l => l.grade === g).map(l => `<option value="${l.id}" ${l === startedLesson ? 'selected' : ''}>${escapeHtml(l.title)}</option>`).join('')}</optgroup>`).join('')}
        </select>
      </fieldset>
      <div class="t-checks">
        <label class="t-check"><input type="checkbox" id="t-ws-hint" checked /> Подсказка: первая буква</label>
        <label class="t-check"><input type="checkbox" id="t-ws-match" checked /> Задание «Соедини»</label>
        <label class="t-check"><input type="checkbox" id="t-ws-key" checked /> Ответы для взрослого</label>
      </div>
      <div class="controls"><button class="btn" type="submit">🖨️ Распечатать лист</button></div>
    </form>`;
}

export function worksheetHtml({ source, lessonId, withHint, withMatch, withKey }){
  const { title, words, grammar } = collect(source, lessonId);
  if (!words.length) return null;
  // в «Соедини» картинки не должны повторяться (🧸 — и toy, и teddy bear)
  const seen = new Set();
  const match = withMatch ? shuffle(words).filter(w => !seen.has(w.emoji) && seen.add(w.emoji)).slice(0, MAX_MATCH) : [];
  const matchRight = shuffle(match);
  const letters = 'АБВГДЕЖЗ';
  const d = new Date();
  const today = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  let n = 0;
  const sheet = `
    <section class="ws-page">
      <header class="ws-head">
        <div><div class="ws-brand">English Quest</div><h1>${escapeHtml(title)}</h1></div>
        <div class="ws-meta"><div>Имя: <span class="ws-fill"></span></div><div>Дата: <span class="ws-fill short"></span></div></div>
      </header>

      <div class="ws-sec">
      <h2>${++n}. Напиши по-английски</h2>
      <p class="ws-task">Посмотри на картинку и прочитай перевод. Напиши слово по-английски.</p>
      <table class="ws-write">
        ${words.map((w, i) => `
          <tr>
            <td class="ws-num">${i + 1}</td>
            <td class="ws-em">${w.emoji}</td>
            <td class="ws-ru">${escapeHtml(w.ru)}</td>
            <td class="ws-line">${withHint ? `<span class="ws-hint">${escapeHtml(hint(w.en))}</span>` : ''}</td>
          </tr>`).join('')}
      </table>
      </div>

      ${match.length ? `<div class="ws-sec">
        <h2>${++n}. Соедини картинку и слово</h2>
        <p class="ws-task">Проведи линию от картинки к слову или напиши рядом с цифрой букву.</p>
        <div class="ws-match">
          <ol>${match.map((w, i) => `<li><span class="ws-num">${i + 1}</span><span class="ws-em">${w.emoji}</span><span class="ws-dot">●</span></li>`).join('')}</ol>
          <ol>${matchRight.map((w, i) => `<li><span class="ws-dot">●</span><span class="ws-word">${escapeHtml(w.en)}</span><span class="ws-num">${letters[i]}</span></li>`).join('')}</ol>
        </div></div>` : ''}

      ${grammar.length ? `<div class="ws-sec">
        <h2>${++n}. Вставь пропущенное слово</h2>
        <p class="ws-task">Выбери слово из скобок и впиши его.</p>
        <ol class="ws-gram">
          ${grammar.map(q => `<li>${escapeHtml(q.q).replace('___', '<span class="ws-blank"></span>')} <span class="ws-opts">(${q.options.map(escapeHtml).join(' / ')})</span></li>`).join('')}
        </ol></div>` : ''}

      <footer class="ws-foot">English Quest · ${today}</footer>
    </section>`;

  const key = withKey ? `
    <section class="ws-page ws-key">
      <header class="ws-head"><div><div class="ws-brand">English Quest</div><h1>Ответы — для взрослого</h1></div></header>
      <h2>1. Напиши по-английски</h2>
      <ol class="ws-key-list">${words.map(w => `<li>${w.emoji} ${escapeHtml(w.ru)} — <b>${escapeHtml(w.en)}</b></li>`).join('')}</ol>
      ${match.length ? `<h2>2. Соедини</h2><p class="ws-key-line">${match.map((w, i) => `${i + 1} — ${letters[matchRight.indexOf(w)]}`).join(', ')}</p>` : ''}
      ${grammar.length ? `<h2>${match.length ? 3 : 2}. Вставь пропущенное слово</h2>
        <ol class="ws-key-list">${grammar.map(q => `<li>${escapeHtml(q.q.replace('___', q.a.toUpperCase()))}</li>`).join('')}</ol>` : ''}
    </section>` : '';
  return sheet + key;
}

export function printWorksheet(opts){
  const html = worksheetHtml(opts);
  if (!html) return false;
  let el = document.getElementById('print-sheet');
  if (!el){ el = document.createElement('div'); el.id = 'print-sheet'; document.body.appendChild(el); }
  el.innerHTML = html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); el.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  return true;
}

export function wireWorksheet(){
  const form = document.getElementById('t-ws');
  if (!form) return;
  const sel = document.getElementById('t-ws-lesson');
  sel.onchange = () => { form.querySelector('input[value=lesson]').checked = true; };
  form.onsubmit = (e) => {
    e.preventDefault();
    const ok = printWorksheet({
      source: form.querySelector('input[name=ws-src]:checked').value,
      lessonId: sel.value,
      withHint: document.getElementById('t-ws-hint').checked,
      withMatch: document.getElementById('t-ws-match').checked,
      withKey: document.getElementById('t-ws-key').checked,
    });
    if (!ok) alert('Для листа нет слов — выберите тему.');
  };
}
