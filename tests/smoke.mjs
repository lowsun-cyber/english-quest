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

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const PORT = 8765, APP = `http://127.0.0.1:${PORT}/`;
const CHROME = process.env.CHROME || ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// если порт уже занят (например, другим сервером), тест упал бы на всём подряд — лучше сказать прямо
try { await fetch(APP); console.error(`Порт ${PORT} уже занят — остановите другой сервер и запустите тест снова.`); process.exit(2); } catch (e) {}

const profile = mkdtempSync(join(tmpdir(), 'eq-smoke-'));
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore', cwd: tmpdir() });
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9335', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1200,900', 'about:blank'], { stdio: 'ignore' });

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
    if (nodes !== 10) throw new Error('узлов на карте: ' + nodes);
    if (document.getElementById('stat-xp').textContent !== '0') throw new Error('XP не 0');
    if (!/0 \\/ 10 мин/.test(document.getElementById('goal-sub').textContent)) throw new Error('цель дня: ' + document.getElementById('goal-sub').textContent);
    return 'карта 10 узлов, цель 0/10';`));

  await test('карта: текущая и закрытая тема', () => js(`
    const n = document.querySelectorAll('.map-node');
    if (!n[0].classList.contains('current') || !n[1].classList.contains('locked')) throw new Error(n[0].className + ' / ' + n[1].className);
    n[1].click(); await __sleep(100);
    if (!__toasts.some(t => t.includes('Сначала пройди'))) throw new Error('нет подсказки о замке');
    return 'ok';`));

  await test('экран темы и карточки', () => js(`
    document.querySelector('.map-node').click(); await __sleep(200);
    const ex = [...document.querySelectorAll('.hub-ex')].map(b => b.dataset.ex).join(',');
    if (ex !== 'cards,vocab,listen,match,spell,grammar,reading,speak') throw new Error(ex);
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
    const st = __ls(); for (const id of ['g2-hello', 'g2-family', 'g2-home']) st.lessonProgress[id] = { vocab: 3, listen: 3, grammar: 2, reading: 1 };
    localStorage.setItem('english_quest_v2', JSON.stringify(st)); return true;`).then(() => load()).then(() => js(`
    const LS = window.EQ.LESSONS.filter(l => l.grade === 2).slice(0, 4), words = LS.flatMap(l => l.words), gram = LS.flatMap(l => l.grammar);
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
    // красное слово без своей записи («is») — звучит вся фраза медленнее; со своей записью — само слово
    const byWord = w => [...document.querySelectorAll('#speak-words .sw')].find(x => x.textContent.replace(/[^A-Za-z]/g, '').toLowerCase() === w);
    window.__said = null; byWord('is').click(); await __sleep(300);
    if (__said !== phrase || __lastAudio.playbackRate !== 0.8) throw new Error('для «is» ожидалась фраза медленно, прозвучало: ' + __said + ' @' + __lastAudio.playbackRate);
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
