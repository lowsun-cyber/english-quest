#!/usr/bin/env node
// Проверка сравнения речи для «Говори» (js/speech.js) — без браузера и микрофона.
//   node tests/speech.mjs
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const { scoreSpeech, tokens, candidatesFromResults, PASS_SCORE } = await import(join(ROOT, 'js/speech.js'));
const sb = { window: {} };
vm.runInNewContext(readFileSync(join(ROOT, 'content.js'), 'utf8'), sb);
const phrases = [...new Set(sb.window.EQ.LESSONS.flatMap(l => l.phrases))];

let fail = 0, total = 0;
const check = (name, cond, info = '') => { total++; if (!cond){ fail++; console.log(`FAIL  ${name}${info ? '  — ' + info : ''}`); } };

// как распознавание обычно возвращает правильно сказанную фразу
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20 };
const asRecognized = p => p.toLowerCase().replace(/[.,!?"]/g, '')
  .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty)\b/g, m => NUM[m])
  .replace(/\bi am\b/g, "i'm").replace(/\bit is\b/g, "it's").replace(/\blet us\b/g, "let's")
  .replace(/\bdo not\b/g, "don't").replace(/\bmum\b/g, 'mom').replace(/\bcolour\b/g, 'color').replace(/\bfavourite\b/g, 'favorite');

for (const p of phrases){
  check(`точно: «${p}»`, scoreSpeech(p, [p.toLowerCase()]).score === 100);
  const r = scoreSpeech(p, [asRecognized(p)]);
  check(`как распознаётся: «${p}» ← «${asRecognized(p)}»`, r.score === 100, `score ${r.score}, красные: ${r.words.filter(w => !w.ok).map(w => w.raw).join(' ')}`);
  // половина слов вместо фразы — не должна проходить (кроме совсем коротких фраз)
  const ws = p.split(/\s+/); if (ws.length >= 4){
    const half = ws.slice(0, Math.floor(ws.length / 2) - 1).join(' ');
    check(`неполная фраза не проходит: «${half}»`, scoreSpeech(p, [half]).score < PASS_SCORE, `score ${scoreSpeech(p, [half]).score}`);
  }
  check(`чужая фраза не проходит: «${p}»`, scoreSpeech(p, ['banana pizza rocket']).score < PASS_SCORE);
}

// частные случаи
check('цифры', scoreSpeech('How old are you? I am nine.', ["how old are you i'm 9"]).score === 100);
check('сокращения в фразе и в речи', scoreSpeech("Let's sing the ABC!", ['let us sing the abc']).score === 100);
check('mum/mom', scoreSpeech('I always help my mum.', ['i always help my mom']).score === 100);
check('огрехи в длинных словах', scoreSpeech('Elephants eat leaves.', ['elephant eat leaves']).score === 100);
check('короткие слова строго', scoreSpeech('I can jump like a frog.', ['i can champ like a frog']).words.find(w => w.raw === 'jump').ok === false);
check('порядок слов', scoreSpeech('Open the door, please.', ['please door the open']).score < 100);
check('лучший из вариантов', scoreSpeech('I can jump like a frog.', ['i can champ like a frog', 'i can jump like a frog']).score === 100);
check('красные слова — именно пропущенные', JSON.stringify(scoreSpeech('Do you like ice cream?', ['do you like cream']).words.filter(w => !w.ok).map(w => w.raw)) === '["ice"]');
check('кандидаты из сегментов', JSON.stringify(candidatesFromResults([[{ transcript: 'how old' }, { transcript: 'who old' }], [{ transcript: 'are you' }]])) === JSON.stringify(['how old are you', 'who old are you']));
check('tokens', JSON.stringify(tokens("I'm 9, Tom's dog!")) === JSON.stringify(['i', 'am', 'nine', 'tom', 'dog']));

console.log(`\n${total - fail} из ${total} проверок прошли (фраз в уроках: ${phrases.length})`);
process.exit(fail ? 1 : 0);
