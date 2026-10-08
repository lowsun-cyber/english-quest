// English Quest — Упражнения: карточки, слова, слушай, пары, напиши, грамматика, чтение, говори.
import { PASS_SCORE, candidatesFromResults, phraseWords, scoreSpeech } from './speech.js';
import { logAnswer } from './activity.js';
import { CHARACTERS, LESSONS, fillItemsFor, lessonStartLine } from './eq.js';
import { checkHomework } from './homework.js';
import { isLessonComplete, penalty, renderHUD, reward } from './hud.js';
import { renderMap } from './map.js';
import { logSkill, recordMistake } from './mistakes.js';
import { saveState, state } from './state.js';
import { speak, speakWordOrPhrase, stopSpeech } from './tts.js';
import { afterFeedback, back, closeModal, modal, openModal, showGuide, toast } from './ui.js';
import { distractors, escapeHtml, hasEmojiTwin, shuffle, uniqueByEmoji } from './util.js';

// === Карточки: слово за словом, потом все слова сеткой ===
export function exCards(lesson, guide){
  const words = lesson.words;
  let i = 0;
  render();
  function render(){
    if (i >= words.length) return overview();
    const w = words[i];
    openModal(`
      ${lessonHeader(lesson, guide)}
      <div class="flash">
        <div class="flash-count">${i + 1} / ${words.length}</div>
        <span class="flash-em" aria-hidden="true">${w.emoji}</span>
        <div class="flash-en" lang="en">${escapeHtml(w.en)}</div>
        <div class="flash-ru">${escapeHtml(w.ru)}</div>
      </div>
      <div class="controls flash-controls">
        <button class="btn secondary" id="fc-prev" ${i === 0 ? 'disabled' : ''}>← Назад</button>
        <button class="btn gold" id="fc-hear">🔊 Ещё раз</button>
        <button class="btn" id="fc-next">${i === words.length - 1 ? 'Все слова ✓' : 'Дальше →'}</button>
      </div>
    `);
    document.getElementById('fc-prev').onclick = () => { i--; render(); };
    document.getElementById('fc-next').onclick = () => { i++; render(); };
    document.getElementById('fc-hear').onclick = () => speak(w.en);
    modal.onkeydown = (e) => {
      if (e.key === 'ArrowRight'){ i++; render(); }
      else if (e.key === 'ArrowLeft' && i > 0){ i--; render(); }
    };
    afterFeedback(() => speak(w.en), 300);
  }
  function overview(){
    markProgress(lesson.id, 'cards');
    saveState();
    openModal(`
      ${lessonHeader(lesson, guide)}
      <div class="question">
        <h3>Все слова темы</h3>
        <p class="t-muted">Нажми на карточку, чтобы услышать слово.</p>
        <div class="word-grid">
          ${words.map(w => `<button class="word-tile" data-en="${escapeHtml(w.en)}"><span class="em" aria-hidden="true">${w.emoji}</span><span class="en" lang="en">${escapeHtml(w.en)}</span><span class="ru">${escapeHtml(w.ru)}</span></button>`).join('')}
        </div>
      </div>
      <div class="controls">
        <button class="btn" id="next-vocab">📚 Проверим себя</button>
        <button class="btn secondary" id="fc-again">🔁 Смотреть снова</button>
      </div>
    `);
    document.querySelectorAll('.word-tile').forEach(t => t.onclick = () => speak(t.dataset.en));
    document.getElementById('next-vocab').onclick = () => exVocab(lesson, guide);
    document.getElementById('fc-again').onclick = () => { i = 0; render(); };
  }
}

// === Напиши: собрать слово из букв ===
export function exSpell(lesson, guide){
  const pool = lesson.words.filter(w => /^[a-z' ]+$/i.test(w.en) && w.en.replace(/[ ']/g, '').length <= 10);
  const list = shuffle(pool).slice(0, 5);
  let idx = 0, right = 0;
  render();
  function render(){
    if (idx >= list.length){
      openModal(`
        ${lessonHeader(lesson, guide)}
        <div class="question"><h3>Написано верно: ${right} из ${list.length}</h3><p>${right === list.length ? 'Ни одной ошибки — супер!' : 'Слова с ошибками попали в «Мои ошибки».'}</p></div>
        <div class="controls"><button class="btn" id="next-grammar">🧩 Дальше: грамматика</button><button class="btn secondary" id="next-close">Закрыть</button></div>
      `);
      document.getElementById('next-grammar').onclick = () => exGrammar(lesson, guide);
      document.getElementById('next-close').onclick = closeModal;
      return;
    }
    const w = list[idx];
    const target = w.en.toLowerCase();
    const letters = [...target].filter(c => /[a-z]/.test(c));
    // со 2-го полугодия (3–4 класс) добавляем две лишние буквы
    const extra = lesson.grade >= 3
      ? shuffle('abcdefghijklmnopqrstuvwxyz'.split('').filter(c => !letters.includes(c))).slice(0, 2) : [];
    const tiles = shuffle([...letters, ...extra]);
    const typed = []; // индексы плиток
    let finished = false;

    openModal(`
      ${lessonHeader(lesson, guide)}
      <div class="question">
        <span class="q-emoji">${w.emoji}</span>
        <div class="q-text pixel">Собери слово</div>
        <div class="review-hint">${escapeHtml(w.ru)}</div>
        <div class="spell-slots" id="sp-slots" lang="en" aria-live="polite"></div>
        <div class="spell-answer" id="sp-answer" hidden></div>
        <div class="spell-tiles">
          ${tiles.map((c, k) => `<button class="spell-tile" data-k="${k}" lang="en">${c}</button>`).join('')}
        </div>
        <p class="t-muted spell-kbd">Можно печатать на клавиатуре.</p>
      </div>
      <div class="controls">
        <button class="btn secondary" id="sp-hear">🔊 Услышать</button>
        <button class="btn gold" id="sp-back">⌫ Стереть</button>
        <button class="btn violet" id="sp-hint">💡 Подсказка</button>
      </div>
    `);
    const slotsEl = document.getElementById('sp-slots');
    const tileEls = [...document.querySelectorAll('.spell-tile')];

    function draw(state_){
      let li = 0;
      slotsEl.innerHTML = [...target].map(ch => {
        if (!/[a-z]/.test(ch)) return ch === ' ' ? '<span class="slot-gap"></span>' : `<span class="slot-fixed">${ch}</span>`;
        const t = typed[li++];
        return `<span class="slot-l${t !== undefined ? ' filled' : ''}${state_ ? ' ' + state_ : ''}">${t !== undefined ? tiles[t] : ''}</span>`;
      }).join('');
      slotsEl.setAttribute('aria-label', `Собрано: ${typed.map(t => tiles[t]).join('') || 'пока ничего'}`);
      tileEls.forEach((el, k) => el.disabled = finished || typed.includes(k));
    }
    function add(k){
      if (finished || typed.includes(k) || typed.length >= letters.length) return;
      typed.push(k);
      draw();
      if (typed.length === letters.length) check();
    }
    function back(){ if (!finished && typed.length){ typed.pop(); draw(); } }
    function hint(){
      if (finished) return;
      // убираем всё, начиная с первой ошибки, и ставим следующую верную букву
      let ok = 0;
      while (ok < typed.length && tiles[typed[ok]] === letters[ok]) ok++;
      typed.length = ok;
      const k = tiles.findIndex((c, j) => c === letters[ok] && !typed.includes(j));
      if (k >= 0) add(k); else draw();
    }
    function check(){
      finished = true;
      const ok = typed.map(t => tiles[t]).join('') === letters.join('');
      draw(ok ? 'ok' : 'bad');
      speak(w.en);
      if (ok){
        right++;
        reward(12, 3, { item: w.en });
        markProgress(lesson.id, 'spell');
        toast(`✅ +12 XP · ${w.en}`);
      } else {
        const ans = document.getElementById('sp-answer');
        ans.hidden = false;
        ans.textContent = `Правильно: ${w.en}`;
        recordMistake('word', lesson, w.en);
        penalty();
      }
      afterFeedback(() => { idx++; render(); }, ok ? 1100 : 2000);
    }

    tileEls.forEach((el, k) => el.onclick = () => add(k));
    document.getElementById('sp-back').onclick = back;
    document.getElementById('sp-hint').onclick = hint;
    document.getElementById('sp-hear').onclick = () => speak(w.en);
    modal.onkeydown = (e) => {
      if (e.key === 'Backspace'){ e.preventDefault(); back(); return; }
      if (/^[a-z]$/i.test(e.key)){
        const k = tiles.findIndex((c, j) => c === e.key.toLowerCase() && !typed.includes(j));
        if (k >= 0) add(k);
      }
    };
    draw();
    afterFeedback(() => speak(w.en), 350);
  }
}

// ---------- EXERCISES ----------
export function markProgress(lessonId, ex){
  const lesson = LESSONS.find(l => l.id === lessonId);
  const wasComplete = lesson && isLessonComplete(lesson);
  const p = state.lessonProgress[lessonId] || {};
  p[ex] = (p[ex]||0) + 1;
  state.lessonProgress[lessonId] = p;
  if (lesson && !wasComplete && isLessonComplete(lesson)) toast(`🔓 Тема «${lesson.title}» пройдена!`);
  checkHomework();
  // reward() сохраняет состояние раньше, чем сюда доходит упражнение, — без этого
  // последний верный ответ терялся при закрытии вкладки
  saveState();
  renderMap();
  renderHUD(); // счётчик пройденных тем 🏆
}

export function startExercise(lesson, kind){
  // intro от Dr. Harlow + гида темы
  const guide = CHARACTERS[lesson.guide] || CHARACTERS.harlow;
  const harlowLine = lessonStartLine(lesson);
  showGuide('Dr. Harlow', harlowLine, CHARACTERS.harlow);
  // Упражнения, которые сами сразу озвучивают слово, не перебиваем приветствием
  if (!['cards', 'vocab', 'listen', 'spell', 'speak'].includes(kind)) setTimeout(() => speak('Let us start!'), 400);

  switch(kind){
    case 'cards': return exCards(lesson, guide);
    case 'vocab': return exVocab(lesson, guide);
    case 'spell': return exSpell(lesson, guide);
    case 'listen': return exListen(lesson, guide);
    case 'match': return exMatch(lesson, guide);
    case 'grammar': return exGrammar(lesson, guide);
    case 'reading': return exReading(lesson, guide);
    case 'speak': return exSpeak(lesson, guide);
    case 'picture': return exPicture(lesson, guide);
    case 'fill': return exFill(lesson, guide);
  }
}

export function lessonHeader(lesson, guide, extra=''){
  return `
    <div class="lesson-title-row"><h2>${lesson.title}</h2><button class="icon-btn lesson-dict" data-open-dict title="Словарь" aria-label="Открыть словарь">📖</button></div>
    <div class="lead">${lesson.subtitle} · ${lesson.grade} класс</div>
    <div class="lead-guide">
      <div class="mini-avatar" style="background:${CHARACTERS.harlow.color}">${CHARACTERS.harlow.emoji}</div>
      <div class="txt"><strong>Dr. Harlow:</strong> ${lesson.intro}</div>
    </div>
    ${guide.id !== 'harlow' ? `
    <div class="lead-guide">
      <div class="mini-avatar" style="background:${guide.color}">${guide.emoji}</div>
      <div class="txt"><strong>${guide.name}:</strong> ${guide.role}</div>
    </div>` : ''}
    ${extra}
  `;
}


// === Vocab: emoji -> English word (4 opts) ===
export function exVocab(lesson, guide){
  let idx = 0;
  const list = shuffle(lesson.words).slice(0, 6);
  render();
  function render(){
    if (idx >= list.length){
      openModal(`
        ${lessonHeader(lesson, guide)}
        <div class="question"><h3>Отлично! Слова изучены.</h3><p>+${list.length*10} XP получено.</p></div>
        <div class="controls"><button class="btn" id="next-listen">🎧 Дальше: слушай</button><button class="btn secondary" id="next-close">Закрыть</button></div>
      `);
      document.getElementById('next-listen').onclick = () => exListen(lesson, guide);
      document.getElementById('next-close').onclick = closeModal;
      return;
    }
    const w = list[idx];
    const opts = shuffle([w, ...distractors(w, lesson.words, 3)]);
    openModal(`
      ${lessonHeader(lesson, guide)}
      <div class="question">
        <span class="q-emoji">${w.emoji}</span>
        <div class="q-text pixel">Как по-английски?</div>
        ${hasEmojiTwin(w, lesson.words) ? `<div class="review-hint">${escapeHtml(w.ru)}</div>` : ''}
        <div class="options">
          ${opts.map(o => `<button class="opt" data-en="${o.en}">${o.en}</button>`).join('')}
        </div>
      </div>
      <div class="controls">
        <button class="btn secondary" id="hear">🔊 Услышать</button>
        <button class="btn gold" id="skip">Пропустить</button>
      </div>
    `);
    document.getElementById('hear').onclick = () => speak(w.en);
    document.getElementById('skip').onclick = () => { recordMistake('word', lesson, w.en); idx++; render(); };
    document.querySelectorAll('.opt').forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.en === w.en){
          btn.classList.add('correct');
          speak(w.en);
          reward(10, 2, { item: w.en });
          markProgress(lesson.id, 'vocab');
          toast(`✅ +10 XP · ${w.en}`);
          afterFeedback(() => { idx++; render(); }, 800);
        } else {
          btn.classList.add('wrong');
          document.querySelector(`.opt[data-en="${w.en}"]`)?.classList.add('correct');
          speak(w.en);
          recordMistake('word', lesson, w.en);
          penalty();
          toast(`Правильно: ${w.en}`);
          afterFeedback(() => { idx++; render(); }, 1400);
        }
      };
    });
    // auto play the word once
    setTimeout(() => speak(w.en), 350);
  }
}

// === Listen: hear the word -> pick emoji ===
export function exListen(lesson, guide){
  let idx = 0;
  const list = shuffle(lesson.words).slice(0, 5);
  render();
  function render(){
    if (idx >= list.length){
      openModal(`
        ${lessonHeader(lesson, guide)}
        <div class="question"><h3>Great listening!</h3><p>+${list.length*12} XP.</p></div>
        <div class="controls"><button class="btn" id="next-match">🎯 Дальше: пара</button><button class="btn secondary" id="next-close">Закрыть</button></div>
      `);
      document.getElementById('next-match').onclick = () => exMatch(lesson, guide);
      document.getElementById('next-close').onclick = closeModal;
      return;
    }
    const w = list[idx];
    const opts = shuffle([w, ...distractors(w, lesson.words, 3)]);
    openModal(`
      ${lessonHeader(lesson, guide)}
      <div class="question">
        <div class="q-listen-icon" aria-hidden="true">🔊</div>
        <div class="q-text pixel">Слушай и выбирай картинку</div>
        <div class="options">
          ${opts.map(o => `<button class="opt opt-emoji" data-en="${o.en}">${o.emoji}</button>`).join('')}
        </div>
      </div>
      <div class="controls">
        <button class="btn secondary" id="hear">🔊 Повторить</button>
      </div>
    `);
    document.getElementById('hear').onclick = () => speak(w.en);
    document.querySelectorAll('.opt').forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.en === w.en){
          btn.classList.add('correct');
          reward(12, 2, { item: w.en });
          markProgress(lesson.id, 'listen');
          toast(`✅ +12 XP`);
          afterFeedback(() => { idx++; render(); }, 700);
        } else {
          btn.classList.add('wrong');
          document.querySelector(`.opt[data-en="${w.en}"]`)?.classList.add('correct');
          recordMistake('word', lesson, w.en);
          penalty();
          afterFeedback(() => { idx++; render(); }, 1200);
        }
      };
    });
    setTimeout(() => speak(w.en), 350);
  }
}

// === Match: two columns (word ↔ emoji) ===
export function exMatch(lesson, guide){
  const pairs = uniqueByEmoji(shuffle(lesson.words)).slice(0, 6);
  const left = shuffle(pairs.map(p => ({key:p.en, label:p.en, kind:'en'})));
  const right = shuffle(pairs.map(p => ({key:p.en, label:p.emoji, kind:'em'})));
  let selL = null, selR = null, doneCount = 0;
  openModal(`
    ${lessonHeader(lesson, guide)}
    <div class="q-text pixel q-lead">Собери пары: слово ↔ картинка</div>
    <div class="match-grid">
      <div class="match-col" id="col-l">${left.map(x=>`<button type="button" class="match-item" data-k="${x.key}" data-side="l" aria-pressed="false">${x.label}</button>`).join('')}</div>
      <div class="match-col" id="col-r">${right.map(x=>`<button type="button" class="match-item match-emoji" data-k="${x.key}" data-side="r" aria-pressed="false" aria-label="${x.key}">${x.label}</button>`).join('')}</div>
    </div>
    <div class="controls"><button class="btn secondary" id="close-match">Закрыть</button></div>
  `);
  document.getElementById('close-match').onclick = closeModal;
  document.querySelectorAll('.match-item').forEach(el => {
    el.onclick = () => {
      if (el.classList.contains('done')) return;
      if (el.dataset.side === 'l'){
        document.querySelectorAll('.match-item[data-side="l"]').forEach(x=>{ x.classList.remove('sel'); x.setAttribute('aria-pressed','false'); });
        el.classList.add('sel'); selL = el;
      } else {
        document.querySelectorAll('.match-item[data-side="r"]').forEach(x=>{ x.classList.remove('sel'); x.setAttribute('aria-pressed','false'); });
        el.classList.add('sel'); selR = el;
      }
      el.setAttribute('aria-pressed','true');
      if (selL && selR){
        if (selL.dataset.k === selR.dataset.k){
          selL.classList.add('done'); selR.classList.add('done');
          selL.classList.remove('sel'); selR.classList.remove('sel');
          // фокус уходит с исчезающей кнопки — переводим его на следующую свободную
          const nextFree = [...document.querySelectorAll('.match-item:not(.done)')][0];
          if (nextFree) nextFree.focus();
          selL.disabled = true; selR.disabled = true;
          reward(14, 3, { item: selL.dataset.k });
          markProgress(lesson.id, 'match');
          speak(selL.dataset.k);
          doneCount++;
          if (doneCount === pairs.length){
            toast('🎉 Все пары собраны!');
            afterFeedback(() => {
              openModal(`
                ${lessonHeader(lesson, guide)}
                <div class="question"><h3>Все пары собраны! 🎯</h3></div>
                <div class="controls"><button class="btn" id="next-spell">✍️ Дальше: напиши</button><button class="btn secondary" id="next-close">Закрыть</button></div>
              `);
              document.getElementById('next-spell').onclick = () => exSpell(lesson, guide);
              document.getElementById('next-close').onclick = closeModal;
            }, 1200);
          }
        } else {
          selL.classList.add('wrong'); selR.classList.add('wrong');
          // перепутаны оба слова: и то, что выбрали слева, и то, чья картинка справа
          recordMistake('word', lesson, selL.dataset.k);
          recordMistake('word', lesson, selR.dataset.k);
          penalty();
          const l = selL, r = selR;
          setTimeout(() => {
            l.classList.remove('wrong','sel'); r.classList.remove('wrong','sel');
            l.setAttribute('aria-pressed','false'); r.setAttribute('aria-pressed','false');
          }, 700);
        }
        selL = null; selR = null;
      }
    };
  });
}

// === Grammar: fill in blank ===
export function exGrammar(lesson, guide){
  let idx = 0;
  const list = shuffle(lesson.grammar);
  render();
  function render(){
    if (idx >= list.length){
      openModal(`
        ${lessonHeader(lesson, guide)}
        <div class="question"><h3>Grammar power! 💪</h3><p>Prof. Owl гордится тобой.</p></div>
        <div class="controls"><button class="btn" id="next-read">📖 Дальше: чтение</button><button class="btn secondary" id="next-close">Закрыть</button></div>
      `);
      document.getElementById('next-read').onclick = () => exReading(lesson, guide);
      document.getElementById('next-close').onclick = closeModal;
      return;
    }
    const q = list[idx];
    const opts = shuffle(q.options);
    openModal(`
      ${lessonHeader(lesson, guide)}
      <div class="question">
        <div class="q-text pixel">Выбери правильный вариант</div>
        <div class="q-text q-sentence">${q.q}</div>
        <div class="q-hint">💡 ${q.hint}</div>
        <div class="options q-options-gap">
          ${opts.map(o => `<button class="opt" data-o="${o}">${o}</button>`).join('')}
        </div>
      </div>
    `);
    document.querySelectorAll('.opt').forEach(btn => {
      btn.onclick = () => {
        logSkill(q, btn.dataset.o === q.a, btn.dataset.o);
        if (btn.dataset.o === q.a){
          btn.classList.add('correct');
          reward(15, 3);
          markProgress(lesson.id, 'grammar');
          speak(q.q.replace('___', q.a));
          toast('✅ +15 XP');
          afterFeedback(() => { idx++; render(); }, 900);
        } else {
          btn.classList.add('wrong');
          document.querySelector(`.opt[data-o="${q.a}"]`)?.classList.add('correct');
          recordMistake('grammar', lesson, q.q);
          penalty();
          afterFeedback(() => { idx++; render(); }, 1400);
        }
      };
    });
  }
}

// === Вставь слово (тип 3-A): фраза урока с пропуском, подсказка — перевод, варианты — слова урока ===
export function exFill(lesson, guide){
  const list = shuffle(fillItemsFor(lesson)).slice(0, 5);
  let idx = 0, right = 0;
  render();
  function render(){
    if (idx >= list.length){
      openModal(`
        ${lessonHeader(lesson, guide)}
        <div class="question"><h3>Верно: ${right} из ${list.length} 🔤</h3><p>${right === list.length ? 'Все слова на своих местах!' : 'Слова с ошибками попали в «Мои ошибки».'}</p></div>
        <div class="controls"><button class="btn secondary" id="next-close">Закрыть</button></div>
      `);
      document.getElementById('next-close').onclick = closeModal;
      return;
    }
    const it = list[idx];
    const opts = shuffle([it.a, ...shuffle(it.others).slice(0, 3)]);
    openModal(`
      ${lessonHeader(lesson, guide)}
      <div class="question">
        <div class="q-text pixel">Вставь слово</div>
        <div class="q-text q-sentence">${escapeHtml(it.q)}</div>
        <div class="q-hint">💡 ${escapeHtml(it.hint)}</div>
        <div class="options q-options-gap">
          ${opts.map(o => `<button class="opt" data-o="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('')}
        </div>
      </div>
    `);
    document.querySelectorAll('.opt').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.opt').forEach(b => b.disabled = true);
        const ok = btn.dataset.o === it.a;
        if (ok){ btn.classList.add('correct'); right++; reward(10, 2); markProgress(lesson.id, 'fill'); }
        else {
          btn.classList.add('wrong');
          document.querySelector(`.opt[data-o="${CSS.escape(it.a)}"]`)?.classList.add('correct');
          recordMistake('word', lesson, it.word);
          penalty();
        }
        speak(it.q.replace('___', it.a));
        afterFeedback(() => { idx++; render(); }, ok ? 1200 : 1800);
      };
    });
  }
}

// === Что на картинке? (тип 2-E): картинка и две короткие фразы — выбрать верную ===
// pics: [{ emoji, right, wrong, word?, skill? }] — word: слово урока для «Моих ошибок», skill: навык грамматики
export function exPicture(lesson, guide){
  const list = shuffle(lesson.pics || []).slice(0, 5);
  let idx = 0, right = 0;
  render();
  function render(){
    if (idx >= list.length){
      openModal(`
        ${lessonHeader(lesson, guide)}
        <div class="question"><h3>Верно: ${right} из ${list.length} 🖼️</h3><p>${right === list.length ? 'Ты всё понял(а) по картинкам!' : 'Ошибки попали в «Мои ошибки» — повторим.'}</p></div>
        <div class="controls"><button class="btn secondary" id="next-close">Закрыть</button></div>
      `);
      document.getElementById('next-close').onclick = closeModal;
      return;
    }
    const it = list[idx];
    const opts = shuffle([it.right, it.wrong]);
    openModal(`
      ${lessonHeader(lesson, guide)}
      <div class="question">
        <div class="q-text pixel">Что на картинке?</div>
        <div class="pic-emoji" aria-hidden="true">${it.emoji}</div>
        <div class="options pic-options">
          ${opts.map(o => `<button class="opt" data-o="${escapeHtml(o)}">${escapeHtml(o)}</button>`).join('')}
        </div>
      </div>
    `);
    document.querySelectorAll('.opt').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.opt').forEach(b => b.disabled = true);
        const ok = btn.dataset.o === it.right;
        logSkill(it, ok, btn.dataset.o);
        if (ok){
          btn.classList.add('correct');
          right++;
          reward(10, 2);
          markProgress(lesson.id, 'picture');
        } else {
          btn.classList.add('wrong');
          document.querySelector(`.opt[data-o="${CSS.escape(it.right)}"]`)?.classList.add('correct');
          if (it.word && lesson.words.some(w => w.en === it.word)) recordMistake('word', lesson, it.word);
          penalty();
        }
        speak(it.right);
        afterFeedback(() => { idx++; render(); }, ok ? 1200 : 1800);
      };
    });
  }
}

// === Reading: passage + 2-3 comprehension Q ===
export function exReading(lesson, guide){
  const r = lesson.reading;
  let idx = 0;
  openModal(`
    ${lessonHeader(lesson, guide)}
    <div class="question">
      <h3>${r.title}</h3>
      <p class="reading-text">${r.text}</p>
      <div class="controls">
        <button class="btn secondary" id="read-tts">🔊 Прочитать вслух</button>
        <button class="btn" id="read-start">➡️ К вопросам</button>
      </div>
    </div>
  `);
  document.getElementById('read-tts').onclick = () => speak(r.text);
  document.getElementById('read-start').onclick = renderQ;

  function renderQ(){
    if (idx >= r.questions.length){
      reward(20, 5, { bonus: true });
      markProgress(lesson.id, 'reading');
      toast('📖 +20 XP');
      openModal(`
        ${lessonHeader(lesson, guide)}
        <div class="question"><h3>Прочитано!</h3><p>+20 XP за понимание текста.</p></div>
        <div class="controls"><button class="btn" id="next-speak">🎤 Дальше: говори</button><button class="btn secondary" id="next-close">Закрыть</button></div>
      `);
      document.getElementById('next-speak').onclick = () => exSpeak(lesson, guide);
      document.getElementById('next-close').onclick = closeModal;
      return;
    }
    const q = r.questions[idx];
    const opts = shuffle(q.options);
    openModal(`
      ${lessonHeader(lesson, guide)}
      <div class="question">
        <div class="q-text q-question">${q.q}</div>
        <div class="options">
          ${opts.map(o => `<button class="opt" data-o="${o}">${o}</button>`).join('')}
        </div>
      </div>
    `);
    document.querySelectorAll('.opt').forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.o === q.a){
          btn.classList.add('correct');
          logAnswer(true);
          toast('✅');
          afterFeedback(() => { idx++; renderQ(); }, 700);
        } else {
          btn.classList.add('wrong');
          document.querySelector(`.opt[data-o="${q.a}"]`)?.classList.add('correct');
          recordMistake('reading', lesson, q.q);
          penalty();
          afterFeedback(() => { idx++; renderQ(); }, 1200);
        }
      };
    });
  }
}

// Fallback: word-by-word translation from lesson vocab
export function translateFromWords(phrase, lesson){
  if (!lesson || !lesson.words) return '(перевод не найден)';
  const dict = {};
  for (const w of lesson.words){ if (w.en && w.ru) dict[w.en.toLowerCase()] = w.ru; }
  const parts = phrase.split(/\s+/).map(tok => {
    const clean = tok.toLowerCase().replace(/[.,!?"'’]/g,'');
    return dict[clean] ? `${tok} (${dict[clean]})` : tok;
  });
  return parts.join(' ');
}

// === Говори: повторить фразу, распознавание речи браузера ===
// Сравнение — в speech.js (цифры, сокращения, британское/американское, порядок слов).
// Без штрафа: можно пробовать снова; после MAX_TRIES неудач — «Засчитать».
const MAX_TRIES = 3, SILENCE_MS = 1800, MAX_LISTEN_MS = 12000;
const SPEECH_ERRORS = {
  'not-allowed': 'Нет доступа к микрофону. Разреши микрофон для этого сайта: значок 🔒 или «аА» рядом с адресом → Микрофон → Разрешить. На iPad: Настройки → Safari → Микрофон.',
  'service-not-allowed': 'Браузер не разрешил распознавание речи. Попробуй открыть сайт в Chrome или Safari.',
  'no-speech': 'Я ничего не услышал. Нажми 🎤 и говори погромче.',
  'audio-capture': 'Микрофон не найден. Проверь, что он подключён и не занят другой программой.',
  'network': 'Для распознавания речи нужен интернет. Можно повторить фразу вслух и нажать «Я сказал(а)».',
};

export function exSpeak(lesson, guide){
  let idx = 0;
  const list = shuffle(lesson.phrases);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  render();
  function render(){
    if (idx >= list.length){
      openModal(`
        ${lessonHeader(lesson, guide)}
        <div class="question"><h3>Great speaking! 🎤</h3><p>DJ Robo проверил — звучишь отлично.</p></div>
        <div class="controls"><button class="btn secondary" id="close-btn">Закрыть</button></div>
      `);
      document.getElementById('close-btn').onclick = closeModal;
      return;
    }
    const phrase = list[idx];
    const ruTr = (window.EQ_TRANSLATIONS && window.EQ_TRANSLATIONS[phrase]) || translateFromWords(phrase, lesson);
    let tries = 0, done = false;
    openModal(`
      ${lessonHeader(lesson, guide)}
      <div class="question">
        <div class="q-text pixel">Повтори за DJ Robo</div>
        <div class="q-text speak-phrase" id="speak-words" lang="en">
          ${phraseWords(phrase).map((w, i) => `<span class="sw" data-i="${i}">${escapeHtml(w.raw)}</span>`).join(' ')}
        </div>
        <div class="speak-translation">🇷🇺 ${escapeHtml(ruTr)}</div>
        <div class="q-hint" id="speak-hint">${SR ? 'Нажми на микрофон и произнеси фразу' : 'Этот браузер не умеет распознавать речь (например, Firefox). Повтори фразу вслух и нажми «Я сказал(а)» — или открой сайт в Chrome или Safari.'}</div>
        ${SR ? '<button class="mic-btn" id="mic" aria-label="Начать запись">🎤</button>' : ''}
        <div id="rec-live" class="rec-live" aria-live="polite"></div>
        <div id="rec-result" class="rec-result" role="status"></div>
      </div>
      <div class="controls">
        <button class="btn secondary" id="hear">🔊 Услышать снова</button>
        <button class="btn" id="self-ok" ${SR ? 'hidden' : ''}>${SR ? '✅ Засчитать' : '✅ Я сказал(а)'}</button>
        <button class="btn gold" id="skip">Пропустить</button>
      </div>
    `);
    const resEl = document.getElementById('rec-result'), liveEl = document.getElementById('rec-live');
    const selfOk = document.getElementById('self-ok');
    document.getElementById('hear').onclick = () => speak(phrase);
    document.getElementById('skip').onclick = () => { idx++; render(); };
    // засчитать без распознавания: браузер не умеет, нет интернета или 3 неудачи подряд
    selfOk.onclick = () => {
      if (done) return;
      done = true;
      reward(8, 2);
      markProgress(lesson.id, 'speak');
      toast('✅ +8 XP');
      afterFeedback(() => { idx++; render(); }, 700);
    };
    afterFeedback(() => speak(phrase), 400);
    if (!SR) return;

    const mic = document.getElementById('mic');
    let rec = null;
    const paint = (words) => document.querySelectorAll('#speak-words .sw').forEach((el, i) => {
      const ok = words[i]?.ok;
      el.classList.toggle('ok', !!ok);
      el.classList.toggle('miss', !ok);
      if (!ok){
        el.setAttribute('role', 'button'); el.tabIndex = 0;
        el.title = 'Нажми, чтобы послушать';
        el.onclick = el.onkeydown = (e) => { if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return; e.preventDefault?.(); speakWordOrPhrase(el.textContent, phrase); };
      } else { el.removeAttribute('role'); el.removeAttribute('tabindex'); el.onclick = el.onkeydown = null; el.title = ''; }
    });

    mic.onclick = () => {
      if (done) return;
      if (rec){ rec.stop(); return; }                 // повторное нажатие — закончить запись
      stopSpeech();
      let finals = [], silence = null, hardStop = null, errored = false;
      try {
        rec = new SR();
        rec.lang = 'en-US';
        rec.interimResults = true;
        rec.continuous = true;                        // не обрывать на первой паузе
        rec.maxAlternatives = 5;                      // выбрать вариант, который лучше совпадает
      } catch (e){ resEl.textContent = 'Не удалось запустить распознавание.'; rec = null; return; }
      const stop = () => { try { rec && rec.stop(); } catch (e) {} };
      mic.classList.add('rec');
      mic.setAttribute('aria-label', 'Закончить запись');
      resEl.textContent = '';
      liveEl.textContent = 'Слушаю…';
      rec.onresult = (e) => {
        finals = Array.from(e.results).filter(r => r.isFinal);
        liveEl.textContent = 'Слышу: ' + Array.from(e.results).map(r => r[0].transcript).join(' ');
        clearTimeout(silence);
        silence = setTimeout(stop, SILENCE_MS);         // замолчал — заканчиваем
      };
      rec.onerror = (e) => {
        errored = true;
        if (e.error === 'aborted') return;
        resEl.textContent = SPEECH_ERRORS[e.error] || 'Не получилось распознать. Попробуй ещё раз.';
        if (e.error === 'network' || e.error === 'not-allowed' || e.error === 'service-not-allowed') selfOk.hidden = false;
      };
      rec.onend = () => {
        clearTimeout(silence); clearTimeout(hardStop);
        mic.classList.remove('rec');
        mic.setAttribute('aria-label', 'Начать запись');
        rec = null;
        liveEl.textContent = '';
        if (done) return;
        const cands = candidatesFromResults(finals);
        if (!cands.length){ if (!errored) resEl.textContent = SPEECH_ERRORS['no-speech']; return; }
        const r = scoreSpeech(phrase, cands);
        paint(r.words);
        tries++;
        if (r.score >= PASS_SCORE){
          done = true;
          resEl.innerHTML = `Ты сказал: <em>«${escapeHtml(r.said)}»</em> · <b>${r.score}%</b> ${r.score === 100 ? '🌟' : '✅'}`;
          reward(18, 4);
          markProgress(lesson.id, 'speak');
          toast(`✅ +18 XP · ${r.score}%`);
          afterFeedback(() => { idx++; render(); }, 1600);
        } else {
          logAnswer(false);                           // для статистики; без штрафа
          resEl.innerHTML = `Ты сказал: <em>«${escapeHtml(r.said)}»</em> · <b>${r.score}%</b>. Почти! Красные слова можно послушать — нажми на них и попробуй ещё раз.`;
          if (tries >= MAX_TRIES) selfOk.hidden = false;
        }
      };
      try { rec.start(); } catch (e){ mic.classList.remove('rec'); rec = null; resEl.textContent = 'Не удалось запустить распознавание.'; return; }
      hardStop = setTimeout(stop, MAX_LISTEN_MS);
      silence = setTimeout(stop, SILENCE_MS + 4000); // если так и не начал говорить
    };
  }
}
