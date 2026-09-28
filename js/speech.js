// English Quest — Сравнение сказанного ребёнком с фразой для упражнения «Говори».
// Чистые функции без DOM: их проверяет tests/speech.mjs.
//
// Распознавание речи возвращает текст «как услышало»: цифрами (9), с сокращениями (I'm),
// по-американски (mom). Учебник британский и пишет словами. Поэтому обе стороны приводим
// к одному виду и сравниваем по порядку слов, прощая мелкие огрехи в длинных словах.

const CONTRACTIONS = {
  "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are',
  "he's": 'he is', "she's": 'she is', "it's": 'it is', "that's": 'that is', "there's": 'there is',
  "what's": 'what is', "where's": 'where is', "who's": 'who is', "how's": 'how is', "here's": 'here is',
  "let's": 'let us', "i've": 'i have', "you've": 'you have', "we've": 'we have', "they've": 'they have',
  "i'll": 'i will', "you'll": 'you will', "we'll": 'we will', "it'll": 'it will', "i'd": 'i would',
  "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "can't": 'can not', 'cannot': 'can not',
  "won't": 'will not', "isn't": 'is not', "aren't": 'are not', "wasn't": 'was not', "weren't": 'were not',
  "haven't": 'have not', "hasn't": 'has not', "couldn't": 'could not', "shouldn't": 'should not', "wouldn't": 'would not',
};
// британское → американское (распознавание почти всегда отдаёт американский вариант)
const SAME = {
  mum: 'mom', mummy: 'mommy', colour: 'color', colours: 'colors', favourite: 'favorite', grey: 'gray',
  maths: 'math', centre: 'center', theatre: 'theater', neighbour: 'neighbor', practise: 'practice',
  okay: 'ok', o: 'oh', dr: 'doctor', prof: 'professor', mr: 'mister', mrs: 'missus',
};
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numberWords(n){
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + numberWords(n % 100) : '');
  return String(n);
}
const ORD = { '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth', '6th': 'sixth', '7th': 'seventh', '8th': 'eighth', '9th': 'ninth', '10th': 'tenth' };

// «How old are you? I'm 9.» → ['how', 'old', 'are', 'you', 'i', 'am', 'nine']
export function tokens(text){
  let t = String(text).toLowerCase().replace(/[’‘`´]/g, "'").replace(/\([^)]*\)/g, ' ');
  t = t.replace(/(\d+)(st|nd|rd|th)\b/g, m => ORD[m] || m);
  t = t.replace(/\d+/g, m => ' ' + numberWords(+m) + ' ');
  t = t.replace(/[-–—/]/g, ' ').replace(/[^a-z' ]/g, ' ');
  const out = [];
  for (let w of t.split(/\s+/)){
    w = w.replace(/^'+|'+$/g, '');
    if (!w) continue;
    const exp = CONTRACTIONS[w];
    if (exp){ out.push(...exp.split(' ')); continue; }
    w = w.replace(/'s$/, '');          // Tom's → tom
    w = w.replace(/'/g, '');
    if (w) out.push(SAME[w] || w);
  }
  return out;
}

function lev(a, b){
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// слово засчитано: совпало, или в длинном слове одна буква иначе (распознавание часто так ошибается)
export function sameWord(target, said){ return target === said || (target.length >= 5 && lev(target, said) <= 1); }

// Какие слова фразы прозвучали — по порядку (наибольшая общая подпоследовательность)
function align(t, s){
  const dp = Array.from({ length: t.length + 1 }, () => new Array(s.length + 1).fill(0));
  for (let i = t.length - 1; i >= 0; i--) for (let j = s.length - 1; j >= 0; j--)
    dp[i][j] = sameWord(t[i], s[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ok = new Array(t.length).fill(false);
  let i = 0, j = 0;
  while (i < t.length && j < s.length){
    if (sameWord(t[i], s[j]) && dp[i][j] === dp[i + 1][j + 1] + 1){ ok[i] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return ok;
}

// Слова фразы для показа: исходное написание + нормализованные части (I'm → i, am)
export function phraseWords(phrase){
  return String(phrase).replace(/"/g, '').split(/\s+/).filter(Boolean).map(raw => ({ raw, parts: tokens(raw) }));
}

// alternatives — варианты распознавания (лучший первым). Возвращает лучший разбор:
// { score 0..100, words: [{ raw, ok }], said }
export function scoreSpeech(phrase, alternatives){
  const words = phraseWords(phrase);
  const flat = words.flatMap((w, wi) => w.parts.map(p => ({ p, wi })));
  let best = null;
  for (const said of alternatives.filter(Boolean)){
    const ok = align(flat.map(x => x.p), tokens(said));
    // слово на экране засчитано, если засчитаны все его части
    const wordOk = words.map((w, wi) => w.parts.length === 0 || flat.every((x, k) => x.wi !== wi || ok[k]));
    const counted = words.filter(w => w.parts.length);
    const hits = counted.filter(w => wordOk[words.indexOf(w)]).length;
    const score = counted.length ? Math.round(hits * 100 / counted.length) : 0;
    if (!best || score > best.score) best = { score, said, words: words.map((w, wi) => ({ raw: w.raw, ok: wordOk[wi] })) };
  }
  return best || { score: 0, said: '', words: words.map(w => ({ raw: w.raw, ok: false })) };
}

// Кандидаты из результата SpeechRecognition: для каждого номера альтернативы склеиваем сегменты
export function candidatesFromResults(results){
  const segs = Array.from(results).filter(r => r.isFinal !== false);
  const maxAlt = Math.max(1, ...segs.map(r => r.length));
  const out = [];
  for (let a = 0; a < maxAlt; a++) out.push(segs.map(r => (r[a] || r[0]).transcript).join(' ').trim());
  return [...new Set(out.filter(Boolean))];
}

export const PASS_SCORE = 60;
