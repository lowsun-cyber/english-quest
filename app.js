// English Quest — app engine v2
// State + persistence + exercises + guide + TTS + speech recognition

(function(){
  const { CHARACTERS, LESSONS, MAX_LEVEL, xpForLevel, totalXpForLevel, levelFromXp, RANKS, rankFor, HARLOW_LINES } = window.EQ;

  // ---------- STATE ----------
  const DEFAULT_STATE = {
    xp: 0, gold: 0, hearts: 5, streak: 0,
    inventory: {},   // { en: count }
    lessonProgress: {}, // { lessonId: { vocab: n, reading: 0/1, grammar: n, listen: n, speak: n, match: n } }
    settings: { theme: 'light', speechRate: 0.9 },
    version: 2,
  };
  let state = null;

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
        if (raw) return { ...DEFAULT_STATE, ...JSON.parse(raw) };
      }
    } catch(e){}
    // 2) try IDB
    try {
      const db = await openIDB();
      return await new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get('state');
        req.onsuccess = () => resolve(req.result ? { ...DEFAULT_STATE, ...req.result } : { ...DEFAULT_STATE });
        req.onerror = () => resolve({ ...DEFAULT_STATE });
      });
    } catch(e){}
    // 3) in-memory
    if (memoryStore) return { ...DEFAULT_STATE, ...memoryStore };
    return { ...DEFAULT_STATE };
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
    document.getElementById('rank-title').style.color = rk.color;
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
      card.addEventListener('click', () => startExercise(l, 'vocab'));
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
    document.getElementById('guide-name').style.color = c.accent;
    document.getElementById('guide-text').textContent = text;
    clearTimeout(guideTimer);
    guideTimer = setTimeout(() => { g.hidden = true; }, 8000);
  }
  document.getElementById('guide-close').addEventListener('click', () => document.getElementById('guide').hidden = true);
  document.getElementById('guide-avatar').addEventListener('click', () => {
    const t = document.getElementById('guide-text').textContent;
    speak(t.length > 40 ? 'Hello there!' : t, { lang: 'en-US' });
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

    const lang = opts.lang || (looksEnglish(raw) ? 'en' : 'ru');
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
  function openModal(html){
    body.innerHTML = html;
    back.classList.add('open');
  }
  function closeModal(){
    back.classList.remove('open');
    stopSpeech();
  }
  document.getElementById('modal-close').addEventListener('click', closeModal);
  back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });

  // ---------- EXERCISES ----------
  function markProgress(lessonId, ex){
    const p = state.lessonProgress[lessonId] || {};
    p[ex] = (p[ex]||0) + 1;
    state.lessonProgress[lessonId] = p;
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
      document.getElementById('skip').onclick = () => { idx++; render(); };
      document.querySelectorAll('.opt').forEach(btn => {
        btn.onclick = () => {
          if (btn.dataset.en === w.en){
            btn.classList.add('correct');
            speak(w.en);
            reward(10, 2, { item: w.en });
            markProgress(lesson.id, 'vocab');
            toast(`✅ +10 XP · ${w.en}`);
            setTimeout(() => { idx++; render(); }, 800);
          } else {
            btn.classList.add('wrong');
            document.querySelector(`.opt[data-en="${w.en}"]`)?.classList.add('correct');
            speak(w.en);
            penalty();
            toast(`Правильно: ${w.en}`);
            setTimeout(() => { idx++; render(); }, 1400);
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
            setTimeout(() => { idx++; render(); }, 700);
          } else {
            btn.classList.add('wrong');
            document.querySelector(`.opt[data-en="${w.en}"]`)?.classList.add('correct');
            penalty();
            setTimeout(() => { idx++; render(); }, 1200);
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
        <div class="match-col" id="col-l">${left.map(x=>`<div class="match-item" data-k="${x.key}" data-side="l">${x.label}</div>`).join('')}</div>
        <div class="match-col" id="col-r">${right.map(x=>`<div class="match-item" data-k="${x.key}" data-side="r" style="font-size:24px;">${x.label}</div>`).join('')}</div>
      </div>
      <div class="controls"><button class="btn secondary" id="close-match">Закрыть</button></div>
    `);
    document.getElementById('close-match').onclick = closeModal;
    document.querySelectorAll('.match-item').forEach(el => {
      el.onclick = () => {
        if (el.classList.contains('done')) return;
        if (el.dataset.side === 'l'){
          document.querySelectorAll('.match-item[data-side="l"]').forEach(x=>x.classList.remove('sel'));
          el.classList.add('sel'); selL = el;
        } else {
          document.querySelectorAll('.match-item[data-side="r"]').forEach(x=>x.classList.remove('sel'));
          el.classList.add('sel'); selR = el;
        }
        if (selL && selR){
          if (selL.dataset.k === selR.dataset.k){
            selL.classList.add('done'); selR.classList.add('done');
            selL.classList.remove('sel'); selR.classList.remove('sel');
            reward(14, 3, { item: selL.dataset.k });
            markProgress(lesson.id, 'match');
            speak(selL.dataset.k);
            doneCount++;
            if (doneCount === pairs.length){
              confetti();
              toast('🎉 Все пары собраны!');
              setTimeout(closeModal, 1500);
            }
          } else {
            selL.classList.add('wrong'); selR.classList.add('wrong');
            penalty();
            const l = selL, r = selR;
            setTimeout(() => {
              l.classList.remove('wrong','sel'); r.classList.remove('wrong','sel');
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
          <div class="q-text" style="font-size:20px; text-align:center; margin: 10px 0;">${q.q}</div>
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
            setTimeout(() => { idx++; render(); }, 900);
          } else {
            btn.classList.add('wrong');
            document.querySelector(`.opt[data-o="${q.a}"]`)?.classList.add('correct');
            penalty();
            setTimeout(() => { idx++; render(); }, 1400);
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
        <p style="font-size:16px; line-height:1.6;">${r.text}</p>
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
        reward(20, 5);
        markProgress(lesson.id, 'reading');
        toast('📖 +20 XP');
        confetti();
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
          <div class="q-text pixel">${q.q}</div>
          <div class="options">
            ${opts.map(o => `<button class="opt" data-o="${o}">${o}</button>`).join('')}
          </div>
        </div>
      `);
      document.querySelectorAll('.opt').forEach(btn => {
        btn.onclick = () => {
          if (btn.dataset.o === q.a){
            btn.classList.add('correct');
            toast('✅');
            setTimeout(() => { idx++; renderQ(); }, 700);
          } else {
            btn.classList.add('wrong');
            document.querySelector(`.opt[data-o="${q.a}"]`)?.classList.add('correct');
            penalty();
            setTimeout(() => { idx++; renderQ(); }, 1200);
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
          <div class="q-text" style="font-size:20px; text-align:center; margin: 12px 0 6px; padding: 12px; background: #fffbe6; border: 2px dashed var(--line); border-radius: 12px;">
            "${phrase}"
          </div>
          <div class="speak-translation" style="text-align:center; margin: 0 0 10px; padding: 8px 12px; background: #eef7ff; border: 2px dashed #7bb7e0; border-radius: 10px; color: #244; font-size:15px;">
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
              setTimeout(() => { idx++; render(); }, 1500);
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
    state = { ...DEFAULT_STATE };
    saveState();
    renderHUD(); renderInventory(); renderLessons();
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
    // welcome from Harlow
    setTimeout(() => {
      showGuide('Dr. Harlow', pick(HARLOW_LINES.welcome), CHARACTERS.harlow);
    }, 900);
  })();

})();
