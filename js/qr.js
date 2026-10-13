// English Quest — QR-код для карточки ключа семьи, без библиотек. Стандарт QR Model 2: байтовый режим,
// коррекция ошибок M (~15 %), версии 1–10 (до 213 байт — ссылка с ключом занимает ~50). Порядок шагов —
// как в справочной реализации Nayuki (MIT): служебные узоры → данные с кодом Рида — Соломона → маска.
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];   // уровень M, по версиям
const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];  // всего кодовых слов в версии
const MAX_VER = 10;

const bit = (x, i) => ((x >>> i) & 1) !== 0;

// умножение в поле GF(256) с многочленом 0x11D
function gfMul(x, y){
  let z = 0;
  for (let i = 7; i >= 0; i--){ z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
  return z;
}
function rsDivisor(deg){
  const r = new Array(deg).fill(0); r[deg - 1] = 1;
  let root = 1;
  for (let i = 0; i < deg; i++){
    for (let j = 0; j < deg; j++){ r[j] = gfMul(r[j], root); if (j + 1 < deg) r[j] ^= r[j + 1]; }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, div){
  const r = div.map(() => 0);
  for (const b of data){
    const f = b ^ r.shift(); r.push(0);
    div.forEach((c, i) => { r[i] ^= gfMul(c, f); });
  }
  return r;
}

// Кодовые слова: режим «байты», длина, данные, конец, заполнители; затем блоки с исправлением и чередование
function codewords(bytes, ver){
  const dataLen = TOTAL[ver] - ECC_PER_BLOCK[ver] * BLOCKS[ver];
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  put(4, 4); put(bytes.length, ver < 10 ? 8 : 16);
  bytes.forEach(b => put(b, 8));
  put(0, Math.min(4, dataLen * 8 - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xEC; bits.length < dataLen * 8; pad ^= 0xEC ^ 0x11) put(pad, 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  const nb = BLOCKS[ver], ecc = ECC_PER_BLOCK[ver], raw = TOTAL[ver];
  const shortN = nb - raw % nb, shortLen = Math.floor(raw / nb);
  const div = rsDivisor(ecc), blocks = [];
  for (let i = 0, k = 0; i < nb; i++){
    const d = data.slice(k, k + shortLen - ecc + (i < shortN ? 0 : 1));
    k += d.length;
    const blk = d.concat(rsRemainder(d, div));
    if (i < shortN) blk.splice(shortLen - ecc, 0, 0);   // место-заглушка, чтобы чередовать ровно
    blocks.push(blk);
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - ecc || j >= shortN) out.push(b[i]); });
  return out;
}

function alignPositions(ver){
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
  const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const res = [6];
  for (let pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
  return res;
}

// Матрица модулей (true — тёмный) для строки; null — не поместилось
export function qrMatrix(text){
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  while (ver <= MAX_VER && bytes.length + 2 + (ver < 10 ? 0 : 1) > TOTAL[ver] - ECC_PER_BLOCK[ver] * BLOCKS[ver]) ver++;
  if (ver > MAX_VER) return null;
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };

  for (let i = 0; i < size; i++){ set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++){
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  const al = alignPositions(ver), last = al.length - 1;
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const drawFormat = mask => {
    const data = (0 << 3) | mask;   // уровень M = 0b00
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const b = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i));
    set(8, 7, bit(b, 6)); set(8, 8, bit(b, 7)); set(7, 8, bit(b, 8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i));
    set(8, size - 8, true);
  };
  drawFormat(0);
  if (ver >= 7){
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const b = (ver << 12) | rem;
    for (let i = 0; i < 18; i++){ const a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, bit(b, i)); set(c, a, bit(b, i)); }
  }

  const data = codewords(bytes, ver);
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2){
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++){
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - v : v;
      if (!fn[y][x] && i < data.length * 8){ m[y][x] = bit(data[i >>> 3], 7 - (i & 7)); i++; }
    }
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0,
  ];
  const applyMask = k => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[k](x, y)) m[y][x] = !m[y][x]; };
  let best = 0, bestScore = Infinity;
  for (let k = 0; k < 8; k++){
    applyMask(k); drawFormat(k);
    const s = penalty(m, size);
    if (s < bestScore){ best = k; bestScore = s; }
    applyMask(k);   // XOR — повторное наложение снимает маску
  }
  applyMask(best); drawFormat(best);
  return m;
}

// Штраф маски (правила стандарта): длинные ряды одного цвета, квадраты 2×2, похожее на угловой узор, баланс
function penalty(m, size){
  let s = 0;
  const line = get => {
    let run = 1;
    for (let i = 1; i <= size; i++){
      if (i < size && get(i) === get(i - 1)) run++;
      else { if (run >= 5) s += run - 2; run = 1; }
    }
    const str = Array.from({ length: size }, (_, i) => get(i) ? '1' : '0').join('');
    for (const p of ['10111010000', '00001011101']) for (let k = str.indexOf(p); k !== -1; k = str.indexOf(p, k + 1)) s += 40;
  };
  for (let y = 0; y < size; y++) line(x => m[y][x]);
  for (let x = 0; x < size; x++) line(y => m[y][x]);
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++){
    if (m[y][x]) dark++;
    if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) s += 3;
  }
  s += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return s;
}

// SVG: всегда чёрное на белом (и в тёмной теме — иначе телефон не прочтёт), поле 4 модуля
export function qrSvg(text, label = 'QR-код'){
  const m = qrMatrix(text);
  if (!m) return '';
  const n = m.length + 8;
  let d = '';
  m.forEach((row, y) => row.forEach((on, x) => { if (on) d += `M${x + 4} ${y + 4}h1v1h-1z`; }));
  return `<svg class="qr" viewBox="0 0 ${n} ${n}" role="img" aria-label="${label}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
