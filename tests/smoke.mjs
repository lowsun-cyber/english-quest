#!/usr/bin/env node
// Сквозной тест English Quest в headless Chrome (DevTools Protocol, без зависимостей).
// Проходит основные сценарии через интерфейс, как пользователь.
//
//   node tests/smoke.mjs            — поднимет локальный сервер на :8765 и запустит тест
//
// Нужны: macOS или Linux, Google Chrome (или CHROME=/путь/к/chrome), Python 3 для сервера, Node 22+.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { startApi, call } from './api.mjs';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const PORT = 8765, APP = `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!CHROME){ console.error('Не найден Google Chrome. Укажите путь: CHROME=/путь/к/chrome node tests/smoke.mjs'); process.exit(2); }
// если порт уже занят (например, другим сервером), тест упал бы на всём подряд — лучше сказать прямо
try { await fetch(APP); console.error(`Порт ${PORT} уже занят — остановите другой сервер и запустите тест снова.`); process.exit(2); } catch (e) {}

const profile = mkdtempSync(join(tmpdir(), 'eq-smoke-'));
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore', cwd: tmpdir() });
// на сервере GitHub (CI) Chrome запускается без песочницы — там нет нужных прав
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9335', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1200,900', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []), 'about:blank'], { stdio: 'ignore' });

let ws, id = 0;
const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const i = ++id; pending.set(i, { resolve, reject }); ws.send(JSON.stringify({ id: i, method, params })); });
async function js(body){
  const r = await send('Runtime.evaluate', { expression: `(async () => { ${body} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || r.exceptionDetails.text);
  return r.result.value;
}
async function load(url = APP){
  await send('Page.navigate', { url });
  // ждём, пока приложение действительно запустится (карта нарисована), а не фиксированное время
  for (let t = 0; t < 50; t++){
    await sleep(200);
    try { if (await js(`return !!(window.EQ && document.querySelectorAll('.map-node').length)`)) break; } catch (e) {}
  }
  await sleep(300);
  await js(STUBS);
}

// Звук в тесте выключен; запоминаем, что «сказали», чтобы отвечать на задания на слух.
const STUBS = `
  window.__said = null;
  const man = await (await fetch('tts_manifest.json')).json(); const rev = {}; for (const [k, v] of Object.entries(man)) rev[v] = rev[v] || k;
  const voices = await (await fetch('tts_voices.json')).json(); for (const [k, v] of Object.entries(voices)) rev[v.replace(/\\.(mp3|m4a)$/, '')] = k;
  window.speechSynthesis.speak = u => { window.__said = u.text; };
  window.Audio = function(src){ const k = String(src).split('/').pop().replace(/\\.(mp3|m4a)$/, ''); window.__said = rev[k] || src; const o = { play: () => Promise.resolve(), pause(){}, set currentTime(v){} }; window.__lastAudio = o; return o; };
  window.confirm = () => true;
  window.__sleep = t => new Promise(r => setTimeout(r, t));
  window.__toasts = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.classList?.contains('toast') && window.__toasts.push(n.textContent)))).observe(document.body, { childList: true });
  window.__gate = async (pin) => { document.getElementById('btn-tutor').click(); await __sleep(150); const q = document.querySelector('.gate-q'); if (!q) return;
    if (/×/.test(q.textContent)){ const [a, b] = q.textContent.match(/\\d+/g).map(Number); document.getElementById('gate-in').value = a * b; }
    else document.getElementById('gate-in').value = pin || '';
    document.getElementById('gate-form').requestSubmit(); await __sleep(300); };
  window.__ls = () => JSON.parse(localStorage.getItem('english_quest_v2') || 'null');
  window.__close = () => document.getElementById('modal-close').click();
  // «виден ли на экране» — атрибута hidden мало: его может перебить display из CSS
  window.__shown = el => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  // ответ «по картинке»: слово с этой картинкой, которое есть среди вариантов (у некоторых слов картинки совпадают)
  window.__byEmoji = (words, emoji) => { const opts = [...document.querySelectorAll('.opt')].map(o => o.dataset.en || o.dataset.o); return words.filter(w => w.emoji === emoji).map(w => w.en).find(e => opts.includes(e)); };
  return true;`;

const results = [];
async function test(name, fn){
  try { const info = await fn(); results.push({ ok: true, name, info }); }
  catch (e) { results.push({ ok: false, name, info: e.message }); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

try {
  let list;
  for (let t = 0; t < 60; t++){ try { list = await (await fetch('http://127.0.0.1:9335/json/list')).json(); if (list.some(p => p.type === 'page')) break; } catch (e) {} await sleep(200); }
  ws = new WebSocket(list.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)){ const p = pending.get(d.id); pending.delete(d.id); d.error ? p.reject(new Error(d.error.message)) : p.resolve(d.result); }
    if (d.method === 'Runtime.exceptionThrown') errors.push(d.params.exceptionDetails.exception?.description?.split('\n')[0] || d.params.exceptionDetails.text);
  };
  await send('Page.enable'); await send('Runtime.enable');
  for (let t = 0; t < 30; t++){ try { await fetch(APP); break; } catch (e) { await sleep(200); } }

  await load();

  await test('страница и шапка', () => js(`
    const nodes = document.querySelectorAll('.map-node').length;
    const g2 = window.EQ.LESSONS.filter(l => l.grade === 2).length, want = g2 + Math.floor(g2 / 4);   // темы + проверки после каждых 4
    if (nodes !== want) throw new Error('узлов на карте: ' + nodes + ', ждали ' + want);
    if (document.getElementById('stat-xp').textContent !== '0') throw new Error('XP не 0');
    if (!/0 \\/ 10 мин/.test(document.getElementById('goal-sub').textContent)) throw new Error('цель дня: ' + document.getElementById('goal-sub').textContent);
    return 'карта ' + nodes + ' узлов, цель 0/10';`));

  await test('карта: текущая и закрытая тема', () => js(`
    const n = document.querySelectorAll('.map-node');
    if (!n[0].classList.contains('current') || !n[1].classList.contains('locked')) throw new Error(n[0].className + ' / ' + n[1].className);
    n[1].click(); await __sleep(100);
    if (!__toasts.some(t => t.includes('Сначала пройди'))) throw new Error('нет подсказки о замке');
    return 'ok';`));

  await test('экран темы и карточки', () => js(`
    document.querySelector('.map-node').click(); await __sleep(200);
    const ex = [...document.querySelectorAll('.hub-ex')].map(b => b.dataset.ex).join(',');
    if (ex !== 'cards,vocab,listen,match,spell,grammar,reading,speak,picture') throw new Error(ex);
    document.querySelector('.hub-ex[data-ex=cards]').click(); await __sleep(200);
    const first = document.querySelector('.flash-en').textContent;
    for (let i = 0; i < 30 && document.getElementById('fc-next'); i++){ document.getElementById('fc-next').click(); await __sleep(30); }
    const tiles = document.querySelectorAll('.word-tile').length;
    if (tiles !== 12) throw new Error('слов в сетке: ' + tiles);
    __close(); return 'первая карточка ' + first + ', 12 слов';`));

  await test('слова: 2 ошибки и 4 верных', () => js(`
    const L = window.EQ.LESSONS[0];
    document.querySelector('.map-node').click(); await __sleep(200); document.querySelector('.hub-ex[data-ex=vocab]').click(); await __sleep(300);
    for (let i = 0; i < 6; i++){ const q = document.querySelector('.q-emoji'); const ans = __byEmoji(L.words, q.textContent);
      [...document.querySelectorAll('.opt')].find(o => i < 2 ? o.dataset.en !== ans : o.dataset.en === ans).click(); await __sleep(i < 2 ? 1600 : 1000); }
    const st = __ls(); __close();
    if (Object.keys(st.mistakes).length !== 2) throw new Error('ошибок: ' + Object.keys(st.mistakes).length);
    if (document.getElementById('stat-hearts')) throw new Error('сердечки всё ещё в шапке');
    if (st.lessonProgress['g2-letters'].vocab !== 4) throw new Error('прогресс: ' + JSON.stringify(st.lessonProgress));
    return 'XP ' + st.xp + ', ошибок 2, без штрафа';`));

  await test('слушай: все верно', () => js(`
    document.querySelector('.map-node').click(); await __sleep(200); document.querySelector('.hub-ex[data-ex=listen]').click(); await __sleep(700);
    for (let i = 0; i < 5; i++){ const b = [...document.querySelectorAll('.opt')].find(o => o.dataset.en === __said); if (!b) throw new Error('не нашёл ответ для «' + __said + '»'); b.click(); await __sleep(1300); }
    const p = __ls().lessonProgress['g2-letters'].listen; __close();
    if (p !== 5) throw new Error('listen = ' + p);
    return '5 из 5';`));

  await test('пары → напиши → грамматика', () => js(`
    document.querySelector('.map-node').click(); await __sleep(200); document.querySelector('.hub-ex[data-ex=match]').click(); await __sleep(300);
    for (const l of [...document.querySelectorAll('.match-item[data-side=l]')]){ l.click(); [...document.querySelectorAll('.match-item[data-side=r]')].find(r => r.dataset.k === l.dataset.k).click(); await __sleep(100); }
    await __sleep(1500);
    if (!document.getElementById('next-spell')) throw new Error('нет перехода к «Напиши»');
    document.getElementById('next-spell').click(); await __sleep(300);
    const L = window.EQ.LESSONS[0], M = document.getElementById('modal');
    const w = L.words.find(w => w.ru === document.querySelector('.review-hint').textContent).en;
    for (const c of w.replace(/[^a-z]/g, '')) M.dispatchEvent(new KeyboardEvent('keydown', { key: c, bubbles: true }));
    await __sleep(100);
    if (!document.querySelector('.slot-l.ok')) throw new Error('слово ' + w + ' не принято');
    __close(); await __sleep(100);
    document.querySelector('.map-node').click(); await __sleep(200); document.querySelector('.hub-ex[data-ex=grammar]').click(); await __sleep(300);
    for (let i = 0; i < L.grammar.length; i++){ const q = [...document.querySelectorAll('.q-text')][1].textContent.trim(); const g = L.grammar.find(x => x.q === q);
      [...document.querySelectorAll('.opt')].find(o => o.dataset.o === g.a).click(); await __sleep(1100); }
    const p = __ls().lessonProgress['g2-letters']; __close();
    return 'match ' + p.match + ', spell ' + p.spell + ', grammar ' + p.grammar;`));

  await test('что на картинке (2-E)', () => js(`
    const L = window.EQ.LESSONS.find(l => l.id === 'g2-letters');
    document.querySelector('.map-node').click(); await __sleep(200); document.querySelector('.hub-ex[data-ex=picture]').click(); await __sleep(300);
    let n = 0;
    while (document.querySelector('.pic-emoji') && n < 6){
      const em = document.querySelector('.pic-emoji').textContent, it = L.pics.find(p => p.emoji === em);
      [...document.querySelectorAll('.opt')].find(o => o.dataset.o === it.right).click(); n++; await __sleep(1400);
    }
    const p = __ls().lessonProgress['g2-letters'].picture; __close();
    if (n !== L.pics.length || p !== n) throw new Error('ответов ' + n + ', засчитано ' + p);
    return n + ' картинок, все верно';`));

  await test('вставь слово (3-A), 3 класс', () => js(`
    const st = __ls(); st.settings.unlockAll = true; st.settings.mapGrade = 3;
    localStorage.setItem('english_quest_v2', JSON.stringify(st)); return true;`).then(() => load()).then(() => js(`
    const L = window.EQ.LESSONS.filter(l => l.grade === 3).sort((a, b) => a.order - b.order)[0], items = window.EQ.fillItemsFor(L);
    document.querySelector('.map-node').click(); await __sleep(250);
    document.querySelector('.hub-ex[data-ex=fill]').click(); await __sleep(300);
    let n = 0;
    while (document.querySelector('.q-sentence') && n < 6){
      const it = items.find(x => x.q === document.querySelector('.q-sentence').textContent);
      if (!it) throw new Error('нет задания для «' + document.querySelector('.q-sentence').textContent + '»');
      [...document.querySelectorAll('.opt')].find(o => o.dataset.o === it.a).click(); n++; await __sleep(1400);
    }
    const st = __ls(); const p = st.lessonProgress[L.id]?.fill; __close();
    st.settings.unlockAll = false; st.settings.mapGrade = 2; localStorage.setItem('english_quest_v2', JSON.stringify(st));
    if (n !== 5 || p !== 5) throw new Error('ответов ' + n + ', засчитано ' + p);
    return L.title + ': 5 из 5';`)).then(r => load().then(() => r)));

  await test('собери предложение (4-C), 4 класс', () => js(`
    const st = __ls(); st.settings.unlockAll = true; st.settings.mapGrade = 4;
    localStorage.setItem('english_quest_v2', JSON.stringify(st)); return true;`).then(() => load()).then(() => js(`
    const L = window.EQ.LESSONS.filter(l => l.grade === 4).sort((a, b) => a.order - b.order)[0], items = window.EQ.buildItemsFor(L);
    document.querySelector('.map-node').click(); await __sleep(250);
    document.querySelector('.hub-ex[data-ex=build]').click(); await __sleep(300);
    let n = 0, wrongDone = false;
    while (document.querySelector('.build-pool') && n < 6){
      const words = [...document.querySelectorAll('.build-pool .build-tile')].map(b => b.textContent);
      const it = items.find(x => x.tokens.length === words.length && [...x.tokens].sort().join('|') === [...words].sort().join('|'));
      if (!it) throw new Error('нет задания для слов: ' + words.join(' '));
      const order = wrongDone ? it.tokens : [...it.tokens].reverse();   // первое — нарочно неверно
      for (const t of order){ const b = [...document.querySelectorAll('.build-pool .build-tile')].find(x => x.textContent === t); b.click(); await __sleep(30); }
      document.getElementById('build-check').click(); n++; wrongDone = true; await __sleep(wrongDone && n === 1 ? 2800 : 1700);
    }
    const st = __ls(); const p = st.lessonProgress[L.id]?.build; __close();
    st.settings.unlockAll = false; st.settings.mapGrade = 2; localStorage.setItem('english_quest_v2', JSON.stringify(st));
    if (n !== 5 || p !== 4) throw new Error('заданий ' + n + ', засчитано ' + p + ' (ждали 4: первое нарочно неверно)');
    return L.title + ': 4 из 5, неверный порядок не засчитан';`)).then(r => load().then(() => r)));

  await test('чтение → тема пройдена → следующая открыта', () => js(`
    const L = window.EQ.LESSONS[0];
    document.querySelector('.map-node').click(); await __sleep(200); document.querySelector('.hub-ex[data-ex=reading]').click(); await __sleep(300);
    document.getElementById('read-start').click(); await __sleep(200);
    for (let i = 0; i < L.reading.questions.length; i++){ const q = document.querySelector('.q-text').textContent.trim(); const rq = L.reading.questions.find(x => x.q === q);
      [...document.querySelectorAll('.opt')].find(o => o.dataset.o === rq.a).click(); await __sleep(1000); }
    __close(); await __sleep(200);
    const n = document.querySelectorAll('.map-node');
    if (!n[0].classList.contains('done')) throw new Error('тема не пройдена: ' + JSON.stringify(__ls().lessonProgress['g2-letters']));
    if (!n[1].classList.contains('current')) throw new Error('вторая тема: ' + n[1].className);
    if (document.getElementById('stat-quests').textContent !== '1') throw new Error('счётчик тем');
    return 'тема ✓, «Hello!» открыта';`));

  await test('мои ошибки: повторение', () => js(`
    const before = document.getElementById('mistakes').innerText;
    if (!/2\\s*ждут повторения/.test(before)) throw new Error(before.slice(0, 60));
    document.getElementById('btn-review').click(); await __sleep(300);
    const words = window.EQ.LESSONS[0].words;
    for (let i = 0; i < 2; i++){ const ans = __byEmoji(words, document.querySelector('.q-emoji').textContent);
      [...document.querySelectorAll('.opt')].find(o => o.dataset.o === ans).click(); await __sleep(1100); }
    const txt = document.querySelector('.modal .question').innerText; __close(); await __sleep(100);
    if (!/Верно: 2 из 2/.test(txt)) throw new Error(txt);
    if (!/на сегодня всё повторено/.test(document.getElementById('mistakes').innerText)) throw new Error('раздел не обновился');
    return 'обе карточки перенесены на завтра';`));

  await test('проверка после 4 тем → 💎', () => js(`
    const st = __ls(); for (const l of window.EQ.LESSONS.filter(l => l.grade === 2).sort((a, b) => a.order - b.order).slice(1, 4)) st.lessonProgress[l.id] = { vocab: 3, listen: 3, grammar: 2, reading: 1 };
    localStorage.setItem('english_quest_v2', JSON.stringify(st)); return true;`).then(() => load()).then(() => js(`
    const LS = window.EQ.LESSONS.filter(l => l.grade === 2).sort((a, b) => a.order - b.order).slice(0, 4), words = LS.flatMap(l => l.words), gram = LS.flatMap(l => l.grammar);
    const cp = document.querySelectorAll('.map-node')[4]; if (!cp.classList.contains('current')) throw new Error('проверка не открылась: ' + cp.className);
    cp.click(); await __sleep(700);
    for (let i = 0; i < 10; i++){
      const opts = [...document.querySelectorAll('.opt')].map(o => o.dataset.o); let ans;
      const em = document.querySelector('.q-emoji'), s = document.querySelector('.q-sentence');
      if (em) ans = words.filter(w => w.emoji === em.textContent).map(w => w.en).find(e => opts.includes(e));
      else if (s) ans = gram.filter(g => g.q === s.textContent).map(g => g.a).find(a => opts.includes(a));
      else ans = opts.find(o => o.toLowerCase() === String(__said).toLowerCase());
      const btn = [...document.querySelectorAll('.opt')].find(o => o.dataset.o === ans);
      if (!btn) throw new Error('вопрос ' + (i + 1) + ' (' + (em ? 'слово ' + em.textContent : s ? 'грамматика «' + s.textContent + '»' : 'на слух, прозвучало «' + __said + '»') + '): не нашёл ответ среди ' + opts.join('/'));
      btn.click(); await __sleep(1300); }
    const res = document.querySelector('.checkpoint-result')?.innerText || ''; document.getElementById('cp-close').click(); await __sleep(200);
    if (!/Проверка сдана/.test(res)) throw new Error(res.slice(0, 80));
    if (!__ls().inventory['trophy:g2-p1']) throw new Error('нет 💎 в инвентаре');
    if (!document.querySelectorAll('.map-node')[5].classList.contains('current')) throw new Error('5-я тема не открылась');
    return res.match(/Верно: \\d+/)[0];`)));

  await test('домашнее задание по ссылке', async () => {
    await load(APP + '#hw&lesson=g2-hello&tasks=vocab&note=' + encodeURIComponent('<b>Тест</b>'));
    return js(`
      if (document.getElementById('homework-sec').hidden) throw new Error('карточки нет');
      if (document.querySelector('#homework b')) throw new Error('HTML из ссылки не экранирован');
      const L = window.EQ.LESSONS.find(l => l.id === 'g2-hello');
      document.querySelector('.hw-task').click(); await __sleep(300);
      const ans = __byEmoji(L.words, document.querySelector('.q-emoji').textContent);
      [...document.querySelectorAll('.opt')].find(o => o.dataset.en === ans).click(); await __sleep(300); __close(); await __sleep(200);
      if (!/Задание выполнено/.test(document.getElementById('homework').innerText)) throw new Error('не выполнено');
      return 'пришло, выполнено';`);
  });

  await test('панель репетитора и отчёт', () => js(`
    await __gate();
    if (document.querySelector('.modal h2').textContent !== 'Режим репетитора') throw new Error('панель не открылась');
    const tiles = document.querySelectorAll('.t-tile').length; if (tiles !== 6) throw new Error('плиток: ' + tiles);
    document.getElementById('t-report').click(); await __sleep(300);
    const rep = document.getElementById('t-report-out').value;
    for (const s of ['Ответов:', 'Цель дня', 'Трудные слова', 'Сданы проверки']) if (!rep.includes(s)) throw new Error('в отчёте нет «' + s + '»');
    __close(); return tiles + ' плиток, отчёт полный';`));

  await test('начатая тема не закрывается, если перед ней появилась новая', () => js(`
    const st = __ls(); const L = window.EQ.LESSONS.filter(l => l.grade === 2).sort((a, b) => a.order - b.order);
    const later = L[L.length - 2]; st.lessonProgress[later.id] = { vocab: 1 };
    localStorage.setItem('english_quest_v2', JSON.stringify(st)); return later.title;`).then(() => load()).then(() => js(`
    const L = window.EQ.LESSONS.filter(l => l.grade === 2).sort((a, b) => a.order - b.order), later = L[L.length - 2];
    const node = [...document.querySelectorAll('.map-node')].find(n => (n.getAttribute('aria-label') || '').startsWith(later.title));
    if (!node || node.classList.contains('locked')) throw new Error('начатая тема закрыта: ' + node?.className);
    const last = [...document.querySelectorAll('.map-node')].find(n => (n.getAttribute('aria-label') || '').startsWith(L[L.length - 1].title));
    if (!last.classList.contains('locked')) throw new Error('не начатая тема после неё должна быть закрыта');
    return '«' + later.title + '» открыта';`)));

  await test('грамматические навыки: учёт и панель', () => js(`
    const { logSkill } = await import('/js/mistakes.js');
    const { saveState } = await import('/js/state.js');
    const q = window.EQ.LESSONS.find(l => l.id === 'g4-daystoremember').grammar.find(g => g.skill === 'G4-07');
    logSkill(q, false, 'goed'); logSkill(q, false, 'goed'); logSkill(q, true, q.a); logSkill({ q: 'без навыка' }, false, 'x');
    await saveState();
    const sk = __ls().skills;
    if (sk['G4-07']?.bad !== 2 || sk['G4-07'].ok !== 1 || sk['G4-07'].wrong.goed !== 2 || Object.keys(sk).some(k => !window.EQ.SKILLS[k])) throw new Error('учёт навыка: ' + JSON.stringify(sk));
    await __gate();
    const txt = document.getElementById('modal-body').innerText;
    if (!/Грамматика по навыкам/.test(txt) || !/Неправильные глаголы/.test(txt) || !/путает: goed/.test(txt)) throw new Error('в панели нет навыка');
    document.getElementById('t-report').click(); await __sleep(300);
    if (!/Грамматика, над чем поработать: Неправильные глаголы/.test(document.getElementById('t-report-out').value)) throw new Error('в отчёте нет слабого навыка');
    __close(); return 'G4-07: 1 верно, 2 ошибки (goed)';`));

  await test('словарь: поиск в обе стороны, фраза, поверх урока', () => js(`
    const f = id => document.getElementById(id);
    const ask = async (q) => { const i = f('dict-q'); i.value = q; i.dispatchEvent(new Event('input')); await __sleep(250); return f('dict-out').innerText.replace(/\\s+/g, ' '); };
    f('btn-dict').click();
    for (let i = 0; i < 30 && !f('dict-q'); i++) await __sleep(100);
    for (let i = 0; i < 30 && /Открываю/.test(f('dict-out').innerText); i++) await __sleep(100);
    let t = await ask('кошка'); if (!/cat — кот/.test(t)) throw new Error('кошка → cat: ' + t.slice(0, 120));
    t = await ask('went'); if (!/go — идти/.test(t)) throw new Error('went → go: ' + t.slice(0, 120));
    t = await ask('children'); if (!/child — ребёнок/.test(t)) throw new Error('children: ' + t.slice(0, 120));
    t = await ask('My brother likes apples'); if (!/brother → брат/.test(t) || !/likes → нравиться/.test(t) || !/apples → яблоко/.test(t)) throw new Error('фраза: ' + t.slice(0, 200));
    t = await ask('zzzqx'); if (!/пока нет в словаре/.test(t)) throw new Error('нет сообщения «не найдено»');
    document.querySelector('.drawer-close').click(); await __sleep(350);
    document.querySelector('.map-node').click(); await __sleep(250);
    document.querySelector('#modal .lesson-dict').click(); await __sleep(400);
    if (f('drawer-back').hidden) throw new Error('из урока словарь не открылся');
    document.getElementById('dict-q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await __sleep(350);
    if (!f('drawer-back').hidden || !f('modal-back').classList.contains('open')) throw new Error('Escape должен закрыть только словарь, урок остаётся');
    __close(); return 'кошка→cat, went→go, фраза по словам, урок не закрылся';`));

  await test('лист для печати', () => js(`
    let printed = 0; window.print = () => { printed++; };
    await __gate();
    document.querySelector('#t-ws input[value=lesson]').checked = true; document.getElementById('t-ws-lesson').value = 'g2-toys';
    document.querySelector('#t-ws button[type=submit]').click(); await __sleep(200);
    const el = document.getElementById('print-sheet');
    const rows = el.querySelectorAll('.ws-write tr').length, pages = el.querySelectorAll('.ws-page').length;
    const pics = [...el.querySelectorAll('.ws-match ol:first-child .ws-em')].map(x => x.textContent);
    window.dispatchEvent(new Event('afterprint'));
    if (!printed) throw new Error('печать не вызвана');
    if (rows < 5 || pages !== 2) throw new Error('строк ' + rows + ', страниц ' + pages);
    if (new Set(pics).size !== pics.length) throw new Error('повторяются картинки в «Соедини»: ' + pics.join(''));
    if (el.innerHTML) throw new Error('лист не очищен после печати');
    __close(); return rows + ' слов, «Соедини» без повторов, ответы на 2-й странице';`));

  await test('перенос: код → просмотр → замена → отмена', () => js(`
    await __gate(); document.getElementById('t-bk-code').click(); await __sleep(500);
    const code = document.getElementById('t-bk-code-out').value; if (!code.startsWith('EQ1.')) throw new Error('код: ' + code.slice(0, 10));
    const xp = __ls().xp; __close();
    window.__code = code; window.__xp = xp; return true;`).then(() => js(`
    const code = window.__code, xp = window.__xp;
    const blank = { xp: 7, settings: { theme: 'light' } }; localStorage.setItem('english_quest_v2', JSON.stringify(blank));
    sessionStorage.setItem('code', code); sessionStorage.setItem('xp', xp); return true;`)).then(() => load()).then(() => js(`
    const code = sessionStorage.getItem('code'), xp = +sessionStorage.getItem('xp');
    await __gate(); document.getElementById('t-bk-paste').value = code; document.getElementById('t-bk-paste-go').click(); await __sleep(400);
    document.getElementById('t-bk-view').click(); await __sleep(300);
    if (!document.querySelector('.t-view-banner')) throw new Error('нет режима просмотра');
    if (__ls().xp !== 7) throw new Error('просмотр изменил прогресс');
    document.getElementById('t-view-close').click(); await __sleep(200);
    document.getElementById('t-bk-paste').value = code; document.getElementById('t-bk-paste-go').click(); await __sleep(400);
    document.getElementById('t-bk-replace').click(); await __sleep(400);
    if (__ls().xp !== xp) throw new Error('замена: XP ' + __ls().xp + ' вместо ' + xp);
    document.getElementById('t-bk-undo').click(); await __sleep(400);
    if (__ls().xp !== 7) throw new Error('отмена не вернула прогресс');
    __close(); return 'XP 7 → ' + xp + ' → 7';`)));

  await test('цель дня и серия', () => js(`
    const k = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    const st = __ls(); st.activity = { [k(-2)]: { sec: 700, ok: 1, bad: 0, goalMet: true }, [k(-1)]: { sec: 650, ok: 1, bad: 0, goalMet: true }, [k(0)]: { sec: 590, ok: 0, bad: 0 } };
    localStorage.setItem('english_quest_v2', JSON.stringify(st)); return true;`).then(() => load()).then(() => js(`
    if (document.getElementById('stat-streak').textContent !== '2') throw new Error('серия до: ' + document.getElementById('stat-streak').textContent);
    document.querySelector('.map-node').click(); await __sleep(200); document.querySelector('.hub-ex[data-ex=cards]').click(); await __sleep(200);
    for (let i = 0; i < 5; i++){ window.dispatchEvent(new Event('pointerdown')); await __sleep(2500); }
    __close(); await __sleep(200);
    if (!document.getElementById('goal').classList.contains('met')) throw new Error('цель не выполнена: ' + document.getElementById('goal-sub').textContent);
    if (document.getElementById('stat-streak').textContent !== '3') throw new Error('серия после: ' + document.getElementById('stat-streak').textContent);
    if (!__toasts.some(t => t.includes('Цель дня выполнена'))) throw new Error('нет сообщения');
    return 'серия 2 → 3';`)));

  await test('заморозки серии', () => js(`
    const k = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    const st = __ls(); st.activity = { [k(-3)]: { sec: 700, ok: 1, bad: 0, goalMet: true }, [k(-2)]: { sec: 700, ok: 1, bad: 0, goalMet: true } };
    st.freezes = 1; st.gold = 0;
    localStorage.setItem('english_quest_v2', JSON.stringify(st)); return true;`).then(() => load()).then(() => js(`
    const k = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    const st = __ls();
    if (!st.activity[k(-1)]?.frozen || st.freezes !== 0) throw new Error('заморозка не закрыла вчерашний день: ' + JSON.stringify(st.activity[k(-1)]) + ', freezes ' + st.freezes);
    if (document.getElementById('stat-streak').textContent !== '2') throw new Error('серия после заморозки: ' + document.getElementById('stat-streak').textContent);
    st.activity = { [k(-4)]: { sec: 700, ok: 1, bad: 0, goalMet: true }, [k(-3)]: { sec: 700, ok: 1, bad: 0, goalMet: true } }; st.freezes = 1; st.gold = 60;
    localStorage.setItem('english_quest_v2', JSON.stringify(st)); return true;`)).then(() => load()).then(() => js(`
    const st = __ls();
    if (st.freezes !== 1) throw new Error('при двух пропусках и одной заморозке она потратилась');
    if (document.getElementById('stat-streak').textContent !== '0') throw new Error('серия должна прерваться');
    document.getElementById('stat-freeze').click(); await __sleep(200);
    document.getElementById('freeze-buy').click(); await __sleep(200);
    const b = __ls(); if (b.freezes !== 2 || b.gold !== 10) throw new Error('покупка: заморозок ' + b.freezes + ', монет ' + b.gold);
    if (!document.getElementById('freeze-buy').disabled) throw new Error('можно купить больше двух');
    __close(); await __sleep(100);
    if (document.getElementById('stat-freezes').textContent !== '2') throw new Error('шапка не обновилась');
    return true;`)).then(() => js(`
    const k = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    const st = __ls(); st.activity = {}; for (let d = -6; d <= -1; d++) st.activity[k(d)] = { sec: 700, ok: 1, bad: 0, goalMet: true };
    st.activity[k(0)] = { sec: 590, ok: 0, bad: 0 }; st.freezes = 0;
    localStorage.setItem('english_quest_v2', JSON.stringify(st)); return true;`)).then(() => load()).then(() => js(`
    document.querySelector('.map-node').click(); await __sleep(200); document.querySelector('.hub-ex[data-ex=cards]').click(); await __sleep(200);
    for (let i = 0; i < 5; i++){ window.dispatchEvent(new Event('pointerdown')); await __sleep(2500); }
    __close(); await __sleep(2800);
    const st = __ls();
    if (document.getElementById('stat-streak').textContent !== '7') throw new Error('серия: ' + document.getElementById('stat-streak').textContent);
    if (st.freezes !== 1) throw new Error('за 7 дней не дали заморозку: ' + st.freezes);
    if (!__toasts.some(t => t.includes('+1 заморозка'))) throw new Error('нет сообщения о подарке');
    return 'спасла серию; не тратится впустую; покупка до 2; подарок за 7 дней';`)));

  await test('тёмная тема и Escape', () => js(`
    document.getElementById('btn-theme').click(); await __sleep(100);
    if (document.documentElement.dataset.theme !== 'dark') throw new Error('тема не переключилась');
    document.querySelector('.map-node').click(); await __sleep(200);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await __sleep(100);
    if (document.getElementById('modal-back').classList.contains('open')) throw new Error('Escape не закрыл окно');
    return true;`).then(() => load()).then(() => js(`
    if (document.documentElement.dataset.theme !== 'dark') throw new Error('тема не сохранилась');
    if (document.getElementById('btn-reset')) throw new Error('кнопка сброса всё ещё в шапке');
    return 'тема сохраняется';`)));

  await test('PIN-код и сброс в панели', () => js(`
    await __gate();
    const f = id => document.getElementById(id);
    f('t-pin1').value = '12'; f('t-pin2').value = '12'; f('t-pin-form').requestSubmit(); await __sleep(100);
    if (!/4 цифры/.test(f('t-pin-err').textContent)) throw new Error('короткий PIN принят');
    f('t-pin1').value = '4826'; f('t-pin2').value = '4827'; f('t-pin-form').requestSubmit(); await __sleep(100);
    if (!/не совпадают/.test(f('t-pin-err').textContent)) throw new Error('несовпадение не замечено');
    f('t-pin1').value = '4826'; f('t-pin2').value = '4826'; f('t-pin-form').requestSubmit(); await __sleep(300);
    const saved = JSON.parse(localStorage.getItem('english_quest_profiles')).tutorPin; if (!saved || saved.includes('4826')) throw new Error('PIN сохранён открытым текстом или не сохранён');
    if (__ls().settings.tutorPin) throw new Error('PIN попал в прогресс ученика');
    if (__shown(f('t-pin-form'))) throw new Error('форма нового PIN видна, хотя PIN уже установлен');
    f('t-lock-now').click(); await __sleep(200);
    document.getElementById('btn-tutor').click(); await __sleep(150);
    if (document.getElementById('gate-in').type !== 'password') throw new Error('вход не по PIN');
    for (let i = 0; i < 5; i++){ f('gate-in').value = '0000'; f('gate-form').requestSubmit(); await __sleep(50); }
    if (!/Подождите/.test(f('gate-err').textContent) || !f('gate-go').disabled) throw new Error('нет паузы после 5 попыток: ' + f('gate-err').textContent);
    __close(); return true;`).then(() => load()).then(() => js(`
    const f = id => document.getElementById(id);
    await __gate('4826');
    if (!document.getElementById('t-pin-change')) throw new Error('верный PIN не пустил в панель');
    f('t-lock-now').click(); await __sleep(200);
    document.getElementById('btn-tutor').click(); await __sleep(150);
    f('gate-forgot').click(); await __sleep(150);
    const [a, b] = document.querySelector('.gate-q').textContent.match(/\\d+/g).map(Number);
    if (a < 12 || b < 12) throw new Error('пример для сброса слишком простой: ' + a + '×' + b);
    f('gate-in').value = a * b; f('gate-form').requestSubmit(); await __sleep(300);
    if (JSON.parse(localStorage.getItem('english_quest_profiles')).tutorPin) throw new Error('PIN не убран');
    if (!document.querySelector('.t-warn')) throw new Error('нет отметки о сбросе PIN');
    f('t-report').click(); await __sleep(200);
    if (!/PIN сбрасывали/.test(f('t-report-out').value)) throw new Error('в отчёте нет отметки о сбросе PIN');
    f('t-pin1').value = '1357'; f('t-pin2').value = '1357'; f('t-pin-form').requestSubmit(); await __sleep(300);
    const before = __ls(); const xp = before.xp;
    f('t-reset').click(); await __sleep(400);
    const st = __ls();
    if (st.xp !== 0 || Object.keys(st.inventory).length || Object.keys(st.mistakes).length) throw new Error('сброс неполный');
    if (!JSON.parse(localStorage.getItem('english_quest_profiles')).tutorPin || st.settings.theme !== 'dark') throw new Error('сброс стёр настройки');
    f('t-bk-undo').click(); await __sleep(400);
    if (__ls().xp !== xp) throw new Error('отмена сброса не вернула прогресс');
    __close(); return 'PIN, пауза, «Забыли PIN?», сброс с отменой';`)));

  await test('несколько учеников', () => js(`
    const f = id => document.getElementById(id);
    if (__shown(f('btn-profile'))) throw new Error('чип виден при одном ученике');
    const mainXp = __ls().xp;
    await __gate('1357');
    f('pf-add-name').value = 'Маша <b>'; document.querySelector('input[name=pf-av][value="🐼"]').checked = true;
    f('pf-add').requestSubmit(); await __sleep(400);
    const idx = JSON.parse(localStorage.getItem('english_quest_profiles'));
    if (idx.list.length !== 2) throw new Error('учеников: ' + idx.list.length);
    if (!__shown(f('btn-profile'))) throw new Error('чип не появился');
    document.querySelector('.pf-list [data-act=switch]').click(); await __sleep(500);
    if (!/Маша/.test(f('pf-name').textContent) || document.querySelector('#pf-name b')) throw new Error('не переключилось или имя не экранировано: ' + f('pf-name').innerHTML);
    if (f('stat-xp').textContent !== '0') throw new Error('у нового ученика XP ' + f('stat-xp').textContent);
    const L = window.EQ.LESSONS[0];
    document.querySelector('.map-node').click(); await __sleep(200); document.querySelector('.hub-ex[data-ex=vocab]').click(); await __sleep(300);
    const ans = __byEmoji(L.words, document.querySelector('.q-emoji').textContent);
    [...document.querySelectorAll('.opt')].find(o => o.dataset.en === ans).click(); await __sleep(300); __close(); await __sleep(200);
    const mashaXp = +f('stat-xp').textContent; if (!mashaXp) throw new Error('Маша не получила XP');
    f('btn-profile').click(); await __sleep(400);
    const cards = document.querySelectorAll('.pf-card'); if (cards.length !== 2) throw new Error('карточек: ' + cards.length);
    [...cards].find(c => !c.classList.contains('current')).click(); await __sleep(500);
    if (+f('stat-xp').textContent !== mainXp) throw new Error('прогресс первого ученика изменился: ' + f('stat-xp').textContent + ' вместо ' + mainXp);
    window.__mashaXp = mashaXp; return true;`).then(() => load(APP + '#hw&lesson=g2-family&tasks=vocab')).then(() => js(`
    const f = id => document.getElementById(id);
    const note = document.querySelector('.pf-note')?.textContent || '';
    if (!/домашнее задание/.test(note)) throw new Error('при запуске не спросили, для кого задание');
    const masha = [...document.querySelectorAll('.pf-card')].find(c => /Маша/.test(c.textContent));
    if (!/Уровень \\d+ · \\d+ XP/.test(masha.textContent)) throw new Error('на карточке нет уровня: ' + masha.textContent);
    masha.click(); await __sleep(600);
    if (f('homework-sec').hidden) throw new Error('задание не пришло Маше');
    const idx = JSON.parse(localStorage.getItem('english_quest_profiles'));
    const main = JSON.parse(localStorage.getItem('english_quest_v2'));
    if (main.homework) throw new Error('задание попало и первому ученику');
    await __gate('1357');
    if (!/Маша/.test(document.querySelector('.modal .lead').textContent)) throw new Error('в панели не видно, чей прогресс');
    const del = [...document.querySelectorAll('.pf-list [data-act=delete]')].find(b => /Маша/.test(b.getAttribute('aria-label')));
    del.click(); await __sleep(600);
    const after = JSON.parse(localStorage.getItem('english_quest_profiles'));
    if (after.list.length !== 1) throw new Error('не удалилось');
    if (localStorage.getItem('english_quest_v2__' + idx.list.find(p => /Маша/.test(p.name)).id)) throw new Error('данные Маши остались');
    __close(); await __sleep(100);
    if (__shown(f('btn-profile'))) throw new Error('чип остался после удаления');
    return 'раздельный прогресс, выбор при запуске, задание — выбранному, удаление';`)));

  await test('говори: попытки, подсказки, «Засчитать»', () => js(`
    // поддельное распознавание: отдаёт по очереди заданные ответы или ошибки
    window.__sr = [];
    window.SpeechRecognition = class { start(){ const it = window.__sr.shift(); setTimeout(() => {
      if (it.error){ this.onerror?.({ error: it.error }); this.onend?.(); return; }
      const r = Object.assign(it.alts.map(t => ({ transcript: t })), { isFinal: true });
      this.onresult?.({ results: [r] }); setTimeout(() => this.onend?.(), 30); }, 30); } stop(){} };
    const f = id => document.getElementById(id);
    const attempt = async (item) => { window.__sr.push(item); document.getElementById('mic').click(); await __sleep(250); };
    document.querySelector('.map-node').click(); await __sleep(200); document.querySelector('.hub-ex[data-ex=speak]').click(); await __sleep(500);
    const phrase = [...document.querySelectorAll('#speak-words .sw')].map(x => x.textContent).join(' ');
    const before = __ls().lessonProgress['g2-letters']?.speak || 0, xpBefore = __ls().xp;
    await attempt({ alts: ['banana rocket'] });
    if (!document.querySelector('#speak-words .sw.miss')) throw new Error('нет красных слов после неудачи');
    // красное слово: есть своя запись — звучит само слово (теперь записаны все слова фраз и буквы),
    // нет записи — вся фраза медленнее (проверяем на слове, запись которого временно «прячем»)
    const byWord = w => [...document.querySelectorAll('#speak-words .sw')].find(x => x.textContent.replace(/[^A-Za-z]/g, '').toLowerCase() === w);
    window.__said = null; byWord('is').click(); await __sleep(300);
    if (__said !== 'is') throw new Error('для «is» ожидалось само слово, прозвучало: ' + __said);
    const first = document.querySelector('#speak-words .sw'); const letter = first.textContent.replace(/[^A-Za-z]/g, '');
    window.__said = null; first.click(); await __sleep(300);
    if (__said !== letter) throw new Error('для буквы «' + letter + '» ожидалось её название, прозвучало: ' + __said);
    // без записи слова → фраза медленнее
    window.__said = null; byWord('is').textContent = 'isx'; byWord('isx')?.click(); await __sleep(300);
    if (__said !== phrase || __lastAudio.playbackRate !== 0.8) throw new Error('для слова без записи ожидалась фраза медленно, прозвучало: ' + __said + ' @' + __lastAudio.playbackRate);
    const last = [...document.querySelectorAll('#speak-words .sw')].pop(); const lw = last.textContent.replace(/[^A-Za-z]/g, '').toLowerCase();
    window.__said = null; last.click(); await __sleep(300);
    if (String(__said).toLowerCase() !== lw) throw new Error('для «' + lw + '» ожидалось само слово, прозвучало: ' + __said);
    if (!/Почти/.test(f('rec-result').textContent)) throw new Error('нет подсказки после неудачи: ' + f('rec-result').textContent);
    if (__ls().xp !== xpBefore) throw new Error('за неудачу что-то списали или начислили');
    await attempt({ alts: ['zzz'] });
    if (!f('self-ok').hidden) throw new Error('«Засчитать» появилось слишком рано');
    await attempt({ alts: ['zzz'] });
    if (f('self-ok').hidden) throw new Error('после 3 неудач нет «Засчитать»');
    await attempt({ alts: ['totally wrong', phrase.toLowerCase().replace(/[.,!?]/g, '')] });
    if (!/100%/.test(f('rec-result').textContent)) throw new Error('не выбран лучший вариант распознавания: ' + f('rec-result').textContent);
    await __sleep(1800);
    if ((__ls().lessonProgress['g2-letters']?.speak || 0) !== before + 1) throw new Error('фраза не засчитана');
    await attempt({ error: 'not-allowed' });
    if (!/Нет доступа к микрофону/.test(f('rec-result').textContent)) throw new Error('непонятная ошибка микрофона: ' + f('rec-result').textContent);
    if (f('self-ok').hidden) throw new Error('при запрете микрофона нет «Засчитать»');
    __close(); await __sleep(100);
    delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
    document.querySelector('.map-node').click(); await __sleep(200); document.querySelector('.hub-ex[data-ex=speak]').click(); await __sleep(400);
    if (document.getElementById('mic') || f('self-ok').hidden || !/не умеет распознавать/.test(f('speak-hint').textContent)) throw new Error('нет запасного варианта для браузера без распознавания');
    f('self-ok').click(); await __sleep(900);
    if ((__ls().lessonProgress['g2-letters']?.speak || 0) !== before + 2) throw new Error('«Я сказал(а)» не засчитало');
    __close(); return 'красные слова, без штрафа, «Засчитать» после 3 попыток, лучший вариант, ошибки, без распознавания';`));

  await test('гид и офлайн-раздел', () => js(`
    document.getElementById('guide').hidden = false; window.__said = null;
    document.getElementById('guide-avatar').click(); await __sleep(300);
    if (!window.__said) throw new Error('иконка гида не озвучила текст');
    document.getElementById('guide-close').click(); await __sleep(100);
    if (__shown(document.getElementById('guide'))) throw new Error('«Скрыть» не скрыло пузырь гида');
    await __gate();
    for (let i = 0; i < 20 && /Проверяю/.test(document.getElementById('t-audio-stat')?.textContent || 'Проверяю'); i++) await __sleep(200);
    const stat = document.getElementById('t-audio-stat')?.textContent || '';
    if (!/Озвучка на устройстве|Вся озвучка сохранена/.test(stat)) throw new Error('раздел «Без интернета»: ' + stat);
    __close(); return 'ок';`));

  await test('гайд How to', async () => {
    const before = await js(`localStorage.removeItem('eq_howto_seen'); return true;`).then(() => load()).then(() => js(`
      const b = document.getElementById('btn-howto');
      if (!b || b.getAttribute('href') !== 'how-to.html') throw new Error('нет кнопки ❓ в шапке');
      if (!__shown(document.getElementById('howto-new'))) throw new Error('нет метки «новое» до первого открытия');
      if (!document.querySelector('.footer-links a[href="how-to.html"]')) throw new Error('нет ссылки внизу страницы');
      return true;`));
    await send('Page.navigate', { url: APP + 'how-to.html' }); await sleep(1500);
    const info = await js(`
      for (const id of ['kids', 'parents', 'tutors', 'faq', 'map', 'rewards', 'mistakes', 'homework', 'team'])
        if (!document.getElementById(id)) throw new Error('нет раздела #' + id);
      const r = document.querySelectorAll('.ht-rank').length, t = document.querySelectorAll('.ht-hero-card').length, g = document.querySelectorAll('.ht-grade').length;
      if (r !== window.EQ.RANKS.length || t !== 5 || g !== 3) throw new Error('списки из контента: званий ' + r + ', героев ' + t + ', классов ' + g);
      if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error('горизонтальная прокрутка');
      if (![...document.querySelectorAll('a[href="./"]')].length) throw new Error('нет ссылки назад к урокам');
      return r + ' званий, ' + t + ' героев, ' + g + ' класса';`);
    await load();
    await js(`if (__shown(document.getElementById('howto-new'))) throw new Error('метка «новое» не исчезла после открытия гайда'); return true;`);
    return info + '; метка снимается после посещения';
  });

  // Сервер учителя: подключение по ссылке, объединение с другим устройством, кабинет, просмотр, отключение.
  await test('сервер учителя: синхронизация и кабинет', async () => {
    const srv = await startApi();
    try {
      const owner = (await call('/login', { body: { code: srv.ownerCode } })).data.token;
      const stu = (await call('/students', { token: owner, body: { name: 'Ваня', avatar: '🐯' } })).data.student;
      const codeA = (await call(`/students/${stu.id}/code`, { token: owner, body: {} })).data.code;
      await js(`localStorage.setItem('eq_api', '${srv.api}'); return true;`);
      await load(APP + '?device=a#link=' + codeA);   // ?… — чтобы страница перезагрузилась, а не только сменился #
      const xpBefore = await js(`
        const f = id => document.getElementById(id);
        if (!f('cl-go')) throw new Error('ссылка #link не предложила подключиться');
        if (location.hash) throw new Error('код остался в адресе');
        const xp = __ls().xp;
        f('cl-go').click();
        for (let i = 0; i < 30 && !f('cl-this'); i++) await __sleep(100);
        if (!f('cl-this')) throw new Error('не спросили, чей прогресс на устройстве');
        f('cl-this').click();
        for (let i = 0; i < 40 && !__toasts.some(t => /сохранён на сервере/.test(t)); i++) await __sleep(100);
        if (!__toasts.some(t => /сохранён на сервере/.test(t))) throw new Error('нет подтверждения: ' + __toasts.join(' / '));
        const idx = JSON.parse(localStorage.getItem('english_quest_profiles'));
        if (idx.list[0].cloud?.studentId !== '${stu.id}' || idx.list[0].name !== 'Ваня') throw new Error('профиль не привязан');
        return xp;`);
      let r = await call(`/students/${stu.id}/progress`, { token: owner });
      assert(r.data.state?.xp === xpBefore && r.data.version === 1, `на сервере не тот прогресс: xp ${r.data.state?.xp} vs ${xpBefore}`);

      // «второе устройство» добавляет 50 XP и золото, пока это устройство тоже занимается
      const codeB = (await call(`/students/${stu.id}/code`, { token: owner, body: {} })).data.code;
      const devB = (await call('/claim', { body: { code: codeB, label: 'Телефон' } })).data.token;
      const remote = (await call('/progress', { token: devB })).data;
      await call('/progress', { token: devB, body: { base: remote.version, state: { ...remote.state, xp: remote.state.xp + 50, gold: remote.state.gold + 7 } } });
      const local = await js(`const s = __ls(); s.xp += 5; localStorage.setItem('english_quest_v2', JSON.stringify(s)); return s;`);
      await load();
      await js(`for (let i = 0; i < 40 && __ls().xp !== ${local.xp + 50}; i++) await __sleep(100); if (__ls().xp !== ${local.xp + 50}) throw new Error('XP после объединения: ' + __ls().xp + ', ждали ${local.xp + 50}'); if (__ls().gold !== ${local.gold + 7}) throw new Error('золото: ' + __ls().gold); return true;`);
      for (let i = 0; i < 30; i++){ r = await call(`/students/${stu.id}/progress`, { token: owner }); if (r.data.state?.xp === local.xp + 50) break; await sleep(100); }
      assert(r.data.state?.xp === local.xp + 50, 'объединённый прогресс не ушёл на сервер: ' + r.data.state?.xp);

      // админ-панель (старый адрес teacher.html переадресует туда)
      await js(`localStorage.setItem('eq_teacher', '${owner}'); return true;`);
      await send('Page.navigate', { url: APP + 'teacher.html' });
      let cab = null;
      for (let i = 0; i < 40 && !cab; i++){ await sleep(200); cab = await js(`const row = document.querySelector('tr[data-id="${stu.id}"]'); return row ? location.pathname + '|' + row.innerText : null;`).catch(() => null); }
      assert(cab && /\/admin\/\|/.test(cab) && /Ваня/.test(cab), 'админ-панель не открылась или нет ученика: ' + cab);
      await js(`
        const wait = async (fn, n = 40) => { for (let i = 0; i < n && !fn(); i++) await new Promise(r => setTimeout(r, 150)); return fn(); };
        const row = document.querySelector('tr[data-id="${stu.id}"]');
        if (row.children[7].textContent.trim() !== '2') throw new Error('устройств: ' + row.children[7].textContent);
        if (!document.getElementById('adm-tab-users') || document.getElementById('adm-tab-users').hidden) throw new Error('владелец не видит раздел «Репетиторы»');
        row.click();
        if (!await wait(() => document.getElementById('adm-hw'))) throw new Error('карточка ученика не открылась');
        if (!/Ваня/.test(document.querySelector('.adm-h1').textContent)) throw new Error('не та карточка');
        document.getElementById('adm-hw-lesson').selectedIndex = 0;
        document.getElementById('adm-hw-note').value = 'Задание из админки';
        document.getElementById('adm-hw').requestSubmit();
        if (!await wait(() => /Задание из админки/.test(document.querySelector('.t-hw-current')?.textContent || ''))) throw new Error('задание не появилось в карточке');
        document.getElementById('adm-code-btn').click();
        if (!await wait(() => document.querySelector('.tc-code-box .t-link'))) throw new Error('нет кода подключения');
        const link = document.querySelector('.tc-code-box .t-link').value;
        if (!/#link=[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(link)) throw new Error('нет ссылки подключения: ' + link);
        if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error('горизонтальная прокрутка в карточке');
        document.getElementById('adm-pdf').click();
        if (!await wait(() => window.eqAdmin.lastPdf, 200)) throw new Error('PDF не собрался');
        if (window.eqAdmin.lastPdf.size < 20000) throw new Error('PDF подозрительно маленький: ' + window.eqAdmin.lastPdf.size);
        location.hash = '#users';
        if (!await wait(() => document.getElementById('adm-user-add'))) throw new Error('раздел «Репетиторы» не открылся');
        document.getElementById('adm-user-name').value = 'Ольга Николаевна'; document.getElementById('adm-user-access').value = 'code';
        document.getElementById('adm-user-add').requestSubmit();
        if (!await wait(() => /admin\\/#login=/.test(document.querySelector('#adm-user-code .t-link')?.value || ''))) throw new Error('нет кода входа для репетитора');
        if (!/Ольга Николаевна/.test(document.querySelector('.adm-table').textContent)) throw new Error('репетитор не в списке');
        location.hash = '#me';
        if (!await wait(() => document.querySelector('.adm-badge'))) throw new Error('раздел «Мои входы» не открылся');
        document.getElementById('adm-me-code').click();
        if (!await wait(() => /admin\\/#login=/.test(document.querySelector('.tc-code-box .t-link')?.value || ''))) throw new Error('нет кода для другого устройства');
        return true;`);
      r = await call(`/students/${stu.id}/progress`, { token: owner });
      assert(r.data.state?.homework?.note === 'Задание из админки', 'домашка не сохранилась на сервере');

      // просмотр прогресса ученика из кабинета
      await load(APP + '?view=1#view=' + stu.id);
      await js(`for (let i = 0; i < 30 && !document.querySelector('.t-view-banner'); i++) await __sleep(100);
        const b = document.querySelector('.t-view-banner');
        if (!b || !/Ваня — прогресс с сервера/.test(b.textContent)) throw new Error('нет просмотра с сервера: ' + (b?.textContent || ''));
        __close(); return true;`);

      // учитель отключил устройство — приложение продолжает работать без сервера
      const devs = (await call(`/students/${stu.id}/devices`, { token: owner })).data.devices;
      await call(`/devices/${devs[0].id}/delete`, { token: owner, body: {} });
      await load();
      await js(`for (let i = 0; i < 30 && JSON.parse(localStorage.getItem('english_quest_profiles')).list[0].cloud; i++) await __sleep(100);
        if (JSON.parse(localStorage.getItem('english_quest_profiles')).list[0].cloud) throw new Error('профиль не отвязался');
        const seen = [...__toasts, ...[...document.querySelectorAll('.toast')].map(t => t.textContent)];   // могло появиться ещё до заглушек теста
        if (!seen.some(t => /отключено от сервера/.test(t))) throw new Error('нет сообщения об отключении');
        return true;`);
      // ученик входит в приложении по логину и паролю (выданным в админке)
      await call(`/students/${stu.id}`, { token: owner, body: { login: 'vanya' } });
      const temp = (await call(`/students/${stu.id}/password`, { token: owner, body: { mode: 'temp' } })).data.tempPassword;
      await js(`const f = id => document.getElementById(id);
        if ([...document.querySelectorAll('footer a')].some(a => /admin/.test(a.getAttribute('href')))) throw new Error('на главной осталась ссылка в кабинет учителя');
        await __gate('1357');   // в панели для взрослых — только подсказка и кнопка, ведущая к входу в шапке
        for (let i = 0; i < 20 && !f('cl-open-account'); i++) await __sleep(100);
        if (!f('cl-open-account') || f('cl-login-form')) throw new Error('в панели должна быть кнопка «Войти», а не своя форма');
        f('cl-open-account').click(); await __sleep(350);
        if (!f('drawer-back').classList.contains('open') || !f('cl-login-form')) throw new Error('кнопка из панели не открыла вход');
        if (/Кабинет учителя/.test(f('drawer-body').innerText)) throw new Error('в панели входа ссылка в кабинет учителя');
        f('cl-login').value = 'Vanya'; f('cl-password').value = '${temp}';
        f('cl-login-form').requestSubmit();
        const linked = () => JSON.parse(localStorage.getItem('english_quest_profiles')).list.some(p => p.cloud?.studentId === '${stu.id}');
        for (let i = 0; i < 40 && !linked(); i++){ if (f('cl-this')) f('cl-this').click(); await __sleep(100); }
        if (!linked()) throw new Error('ученик не вошёл по логину');
        return true;`);
      // кнопка в шапке показывает, кто вошёл; выход и вход — в выезжающей панели
      await js(`const f = id => document.getElementById(id);
        const name = () => f('acc-name').textContent;
        const linked = () => JSON.parse(localStorage.getItem('english_quest_profiles')).list.some(p => p.cloud?.studentId === '${stu.id}');
        for (let i = 0; i < 20 && name() !== 'Ваня'; i++) await __sleep(100);
        if (f('btn-account').hidden || name() !== 'Ваня') throw new Error('в шапке не видно, кто вошёл: ' + name());
        f('btn-account').click(); await __sleep(350);
        if (!f('drawer-back').classList.contains('open') || !/Вы вошли как\\s*Ваня/.test(f('drawer-body').innerText)) throw new Error('панель входа не показывает ученика');
        f('cl-unlink').click();
        for (let i = 0; i < 20 && name() !== 'Войти'; i++) await __sleep(100);
        if (name() !== 'Войти' || linked()) throw new Error('выход из панели не сработал: ' + name());
        f('cl-login').value = 'vanya'; f('cl-password').value = 'неверный';
        f('cl-login-form').requestSubmit();
        for (let i = 0; i < 80 && f('cl-err')?.hidden !== false; i++) await __sleep(100);
        if (!f('drawer-back').classList.contains('open') || !/не подошли/.test(f('cl-err')?.textContent || '')) throw new Error('нет ошибки неверного пароля в панели');
        if (f('cl-login').value !== 'vanya') throw new Error('после ошибки стёрся логин');
        f('cl-password').value = '${temp}';
        f('cl-login-form').requestSubmit();
        for (let i = 0; i < 40 && !linked(); i++){ if (f('cl-this')) f('cl-this').click(); await __sleep(100); }
        for (let i = 0; i < 20 && name() !== 'Ваня'; i++) await __sleep(100);
        if (!linked() || name() !== 'Ваня' || f('drawer-back').classList.contains('open')) throw new Error('вход из панели в шапке не сработал: ' + name() + ' | ' + (f('cl-err')?.textContent || ''));
        return true;`);

      // админка: вход по почте и паролю, приглашение по ссылке из письма
      await call('/me/email', { token: owner, body: { email: 'owner@example.org' } });
      await call('/me/password', { token: owner, body: { password: 'owner-pass-1' } });
      await js(`localStorage.removeItem('eq_teacher'); return true;`);
      await send('Page.navigate', { url: APP + 'admin/?p=1' });
      let ok = null;
      for (let i = 0; i < 30 && !ok; i++){ await sleep(200); ok = await js(`return !!document.getElementById('adm-login-form');`).catch(() => false); }
      assert(ok, 'в админке нет формы входа по почте');
      await js(`document.getElementById('adm-email').value = 'owner@example.org'; document.getElementById('adm-password').value = 'owner-pass-1';
        document.getElementById('adm-login-form').requestSubmit();
        for (let i = 0; i < 30 && !/Владелец/.test(document.getElementById('adm-who').textContent); i++) await new Promise(r => setTimeout(r, 150));
        if (!/Владелец/.test(document.getElementById('adm-who').textContent)) throw new Error('не вошли по почте и паролю: ' + document.querySelector('.gate-err')?.textContent);
        return true;`);
      await call('/users', { token: owner, body: { name: 'Нина', email: 'nina@example.org', access: 'invite' } });
      const inviteLink = /#reset=([0-9a-f]{64})/.exec(srv.mails().at(-1)?.text || '')?.[1];
      assert(inviteLink, 'нет письма с приглашением');
      await js(`localStorage.removeItem('eq_teacher'); return true;`);
      await send('Page.navigate', { url: APP + 'admin/?r=1#reset=' + inviteLink });
      ok = null;
      for (let i = 0; i < 30 && !ok; i++){ await sleep(200); ok = await js(`return !!document.getElementById('adm-reset-form');`).catch(() => false); }
      assert(ok, 'ссылка из письма не открыла «Задайте пароль»');
      await js(`document.getElementById('adm-reset-p1').value = 'nina-pass-1'; document.getElementById('adm-reset-p2').value = 'nina-pass-1';
        document.getElementById('adm-reset-form').requestSubmit();
        for (let i = 0; i < 30 && !/Нина/.test(document.getElementById('adm-who').textContent); i++) await new Promise(r => setTimeout(r, 150));
        if (!/Нина · Репетитор/.test(document.getElementById('adm-who').textContent)) throw new Error('после пароля не вошли: ' + document.getElementById('adm-who').textContent);
        return true;`);
      return 'подключение по ссылке, объединение +50 XP, админ-панель (домашка, PDF, репетитор), просмотр, отключение, вход по логину и паролю, приглашение по почте';
    } finally {
      await js(`localStorage.removeItem('eq_api'); localStorage.removeItem('eq_teacher'); return true;`).catch(() => {});
      await srv.stop();
    }
  });

  await test('без ошибок JavaScript', async () => { assert(!errors.length, errors.join(' | ')); return 'ни одной'; });
} catch (e) {
  results.push({ ok: false, name: 'запуск', info: e.message });
} finally {
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.info && r.info !== true ? '  — ' + r.info : ''}`);
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed} из ${results.length} прошли`);
  try { ws?.close(); } catch (e) {}
  chrome.kill(); server.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
