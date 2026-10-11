// English Quest — Карта-путь региона (docs/design-v2/STYLE.md, раздел 7; эскиз 34-screen-map-path).
// Дорога через темы класса: у темы — островок с рисунком места, после каждых 4 тем — испытание (щит).
// Рисунок (фон, дорога, островки) — одно SVG в координатах эскиза шириной 390 px, растягивается по ширине;
// метки, таблички и «Ты здесь» — HTML поверх, в процентах тех же координат. Нажатие на метку — карточка рядом.
import { LOCATION_ART } from './eq.js';
import { heroPic, playerHero } from './heroes.js';
import { escapeHtml } from './util.js';

const W = 390, LEFT = 110, RIGHT = 280, MID = 195, STEP = 160, BOSS_GAP = 170, TOP = 250;

// Оформление регионов (паспорт, запись 3): долина — луг и тропа, город — мостовая и разметка, экспедиция — песок и грунт
const THEMES = {
  2: { bg: '#b6e09c', grid: 'rgba(0,0,0,0.06)', done: '#f3dcb5', doneDash: '#c0742c', ahead: '#d6dcd8', aheadDash: '#9fb0b8', deco: 'bush', ground: '#8fcf6e' },
  3: { bg: '#d3d2c8', grid: 'rgba(0,0,0,0.10)', done: '#c9b28c', doneDash: '#fffdf6', ahead: '#8e969e', aheadDash: '#e6e9ec', deco: 'lamp', ground: '#8fcf6e', cobble: true },
  4: { bg: '#f1dfb8', grid: 'rgba(139,90,43,0.10)', done: '#c99a63', doneDash: '#7a4b1c', ahead: '#dccfb4', aheadDash: '#b8a687', deco: 'cactus', ground: '#e9d3a8' },
};
const K = '#1c2b1a';
const DECO = {
  bush: (x, y) => `<circle cx="${x}" cy="${y}" r="13" fill="#7cc35c" stroke="${K}" stroke-width="2.5"/><circle cx="${x + 12}" cy="${y + 6}" r="9" fill="#7cc35c" stroke="${K}" stroke-width="2.5"/>`,
  lamp: (x, y) => `<path d="M${x} ${y + 30} V${y - 16}" stroke="${K}" stroke-width="4" stroke-linecap="round"/><rect x="${x - 8}" y="${y - 30}" width="16" height="16" rx="3" fill="#ffe680" stroke="${K}" stroke-width="2.5"/><path d="M${x - 10} ${y - 30} h20" stroke="${K}" stroke-width="3" stroke-linecap="round"/><ellipse cx="${x}" cy="${y + 31}" rx="9" ry="3" fill="rgba(0,0,0,.18)"/>`,
  cactus: (x, y) => `<path d="M${x} ${y + 22} V${y - 16} M${x} ${y} h-9 v-10 M${x} ${y - 4} h9 v-12" fill="none" stroke="${K}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><path d="M${x} ${y + 22} V${y - 16} M${x} ${y} h-9 v-10 M${x} ${y - 4} h9 v-12" fill="none" stroke="#5aa851" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><ellipse cx="${x + 22}" cy="${y + 20}" rx="9" ry="6" fill="#b8a687" stroke="${K}" stroke-width="2.5"/>`,
};

// Расставляем узлы: темы — слева/справа по очереди, испытания — по центру
export function layout(nodes){
  let y = TOP, side = 0;
  return nodes.map((n, i) => {
    if (i > 0) y += (n.kind === 'checkpoint' || nodes[i - 1].kind === 'checkpoint') ? BOSS_GAP : STEP;
    const x = n.kind === 'checkpoint' ? MID : (side++ % 2 ? RIGHT : LEFT);
    return { ...n, x, y, node: n };   // node — исходный узел карты (по нему st и label)
  });
}
const art = n => n.kind === 'checkpoint' ? LOCATION_ART[n.cp.id] : (n.lesson.island || LOCATION_ART[n.lesson.id]);

// Дорога: плавные кривые между метками (центр метки — на 46 px ниже центра островка, как в эскизе)
function roadPath(pts){
  let d = `M${pts[0].x} ${pts[0].y - 35} C${pts[0].x} ${pts[0].y + 10} ${pts[0].x} ${pts[0].y - 30} ${pts[0].x} ${pts[0].y + 46}`;
  for (let i = 1; i < pts.length; i++){
    const a = pts[i - 1], b = pts[i];
    d += ` C${a.x} ${a.y + 46 + 75} ${b.x} ${b.y + 46 - 75} ${b.x} ${b.y + 46}`;
  }
  return d;
}

// st(n): 'done' | 'current' | 'open' | 'locked'; label(n): подпись для экранных дикторов
export function renderPath(wrap, { grade, nodes, st, label, hero, head = '', tail = '' }){
  const T = THEMES[grade] || THEMES[2];
  const pts = layout(nodes);
  const last = pts[pts.length - 1];
  const H = (last?.y || TOP) + 150 + 190;
  const curIdx = pts.findIndex(p => st(p.node) === 'current');
  // песчаная «пройденная» дорога — до текущей метки, а если её нет — до последней пройденной
  const doneUpTo = curIdx >= 0 ? curIdx : Math.max(0, pts.reduce((m, p, i) => st(p.node) === 'done' ? i : m, -1));
  const pct = (v, total) => `${(v / total * 100).toFixed(3)}%`;
  const deco = pts.map((p, i) => {
    // украшения — на свободной стороне от островка
    const x = p.x === LEFT ? 352 : p.x === RIGHT ? 32 : (i % 2 ? 30 : 356);
    return DECO[T.deco](x, p.y - 60 + (i % 3) * 18);
  }).join('');
  const islands = pts.map(p => {
    const a = art(p), muted = st(p.node) === 'locked' ? ' filter="url(#mute)"' : '';
    if (a?.img) return `<image href="${a.img}" x="${p.x - 100}" y="${p.y - 112}" width="200" height="170"${muted}/>`;
    // без рисунка (например, тема из пакета) — островок региона с эмодзи темы
    const em = p.kind === 'lesson' ? (p.lesson.words[0]?.emoji || '📘') : '🛡️';
    return `<g${muted}><ellipse cx="${p.x}" cy="${p.y + 30}" rx="86" ry="26" fill="${T.ground}" stroke="${K}" stroke-width="3"/><text x="${p.x}" y="${p.y + 4}" text-anchor="middle" font-size="64">${em}</text></g>`;
  }).join('');
  const road = roadPath(pts), doneRoad = roadPath(pts.slice(0, doneUpTo + 1));
  const svg = `<svg class="path-art" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">
    <defs><filter id="mute"><feColorMatrix type="saturate" values="0.12"/></filter>
      <pattern id="path-tiles-${grade}" width="48" height="48" patternUnits="userSpaceOnUse"><rect width="48" height="48" fill="${T.bg}"/>${T.cobble
        ? `<g fill="none" stroke="${T.grid}" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="5"/><rect x="26" y="2" width="20" height="20" rx="5"/><rect x="14" y="26" width="20" height="20" rx="5"/><rect x="-10" y="26" width="20" height="20" rx="5"/><rect x="38" y="26" width="20" height="20" rx="5"/></g>`
        : `<path d="M48 0H0V48" fill="none" stroke="${T.grid}" stroke-width="1"/>`}</pattern></defs>
    <rect width="${W}" height="${H}" fill="url(#path-tiles-${grade})"/>
    ${deco}
    <path d="${road}" fill="none" stroke="${K}" stroke-width="34" stroke-linecap="round"/>
    <path d="${road}" fill="none" stroke="${T.ahead}" stroke-width="27" stroke-linecap="round"/>
    <path d="${doneRoad}" fill="none" stroke="${T.done}" stroke-width="27" stroke-linecap="round"/>
    <path d="${road}" fill="none" stroke="${T.aheadDash}" stroke-width="3" stroke-dasharray="2 14" stroke-linecap="round"/>
    <path d="${doneRoad}" fill="none" stroke="${T.doneDash}" stroke-width="4" stroke-dasharray="2 14" stroke-linecap="round"/>
    ${islands}
    <rect x="0" y="${H - 190}" width="${W}" height="190" fill="#3a4150"/>
    <path d="M0 ${H - 190} q30 -26 60 0 q30 -30 66 0 q34 -24 66 0 q32 -30 66 0 q30 -24 66 0 q32 -28 66 0 V${H - 180} H0 Z" fill="#3a4150"/>
    <polygon points="40,${H - 70} 110,${H - 150} 180,${H - 70}" fill="#4b5566" stroke="#5d6778" stroke-width="3"/><polygon points="150,${H - 70} 240,${H - 170} 330,${H - 70}" fill="#4b5566" stroke="#5d6778" stroke-width="3"/>
  </svg>`;
  const LOCK = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="#4a5a48" stroke-width="3"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="#4a5a48" stroke-width="3" stroke-linecap="round"/></svg>';
  let num = 0;
  const marks = pts.map((p, i) => {
    const s = st(p.node), boss = p.kind === 'checkpoint';
    if (!boss) num++;
    const mark = s === 'locked' ? LOCK : s === 'done' ? '★' : boss ? '♛' : String(num);
    const a = art(p);
    return `<button type="button" class="map-node path-mark ${p.kind} ${s}" data-i="${i}" style="left:${pct(p.x, W)}; top:${pct(p.y + 46, H)}" aria-label="${escapeHtml(label(p.node, a?.name))}">
        <span class="mn-block" aria-hidden="true">${mark}</span>
      </button>
      <span class="path-label ${s}${p.fresh ? ' fresh' : ''}" style="left:${pct(p.x, W)}; top:${pct(p.y + 78, H)}" aria-hidden="true">${escapeHtml(a?.name || (boss ? p.cp.title : p.lesson.title))}${p.fresh ? ' <b class="new-badge mn-new">Новое</b>' : ''}</span>`;
  }).join('');
  // «Ты здесь»: герой игрока у текущей темы, со стороны центра дороги
  const cur = pts[curIdx];
  const here = cur ? (() => {
    const toRight = cur.x <= MID, hx = toRight ? cur.x + 46 : cur.x - 104, tx = toRight ? cur.x + 40 : cur.x - 130;
    return `<span class="path-here-tag" style="left:${pct(tx, W)}; top:${pct(cur.y - 52, H)}" aria-hidden="true">Ты здесь</span>
      <span class="path-hero" style="left:${pct(hx, W)}; top:${pct(cur.y - 18, H)}; --hero-color:${hero.color}" aria-hidden="true">${heroPic(hero, 'full')}</span>`;
  })() : '';
  wrap.innerHTML = `${head}<div class="path region-${grade}" style="aspect-ratio:${W} / ${H}">${svg}${marks}${here}<div class="path-card" id="path-card" hidden></div>
    <div class="path-tail" style="top:${pct(H - 130, H)}">${tail}</div></div>`;
  return { pts, H };
}

// Карточка у метки: «ЛОКАЦИЯ N ИЗ M» или «ИСПЫТАНИЕ», название, тема, прогресс и кнопка
export function showCard(wrap, p, H, html){
  const card = wrap.querySelector('#path-card');
  if (!card) return;
  const left = Math.max(16, Math.min(W - 16 - 236, p.x - 118));
  card.style.left = `${(left / W * 100).toFixed(3)}%`;
  card.style.top = `${((p.y + 108) / H * 100).toFixed(3)}%`;
  card.innerHTML = html;
  card.hidden = false;
  card.querySelector('button, [href]')?.focus({ preventScroll: true });
}
export const hideCard = wrap => { const c = wrap.querySelector('#path-card'); if (c) c.hidden = true; };
export { playerHero };
