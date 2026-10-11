// English Quest — Квест-реванш: самые трудные слова и вопросы из «Моих ошибок» на ступень проще,
// чем там, где была ошибка (revengeFormat в stats.js). Верный ответ — удачное повторение.
import { logAnswer } from './activity.js';
import { reward } from './hud.js';
import { dueFor, logSkill, logWord, noteError, renderMistakes } from './mistakes.js';
import { saveState, state } from './state.js';
import { REVENGE_MIN, lessonWords, revengeFormat, revengeItems, revengeReady } from './stats.js';
import { speak } from './tts.js';
import { afterFeedback, closeModal, confetti, openModal, toast } from './ui.js';
import { distractors, escapeHtml, shuffle } from './util.js';
import { WHY_MS, whyWrong } from './why.js';

export const REVENGE_PRIZE = { xp: 20, coins: 10 };   // за реванш на 80% и выше — каждый раз
export { revengeReady };

// Варианты для слова: перепутанное (если было) обязательно среди них — чтобы сравнить
function wordOptions(entry, n){
  const { m, data } = entry, w = data.word, pool = data.lesson.words;
  const confused = Object.keys(m.with || {}).map(en => pool.find(x => x.en === en) || lessonWords().get(en)).filter(x => x && x.emoji !== w.emoji);
  const rest = distractors(w, pool.filter(x => !confused.includes(x)), n);
  return shuffle([w, ...[...confused.slice(0, 1), ...rest].slice(0, n)]);
}

export function startRevenge(){
  const queue = revengeItems(state);
  if (queue.length < REVENGE_MIN){ toast(`Реванш появится, когда в «Моих ошибках» будет ${REVENGE_MIN} трудных слов`); return; }
  let idx = 0, right = 0;
  const header = `
    <h2>⚔️ Квест-реванш</h2>
    <div class="lead">Самые трудные слова и вопросы — теперь чуть проще. Одолей их!</div>`;
  render();

  function render(){
    if (idx >= queue.length) return finish();
    const entry = queue[idx], { m, data } = entry, fmt = revengeFormat(m);
    let body, options, answer, say, emojiOpts = false;
    if (fmt === 'grammar2'){
      const wrong = Object.keys(m.with || {})[0];
      const other = wrong && data.q.options.includes(wrong) && wrong !== data.q.a ? wrong : shuffle(data.q.options.filter(o => o !== data.q.a))[0];
      options = shuffle([data.q.a, other].map(o => ({ v: o, label: o })));
      answer = data.q.a; say = data.q.q.replace('___', data.q.a);
      body = `<div class="q-text pixel">Выбери правильный вариант</div><div class="q-text q-sentence">${escapeHtml(data.q.q)}</div><div class="review-hint">💡 ${escapeHtml(data.q.hint)}</div>`;
    } else if (fmt === 'pick-word'){
      options = wordOptions(entry, 3).map(w => ({ v: w.en, label: w.en }));
      answer = data.word.en; say = data.word.en;
      body = `<span class="q-emoji">${data.word.emoji}</span><div class="q-text pixel">Как по-английски?</div><div class="review-hint">${escapeHtml(data.word.ru)}</div>`;
    } else {
      options = wordOptions(entry, fmt === 'listen2' ? 1 : 3).map(w => ({ v: w.en, label: w.emoji, aria: w.ru }));
      emojiOpts = true;
      answer = data.word.en;
      body = `<div class="q-listen-icon" aria-hidden="true">🔊</div><div class="q-text pixel">Слушай и выбирай картинку</div>`;
    }
    openModal(`
      ${header}
      <div class="review-progress" aria-label="Вопрос ${idx + 1} из ${queue.length}"><span style="width:${Math.round(idx * 100 / queue.length)}%"></span></div>
      <div class="question">
        ${body}
        <div class="options${options.length === 2 ? ' options-2' : ''}">
          ${options.map(o => `<button class="opt${emojiOpts ? ' opt-emoji' : ''}" data-o="${escapeHtml(o.v)}"${o.aria ? ` aria-label="${escapeHtml(o.aria)}"` : ''}>${escapeHtml(o.label)}</button>`).join('')}
        </div>
      </div>
      ${m.type === 'word' ? '<div class="controls"><button class="btn secondary" id="hear">🔊 Услышать</button></div>' : ''}
    `);
    const hear = document.getElementById('hear');
    if (hear) hear.onclick = () => speak(data.word.en);
    if (emojiOpts) afterFeedback(() => speak(data.word.en), 350);
    document.querySelectorAll('.opt').forEach(btn => btn.onclick = () => {
      document.querySelectorAll('.opt').forEach(b => b.disabled = true);
      const ok = btn.dataset.o === answer, stored = state.mistakes[entry.key];
      if (m.type === 'grammar') logSkill(data.q, ok, btn.dataset.o);
      if (ok){
        btn.classList.add('correct');
        right++;
        if (m.type === 'word') logWord(answer, true);
        if (stored.box >= 3){ delete state.mistakes[entry.key]; state.mastered = (state.mastered || 0) + 1; toast('🎉 Выучено!'); }
        else { stored.box += 1; stored.due = dueFor(stored.box); stored.rv = Date.now(); }
        reward(10, 2);   // сохраняет состояние и обновляет шапку
      } else {
        btn.classList.add('wrong');
        document.querySelector(`.opt[data-o="${CSS.escape(answer)}"]`)?.classList.add('correct');
        stored.box = 0; stored.due = dueFor(0); stored.wrong += 1; stored.last = Date.now();
        const error = noteError(stored, m.type, m.ref, { exercise: 'revenge', chosen: btn.dataset.o, skill: data.q?.skill });
        logAnswer(false);
        saveState();
        whyWrong({ lesson: data.lesson, error, answer, chosen: btn.dataset.o, q: data.q });
      }
      if (say) speak(say);
      afterFeedback(() => { idx++; render(); }, ok ? 900 : WHY_MS);
    });
  }

  function finish(){
    const pct = Math.round(right * 100 / queue.length), won = pct >= 80;
    state.revengeWins = (state.revengeWins || 0) + (won ? 1 : 0);
    if (won){ confetti(); reward(REVENGE_PRIZE.xp, REVENGE_PRIZE.coins, { bonus: true }); } else saveState();
    openModal(`
      ${header}
      <div class="question">
        <h3>${won ? 'Реванш взят! ⚔️' : 'Почти! Попробуем ещё раз'}</h3>
        <p>Верно: <b>${right}</b> из ${queue.length} (${pct}%).${won ? ` <b>+${REVENGE_PRIZE.xp} XP, +${REVENGE_PRIZE.coins} 🪙</b>` : ' Трудные слова остались в «Моих ошибках».'}</p>
      </div>
      <div class="controls"><button class="btn" id="rv-close">Готово</button></div>
    `);
    document.getElementById('rv-close').onclick = closeModal;
    renderMistakes();
  }
}
