// English Quest — app engine v2
// State + persistence + exercises + guide + TTS + speech recognition

(function(){
  const { CHARACTERS, LESSONS, MAX_LEVEL, xpForLevel, totalXpForLevel, levelFromXp, RANKS, rankFor, HARLOW_LINES } = window.EQ;

  // ---------- STATE ----------
  const DEFAULT_STATE = {
    xp: 0, gold: 0, hearts: 5, streak: 0,
    inventory: {},   // { en: count }
    lessonProgress: {}, // { lessonId: { vocab: n, reading: 0/1, grammar: n, listen: n, speak: n, match: n } }
    mistakes: {},    // { 'type:lessonId:ref': { type, lessonId, ref, box, due, wrong, last } } — см. «Мои ошибки»
    mastered: 0,     // сколько ошибок выучено до конца
    activity: {},    // { 'YYYY-MM-DD': { sec, ok, bad } } — для режима репетитора
    lessonWrong: {}, // { lessonId: число ошибок за всё время }
    homework: null,  // текущее домашнее задание, см. makeHomework()
    settings: { theme: 'light', speechRate: 0.9 },
    version: 2,
  };
  let state = null;
  // Глубокая копия: иначе вложенные объекты (inventory, mistakes) общие с DEFAULT_STATE и переживают сброс
  function freshState(){ return JSON.parse(JSON.stringify(DEFAULT_STATE)); }

  // ---------- SAVE / LOAD (browser storage + IDB fallback + in-memory) ----------
  // NOTE: preview iframe blocks web storage APIs. All calls go through window[...]
  // and try/catch so preview falls back to in-memory silently.
  const STORE_KEY = 'english_quest_v2';
  const IDB_NAME = 'EnglishQuest';
  const IDB_STORE = 'state';
  let idbReady = false;
  let memoryStore = null;

  function getLS(){ try { return window['local' + 'Storage']; } catch(e){ return null; } }
  function getIDB(){ try { return window['index' + 'edDB']; } catch(e){ return null; } }

  function openIDB(){
    return new Promise((resolve, reject) => {
      const idb = getIDB();
      if (!idb) return reject('no-idb');
      try {
        const req = idb.open(IDB_NAME, 1);
        req.onupgradeneeded = () => { req.result.createObjectStore(IDB_STORE); };
        req.onsuccess = () => { idbReady = true; resolve(req.result); };
        req.onerror = () => reject(req.error);
      } catch(e){ reject(e); }
    });
  }

  async function loadState(){
    // 1) try browser storage
    try {
      const ls = getLS();
      if (ls) {
        const raw = ls.getItem(STORE_KEY);
        if (raw) return { ...freshState(), ...JSON.parse(raw) };
      }
    } catch(e){}
    // 2) try IDB
    try {
      const db = await openIDB();
      return await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get('state');
        req.onsuccess = () => resolve(req.result ? { ...freshState(), ...req.result } : freshState());
        req.onerror = () => resolve(freshState());
      });
    } catch(e){}
    // 3) in-memory
    if (memoryStore) return { ...freshState(), ...memoryStore };
    return freshState();
  }

  async function saveState(){
    memoryStore = JSON.parse(JSON.stringify(state));
    try {
      const ls = getLS();
      if (ls) ls.setItem(STORE_KEY, JSON.stringify(state));
    } catch(e){}
    try {
      if (!idbReady) await openIDB();
      const db = await openIDB();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(state, 'state');
    } catch(e){}
  }

  // ---------- HUD RENDER ----------
  function renderHUD(){
    document.getElementById('stat-xp').textContent = state.xp;
    document.getElementById('stat-gold').textContent = state.gold;
    document.getElementById('stat-hearts').textContent = '❤️'.repeat(Math.max(0, state.hearts)) + '🖤'.repeat(Math.max(0, 5 - state.hearts));
    document.getElementById('stat-streak').textContent = state.streak;
    // level
    const lvl = levelFromXp(state.xp);
    const nextTotal = totalXpForLevel(lvl+1);
    const currentTotal = totalXpForLevel(lvl);
    const need = nextTotal - currentTotal;
    const got = state.xp - currentTotal;
    const pct = Math.min(100, Math.floor(got * 100 / need));
    document.getElementById('level-badge').textContent = 'L' + lvl;
    const rk = rankFor(lvl);
    document.getElementById('rank-title').textContent = `${rk.emoji} ${rk.title}`;
    document.getElementById('rank-title').style.setProperty('--rank-color', rk.color);
    document.getElementById('level-progress').style.width = pct + '%';
    document.getElementById('xp-text').textContent = lvl >= MAX_LEVEL
      ? `Максимум! ${state.xp} XP`
      : `${got} / ${need} XP до уровня ${lvl+1}`;
    // quests
    const completed = LESSONS.filter(l => isLessonComplete(l)).length;
    document.getElementById('stat-quests').textContent = completed;
  }

  function isLessonComplete(l){
    const p = state.lessonProgress[l.id];
    if (!p) return false;
    return (p.vocab||0) >= 3 && (p.listen||0) >= 3 && (p.grammar||0) >= 2 && (p.reading||0) >= 1;
  }

  // ---------- TEAM ----------
  function renderTeam(){
    const container = document.getElementById('team');
    container.innerHTML = '';
    Object.values(CHARACTERS).forEach(c => {
      const card = document.createElement('div');
      card.className = 'char-card';
      card.innerHTML = `
        <div class="char-avatar" style="background:${c.color}">
          <span>${c.emoji}</span>
          <span class="avatar-plate"></span>
        </div>
        <div class="char-name">${c.name}</div>
        <div class="char-sub">${c.subtitle}</div>
        <div class="char-role">${c.role}</div>
      `;
      card.addEventListener('click', () => {
        const line = c.id === 'harlow'
          ? 'Я поведу тебя через все уроки. Нажми на любой урок ниже.'
          : `Я помогаю с темой «${c.subtitle}». Открой соответствующий урок!`;
        showGuide(c.name, line, c);
        speak(c.id === 'harlow' ? 'Hi, I am Doctor Harlow. Let us learn English.' : `I am ${c.name}. Nice to meet you.`);
      });
      container.appendChild(card);
    });
  }

  // ---------- LESSONS ----------
  let currentGrade = 'all';
  function renderLessons(){
    const wrap = document.getElementById('lessons');
    wrap.innerHTML = '';
    const list = currentGrade === 'all' ? LESSONS : LESSONS.filter(l => l.grade === +currentGrade);
    list.forEach(l => {
      const p = state.lessonProgress[l.id] || {};
      const total = 5;
      const doneN = (p.vocab? 1:0) + (p.listen? 1:0) + (p.grammar? 1:0) + (p.reading? 1:0) + (p.match? 1:0);
      const pct = Math.round(doneN * 100 / total);
      const guide = CHARACTERS[l.guide] || CHARACTERS.harlow;
      const iconEm = l.words[0]?.emoji || '📘';
      const card = document.createElement('div');
      card.className = 'lesson-card';
      card.innerHTML = `
        <span class="badge-grade">${l.grade} кл</span>
        <span class="lesson-icon">${iconEm}</span>
        <div class="title">${l.title}</div>
        <div class="subtitle">${l.subtitle} · ${guide.emoji} ${guide.name}</div>
        <div class="completion"><span style="width:${pct}%"></span></div>
        <div class="actions">
          <button class="mini" data-ex="vocab">📚 Слова</button>
          <button class="mini" data-ex="listen">🎧 Слушай</button>
          <button class="mini" data-ex="match">🎯 Пара</button>
          <button class="mini" data-ex="grammar">🧩 Грам.</button>
          <button class="mini" data-ex="reading">📖 Читать</button>
          <button class="mini" data-ex="speak">🎤 Говори</button>
        </div>
      `;
      card.querySelectorAll('.mini').forEach(b => {
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          startExercise(l, b.dataset.ex);
        });
      });
      card.tabIndex = 0;
      card.setAttribute('aria-label', `${l.title} — открыть урок`);
      card.addEventListener('click', () => startExercise(l, 'vocab'));
      card.addEventListener('keydown', (e) => {
        if (e.target === card && (e.key === 'Enter' || e.key === ' ')){
          e.preventDefault();
          startExercise(l, 'vocab');
        }
      });
      wrap.appendChild(card);
    });
  }

  document.querySelectorAll('#grade-tabs .tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('#grade-tabs .tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      currentGrade = t.dataset.grade;
      renderLessons();
    });
  });

  // ---------- INVENTORY ----------
  function renderInventory(){
    const inv = document.getElementById('inv');
    inv.innerHTML = '';
    const items = Object.entries(state.inventory).slice(0, 48);
    const totalSlots = Math.max(24, Math.ceil((items.length + 4) / 8) * 8);
    for (let i=0;i<totalSlots;i++){
      const slot = document.createElement('div');
      slot.className = 'slot';
      if (items[i]){
        const [word, count] = items[i];
        // find emoji from any lesson
        let em = '📦';
        for (const l of LESSONS) {
          const w = l.words.find(w => w.en === word);
          if (w){ em = w.emoji; break; }
        }
        slot.innerHTML = `${em}<span class="count">${count}</span>`;
        slot.title = `${word}: ${count}`;
      } else {
        slot.classList.add('empty');
      }
      inv.appendChild(slot);
    }
  }

  function addItem(word, n=1){
    state.inventory[word] = (state.inventory[word] || 0) + n;
  }

  // ---------- TOAST / CONFETTI ----------
  function toast(msg){
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }
  function confetti(){
    const wrap = document.createElement('div');
    wrap.className = 'confetti-wrap';
    const colors = ['#3fb650','#3a9fe0','#f5c02b','#ff7bb0','#a870ff','#ff6b3a'];
    for (let i=0;i<60;i++){
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.left = Math.random()*100 + '%';
      p.style.background = colors[i%colors.length];
      p.style.animationDuration = (2 + Math.random()*2) + 's';
      p.style.animationDelay = (Math.random()*0.3) + 's';
      p.style.transform = `rotate(${Math.random()*360}deg)`;
      wrap.appendChild(p);
    }
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 4000);
  }

  // ---------- REWARD ----------
  function reward(xp, gold, opts={}){
    if (!opts.bonus) logAnswer(true);
    const prevLvl = levelFromXp(state.xp);
    state.xp += xp;
    state.gold += gold;
    state.streak += 1;
    if (opts.item) addItem(opts.item, 1);
    const newLvl = levelFromXp(state.xp);
    if (newLvl > prevLvl){
      confetti();
      const rk = rankFor(newLvl);
      toast(`🎉 Level ${newLvl}! ${rk.title}`);
      speak(`Level ${newLvl}!`);
      showGuide('Dr. Harlow', pick(HARLOW_LINES.levelUp), CHARACTERS.harlow);
    }
    saveState();
    renderHUD();
    renderInventory();
  }
  function penalty(){
    logAnswer(false);
    state.hearts = Math.max(0, state.hearts - 1);
    state.streak = 0;
    if (state.hearts === 0){
      toast('Сердечки восстанавливаются…');
      state.hearts = 5;
    }
    saveState();
    renderHUD();
  }

  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

  // ---------- МОИ ОШИБКИ (интервальное повторение) ----------
  // Каждая ошибка — карточка в «коробке» 0..3. Верный ответ при повторении двигает её дальше,
  // и она возвращается через 1, 3 и 7 дней. После верного ответа в последней коробке — выучено.
  // Неверный ответ возвращает карточку в коробку 0 (можно повторять сразу).
  const REVIEW_INTERVALS = [0, 1, 3, 7]; // дней до повторения для коробки 0..3
  const REVIEW_SESSION_SIZE = 10;
  const DAY = 86400000;

  function startOfDay(t){ const d = new Date(t); d.setHours(0,0,0,0); return d.getTime(); }
  function dueFor(box){ return box === 0 ? Date.now() : startOfDay(Date.now()) + REVIEW_INTERVALS[box] * DAY; }

  function recordMistake(type, lesson, ref){
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
  function resolveMistake(m){
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

  function mistakeEntries(){
    return Object.entries(state.mistakes)
      .map(([key, m]) => ({ key, m, data: resolveMistake(m) }))
      .filter(x => x.data);
  }

  function daysLabel(due){
    const d = Math.round((startOfDay(due) - startOfDay(Date.now())) / DAY);
    if (d <= 0) return 'сегодня';
    if (d === 1) return 'завтра';
    const n = d % 10, nn = d % 100;
    const word = (n === 1 && nn !== 11) ? 'день' : (n >= 2 && n <= 4 && (nn < 12 || nn > 14)) ? 'дня' : 'дней';
    return `через ${d} ${word}`;
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderMistakes(){
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

  function startReview(){
    const now = Date.now();
    const queue = shuffle(mistakeEntries().filter(x => x.m.due <= now)).slice(0, REVIEW_SESSION_SIZE);
    if (!queue.length) return;
    let idx = 0, right = 0;
    const header = `
      <h2>Мои ошибки</h2>
      <div class="lead">Повторяем то, что было трудно. Сердечки здесь не тратятся.</div>`;
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
        const pool = shuffle(data.lesson.words.filter(x => x.en !== data.word.en)).slice(0, 3);
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
          <div class="q-text review-sentence">${escapeHtml(data.q.q)}</div>
          <div class="review-hint">💡 ${escapeHtml(data.q.hint)}</div>`;
      } else {
        options = shuffle(data.q.options);
        answer = data.q.a;
        body = `
          <p class="review-passage">${escapeHtml(data.reading.text)}</p>
          <div class="q-text review-sentence">${escapeHtml(data.q.q)}</div>`;
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


  // ---------- АКТИВНОСТЬ (для режима репетитора) ----------
  // По дням: секунды занятий и ответы. Время считаем только пока открыт урок/повторение
  // и ребёнок что-то нажимал за последние 90 секунд — чтобы открытая вкладка не «накручивала» минуты.
  const ACTIVITY_TICK = 5; // сек
  let lastInteraction = 0;
  ['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, () => { lastInteraction = Date.now(); }, { passive: true, capture: true }));

  function dayKey(t = Date.now()){
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function todayActivity(){
    const k = dayKey();
    return state.activity[k] || (state.activity[k] = { sec: 0, ok: 0, bad: 0 });
  }
  function logAnswer(ok){ todayActivity()[ok ? 'ok' : 'bad'] += 1; }

  let _ticks = 0;
  setInterval(() => {
    if (!state) return;
    const practising = document.getElementById('modal-back').classList.contains('open')
      && document.visibilityState === 'visible'
      && Date.now() - lastInteraction < 90000;
    if (!practising) return;
    todayActivity().sec += ACTIVITY_TICK;
    if (++_ticks % 6 === 0) saveState(); // раз в ~30 с
  }, ACTIVITY_TICK * 1000);

  // ---------- ДОМАШНЕЕ ЗАДАНИЕ ----------
  const EX_NAMES = { vocab: '📚 Слова', listen: '🎧 Слушай', match: '🎯 Пара', grammar: '🧩 Грамматика', reading: '📖 Чтение', speak: '🎤 Говори' };
  const EX_ORDER = Object.keys(EX_NAMES);

  function parseDay(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d).getTime(); }
  function fmtDay(s){ const d = new Date(parseDay(s)); return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`; }
  function dueLabel(s){
    if (!s) return '';
    if (parseDay(s) < startOfDay(Date.now())) return `срок был ${fmtDay(s)}`;
    return `сдать ${daysLabel(parseDay(s))} (${fmtDay(s)})`;
  }

  function makeHomework({ lessonId, tasks, due, note }){
    return {
      id: [lessonId, tasks.join(','), due || '', note || ''].join('|'),
      lessonId, tasks, due: due || '', note: note || '',
      assigned: Date.now(),
      // что уже было сделано до задания — считаем только новые прохождения
      baseline: Object.fromEntries(tasks.map(ex => [ex, state.lessonProgress[lessonId]?.[ex] || 0])),
      doneAt: null,
    };
  }
  function homeworkTaskDone(hw, ex){ return (state.lessonProgress[hw.lessonId]?.[ex] || 0) > (hw.baseline[ex] || 0); }

  function assignHomework(spec){
    const lesson = LESSONS.find(l => l.id === spec.lessonId);
    const tasks = (spec.tasks || []).filter(ex => EX_NAMES[ex]);
    if (!lesson || !tasks.length) return false;
    const hw = makeHomework({ ...spec, tasks });
    if (state.homework && state.homework.id === hw.id) return 'same';
    state.homework = hw;
    saveState();
    renderHomework();
    return true;
  }

  function homeworkLink(spec){
    const p = new URLSearchParams({ lesson: spec.lessonId, tasks: spec.tasks.join(',') });
    if (spec.due) p.set('due', spec.due);
    if (spec.note) p.set('note', spec.note);
    return location.href.split('#')[0] + '#hw&' + p.toString();
  }

  // Ссылка вида index.html#hw&lesson=g2-hello&tasks=vocab,listen&due=2026-10-01&note=...
  function applyHomeworkFromHash(){
    if (!location.hash.startsWith('#hw')) return;
    const p = new URLSearchParams(location.hash.slice(1).replace(/^hw&?/, ''));
    const due = p.get('due');
    const res = assignHomework({
      lessonId: p.get('lesson'),
      tasks: (p.get('tasks') || '').split(','),
      due: /^\d{4}-\d{2}-\d{2}$/.test(due || '') ? due : '',
      note: (p.get('note') || '').slice(0, 300),
    });
    history.replaceState(null, '', location.pathname + location.search);
    if (res === true){
      toast('📬 Новое домашнее задание!');
      setTimeout(() => document.getElementById('homework-sec')?.scrollIntoView({ behavior: 'smooth' }), 400);
    } else if (res === 'same') toast('Это задание уже получено');
    else toast('Ссылка на задание не распознана');
  }

  function checkHomework(){
    const hw = state.homework;
    if (!hw || hw.doneAt) { renderHomework(); return; }
    if (hw.tasks.every(ex => homeworkTaskDone(hw, ex))){
      hw.doneAt = Date.now();
      confetti();
      toast('🎉 Домашнее задание выполнено! +30 XP');
      reward(30, 10, { bonus: true });
    }
    renderHomework();
  }

  function renderHomework(){
    const sec = document.getElementById('homework-sec');
    const wrap = document.getElementById('homework');
    if (!sec || !wrap) return;
    const hw = state.homework;
    const lesson = hw && LESSONS.find(l => l.id === hw.lessonId);
    if (!hw || !lesson){ sec.hidden = true; return; }
    sec.hidden = false;
    const doneN = hw.tasks.filter(ex => homeworkTaskDone(hw, ex)).length;
    document.getElementById('hw-due').textContent = hw.doneAt ? 'Выполнено ✓' : (dueLabel(hw.due) || `Сделано ${doneN} из ${hw.tasks.length}`);
    wrap.innerHTML = `
      <div class="hw-card${hw.doneAt ? ' done' : ''}">
        <div class="hw-head">
          <span class="hw-icon" aria-hidden="true">${lesson.words[0]?.emoji || '📘'}</span>
          <div>
            <div class="hw-title">${escapeHtml(lesson.title)}</div>
            <div class="hw-sub">${escapeHtml(lesson.subtitle)} · ${lesson.grade} класс · сделано ${doneN} из ${hw.tasks.length}</div>
          </div>
        </div>
        ${hw.note ? `<p class="hw-note"><span aria-hidden="true">💬</span> ${escapeHtml(hw.note)}</p>` : ''}
        <div class="hw-tasks">
          ${hw.tasks.map(ex => {
            const d = homeworkTaskDone(hw, ex);
            return `<button class="hw-task${d ? ' done' : ''}" data-ex="${ex}">${d ? '✓ ' : ''}${EX_NAMES[ex]}</button>`;
          }).join('')}
        </div>
        ${hw.doneAt ? `<div class="hw-finish"><strong>🎉 Задание выполнено!</strong><button class="icon-btn" id="hw-clear">Убрать задание</button></div>` : ''}
      </div>`;
    wrap.querySelectorAll('.hw-task').forEach(b => b.onclick = () => startExercise(lesson, b.dataset.ex));
    const clr = document.getElementById('hw-clear');
    if (clr) clr.onclick = () => { state.homework = null; saveState(); renderHomework(); };
  }

  // ---------- РЕЖИМ РЕПЕТИТОРА ----------
  let tutorUnlocked = false;

  function openTutorGate(){
    if (tutorUnlocked) return openTutorPanel();
    const a = 6 + Math.floor(Math.random()*4), b = 6 + Math.floor(Math.random()*4);
    openModal(`
      <h2>Для взрослых</h2>
      <div class="lead">Здесь статистика и домашние задания. Чтобы войти, реши пример.</div>
      <form class="gate" id="gate-form">
        <label for="gate-in" class="gate-q">${a} × ${b} =</label>
        <input id="gate-in" type="text" inputmode="numeric" autocomplete="off" maxlength="3" required />
        <button class="btn" type="submit">Войти</button>
      </form>
      <p class="gate-err" id="gate-err" role="alert"></p>
    `);
    const input = document.getElementById('gate-in');
    input.focus();
    document.getElementById('gate-form').onsubmit = (e) => {
      e.preventDefault();
      if (parseInt(input.value, 10) === a * b){ tutorUnlocked = true; openTutorPanel(); }
      else { document.getElementById('gate-err').textContent = 'Неверно. Попробуйте ещё раз.'; input.select(); }
    };
  }

  function lastDays(n){
    const out = [];
    for (let i = n - 1; i >= 0; i--){
      const t = startOfDay(Date.now()) - i * DAY;
      const k = dayKey(t);
      out.push({ key: k, t, ...(state.activity[k] || { sec: 0, ok: 0, bad: 0 }) });
    }
    return out;
  }

  function tutorStats(){
    const days = lastDays(7);
    const sec = days.reduce((s, d) => s + d.sec, 0);
    const ok = days.reduce((s, d) => s + d.ok, 0);
    const bad = days.reduce((s, d) => s + d.bad, 0);
    const active = days.filter(d => d.sec > 0 || d.ok + d.bad > 0).length;
    const lessons = LESSONS.map(l => {
      const p = state.lessonProgress[l.id] || {};
      return { l, parts: EX_ORDER.filter(ex => p[ex]).length, wrong: state.lessonWrong[l.id] || 0 };
    });
    const hard = mistakeEntries().sort((a, b) => b.m.wrong - a.m.wrong);
    return { days, min: sec > 0 && sec < 60 ? '<1' : Math.round(sec / 60), ok, bad, total: ok + bad, pct: ok + bad ? Math.round(ok * 100 / (ok + bad)) : null, active, lessons, hard };
  }

  const WEEKDAYS = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

  function minutesChart(days){
    const mins = days.map(d => d.sec / 60);
    const label = m => m > 0 && m < 1 ? '<1' : String(Math.round(m));
    const max = Math.max(...mins, 1);
    const peak = mins.indexOf(Math.max(...mins));
    const empty = mins.every(m => m === 0);
    return `
      <figure class="t-chart">
        <figcaption>Минуты занятий по дням</figcaption>
        ${empty ? '<p class="t-muted bars-empty">За неделю занятий пока не было.</p>' : ''}
        <div class="bars" aria-hidden="true">
          ${days.map((d, i) => `
            <div class="bar-col" title="${WEEKDAYS[new Date(d.t).getDay()]} ${fmtDay(d.key)}: ${label(mins[i])} мин">
              <span class="bar-val">${i === peak && mins[i] ? label(mins[i]) : ''}</span>
              <span class="bar" style="height:${mins[i] ? Math.max(4, Math.round(mins[i] * 100 / max)) : 0}%"></span>
            </div>`).join('')}
        </div>
        <div class="bar-days" aria-hidden="true">${days.map(d => `<span>${WEEKDAYS[new Date(d.t).getDay()]}</span>`).join('')}</div>
        <table class="sr-only">
          <caption>Минуты занятий по дням</caption>
          <tr><th>День</th><th>Минуты</th><th>Верных ответов</th><th>Ошибок</th></tr>
          ${days.map((d, i) => `<tr><td>${fmtDay(d.key)}</td><td>${label(mins[i])}</td><td>${d.ok}</td><td>${d.bad}</td></tr>`).join('')}
        </table>
      </figure>`;
  }

  function tutorReport(s){
    const d = new Date();
    const lines = [`English Quest — отчёт на ${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`];
    lines.push(`За 7 дней: ${s.min} мин, занятия в ${s.active} из 7 дней`);
    lines.push(s.total ? `Ответов: ${s.total}, верных ${s.pct}%` : 'Ответов за неделю нет');
    const started = s.lessons.filter(x => x.parts > 0);
    if (started.length) lines.push(`Темы в работе: ${started.map(x => `${x.l.title} (${x.parts}/6)`).join(', ')}`);
    const worst = s.lessons.filter(x => x.wrong > 0).sort((a,b) => b.wrong - a.wrong).slice(0, 3);
    if (worst.length) lines.push(`Больше всего ошибок: ${worst.map(x => `${x.l.title} (${x.wrong})`).join(', ')}`);
    const words = s.hard.filter(x => x.m.type === 'word').slice(0, 8).map(x => x.data.word.en);
    if (words.length) lines.push(`Трудные слова: ${words.join(', ')}`);
    if (state.mastered) lines.push(`Выучено после ошибок: ${state.mastered}`);
    const hw = state.homework, hl = hw && LESSONS.find(l => l.id === hw.lessonId);
    if (hl) lines.push(`Домашнее задание: ${hl.title} — ${hw.tasks.map(ex => `${EX_NAMES[ex].replace(/^\S+\s/, '')} ${homeworkTaskDone(hw, ex) ? '✓' : '—'}`).join(', ')}${hw.due ? ` (срок ${fmtDay(hw.due)})` : ''}`);
    return lines.join('\n');
  }

  async function copyText(text, input){
    try { await navigator.clipboard.writeText(text); return true; }
    catch(e){
      if (input){ input.focus(); input.select(); try { return document.execCommand('copy'); } catch(_){} }
      return false;
    }
  }

  function openTutorPanel(){
    const s = tutorStats();
    const hw = state.homework, hwLesson = hw && LESSONS.find(l => l.id === hw.lessonId);
    const defaultDue = dayKey(Date.now() + 2 * DAY);
    const grades = [...new Set(LESSONS.map(l => l.grade))];
    const worst = s.lessons.filter(x => x.wrong > 0).sort((a,b) => b.wrong - a.wrong).slice(0, 3).map(x => x.l.id);

    openModal(`
      <h2>Режим репетитора</h2>
      <div class="lead">Прогресс ученика на этом устройстве.</div>

      <div class="t-tiles">
        <div class="t-tile"><span class="t-num">${s.min}</span><span class="t-lbl">минут за 7 дней</span></div>
        <div class="t-tile"><span class="t-num">${s.active}<small>/7</small></span><span class="t-lbl">дней с занятиями</span></div>
        <div class="t-tile"><span class="t-num">${s.total}</span><span class="t-lbl">ответов за 7 дней</span></div>
        <div class="t-tile"><span class="t-num">${s.pct === null ? '—' : s.pct + '%'}</span><span class="t-lbl">верных ответов</span></div>
      </div>
      ${minutesChart(s.days)}

      <h3 class="t-h">Домашнее задание</h3>
      ${hwLesson ? `
        <div class="t-hw-current">
          <div><b>${escapeHtml(hwLesson.title)}</b> · ${hw.tasks.map(ex => `${homeworkTaskDone(hw, ex) ? '✓' : '○'} ${EX_NAMES[ex]}`).join(' · ')}
          <div class="t-muted">${hw.doneAt ? 'Выполнено ✓' : (dueLabel(hw.due) || 'без срока')}</div></div>
          <button class="icon-btn" id="t-hw-cancel">${hw.doneAt ? 'Убрать' : 'Отменить'}</button>
        </div>` : '<p class="t-muted">Сейчас задания нет.</p>'}
      <form class="t-hw-form" id="t-hw-form">
        <label>Тема
          <select id="t-hw-lesson">
            ${grades.map(g => `<optgroup label="${g} класс">${LESSONS.filter(l => l.grade === g).map(l => `<option value="${l.id}">${escapeHtml(l.title)} — ${escapeHtml(l.subtitle)}</option>`).join('')}</optgroup>`).join('')}
          </select>
        </label>
        <fieldset>
          <legend>Упражнения</legend>
          <div class="t-checks">
            ${EX_ORDER.map(ex => `<label class="t-check"><input type="checkbox" value="${ex}" ${['vocab','listen','match'].includes(ex) ? 'checked' : ''}/> ${EX_NAMES[ex]}</label>`).join('')}
          </div>
        </fieldset>
        <div class="t-row">
          <label>Срок <input type="date" id="t-hw-due" value="${defaultDue}" min="${dayKey()}"/></label>
          <label class="t-grow">Комментарий для ученика <input type="text" id="t-hw-note" maxlength="300" placeholder="Например: повтори слова про семью"/></label>
        </div>
        <div class="controls">
          <button class="btn" type="button" id="t-hw-link">🔗 Скопировать ссылку</button>
          <button class="btn secondary" type="button" id="t-hw-here">📌 Назначить на этом устройстве</button>
        </div>
        <input class="t-link" id="t-hw-out" readonly hidden aria-label="Ссылка на задание"/>
        <p class="t-muted t-hint" id="t-hw-hint"></p>
      </form>

      <h3 class="t-h">Темы</h3>
      <div class="t-table-wrap">
        <table class="t-table">
          <thead><tr><th>Тема</th><th>Класс</th><th>Пройдено</th><th>Ошибок</th></tr></thead>
          <tbody>
            ${s.lessons.map(x => `
              <tr class="${worst.includes(x.l.id) ? 'hot' : ''}${x.parts ? '' : ' idle'}">
                <td>${x.l.words[0]?.emoji || ''} ${escapeHtml(x.l.title)}</td>
                <td>${x.l.grade}</td>
                <td><span class="pips" aria-label="${x.parts} из 6">${EX_ORDER.map((_, i) => `<span class="pip${i < x.parts ? ' on' : ''}"></span>`).join('')}</span> ${x.parts}/6</td>
                <td>${x.wrong ? (worst.includes(x.l.id) ? `<b>${x.wrong}</b> ⚠️` : x.wrong) : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <h3 class="t-h">Трудные слова и вопросы</h3>
      ${s.hard.length ? `
        <ul class="t-hard" role="list">
          ${s.hard.slice(0, 12).map(({ m, data }) => `
            <li><span class="t-hard-main">${m.type === 'word' ? `${data.word.emoji} <b>${escapeHtml(data.word.en)}</b> — ${escapeHtml(data.word.ru)}` : `${m.type === 'grammar' ? '🧩' : '📖'} ${escapeHtml(data.q.q)}`}</span>
            <span class="t-muted">ошибок: ${m.wrong}</span></li>`).join('')}
        </ul>` : '<p class="t-muted">Пока нет — ошибок не было или все уже выучены.</p>'}
      ${state.mastered ? `<p class="t-muted">Выучено после ошибок: <b>${state.mastered}</b></p>` : ''}

      <h3 class="t-h">Отчёт</h3>
      <p class="t-muted">Короткий текст для мессенджера — например, чтобы родитель отправил его репетитору.</p>
      <div class="controls"><button class="btn gold" id="t-report">📋 Скопировать отчёт</button></div>
      <textarea class="t-report" id="t-report-out" readonly hidden rows="8" aria-label="Текст отчёта"></textarea>
    `, { wide: true });

    const readSpec = () => ({
      lessonId: document.getElementById('t-hw-lesson').value,
      tasks: [...document.querySelectorAll('.t-check input:checked')].map(i => i.value),
      due: document.getElementById('t-hw-due').value,
      note: document.getElementById('t-hw-note').value.trim(),
    });
    const hint = document.getElementById('t-hw-hint');
    document.getElementById('t-hw-link').onclick = async () => {
      const spec = readSpec();
      if (!spec.tasks.length){ hint.textContent = 'Выберите хотя бы одно упражнение.'; return; }
      const out = document.getElementById('t-hw-out');
      out.value = homeworkLink(spec);
      out.hidden = false;
      const ok = await copyText(out.value, out);
      hint.textContent = (ok ? 'Ссылка скопирована — отправьте её ученику. ' : 'Скопируйте ссылку из поля выше. ')
        + (location.protocol === 'file:' ? 'Сейчас приложение открыто как файл, поэтому ссылка сработает только на этом компьютере. Чтобы она открывалась у ученика, сайт нужно выложить в интернет.' : '');
    };
    document.getElementById('t-hw-here').onclick = () => {
      const spec = readSpec();
      if (!spec.tasks.length){ hint.textContent = 'Выберите хотя бы одно упражнение.'; return; }
      const res = assignHomework(spec);
      toast(res === 'same' ? 'Это задание уже назначено' : '📌 Задание назначено');
      openTutorPanel();
    };
    const cancel = document.getElementById('t-hw-cancel');
    if (cancel) cancel.onclick = () => { state.homework = null; saveState(); renderHomework(); openTutorPanel(); };
    document.getElementById('t-report').onclick = async () => {
      const out = document.getElementById('t-report-out');
      out.value = tutorReport(s);
      out.hidden = false;
      toast(await copyText(out.value, out) ? '📋 Отчёт скопирован' : 'Скопируйте текст из поля');
    };
  }
  document.getElementById('btn-tutor').onclick = openTutorGate;

  // ---------- GUIDE BUBBLE ----------
  let guideTimer = null;
  function showGuide(name, text, character=null){
    const g = document.getElementById('guide');
    const c = character || CHARACTERS.harlow;
    g.hidden = false;
    const av = document.getElementById('guide-avatar');
    av.textContent = c.emoji;
    av.style.background = c.color;
    av.style.boxShadow = `0 6px 0 ${c.accent}`;
    document.getElementById('guide-name').textContent = name;
    document.getElementById('guide-name').style.setProperty('--guide-accent', c.accent);
    document.getElementById('guide-text').textContent = text;
    clearTimeout(guideTimer);
    guideTimer = setTimeout(() => { g.hidden = true; }, 8000);
    guideScrollY = window.scrollY;
  }
  // Прячем гида, как только ребёнок начинает листать — он не должен закрывать уроки
  let guideScrollY = 0;
  window.addEventListener('scroll', () => {
    const g = document.getElementById('guide');
    if (!g.hidden && Math.abs(window.scrollY - guideScrollY) > 80) g.hidden = true;
  }, { passive: true });
  document.getElementById('guide-close').addEventListener('click', () => document.getElementById('guide').hidden = true);
  document.getElementById('guide-avatar').addEventListener('click', () => {
    // Читаем ровно то, что написано в пузыре, на его языке (реплики гида — по-русски)
    speak(document.getElementById('guide-text').textContent);
  });

  // ---------- TTS ----------
  // Живой голос Enceladus (Gemini 2.5 Pro TTS). Все фразы прегенерированы
  // в build-time и лежат статикой в tts_cache/<sha1>.mp3.
  // Клиент читает манифест { фраза -> ключ } и играет соответствующий MP3.
  const TTS_VOICE = 'enceladus';
  const TTS_CACHE_DIR = 'tts_cache/';
  let _ttsManifest = null;
  let _ttsManifestLoading = null;
  let _currentAudio = null;

  async function loadManifest(){
    if (_ttsManifest) return _ttsManifest;
    if (_ttsManifestLoading) return _ttsManifestLoading;
    _ttsManifestLoading = fetch('tts_manifest.json')
      .then(r => r.ok ? r.json() : {})
      .then(j => { _ttsManifest = j || {}; return _ttsManifest; })
      .catch(() => { _ttsManifest = {}; return _ttsManifest; });
    return _ttsManifestLoading;
  }
  loadManifest(); // прогреваем сразу

  function stopSpeech(){
    if (_currentAudio){
      try { _currentAudio.pause(); _currentAudio.currentTime = 0; } catch(e){}
      _currentAudio = null;
    }
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch(e){}
  }

  // Возвращает URL к статическому MP3 по фразе или null, если нет в манифесте.
  function ttsFileUrl(text){
    if (!_ttsManifest) return null;
    const key = _ttsManifest[text];
    return key ? (TTS_CACHE_DIR + key + '.mp3') : null;
  }

  // Кэш выбранного мужского голоса (только для fallback на speechSynthesis при оффлайне)
  const _voiceCache = { en: null, ru: null };

  function pickMaleVoice(lang){
    const key = lang.slice(0,2).toLowerCase();
    if (_voiceCache[key]) return _voiceCache[key];
    const voices = window.speechSynthesis.getVoices() || [];
    if (!voices.length) return null;
    const langMatches = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(key));
    if (!langMatches.length) return null;

    // Явно мужские имена/маркеры
    const maleRe = /\b(male|david|daniel|alex|fred|george|mark|tom|thomas|ryan|guy|matt|matthew|james|john|paul|peter|michael|arthur|oliver|liam|ethan|aaron|brian|kevin|justin|reed|rishi|arnaud|maged|yuri|pavel|dmitry|sergey|maxim|nikolay|nikolai|artemiy)\b/i;
    // Явно женские — исключаем
    const femaleRe = /\b(female|samantha|karen|victoria|allison|susan|zira|hazel|serena|kate|moira|tessa|fiona|veena|milena|katya|elena|irina|maria|anna|olga|milena)\b/i;

    // Приоритет: явно male > не-female с natural/enhanced/premium > google en > первый доступный
    const scored = langMatches.map(v => {
      const n = (v.name || '') + ' ' + (v.voiceURI || '');
      let s = 0;
      if (maleRe.test(n)) s += 100;
      if (femaleRe.test(n)) s -= 100;
      if (/natural|neural|enhanced|premium|online|wavenet|studio/i.test(n)) s += 20;
      if (/google/i.test(n)) s += 10;
      if (/microsoft/i.test(n)) s += 8;
      if (/^en-us|^en_us/i.test(v.lang)) s += 5;
      return { v, s };
    }).sort((a,b) => b.s - a.s);

    _voiceCache[key] = scored[0]?.v || langMatches[0] || null;
    return _voiceCache[key];
  }

  // Нормализация текста перед подачей в TTS.
  // Причина: некоторые голоса (особенно Windows/системные) читают одиночную заглавную I
  // как букву алфавита. Приводим одиночные I к нижнему регистру — на произношении
  // местоимения это не сказывается, а буквенный «capital I» устраняется.
  function normalizeForSpeech(text){
    let t = String(text);
    // Убираем скобочные комментарии (обычно русский пояснитель): "How ___ sugar? (нельзя посчитать)" → "How ___ sugar?"
    t = t.replace(/\s*\([^)]*\)/g, '');
    // Схлопываем пробелы
    t = t.replace(/\s+/g, ' ').trim();
    // Одиночная I как отдельное слово → i
    t = t.replace(/(^|[\s(\-"'“‘])I(?=[\s.,!?;:)\-"'”’]|$)/g, '$1i');
    // I'm / I've / I'll / I'd → i'm ...
    t = t.replace(/(^|[\s(\-"'“‘])I(?=['’](m|ve|ll|d|re))/g, '$1i');
    return t;
  }

  // Chrome-баг: без периодического resume() длинные утерансы обрываются через ~15с.
  let _resumeTimer = null;
  function _keepAlive(){
    if (_resumeTimer) return;
    _resumeTimer = setInterval(() => {
      try {
        if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending){
          clearInterval(_resumeTimer); _resumeTimer = null;
          return;
        }
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      } catch(e){}
    }, 5000);
  }

  function speak(text, opts={}){
    const raw = String(text).trim();
    if (!raw) return;
    stopSpeech();

    // 'en-US', 'en_GB' и т.п. → 'en', иначе такие вызовы никогда не доходили до MP3
    const lang = opts.lang
      ? (opts.lang.toLowerCase().startsWith('en') ? 'en' : opts.lang)
      : (looksEnglish(raw) ? 'en' : 'ru');
    const clean = lang === 'en' ? normalizeForSpeech(raw) : raw;

    // Русский всё равно через браузерный TTS (мы не генерировали Enceladus для рус.).
    if (lang !== 'en'){
      speakFallback(clean, lang);
      return;
    }

    loadManifest().then(() => {
      // Пробуем найти MP3 сразу по исходной фразе; иначе — по нормализованной;
      // иначе — фолбэк на браузерный голос.
      const url = ttsFileUrl(raw) || ttsFileUrl(clean);
      if (!url){
        console.warn('[TTS] no cached MP3 for:', raw.slice(0,60));
        speakFallback(clean, lang);
        return;
      }
      const a = new Audio(url);
      a.playbackRate = 1.0;
      a.volume = 1.0;
      _currentAudio = a;
      a.play().catch(err => {
        console.warn('[TTS] play failed, fallback:', err);
        speakFallback(clean, lang);
      });
    });
  }

  // Фолбэк на браузерный speechSynthesis — если бэкенд недоступен.
  function speakFallback(text, lang){
    if (!('speechSynthesis' in window)) return;
    try { window.speechSynthesis.cancel(); } catch(e){}
    const ttsLang = lang.startsWith('en') ? 'en-US' : 'ru-RU';
    const voice = pickMaleVoice(ttsLang);
    const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    const runFrom = (idx) => {
      if (idx >= sentences.length) return;
      const u = new SpeechSynthesisUtterance(sentences[idx]);
      u.rate = 0.9; u.pitch = 0.95; u.lang = ttsLang;
      if (voice) u.voice = voice;
      u.onend = () => setTimeout(() => runFrom(idx + 1), 650);
      window.speechSynthesis.speak(u);
      _keepAlive();
    };
    runFrom(0);
  }

  function looksEnglish(text){
    return /[a-zA-Z]/.test(text) && !/[а-яА-Я]/.test(text);
  }
  // прогреваем voices и сбрасываем кэш при их подгрузке
  if ('speechSynthesis' in window){
    window.speechSynthesis.onvoiceschanged = () => {
      _voiceCache.en = null; _voiceCache.ru = null;
      window.speechSynthesis.getVoices();
    };
    window.speechSynthesis.getVoices();
  }

  // ---------- MODAL ----------
  const back = document.getElementById('modal-back');
  const body = document.getElementById('modal-body');
  const modal = document.getElementById('modal');
  let modalOpener = null;
  function openModal(html, opts={}){
    if (!back.classList.contains('open')) modalOpener = document.activeElement;
    modal.classList.toggle('wide', !!opts.wide);
    body.innerHTML = html;
    back.classList.add('open');
    // каждый вопрос перерисовывает окно — держим фокус внутри, чтобы клавиатура не терялась
    if (!modal.contains(document.activeElement) || document.activeElement === document.body) modal.focus();
  }
  // Таймеры «показать ответ → следующий вопрос» не должны заново открывать окно,
  // если ребёнок успел его закрыть (или открыть другой урок).
  let modalGen = 0;
  function afterFeedback(fn, ms){
    const gen = modalGen;
    setTimeout(() => { if (gen === modalGen && back.classList.contains('open')) fn(); }, ms);
  }
  function closeModal(){
    modalGen++;
    back.classList.remove('open');
    stopSpeech();
    if (modalOpener && document.contains(modalOpener)) modalOpener.focus();
    modalOpener = null;
  }
  document.addEventListener('keydown', (e) => {
    if (!back.classList.contains('open')) return;
    if (e.key === 'Escape'){ closeModal(); return; }
    if (e.key === 'Tab'){
      const f = [...modal.querySelectorAll('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)){ e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
    }
  });
  document.getElementById('modal-close').addEventListener('click', closeModal);
  back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });

  // ---------- EXERCISES ----------
  function markProgress(lessonId, ex){
    const p = state.lessonProgress[lessonId] || {};
    p[ex] = (p[ex]||0) + 1;
    state.lessonProgress[lessonId] = p;
    checkHomework();
  }

  function startExercise(lesson, kind){
    // intro от Dr. Harlow + гида темы
    const guide = CHARACTERS[lesson.guide] || CHARACTERS.harlow;
    const harlowLine = `Урок «${lesson.title}». ${lesson.intro}`;
    showGuide('Dr. Harlow', harlowLine, CHARACTERS.harlow);
    setTimeout(() => speak('Let us start!'), 400);

    switch(kind){
      case 'vocab': return exVocab(lesson, guide);
      case 'listen': return exListen(lesson, guide);
      case 'match': return exMatch(lesson, guide);
      case 'grammar': return exGrammar(lesson, guide);
      case 'reading': return exReading(lesson, guide);
      case 'speak': return exSpeak(lesson, guide);
    }
  }

  function lessonHeader(lesson, guide, extra=''){
    return `
      <h2>${lesson.title}</h2>
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

  function shuffle(arr){ return arr.slice().sort(() => Math.random()-0.5); }

  // === Vocab: emoji -> English word (4 opts) ===
  function exVocab(lesson, guide){
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
      const opts = shuffle([w, ...shuffle(lesson.words.filter(x => x.en !== w.en)).slice(0,3)]);
      openModal(`
        ${lessonHeader(lesson, guide)}
        <div class="question">
          <span class="q-emoji">${w.emoji}</span>
          <div class="q-text pixel">Как по-английски?</div>
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
  function exListen(lesson, guide){
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
      const opts = shuffle([w, ...shuffle(lesson.words.filter(x => x.en !== w.en)).slice(0,3)]);
      openModal(`
        ${lessonHeader(lesson, guide)}
        <div class="question">
          <div style="text-align:center; font-size:56px;">🔊</div>
          <div class="q-text pixel">Слушай и выбирай картинку</div>
          <div class="options">
            ${opts.map(o => `<button class="opt" data-en="${o.en}" style="font-size:36px;">${o.emoji}</button>`).join('')}
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
  function exMatch(lesson, guide){
    const pairs = shuffle(lesson.words).slice(0, 6);
    const left = shuffle(pairs.map(p => ({key:p.en, label:p.en, kind:'en'})));
    const right = shuffle(pairs.map(p => ({key:p.en, label:p.emoji, kind:'em'})));
    let selL = null, selR = null, doneCount = 0;
    openModal(`
      ${lessonHeader(lesson, guide)}
      <div class="q-text pixel" style="margin-top:12px;">Собери пары: слово ↔ картинка</div>
      <div class="match-grid">
        <div class="match-col" id="col-l">${left.map(x=>`<button type="button" class="match-item" data-k="${x.key}" data-side="l" aria-pressed="false">${x.label}</button>`).join('')}</div>
        <div class="match-col" id="col-r">${right.map(x=>`<button type="button" class="match-item" data-k="${x.key}" data-side="r" aria-pressed="false" aria-label="${x.key}" style="font-size:24px;">${x.label}</button>`).join('')}</div>
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
              afterFeedback(closeModal, 1500);
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
  function exGrammar(lesson, guide){
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
          <div class="q-text" style="font-size:24px; font-weight:800; text-align:center; margin: 10px 0;">${q.q}</div>
          <div style="color: var(--muted); font-size:13px; text-align:center;">💡 ${q.hint}</div>
          <div class="options" style="margin-top:10px;">
            ${opts.map(o => `<button class="opt" data-o="${o}">${o}</button>`).join('')}
          </div>
        </div>
      `);
      document.querySelectorAll('.opt').forEach(btn => {
        btn.onclick = () => {
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

  // === Reading: passage + 2-3 comprehension Q ===
  function exReading(lesson, guide){
    const r = lesson.reading;
    let idx = 0;
    openModal(`
      ${lessonHeader(lesson, guide)}
      <div class="question">
        <h3>${r.title}</h3>
        <p style="font-size:20px; line-height:1.6;">${r.text}</p>
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
          <div class="q-text" style="font-size:22px; font-weight:800;">${q.q}</div>
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
  function translateFromWords(phrase, lesson){
    if (!lesson || !lesson.words) return '(перевод не найден)';
    const dict = {};
    for (const w of lesson.words){ if (w.en && w.ru) dict[w.en.toLowerCase()] = w.ru; }
    const parts = phrase.split(/\s+/).map(tok => {
      const clean = tok.toLowerCase().replace(/[.,!?"'’]/g,'');
      return dict[clean] ? `${tok} (${dict[clean]})` : tok;
    });
    return parts.join(' ');
  }

  // === Speak: repeat a phrase, score via SpeechRecognition ===
  function exSpeak(lesson, guide){
    let idx = 0;
    const list = shuffle(lesson.phrases);
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
      openModal(`
        ${lessonHeader(lesson, guide)}
        <div class="question">
          <div class="q-text pixel">Повтори за DJ Robo</div>
          <div class="q-text speak-phrase">
            "${phrase}"
          </div>
          <div class="speak-translation">
            🇷🇺 ${ruTr}
          </div>
          <div style="text-align:center; color: var(--muted); font-size:13px;">Нажми на микрофон и произнеси фразу</div>
          <button class="mic-btn" id="mic">🎤</button>
          <div id="rec-result" style="text-align:center; min-height: 22px; font-weight:700;"></div>
        </div>
        <div class="controls">
          <button class="btn secondary" id="hear">🔊 Услышать снова</button>
          <button class="btn gold" id="skip">Пропустить</button>
        </div>
      `);
      document.getElementById('hear').onclick = () => speak(phrase);
      document.getElementById('skip').onclick = () => { idx++; render(); };
      setTimeout(() => speak(phrase), 400);
      const mic = document.getElementById('mic');
      const resEl = document.getElementById('rec-result');
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR){
        resEl.textContent = 'Микрофон не поддерживается в этом браузере.';
        mic.disabled = true;
        return;
      }
      mic.onclick = () => {
        try {
          const rec = new SR();
          rec.lang = 'en-US';
          rec.interimResults = false;
          rec.maxAlternatives = 1;
          mic.classList.add('rec');
          resEl.textContent = 'Слушаю...';
          rec.start();
          rec.onresult = (e) => {
            mic.classList.remove('rec');
            const said = e.results[0][0].transcript.toLowerCase();
            const target = phrase.toLowerCase().replace(/[.,!?"]/g,'');
            const targetWords = target.split(/\s+/);
            const saidWords = said.split(/\s+/);
            let hits = 0;
            for (const tw of targetWords) if (saidWords.includes(tw)) hits++;
            const score = Math.round(hits * 100 / targetWords.length);
            resEl.innerHTML = `Ты сказал: <em>"${said}"</em> · <b>${score}%</b>`;
            if (score >= 60){
              reward(18, 4);
              markProgress(lesson.id, 'speak');
              toast(`✅ +18 XP · ${score}%`);
              afterFeedback(() => { idx++; render(); }, 1500);
            } else {
              penalty();
              setTimeout(() => {}, 300);
            }
          };
          rec.onerror = () => { mic.classList.remove('rec'); resEl.textContent = 'Ошибка микрофона. Попробуй ещё раз.'; };
          rec.onend = () => mic.classList.remove('rec');
        } catch(e){
          resEl.textContent = 'Не удалось запустить распознавание.';
          mic.classList.remove('rec');
        }
      };
    }
  }

  // ---------- THEME ----------
  document.getElementById('btn-theme').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const nxt = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', nxt);
    state.settings.theme = nxt;
    document.getElementById('btn-theme').textContent = nxt === 'light' ? '🌙' : '☀️';
    saveState();
  };

  // ---------- RESET ----------
  document.getElementById('btn-reset').onclick = () => {
    if (!confirm('Сбросить весь прогресс?')) return;
    state = freshState();
    saveState();
    renderHUD(); renderInventory(); renderLessons(); renderMistakes(); renderHomework();
    toast('Прогресс сброшен');
  };

  // ---------- CTA ----------
  document.getElementById('btn-hero-start').onclick = () => startExercise(LESSONS[0], 'vocab');
  document.getElementById('btn-hero-team').onclick = () => document.getElementById('team-sec').scrollIntoView({behavior:'smooth'});

  // ---------- INIT ----------
  (async function init(){
    state = await loadState();
    const theme = state.settings?.theme || 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('btn-theme').textContent = theme === 'light' ? '🌙' : '☀️';
    renderHUD();
    renderTeam();
    renderLessons();
    renderInventory();
    renderMistakes();
    applyHomeworkFromHash();
    renderHomework();
    // welcome from Harlow
    setTimeout(() => {
      showGuide('Dr. Harlow', pick(HARLOW_LINES.welcome), CHARACTERS.harlow);
    }, 900);
  })();

})();
