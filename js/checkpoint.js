// English Quest — Проверки после каждых 4 тем.
import { logAnswer } from './activity.js';
import { addItem, renderHUD, renderInventory, reward } from './hud.js';
import { BLOCK, CHECKPOINT_PASS, CHECKPOINT_SIZE, lessonsOf, renderMap } from './map.js';
import { countError, logSkill, logWord, recordMistake } from './mistakes.js';
import { saveState, state } from './state.js';
import { speak } from './tts.js';
import { afterFeedback, closeModal, confetti, openModal } from './ui.js';
import { distractors, escapeHtml, hasEmojiTwin, shuffle } from './util.js';
import { WHY_MS, whyWrong } from './why.js';
import { SKILLS } from './eq.js';
import { classifyError, errorCodeOf, skillItems, skillWeak } from './stats.js';

// === Смешанная викторина по темам: проверки-боссы и «Шахты» ===
// mix — сколько вопросов каждого вида: { word, listen, grammar }; недостающие добираются словами.
// onFinish(right, total) рисует итог.
export function runQuiz({ header, lessons, size, mix, onFinish, record = true }){
  const words = lessons.flatMap(l => l.words.map(w => ({ w, l })));
  const grammar = lessons.flatMap(l => l.grammar.map(q => ({ q, l })));
  const picked = shuffle(words);
  let at = 0;
  const take = n => picked.slice(at, at += n);
  let qs = [
    ...take(mix.word || 0).map(x => ({ type: 'word', ...x })),
    ...take(mix.listen || 0).map(x => ({ type: 'listen', ...x })),
    ...shuffle(grammar).slice(0, mix.grammar || 0).map(x => ({ type: 'grammar', ...x })),
  ];
  qs = qs.concat(take(size - qs.length).map(x => ({ type: 'word', ...x })));
  const queue = shuffle(qs).slice(0, size);
  let idx = 0, right = 0;
  render();

  function render(){
    if (idx >= queue.length) return onFinish(right, queue.length);
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
        if (ok){ btn.classList.add('correct'); right++; if (item.w) logWord(item.w.en, true); }
        else {
          btn.classList.add('wrong');
          document.querySelector(`.opt[data-o="${CSS.escape(answer)}"]`)?.classList.add('correct');
          // record: false — темы нет в учебнике (особые квесты): в «Мои ошибки» не пишем, но тип и код ошибки считаем
          const info = { exercise: item.type === 'listen' ? 'listen' : 'checkpoint', chosen: btn.dataset.o, skill: item.q?.skill };
          const error = !record
            ? (() => { const e = classifyError({ type: item.type === 'grammar' ? 'grammar' : 'word', ...info, answer }); countError(e, errorCodeOf({ ...info, error: e })); return e; })()
            : item.type === 'grammar'
            ? recordMistake('grammar', item.l, item.q.q, { exercise: 'checkpoint', chosen: btn.dataset.o, skill: item.q.skill })
            : recordMistake('word', item.l, item.w.en, { exercise: 'checkpoint', chosen: btn.dataset.o });
          whyWrong({ lesson: item.l, error, answer, chosen: btn.dataset.o, q: item.q });
        }
        if (say) speak(say);
        afterFeedback(() => { idx++; render(); }, ok ? 800 : WHY_MS);
      };
    });
  }
}

// === Проверка-босс после части: 10 вопросов по 4 темам ===
export function startCheckpoint(cp){
  const header = `
    <h2>${cp.emoji} ${escapeHtml(cp.title)}</h2>
    <div class="lead">Темы: ${cp.lessons.map(l => escapeHtml(l.title)).join(', ')}. Нужно ${CHECKPOINT_PASS} из ${CHECKPOINT_SIZE}.</div>`;
  runQuiz({ header, lessons: cp.lessons, size: CHECKPOINT_SIZE, mix: { word: 4, listen: 3, grammar: 3 }, onFinish: finish });

  function finish(right, total){
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
        <h3>${passed ? 'Босс побеждён! Проверка сдана!' : 'Почти получилось'}</h3>
        <p>Верно: <b>${right}</b> из ${total}.${passed ? '' : ` Нужно ${CHECKPOINT_PASS}.`}</p>
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

// === «Подтянуть навык»: тренировка на вопросах одного навыка (граф навыков, см. skillGate в stats.js) ===
export const SKILL_PRACTICE_SIZE = 6;
export function startSkillPractice(code, grade = 4){
  const skill = SKILLS[code], items = skillItems(code, grade);
  if (!skill || !items.length) return;
  // мало вопросов у навыка — повторяем их, чтобы набралось на тренировку
  let pool = shuffle(items);
  while (pool.length < SKILL_PRACTICE_SIZE) pool = pool.concat(shuffle(items));
  pool = pool.slice(0, SKILL_PRACTICE_SIZE);
  const lessons = [...new Set(pool.map(x => x.l))].map(l => ({ ...l, grammar: pool.filter(x => x.l === l).map(x => x.q) }));
  const header = `
    <h2>💪 Подтянуть навык</h2>
    <div class="lead">${escapeHtml(skill.title)}. Ответь на ${pool.length} вопросов — и дорога дальше откроется.</div>`;
  runQuiz({ header, lessons, size: pool.length, mix: { grammar: pool.length }, onFinish: (right, total) => {
    saveState();
    const ok = !skillWeak(code, state);
    if (ok) confetti();
    openModal(`
      ${header}
      <div class="question checkpoint-result ${ok ? 'pass' : 'fail'}">
        <span class="cp-big" aria-hidden="true">${ok ? '🔓' : '💪'}</span>
        <h3>${ok ? 'Навык подтянут — путь открыт!' : 'Ещё чуть-чуть'}</h3>
        <p>Верно: <b>${right}</b> из ${total}.${ok ? '' : ' Потренируйся ещё раз — каждый верный ответ укрепляет навык.'}</p>
      </div>
      <div class="controls">
        ${ok ? '' : '<button class="btn" id="sk-retry">🔁 Ещё раз</button>'}
        <button class="btn ${ok ? '' : 'secondary'}" id="sk-close">К карте</button>
      </div>`);
    const retry = document.getElementById('sk-retry');
    if (retry) retry.onclick = () => startSkillPractice(code, grade);
    document.getElementById('sk-close').onclick = () => { closeModal(); document.getElementById('lessons-sec').scrollIntoView({ behavior: 'smooth' }); };
    renderMap();
    renderHUD();
  } });
}
