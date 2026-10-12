#!/usr/bin/env node
// Проверка посылки от Dr. Harlow (AI-пакет) перед загрузкой — те же правила, что в админ-панели (js/aipack.js).
//   node tools/parcel.mjs посылка.json [ещё.json …]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadContent } from './packs.mjs';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
globalThis.window = { EQ: loadContent() };   // js/eq.js берёт контент из window.EQ
const { validateParcel, questSize } = await import(join(ROOT, 'js/aipack.js'));

const files = process.argv.slice(2);
if (!files.length){ console.log('Укажите файл: node tools/parcel.mjs посылка.json'); process.exit(2); }
let bad = 0;
for (const f of files){
  let p = null;
  try { p = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { console.log(`✗ ${f}: не JSON — ${e.message}`); bad++; continue; }
  const errs = validateParcel(p);
  if (errs.length){ bad++; console.log(`✗ ${f}`); for (const e of errs) console.log(`  — ${e}`); continue; }
  console.log(`✓ ${f}: «${p.title}», приз ${p.reward.emoji} ${p.reward.title}`);
  for (const q of p.quests) console.log(`  ${q.emoji} ${q.title} — ${questSize(q)} заданий${q.focus?.length ? ` (${q.focus.join(', ')})` : ''}`);
}
process.exit(bad ? 1 : 0);
