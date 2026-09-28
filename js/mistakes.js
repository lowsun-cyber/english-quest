// English Quest — «Мои ошибки»: интервальное повторение трудных слов и вопросов.
import { logAnswer } from './activity.js';
import { LESSONS } from './eq.js';
import { reward } from './hud.js';
import { saveState, state } from './state.js';
import { speak } from './tts.js';
import { afterFeedback, closeModal, openModal, toast } from './ui.js';
import { DAY, daysLabel, distractors, escapeHtml, shuffle, startOfDay } from './util.js';

// ---------- МОИ ОШИБКИ (интервальное повторение) ----------
// Каждая ошибка — карточка в «коробке» 0..3. Верный ответ при повторении двигает её дальше,
// и она возвращается через 1, 3 и 7 дней. После верного ответа в последней коробке — выучено.
// Неверный ответ возвращает карточку в коробку 0 (можно повторять сразу).
export const REVIEW_INTERVALS = [0, 1, 3, 7]; // дней до повторения для коробки 0..3
export const REVIEW_SESSION_SIZE = 10;

export function dueFor(box){ return box === 0 ? Date.now() : startOfDay(Date.now()) + REVIEW_INTERVALS[box] * DAY; }

export function recordMistake(type, lesson, ref){
  const key = `${type}:${lesson.id}:${ref}`;
  const m = state.mistakes[key] || { type, lessonId: lesson.id, ref, wrong: 0 };
  m.box = 0;
  m.due = dueFor(0);
  m.wrong += 1;
  m.last = Date.now();
  state.mistakes[key] = m;
  state.lessonWrong[lesson.id] = (state.lessonWrong[lesson.id] || 0) + 1;
  saveState();
  renderMistakes();
}

// Достаём из контента всё, что нужно для показа карточки. null — если урок/слово удалены.
export function resolveMistake(m){
  const lesson = LESSONS.find(l => l.id === m.lessonId);
  if (!lesson) return null;
  if (m.type === 'word'){
    const w = lesson.words.find(w => w.en === m.ref);
    return w ? { lesson, word: w } : null;
  }
  if (m.type === 'grammar'){
    const q = lesson.grammar.find(q => q.q === m.ref);
    return q ? { lesson, q } : null;
  }
  if (m.type === 'reading'){
    const q = lesson.reading?.questions.find(q => q.q === m.ref);
    return q ? { lesson, q, reading: lesson.reading } : null;
  }
  return null;
}

export function mistakeEntries(){
  return Object.entries(state.mistakes)
    .map(([key, m]) => ({ key, m, data: resolveMistake(m) }))
    .filter(x => x.data);
}



export function renderMistakes(){
  const wrap = document.getElementById('mistakes');
  if (!wrap) return;
  const all = mistakeEntries();
  const now = Date.now();
  const due = all.filter(x => x.m.due <= now);
  const later = all.filter(x => x.m.due > now).sort((a,b) => a.m.due - b.m.due);
  const mastered = state.mastered || 0;

  if (!all.length){
    wrap.innerHTML = `
      <div class="review-empty">
        <span class="review-empty-icon" aria-hidden="true">🛡️</span>
        <div>
          <strong>Ошибок пока нет</strong>
          <p>Если где-то ошибёшься, слово появится здесь — и мы повторим его, пока не запомнится.${mastered ? ` Уже выучено после ошибок: <b>${mastered}</b>.` : ''}</p>
        </div>
      </div>`;
    return;
  }

  const item = ({ m, data }) => {
    const pips = [1,2,3].map(i => `<span class="pip${m.box >= i ? ' on' : ''}"></span>`).join('');
    const when = m.due <= now ? '<span class="when now">повторить</span>' : `<span class="when">${daysLabel(m.due)}</span>`;
    let main;
    if (m.type === 'word'){
      main = `<span class="mi-em" aria-hidden="true">${data.word.emoji}</span><span class="mi-text"><span class="mi-en">${escapeHtml(data.word.en)}</span><span class="mi-ru">${escapeHtml(data.word.ru)}</span></span>`;
    } else {
      const label = m.type === 'grammar' ? 'Грамматика' : 'Чтение';
      main = `<span class="mi-em" aria-hidden="true">${m.type === 'grammar' ? '🧩' : '📖'}</span><span class="mi-text"><span class="mi-en mi-sentence">${escapeHtml(data.q.q)}</span><span class="mi-ru">${label} · ${escapeHtml(data.lesson.title)}</span></span>`;
    }
    return `<li class="mistake-item">${main}<span class="mi-meta"><span class="pips" title="Верных повторений: ${m.box} из 3" aria-label="Верных повторений: ${m.box} из 3">${pips}</span>${when}</span></li>`;
  };

  const nextLabel = later.length ? daysLabel(later[0].m.due) : null;
  wrap.innerHTML = `
    <div class="review-panel">
      <div class="review-summary">
        <div class="review-count">
          <span class="big">${due.length}</span>
          <span>${due.length ? 'ждут повторения сейчас' : 'на сегодня всё повторено'}</span>
        </div>
        <div class="review-stats">
          <span>Всего в списке: <b>${all.length}</b></span>
          ${mastered ? `<span>Выучено после ошибок: <b>${mastered}</b></span>` : ''}
          ${!due.length && nextLabel ? `<span>Следующее повторение: <b>${nextLabel}</b></span>` : ''}
        </div>
        <button class="btn" id="btn-review" ${due.length ? '' : 'disabled'}>🔁 Повторить${due.length ? ` (${Math.min(due.length, REVIEW_SESSION_SIZE)})` : ''}</button>
      </div>
      <ul class="mistake-list" role="list">
        ${[...due, ...later].map(item).join('')}
      </ul>
    </div>`;
  const btn = document.getElementById('btn-review');
  if (btn && due.length) btn.onclick = startReview;
}

export function startReview(){
  const now = Date.now();
  const queue = shuffle(mistakeEntries().filter(x => x.m.due <= now)).slice(0, REVIEW_SESSION_SIZE);
  if (!queue.length) return;
  let idx = 0, right = 0;
  const header = `
    <h2>Мои ошибки</h2>
    <div class="lead">Повторяем то, что было трудно.</div>`;
  const progress = () => `<div class="review-progress" aria-label="Вопрос ${idx+1} из ${queue.length}"><span style="width:${Math.round(idx*100/queue.length)}%"></span></div>`;

  render();
  function render(){
    if (idx >= queue.length){
      const newlyMastered = queue.filter(x => x.result === 'mastered').length;
      openModal(`
        ${header}
        <div class="question">
          <h3>Повторение завершено!</h3>
          <p>Верно: <b>${right}</b> из ${queue.length}.${newlyMastered ? ` Выучено насовсем: <b>${newlyMastered}</b> 🎉` : ''}</p>
          ${right < queue.length ? '<p>Слова с ошибками вернутся в список — повторим ещё раз.</p>' : ''}
        </div>
        <div class="controls"><button class="btn" id="review-close">Готово</button></div>
      `);
      document.getElementById('review-close').onclick = closeModal;
      renderMistakes();
      return;
    }
    const entry = queue[idx];
    const { m, data } = entry;
    let body, options, answer, sayOnAnswer;
    if (m.type === 'word'){
      const pool = distractors(data.word, data.lesson.words, 3);
      options = shuffle([data.word.en, ...pool.map(x => x.en)]);
      answer = data.word.en;
      sayOnAnswer = data.word.en;
      body = `
        <span class="q-emoji">${data.word.emoji}</span>
        <div class="q-text pixel">Как по-английски?</div>
        <div class="review-hint">${escapeHtml(data.word.ru)}</div>`;
    } else if (m.type === 'grammar'){
      options = shuffle(data.q.options);
      answer = data.q.a;
      sayOnAnswer = data.q.q.replace('___', data.q.a);
      body = `
        <div class="q-text pixel">Выбери правильный вариант</div>
        <div class="q-text q-sentence">${escapeHtml(data.q.q)}</div>
        <div class="review-hint">💡 ${escapeHtml(data.q.hint)}</div>`;
    } else {
      options = shuffle(data.q.options);
      answer = data.q.a;
      body = `
        <p class="review-passage">${escapeHtml(data.reading.text)}</p>
        <div class="q-text q-sentence">${escapeHtml(data.q.q)}</div>`;
    }
    openModal(`
      ${header}
      ${progress()}
      <div class="question">
        ${body}
        <div class="options">
          ${options.map(o => `<button class="opt" data-o="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('')}
        </div>
      </div>
      ${m.type === 'word' ? '<div class="controls"><button class="btn secondary" id="hear">🔊 Услышать</button></div>' : ''}
    `);
    const hear = document.getElementById('hear');
    if (hear) hear.onclick = () => speak(data.word.en);

    document.querySelectorAll('.opt').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.opt').forEach(b => b.disabled = true);
        const ok = btn.dataset.o === answer;
        const stored = state.mistakes[entry.key];
        if (ok){
          btn.classList.add('correct');
          right++;
          if (stored.box >= 3){
            delete state.mistakes[entry.key];
            state.mastered = (state.mastered || 0) + 1;
            entry.result = 'mastered';
            toast('🎉 Выучено!');
          } else {
            stored.box += 1;
            stored.due = dueFor(stored.box);
            toast(`✅ Повторим ${daysLabel(stored.due)}`);
          }
          reward(8, 2); // reward() сохраняет состояние и обновляет HUD
        } else {
          btn.classList.add('wrong');
          document.querySelector(`.opt[data-o="${CSS.escape(answer)}"]`)?.classList.add('correct');
          stored.box = 0;
          stored.due = dueFor(0);
          stored.wrong += 1;
          stored.last = Date.now();
          logAnswer(false);
          toast(`Правильно: ${answer}`);
          saveState();
        }
        if (sayOnAnswer) speak(sayOnAnswer);
        afterFeedback(() => { idx++; render(); }, ok ? 900 : 1600);
      };
    });
  }
}
