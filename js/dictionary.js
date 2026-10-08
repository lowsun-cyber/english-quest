// English Quest — Словарь: найти слово по-английски или по-русски, перевести фразу по словам, послушать.
// Открывается в выезжающей панели — поверх урока, упражнение под ней не закрывается.
// Данные: слова уроков Quest (их перевод главный) + базовый словарь dict-data.js (загружается при первом открытии).
import { EMOJI, LESSONS } from './eq.js';
import { speak } from './tts.js';
import { drawerShows, openDrawer } from './ui.js';
import { escapeHtml } from './util.js';

const MAX_RESULTS = 30;
const CYR = /[а-яё]/i;
export const normDict = s => String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
// варианты перевода через запятую; запятые внутри скобок — часть пояснения
const splitRu = ru => String(ru || '').split(/,\s*(?![^()]*\))/).map(s => s.trim()).filter(Boolean);

// ---------- индекс ----------
let index = null;
export async function loadDictionary(){
  if (index) return index;
  const { DICT, FORMS } = await import('./dict-data.js');
  const byEn = new Map();
  const add = (en, ru, extra = {}) => {
    const k = normDict(en);
    if (!k) return;
    let e = byEn.get(k);
    if (!e){ e = { en: en.trim(), ru: [], emoji: '', lessons: [] }; byEn.set(k, e); }
    for (const r of ru) if (!e.ru.includes(r)) e.ru.push(r);
    if (extra.emoji && !e.emoji) e.emoji = extra.emoji;
    if (extra.lesson && !e.lessons.includes(extra.lesson)) e.lessons.push(extra.lesson);
  };
  for (const l of LESSONS) for (const w of l.words) add(w.en, splitRu(w.ru), { emoji: w.emoji, lesson: l });
  for (const line of DICT.split('\n')){
    if (!line || line.startsWith('#')) continue;
    const [en, ru] = line.split('|');
    add(en, splitRu(ru));
  }
  for (const e of byEn.values()){
    if (!e.emoji) e.emoji = EMOJI[normDict(e.en).replace(/[ -]/g, '_')] || '';
    // для поиска по-русски: каждый вариант без пояснений в скобках
    e.ruN = e.ru.flatMap(r => r.split(';')).map(r => normDict(r.replace(/\([^)]*\)/g, ''))).filter(Boolean);
  }
  const forms = new Map(FORMS.split('\n').filter(Boolean).map(l => l.split('|').map(normDict)));
  return index = { entries: [...byEn.values()], byEn, forms };
}

// went → go, apples → apple, playing → play, bigger → big
function enCandidates(w, forms){
  const out = [w];
  if (forms.has(w)) out.push(forms.get(w));
  const cut = (n, add = '') => out.push(w.slice(0, -n) + add);
  if (w.endsWith("'s")) cut(2);
  if (w.endsWith('ies') || w.endsWith('ied')) cut(3, 'y');
  if (w.endsWith('es')) cut(2);
  if (w.endsWith('s') && !w.endsWith('ss')) cut(1);
  if (w.endsWith('ed')){ cut(2); cut(1); if (/(.)\1ed$/.test(w)) cut(3); }
  if (w.endsWith('ing')){ cut(3); cut(3, 'e'); if (/(.)\1ing$/.test(w)) cut(4); }
  if (w.endsWith('er')){ cut(2); cut(1); if (/(.)\1er$/.test(w)) cut(3); if (w.endsWith('ier')) cut(3, 'y'); }
  if (w.endsWith('est')){ cut(3); cut(2); if (/(.)\1est$/.test(w)) cut(4); if (w.endsWith('iest')) cut(4, 'y'); }
  return [...new Set(out)].filter(x => x.length > 1 || x === 'i' || x === 'a');
}
// кошки → кошк: окончания у русских слов разные, ищем по основе
const ruStem = w => w.length > 4 ? w.slice(0, -2) : w.length > 3 ? w.slice(0, -1) : w;

// Поиск одного слова или выражения: [[статья, оценка]], лучшие сначала.
// 100 — точно, 85–90 — начальная форма или отдельное слово перевода, 50–60 — начало слова, 20 — часть слова.
export function scoredSearch(idx, query){
  const q = normDict(query);
  if (!q) return [];
  const score = new Map();
  const bump = (e, s) => { if ((score.get(e) || 0) < s) score.set(e, s); };
  if (CYR.test(q)){
    const stem = ruStem(q);
    // «люблю», «играет» — глагол: из статей с той же основой выше те, где перевод — глагол (любить, а не любой)
    const verb = /(ю|у|ешь|ет|ем|ете|ют|ут|ишь|ит|им|ите|ят|ат|ть|ться|л|ла|ли)$/.test(q);
    for (const e of idx.entries) for (const r of e.ruN){
      const words = r.split(' ');
      if (r === q) bump(e, 100);
      else if (words.includes(q)) bump(e, 85);
      else if (r.startsWith(q) || words.some(t => t.startsWith(q))) bump(e, 60);
      else if (stem.length >= 3 && words.some(t => t.startsWith(stem))) bump(e, 50 + (verb && words.some(t => t.startsWith(stem) && /ть(ся)?$/.test(t)) ? 5 : 0));
      else if (q.length >= 3 && r.includes(q)) bump(e, 20);
    }
  } else {
    enCandidates(q, idx.forms).forEach((c, i) => { const e = idx.byEn.get(c); if (e) bump(e, i === 0 ? 100 : 90); });
    for (const e of idx.entries){
      const k = normDict(e.en);
      if (k.startsWith(q)) bump(e, 60 - Math.min(20, k.length - q.length));
      else if (q.length >= 3 && k.includes(q)) bump(e, 20);
    }
  }
  return [...score].sort((a, b) => b[1] - a[1] || a[0].en.length - b[0].en.length).slice(0, MAX_RESULTS);
}
export const searchDictionary = (idx, query) => scoredSearch(idx, query).map(x => x[0]);

// Фраза, которой нет целиком: на каждое слово — лучшая статья (если совпадение надёжное) или null
export function glossPhrase(idx, query){
  return String(query).split(/[\s,.!?;:"«»()]+/).filter(Boolean).map(t => {
    const best = scoredSearch(idx, t)[0];
    return { t, e: best && best[1] >= 50 ? best[0] : null };
  });
}

// ---------- панель ----------
let lastQuery = '';
const ruText = e => e.ru.join(', ');
function itemHtml(e){
  const where = e.lessons.length ? `<div class="dict-where">${e.lessons.slice(0, 2).map(l => `урок «${escapeHtml(l.title)}», ${l.grade} класс`).join(' · ')}</div>` : '';
  return `
    <li class="dict-item">
      <span class="dict-em" aria-hidden="true">${e.emoji || '📘'}</span>
      <div class="dict-main"><b class="dict-en" lang="en">${escapeHtml(e.en)}</b> — <span class="dict-ru">${escapeHtml(ruText(e))}</span>${where}</div>
      <button class="icon-btn dict-say" data-say="${escapeHtml(e.en)}" aria-label="Послушать ${escapeHtml(e.en)}">🔊</button>
    </li>`;
}
function resultsHtml(idx, query){
  const q = normDict(query);
  if (!q) return `<p class="t-muted">Напиши слово по-английски или по-русски — например, <b>cat</b>, <b>кошка</b>, <b>went</b>.<br>Можно целую фразу: <b>I like apples</b> или <b>я люблю яблоки</b> — переведу по словам.</p>`;
  const found = searchDictionary(idx, q);
  const phrase = q.includes(' ') && !(found[0] && (normDict(found[0].en) === q || found[0].ruN.includes(q)));
  let html = '';
  if (phrase){
    const g = glossPhrase(idx, query);
    if (g.length > 1){
      const ru = CYR.test(q);
      html += `<div class="dict-gloss"><div class="dict-gloss-title">По словам</div><ol class="dict-gloss-list">${g.map(({ t, e }) => `
        <li><span class="dict-gloss-src">${escapeHtml(t)}</span> → ${e ? `<b ${ru ? 'lang="en"' : ''}>${escapeHtml(ru ? e.en : e.ru[0])}</b>` : '<span class="t-muted">?</span>'}</li>`).join('')}</ol>
        ${ru ? '' : `<button class="btn secondary dict-say-all" data-say="${escapeHtml(query.trim())}">🔊 Послушать фразу</button>`}
        <p class="t-muted dict-note">Перевод по словам — подсказка: порядок слов в английском и русском бывает разным.</p></div>`;
    }
  }
  const list = phrase ? [] : found;
  if (list.length) html += `<ul class="dict-list" role="list">${list.map(itemHtml).join('')}</ul>`;
  else if (!phrase) html += `<p class="t-muted">Такого слова пока нет в словаре Quest. Проверь, нет ли опечатки, или попробуй начальную форму: <b>go</b> вместо <b>goes</b>.</p>`;
  return html;
}
export async function openDictionary(query){
  if (typeof query === 'string') lastQuery = query;
  const body = openDrawer('dictionary', '📖 Словарь', `
    <form class="dict-form" role="search" onsubmit="return false">
      <input id="dict-q" type="search" placeholder="Слово по-английски или по-русски" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="Слово для поиска" value="${escapeHtml(lastQuery)}" />
    </form>
    <div id="dict-out" aria-live="polite"><p class="t-muted">Открываю словарь…</p></div>`);
  if (!body) return;
  const input = body.querySelector('#dict-q'), out = body.querySelector('#dict-out');
  let idx;
  try { idx = await loadDictionary(); }
  catch (e) { out.innerHTML = '<p class="t-muted">Словарь не загрузился. Проверь интернет и открой ещё раз.</p>'; return; }
  if (!drawerShows('dictionary')) return;
  const show = () => { lastQuery = input.value; out.innerHTML = resultsHtml(idx, input.value); };
  let t = null;
  input.oninput = () => { clearTimeout(t); t = setTimeout(show, 120); };
  out.onclick = (e) => { const b = e.target.closest('[data-say]'); if (b) speak(b.dataset.say, { lang: 'en' }); };
  show();
  setTimeout(() => { input.focus(); input.select(); }, 60);
}

// Кнопки «📖» — в шапке и в каждом уроке (data-open-dict, разметка урока перерисовывается)
export function initDictionary(){
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open-dict]');
    if (b){ e.preventDefault(); openDictionary(); }
  });
}
