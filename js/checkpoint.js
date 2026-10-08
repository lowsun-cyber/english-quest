// English Quest — Проверки после каждых 4 тем.
import { logAnswer } from './activity.js';
import { addItem, renderHUD, renderInventory, reward } from './hud.js';
import { BLOCK, CHECKPOINT_PASS, CHECKPOINT_SIZE, lessonsOf, renderMap } from './map.js';
import { logSkill, recordMistake } from './mistakes.js';
import { saveState, state } from './state.js';
import { speak } from './tts.js';
import { afterFeedback, closeModal, confetti, openModal } from './ui.js';
import { distractors, escapeHtml, hasEmojiTwin, shuffle } from './util.js';

// === Проверка после части: 10 вопросов по 4 темам ===
export function startCheckpoint(cp){
  const words = cp.lessons.flatMap(l => l.words.map(w => ({ w, l })));
  const grammar = cp.lessons.flatMap(l => l.grammar.map(q => ({ q, l })));
  const picked = shuffle(words);
  let qs = [
    ...picked.slice(0, 4).map(x => ({ type: 'word', ...x })),
    ...picked.slice(4, 7).map(x => ({ type: 'listen', ...x })),
    ...shuffle(grammar).slice(0, 3).map(x => ({ type: 'grammar', ...x })),
  ];
  qs = qs.concat(picked.slice(7, 7 + CHECKPOINT_SIZE - qs.length).map(x => ({ type: 'word', ...x })));
  const queue = shuffle(qs).slice(0, CHECKPOINT_SIZE);
  let idx = 0, right = 0;
  const header = `
    <h2>${cp.emoji} ${escapeHtml(cp.title)}</h2>
    <div class="lead">Темы: ${cp.lessons.map(l => escapeHtml(l.title)).join(', ')}. Нужно ${CHECKPOINT_PASS} из ${queue.length}.</div>`;
  render();

  function render(){
    if (idx >= queue.length) return finish();
    const item = queue[idx];
    let body, options, answer, say;
    const others = n => distractors(item.w, words.map(x => x.w), n).map(w => ({ w }));
    if (item.type === 'word'){
      options = shuffle([item.w.en, ...others(3).map(x => x.w.en)]);
      answer = item.w.en; say = item.w.en;
      body = `<span class="q-emoji">${item.w.emoji}</span><div class="q-text pixel">Как по-английски?</div>${hasEmojiTwin(item.w, words.map(x => x.w)) ? `<div class="review-hint">${escapeHtml(item.w.ru)}</div>` : ''}`;
    } else if (item.type === 'listen'){
      options = shuffle([item.w, ...others(3).map(x => x.w)]);
      answer = item.w.en;
      body = `<div class="q-listen-icon" aria-hidden="true">🔊</div><div class="q-text pixel">Слушай и выбирай картинку</div>`;
    } else {
      options = shuffle(item.q.options);
      answer = item.q.a; say = item.q.q.replace('___', item.q.a);
      body = `<div class="q-text pixel">Выбери правильный вариант</div><div class="q-text q-sentence">${escapeHtml(item.q.q)}</div>`;
    }
    openModal(`
      ${header}
      <div class="review-progress" aria-label="Вопрос ${idx + 1} из ${queue.length}"><span style="width:${Math.round(idx * 100 / queue.length)}%"></span></div>
      <div class="question">
        ${body}
        <div class="options">
          ${options.map(o => item.type === 'listen'
            ? `<button class="opt opt-emoji" data-o="${escapeHtml(o.en)}" aria-label="${escapeHtml(o.ru)}">${o.emoji}</button>`
            : `<button class="opt" data-o="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('')}
        </div>
      </div>
      ${item.type === 'listen' ? '<div class="controls"><button class="btn secondary" id="hear">🔊 Повторить</button></div>' : ''}
    `);
    if (item.type === 'listen'){
      document.getElementById('hear').onclick = () => speak(item.w.en);
      afterFeedback(() => speak(item.w.en), 350);
    }
    document.querySelectorAll('.opt').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.opt').forEach(b => b.disabled = true);
        const ok = btn.dataset.o === answer;
        logAnswer(ok);
        if (item.type === 'grammar') logSkill(item.q, ok, btn.dataset.o);
        if (ok){ btn.classList.add('correct'); right++; }
        else {
          btn.classList.add('wrong');
          document.querySelector(`.opt[data-o="${CSS.escape(answer)}"]`)?.classList.add('correct');
          if (item.type === 'grammar') recordMistake('grammar', item.l, item.q.q);
          else recordMistake('word', item.l, item.w.en);
        }
        if (say) speak(say);
        afterFeedback(() => { idx++; render(); }, ok ? 800 : 1500);
      };
    });
  }

  function finish(){
    const prev = state.checkpoints[cp.id] || {};
    const passed = right >= CHECKPOINT_PASS;
    const firstPass = passed && !prev.passedAt;
    state.checkpoints[cp.id] = { best: Math.max(prev.best || 0, right), passedAt: prev.passedAt || (passed ? Date.now() : null) };
    if (firstPass){
      addItem(`trophy:${cp.id}`, 1);
      confetti();
      reward(50, 20, { bonus: true });
    } else saveState();
    const nextLesson = lessonsOf(cp.grade)[cp.part * BLOCK];
    openModal(`
      ${header}
      <div class="question checkpoint-result ${passed ? 'pass' : 'fail'}">
        <span class="cp-big" aria-hidden="true">${passed ? cp.emoji : '💪'}</span>
        <h3>${passed ? 'Проверка сдана!' : 'Почти получилось'}</h3>
        <p>Верно: <b>${right}</b> из ${queue.length}.${passed ? '' : ` Нужно ${CHECKPOINT_PASS}.`}</p>
        ${firstPass ? `<p>Награда: ${cp.emoji} в инвентаре и +50 XP.${nextLesson ? ` Открыта тема «${escapeHtml(nextLesson.title)}».` : ''}</p>` : ''}
        ${!passed ? '<p>Ошибки попали в «Мои ошибки» — повтори их и попробуй снова.</p>' : ''}
      </div>
      <div class="controls">
        ${passed ? '' : '<button class="btn" id="cp-retry">🔁 Попробовать снова</button>'}
        <button class="btn ${passed ? '' : 'secondary'}" id="cp-close">К карте</button>
      </div>
    `);
    const retry = document.getElementById('cp-retry');
    if (retry) retry.onclick = () => startCheckpoint(cp);
    document.getElementById('cp-close').onclick = () => { closeModal(); document.getElementById('lessons-sec').scrollIntoView({ behavior: 'smooth' }); };
    renderMap();
    renderHUD();
    renderInventory();
  }
}
