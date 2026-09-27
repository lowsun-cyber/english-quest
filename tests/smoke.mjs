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
async function load(url = APP){ await send('Page.navigate', { url }); await sleep(1800); await js(STUBS); }

// Звук в тесте выключен; запоминаем, что «сказали», чтобы отвечать на задания на слух.
const STUBS = `
  window.__said = null;
  const man = await (await fetch('tts_manifest.json')).json(); const rev = {}; for (const [k, v] of Object.entries(man)) rev[v] = rev[v] || k;
  window.speechSynthesis.speak = u => { window.__said = u.text; };
  window.Audio = function(src){ const k = String(src).split('/').pop().replace(/\\.(mp3|m4a)$/, ''); window.__said = rev[k] || src; return { play: () => Promise.resolve(), pause(){}, set currentTime(v){} }; };
  window.confirm = () => true;
  window.__sleep = t => new Promise(r => setTimeout(r, t));
  window.__toasts = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.classList?.contains('toast') && window.__toasts.push(n.textContent)))).observe(document.body, { childList: true });
  window.__gate = async () => { document.getElementById('btn-tutor').click(); await __sleep(150); const q = document.querySelector('.gate-q'); if (q){ const [a, b] = q.textContent.match(/\\d+/g).map(Number); document.getElementById('gate-in').value = a * b; document.getElementById('gate-form').requestSubmit(); await __sleep(300); } };
  window.__ls = () => JSON.parse(localStorage.getItem('english_quest_v2') || 'null');
  window.__close = () => document.getElementById('modal-close').click();
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
    for (let i = 0; i < 6; i++){ const q = document.querySelector('.q-emoji'); const ans = L.words.find(w => w.emoji === q.textContent).en;
      [...document.querySelectorAll('.opt')].find(o => i < 2 ? o.dataset.en !== ans : o.dataset.en === ans).click(); await __sleep(i < 2 ? 1600 : 1000); }
    const st = __ls(); __close();
    if (Object.keys(st.mistakes).length !== 2) throw new Error('ошибок: ' + Object.keys(st.mistakes).length);
    if (st.hearts !== 3) throw new Error('сердечек: ' + st.hearts);
    if (st.lessonProgress['g2-letters'].vocab !== 4) throw new Error('прогресс: ' + JSON.stringify(st.lessonProgress));
    return 'XP ' + st.xp + ', ошибок 2, сердечек 3';`));

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
    const w = L.words.find(w => w.emoji === document.querySelector('.q-emoji').textContent).en;
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
    for (let i = 0; i < 2; i++){ const ans = words.find(w => w.emoji === document.querySelector('.q-emoji').textContent).en;
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
      else if (s) ans = gram.find(g => g.q === s.textContent).a;
      else ans = opts.find(o => o.toLowerCase() === String(__said).toLowerCase());
      [...document.querySelectorAll('.opt')].find(o => o.dataset.o === ans).click(); await __sleep(1300); }
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
      const ans = L.words.find(w => w.emoji === document.querySelector('.q-emoji').textContent).en;
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

  await test('тёмная тема, Escape и сброс', () => js(`
    document.getElementById('btn-theme').click(); await __sleep(100);
    if (document.documentElement.dataset.theme !== 'dark') throw new Error('тема не переключилась');
    document.querySelector('.map-node').click(); await __sleep(200);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await __sleep(100);
    if (document.getElementById('modal-back').classList.contains('open')) throw new Error('Escape не закрыл окно');
    return true;`).then(() => load()).then(() => js(`
    if (document.documentElement.dataset.theme !== 'dark') throw new Error('тема не сохранилась');
    document.getElementById('btn-reset').click(); await __sleep(200);
    const st = __ls(); if (st.xp !== 0 || Object.keys(st.inventory).length || Object.keys(st.mistakes).length) throw new Error('сброс неполный');
    return 'тема сохраняется, сброс чистый';`)));

  await test('говори, гид, офлайн-раздел', () => js(`
    document.querySelector('.map-node').click(); await __sleep(200); document.querySelector('.hub-ex[data-ex=speak]').click(); await __sleep(600);
    if (!document.querySelector('.speak-phrase')) throw new Error('нет фразы для повторения');
    const mic = document.querySelector('.mic-btn'); if (!mic) throw new Error('нет кнопки микрофона');
    mic.click(); await __sleep(500); mic.click(); await __sleep(200);
    const skip = document.getElementById('skip'); if (skip) { skip.click(); await __sleep(300); }
    __close(); await __sleep(100);
    document.getElementById('guide').hidden = false; window.__said = null;
    document.getElementById('guide-avatar').click(); await __sleep(300);
    if (!window.__said) throw new Error('иконка гида не озвучила текст');
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
