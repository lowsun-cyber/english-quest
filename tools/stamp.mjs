#!/usr/bin/env node
// Версия в адресах скриптов и стилей: style.css → style.css?v=3f9a1c2b7e.
// Хостинг разрешает браузерам хранить JS и CSS неделю; с новой версией в адресе браузер сразу берёт новые файлы.
//
// Версия — по содержимому всех скриптов и стилей: правка только в тексте страницы её не меняет.
// Метятся ВСЕ относительные импорты в модулях: один модуль под двумя адресами (с версией и без)
// загрузился бы дважды, и у приложения стало бы два разных «состояния».
// Запускается при выкладке на копии сайта (в репозитории адреса остаются без версии):
//   node tools/stamp.mjs <папка сайта>
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dir = process.argv[2];
if (!dir){ console.error('Укажите папку сайта: node tools/stamp.mjs _site'); process.exit(2); }

const SKIP = new Set(['.git', '.github', 'node_modules', 'tests', 'tools', 'server', 'tts_cache', '_site']);
function walk(d, out = []){
  for (const name of readdirSync(d)){
    if (SKIP.has(name)) continue;
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const all = walk(dir).sort();
const assets = all.filter(p => /\.(js|css)$/.test(p) && !/(^|\/)sw\.js$/.test(p));
const pages = all.filter(p => p.endsWith('.html'));

const h = createHash('sha256');
for (const p of assets){ h.update(relative(dir, p)); h.update(readFileSync(p)); }
const ver = h.digest('hex').slice(0, 10);
const tag = url => `${url}?v=${ver}`;

let count = 0;
const rewrite = (p, fn) => { const s = readFileSync(p, 'utf8'), t = fn(s); if (t !== s){ writeFileSync(p, t); count++; } };
// страницы: <script src="…js"> и <link href="…css"> со своего сайта
for (const p of pages) rewrite(p, s => s
  .replace(/(<script\b[^>]*\bsrc=")([^"?#:]+\.js)(")/g, (m, a, u, b) => a + tag(u) + b)
  .replace(/(<link\b[^>]*\bhref=")([^"?#:]+\.css)(")/g, (m, a, u, b) => a + tag(u) + b));
// модули: import … from './x.js', import './x.js', import('./x.js')
const IMPORT = /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"?#]+\.js)\2/g;
for (const p of assets.filter(p => p.endsWith('.js'))) rewrite(p, s => s.replace(IMPORT, (m, a, q, u) => a + q + tag(u) + q));

// проверка: не осталось относительных импортов без версии
const left = assets.filter(p => p.endsWith('.js')).flatMap(p => [...readFileSync(p, 'utf8').matchAll(IMPORT)].filter(m => !m[3].includes('?v=')).map(m => `${relative(dir, p)}: ${m[3]}`));
if (left.length){ console.error('Импорты без версии:\n' + left.join('\n')); process.exit(1); }
console.log(`Версия ${ver}: обновлено файлов — ${count}`);
