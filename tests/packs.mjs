#!/usr/bin/env node
// Пакеты локаций: проверка всех пакетов в packs/, актуальность packs.js и подключение (addPacks) без браузера.
//   node tests/packs.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, buildPacksJs, enabledPacks, listPacks, loadContent, packLines, validatePack } from '../tools/packs.mjs';

let fail = 0, total = 0;
const check = (name, cond, info = '') => { total++; if (!cond){ fail++; console.log(`FAIL  ${name}${info !== '' ? '  — ' + JSON.stringify(info) : ''}`); } };
const read = f => JSON.parse(readFileSync(join(ROOT, f), 'utf8'));

// 1. пакеты в папке: формат; подключённые — строго (с озвучкой); packs.js собран из подключённых
const base = loadContent(), enabled = enabledPacks(), files = listPacks();
for (const f of files){
  const p = read(`packs/${f}`), errs = validatePack(p, base, { strict: enabled.includes(p.id), file: f });
  check(`пакет ${f}`, !errs.length, errs);
}
check('packs/index.json — только существующие пакеты', enabled.every(id => files.includes(`${id}.json`)), enabled);
const want = buildPacksJs(enabled.map(id => read(`packs/${id}.json`)));
check('packs.js собран из подключённых пакетов (node tools/packs.mjs)', readFileSync(join(ROOT, 'packs.js'), 'utf8') === want);

// 2. валидатор ловит ошибки
const space = read('packs/example-g4-space.json'), toy = read('packs/example-g3-toybox.json');
const bad = (patch, p = toy) => validatePack({ ...JSON.parse(JSON.stringify(p)), ...patch }, base);
check('ошибка: неизвестный навык', bad({ quests: [{ ...toy.quests[0], grammar: [{ ...toy.quests[0].grammar[0], skill: 'G9-99' }] }] }).some(e => /G9-99/.test(e)));
check('ошибка: ответ не среди вариантов', bad({ quests: [{ ...toy.quests[0], grammar: [{ ...toy.quests[0].grammar[0], a: 'Them' }] }] }).length > 0);
check('ошибка: нет такой темы', bad({ lessonId: 'g3-nope' }).some(e => /lessonId/.test(e)));
check('ошибка: неизвестное упражнение', bad({ quests: [{ ...toy.quests[0], kind: 'dance' }] }).some(e => /kind/.test(e)));
check('ошибка: метка вне сцены', bad({ scene: { image: 'og-image.png', width: 100, height: 100, markers: [{ quest: 'toybox-this-these', x: 150, y: 10 }] } }).some(e => /вне сцены/.test(e)));
check('сцена с меткой внутри — без ошибок', !bad({ scene: { image: 'og-image.png', width: 100, height: 100, markers: [{ quest: 'toybox-this-these', x: 50, y: 50 }] } }).length);
check('ошибка: в новой теме мало слов', bad({ lesson: { ...space.lesson, words: space.lesson.words.slice(0, 3) } }, space).some(e => /слов/.test(e)));
check('ошибка: тема с таким id уже есть', bad({ id: 'g3-school' }, space).some(e => /уже есть/.test(e)));
check('строгая проверка: неозвученное', validatePack(toy, base, { strict: true }).some(e => /не озвучено/.test(e)));

// 3. подключение (addPacks) — на копии контента с обоими примерами
const EQ = loadContent();
const g4 = () => EQ.LESSONS.filter(l => l.grade === 4).sort((a, b) => a.order - b.order);
const before = g4().map(l => l.id), maxOrder = Math.max(...g4().map(l => l.order));
EQ.addPacks([space, toy]);
const after = g4().map(l => l.id), sp = EQ.LESSONS.find(l => l.id === space.id);
check('новая тема — в конце своего региона', after.length === before.length + 1 && after[after.length - 1] === space.id && sp.order === maxOrder + 1);
check('старые темы на своих местах — проверки не сдвигаются', before.every((id, i) => after[i] === id));
check('у новой темы — дата, слой и пакет', sp.addedAt === space.addedAt && sp.layer === 'ext' && sp.pack === space.id);
check('повторное подключение не дублирует', (EQ.addPacks([space]), EQ.LESSONS.filter(l => l.id === space.id).length === 1));
const toys = EQ.LESSONS.find(l => l.id === 'g3-toys3'), kind = 'x:toybox-this-these';
check('новый квест в старой теме', toys.extraQuests?.length === 1 && EQ.extraQuestOf(toys, kind)?.kind === 'grammar');
const sub = EQ.questLesson(toys, kind);
check('квест из пакета — на своих вопросах и словах темы', sub.grammar === toy.quests[0].grammar && sub.words === toys.words && sub.questKind === kind && sub.id === toys.id);
check('у обычного квеста тема не меняется', EQ.questLesson(toys, 'grammar') === toys);
const lines = EQ.voiceLines().map(x => x.text);
check('фразы пакета — в озвучке', packLines(toy).every(t => lines.includes(t)) && lines.includes(EQ.lessonStartLine(sp)));
check('«Новое» — 14 дней', EQ.isNewItem('2026-10-11', Date.parse('2026-10-20')) && !EQ.isNewItem('2026-10-11', Date.parse('2026-10-26')) && !EQ.isNewItem(null));

// 4. квесты, ошибки и звания с пакетами (stats.js)
globalThis.window = { EQ };
const S = await import(join(ROOT, 'js/stats.js'));
const q = S.lessonQuests(toys).find(x => x.kind === kind);
check('квест из пакета на доске, редкость из пакета', q?.rarity === 'rare');
check('название квеста из пакета', S.questTitle(toys, kind) === '🧸 Коробка с игрушками');
const fresh = { lessonProgress: {}, quests: {}, settings: {} };
check('квест из пакета закрыт по тем же правилам', S.questLock(toys, kind, fresh) !== null);
check('«Новое» у неначатого квеста из пакета', S.questIsNew(toys, kind, fresh) === EQ.isNewItem(toy.addedAt));
const gq = toy.quests[0].grammar[0];
const r = S.resolveMistake({ type: 'grammar', lessonId: toys.id, ref: gq.q });
check('ошибка в квесте из пакета — в «Моих ошибках»', r?.q === gq);
const rw = S.resolveMistake({ type: 'word', lessonId: sp.id, ref: 'rocket' });
check('слово новой темы — в «Моих ошибках»', rw?.word.en === 'rocket');
// звание не теряется, когда в регион добавили тему и появилась новая проверка
const g4l = g4(), ck = S.checkpointsOf(4);
const st = { lessonProgress: Object.fromEntries(g4l.slice(0, -1).map(l => [l.id, { vocab: 3, listen: 3, grammar: 2, reading: 1 }])), checkpoints: Object.fromEntries(ck.slice(0, -1).map(c => [c.id, { best: 9, passedAt: 1 }])), rankSteps: { expedition: 3 } };
check('звание сохраняется (rankSteps)', S.regionRanks(st).find(x => x.region.id === 'expedition').step >= 3);

console.log(`\n${total - fail} из ${total} проверок пакетов прошли`);
process.exit(fail ? 1 : 0);
