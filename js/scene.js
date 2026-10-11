// English Quest — Сцена локации (docs/design-v2/STYLE.md §6, эскизы 32-screen-location и 40-scene-mines).
// Локация рисуется как одно место: фон региона, в центре — рисунок места темы (тот же, что на карте-пути),
// вокруг — предметы-квесты. У каждого упражнения свой предмет во всех локациях (сундук — всегда «Слова»),
// на предмете — метка цвета редкости: номер, ★ — пройдено, замок — закрыто.
// Рисунок — одно SVG (viewBox 360×320), метки — HTML-кнопки поверх в процентах тех же координат.
import { escapeHtml } from './util.js';

export const SW = 360, SH = 320;
const K = '#1c2b1a';
const o = (w = 2.5) => `stroke="${K}" stroke-width="${w}" stroke-linejoin="round"`;

// ---------- фон региона ----------
const BACKS = {
  2: () => `<rect width="${SW}" height="${SH}" fill="#cfe9f6"/>
    <circle cx="300" cy="40" r="18" fill="#f5c02b" ${o()}/>
    <path d="M40 42 a10 10 0 0 1 14 -10 a13 13 0 0 1 24 4 a9 9 0 0 1 2 16 h-36 a8 8 0 0 1 -4 -10 Z" fill="#fffdf6" ${o(2)}/>
    <path d="M180 30 a8 8 0 0 1 11 -8 a10 10 0 0 1 19 3 a7 7 0 0 1 1 13 h-28 a6 6 0 0 1 -3 -8 Z" fill="#fffdf6" ${o(2)}/>
    <path d="M0 112 q60 -46 130 -6 q60 -40 120 -4 q60 -34 110 -2 V${SH} H0 Z" fill="#7cc35c" ${o()}/>
    <rect y="118" width="${SW}" height="${SH - 118}" fill="#8fcf6e"/><path d="M0 118 H${SW}" stroke="${K}" stroke-width="2.5"/>
    <path d="M20 150 l4 -8 l4 8 M70 270 l4 -8 l4 8 M300 150 l4 -8 l4 8 M210 300 l4 -8 l4 8 M150 240 l4 -8 l4 8" fill="none" stroke="#5aa851" stroke-width="2.5" stroke-linecap="round"/>`,
  3: () => `<rect width="${SW}" height="${SH}" fill="#cfe9f6"/>
    <path d="M40 34 a10 10 0 0 1 14 -10 a13 13 0 0 1 24 4 a9 9 0 0 1 2 16 h-36 a8 8 0 0 1 -4 -10 Z" fill="#fffdf6" ${o(2)}/>
    ${[[0, 70, 46, '#f3dcb5', '#e5483b'], [44, 54, 40, '#e8d8c4', '#2a7cb4'], [86, 78, 50, '#f3dcb5', '#c0742c'], [138, 60, 38, '#e8d8c4', '#e5483b'], [178, 84, 52, '#f3dcb5', '#2a7cb4'], [232, 64, 40, '#e8d8c4', '#c0742c'], [274, 76, 46, '#f3dcb5', '#e5483b'], [320, 58, 44, '#e8d8c4', '#2a7cb4']]
      .map(([x, h, w, wall, roof]) => `<rect x="${x}" y="${118 - h + 14}" width="${w}" height="${h - 14}" fill="${wall}" ${o()}/><polygon points="${x - 4},${118 - h + 14} ${x + w / 2},${118 - h - 6} ${x + w + 4},${118 - h + 14}" fill="${roof}" ${o()}/><rect x="${x + w / 2 - 6}" y="${118 - h + 26}" width="12" height="12" fill="#a4d5ee" ${o(2)}/>`).join('')}
    <rect y="118" width="${SW}" height="${SH - 118}" fill="#d3d2c8"/><path d="M0 118 H${SW}" stroke="${K}" stroke-width="2.5"/>
    <g fill="none" stroke="rgba(0,0,0,.12)" stroke-width="1.5">${Array.from({ length: 7 }, (_, r) => Array.from({ length: 13 }, (_, c) => `<rect x="${c * 30 - (r % 2) * 15}" y="${126 + r * 28}" width="26" height="22" rx="6"/>`).join('')).join('')}</g>`,
  4: () => `<rect width="${SW}" height="${SH}" fill="#ffe9c4"/>
    <circle cx="300" cy="40" r="20" fill="#f5c02b" ${o()}/>
    <polygon points="-10,118 50,50 110,118" fill="#c9b38a" ${o()}/><polygon points="80,118 150,34 220,118" fill="#b8a07a" ${o()}/><polygon points="150,118 150,34 165,52 150,60" fill="#fffdf6" opacity=".7"/>
    <path d="M200 118 q50 -40 100 -6 q30 -20 70 -4 V118 Z" fill="#e9d3a8" ${o()}/>
    <rect y="118" width="${SW}" height="${SH - 118}" fill="#f1dfb8"/><path d="M0 118 H${SW}" stroke="${K}" stroke-width="2.5"/>
    <path d="M30 170 q10 -4 20 0 M260 160 q10 -4 20 0 M120 290 q10 -4 20 0 M300 260 q10 -4 20 0" fill="none" stroke="#c99a63" stroke-width="2.5" stroke-linecap="round"/>`,
};

// ---------- предметы-квесты: основание в (0,0), высота ~50 ----------
export const OBJECTS = {
  cards: { name: 'Стопка карточек', svg: `<g transform="rotate(-14 -10 -20)"><rect x="-26" y="-48" width="30" height="40" rx="3" fill="#fffdf6" ${o()}/></g><g transform="rotate(10 10 -20)"><rect x="-2" y="-50" width="30" height="40" rx="3" fill="#fffdf6" ${o()}/><circle cx="13" cy="-36" r="6" fill="#e5483b" ${o(2)}/><path d="M5 -22 h16" stroke="${K}" stroke-width="2.5"/></g><rect x="-14" y="-46" width="30" height="40" rx="3" fill="#fff4cc" ${o()}/><text x="1" y="-20" text-anchor="middle" font-family="'Baloo 2',sans-serif" font-weight="800" font-size="16" fill="${K}">Aa</text>` },
  vocab: { name: 'Сундук слов', svg: `<rect x="-28" y="-30" width="56" height="30" fill="#c0742c" ${o()}/><path d="M-28 -30 q28 -26 56 0 Z" fill="#d69f0a" ${o()}/><rect x="-28" y="-22" width="56" height="7" fill="#f5c02b" ${o(2)}/><rect x="-6" y="-26" width="12" height="14" fill="#f5c02b" ${o(2)}/><circle cx="0" cy="-19" r="2" fill="${K}"/>` },
  listen: { name: 'Радиоприёмник', svg: `<path d="M14 -40 L26 -60" stroke="${K}" stroke-width="3" stroke-linecap="round"/><circle cx="27" cy="-61" r="3" fill="#e5483b" ${o(2)}/><rect x="-28" y="-40" width="56" height="40" rx="6" fill="#3a9fe0" ${o()}/><circle cx="-10" cy="-20" r="12" fill="#2a7cb4" ${o(2.5)}/><circle cx="-10" cy="-20" r="5" fill="#fffdf6" ${o(2)}/><rect x="8" y="-32" width="14" height="8" rx="2" fill="#fff4cc" ${o(2)}/><circle cx="15" cy="-12" r="5" fill="#f5c02b" ${o(2)}/>` },
  match: { name: 'Коробка-пазл', svg: `<rect x="-26" y="-30" width="52" height="30" fill="#a870ff" ${o()}/><path d="M-26 -30 l8 -8 h52 l-8 8" fill="#c9b3ff" ${o()}/><path d="M-8 -50 h10 a6 6 0 1 1 8 0 h10 v10 a6 6 0 1 0 0 8 v10 h-28 Z" fill="#f5c02b" ${o()}/><path d="M-16 -16 h32" stroke="#fffdf6" stroke-width="3" stroke-linecap="round"/>` },
  spell: { name: 'Кубики с буквами', svg: `${[[-26, -24, '#e5483b', 'A'], [0, -24, '#3a9fe0', 'B'], [-13, -48, '#3fb650', 'C']].map(([x, y, c, l]) => `<rect x="${x}" y="${y}" width="24" height="24" rx="3" fill="${c}" ${o()}/><text x="${x + 12}" y="${y + 18}" text-anchor="middle" font-family="'Baloo 2',sans-serif" font-weight="800" font-size="16" fill="#fffdf6">${l}</text>`).join('')}` },
  grammar: { name: 'Книга правил', svg: `<path d="M-4 0 V-26 M4 0 V-26" stroke="#8b6f5a" stroke-width="5"/><path d="M-18 0 h36" stroke="${K}" stroke-width="3" stroke-linecap="round"/><path d="M0 -26 L-28 -34 V-58 L0 -50 Z" fill="#fffdf6" ${o()}/><path d="M0 -26 L28 -34 V-58 L0 -50 Z" fill="#fffdf6" ${o()}/><path d="M-22 -48 l16 4 M-22 -42 l16 4 M6 -44 l16 -4 M6 -38 l16 -4" stroke="${K}" stroke-width="1.5"/><path d="M0 -50 V-26" stroke="#a870ff" stroke-width="3"/>` },
  reading: { name: 'Книжная полка', svg: `<rect x="-30" y="-56" width="60" height="56" fill="#c0742c" ${o()}/><path d="M-30 -28 H30" stroke="${K}" stroke-width="2.5"/>${[[-24, -52, 8, '#e5483b'], [-14, -50, 7, '#3a9fe0'], [-5, -54, 9, '#3fb650'], [6, -50, 7, '#f5c02b'], [-24, -24, 9, '#a870ff'], [-13, -22, 7, '#ff7bb0'], [0, -25, 10, '#3a9fe0']].map(([x, y, w, c]) => `<rect x="${x}" y="${y}" width="${w}" height="${y < -40 ? -28 - y : -y - 2}" fill="${c}" ${o(2)}/>`).join('')}` },
  speak: { name: 'Микрофон', svg: `<path d="M0 0 V-22 M-14 0 h28" stroke="${K}" stroke-width="3.5" stroke-linecap="round"/><path d="M-14 -36 a14 14 0 0 0 28 0" fill="none" stroke="${K}" stroke-width="3"/><rect x="-9" y="-60" width="18" height="32" rx="9" fill="#f5c02b" ${o()}/><path d="M-9 -48 h18 M-9 -40 h18" stroke="${K}" stroke-width="1.5"/>` },
  picture: { name: 'Картина в раме', svg: `<path d="M-20 0 L-12 -24 M20 0 L12 -24" stroke="#8b6f5a" stroke-width="4" stroke-linecap="round"/><rect x="-28" y="-60" width="56" height="40" fill="#d69f0a" ${o()}/><rect x="-22" y="-54" width="44" height="28" fill="#cfe9f6" ${o(2)}/><path d="M-22 -26 l14 -14 l10 10 l8 -6 l12 10" fill="#3fb650" ${o(2)}/><circle cx="12" cy="-46" r="4" fill="#f5c02b" ${o(1.5)}/>` },
  fill: { name: 'Тетрадь', svg: `<rect x="-24" y="-46" width="44" height="46" rx="3" fill="#fffdf6" ${o()}/><path d="M-16 -34 h28 M-16 -26 h28 M-16 -18 h12 M-16 -10 h28" stroke="#3a9fe0" stroke-width="2"/><path d="M0 -18 h10" stroke="#e5483b" stroke-width="3" stroke-dasharray="3 2"/>${[-40, -30, -20, -10].map(y => `<circle cx="-24" cy="${y}" r="3" fill="#9fb0b8" ${o(1.5)}/>`).join('')}<g transform="rotate(30 22 -30)"><rect x="18" y="-56" width="8" height="34" fill="#f5c02b" ${o(2)}/><polygon points="18,-22 26,-22 22,-14" fill="#f3dcb5" ${o(2)}/></g>` },
  build: { name: 'Кирпичики слов', svg: `${[[-30, -16, '#e5483b', 'I'], [2, -16, '#3a9fe0', 'can'], [-14, -32, '#3fb650', 'swim']].map(([x, y, c, w]) => `<rect x="${x}" y="${y}" width="30" height="16" rx="2" fill="${c}" ${o()}/><text x="${x + 15}" y="${y + 12}" text-anchor="middle" font-family="'Baloo 2',sans-serif" font-weight="800" font-size="10" fill="#fffdf6">${w}</text>`).join('')}` },
  extra: { name: 'Свиток с заданием', svg: `<rect x="-22" y="-50" width="44" height="44" fill="#fff4cc" ${o()}/><ellipse cx="0" cy="-50" rx="26" ry="6" fill="#f3dcb5" ${o()}/><ellipse cx="0" cy="-6" rx="26" ry="6" fill="#f3dcb5" ${o()}/><path d="M-12 -36 h24 M-12 -28 h20 M-12 -20 h24" stroke="#c0742c" stroke-width="2"/>` },
};
// Места предметов: задний ряд у горизонта, средний и передний; рисунок места — в центре сзади
const SLOTS = [[38, 172], [322, 172], [50, 246], [310, 246], [34, 306], [116, 308], [180, 314], [244, 308], [326, 306], [126, 252], [234, 252], [180, 262]];

// quests: [{ kind, objKey, n, state: 'open'|'done'|'locked'|'current', color, label, selected }]
export function renderScene({ grade, art, regionName, quests, emoji }){
  const back = (BACKS[grade] || BACKS[2])();
  const centre = art?.img
    ? `<image href="${art.img}" x="${180 - 92}" y="${70}" width="184" height="156"/>`
    : `<ellipse cx="180" cy="200" rx="80" ry="22" fill="#8fcf6e" ${o(3)}/><text x="180" y="186" text-anchor="middle" font-size="64">${emoji || '📘'}</text>`;
  const items = quests.map((q, i) => {
    const [x, y] = SLOTS[i % SLOTS.length], obj = OBJECTS[q.objKey] || OBJECTS.extra;
    return `<g transform="translate(${x} ${y})"${q.state === 'locked' ? ' opacity=".8"' : ''}><ellipse cx="0" cy="0" rx="26" ry="5" fill="rgba(0,0,0,.15)"/>${obj.svg}</g>`;
  }).join('');
  const LOCK = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="#4a5a48" stroke-width="3"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="#4a5a48" stroke-width="3" stroke-linecap="round"/></svg>';
  const marks = quests.map((q, i) => {
    const [x, y] = SLOTS[i % SLOTS.length];
    const mx = x + 18, my = y - 54;
    const mark = q.state === 'locked' ? LOCK : q.state === 'done' ? '★' : String(q.n);
    return `<button type="button" class="hub-ex scene-mark ${q.state}${q.selected ? ' sel' : ''}${q.fresh ? ' fresh' : ''}" data-ex="${q.kind}" style="left:${(mx / SW * 100).toFixed(3)}%; top:${(my / SH * 100).toFixed(3)}%; --rarity:${q.color}" aria-label="${escapeHtml(q.label)}" aria-pressed="${q.selected ? 'true' : 'false'}">${mark}${q.fresh ? '<b class="new-badge">Новое</b>' : ''}</button>`;
  }).join('');
  return `<div class="scene region-${grade}">
    <svg class="scene-art" viewBox="0 0 ${SW} ${SH}" aria-hidden="true" focusable="false">${back}${centre}${items}</svg>
    <div class="scene-plate"><span>${escapeHtml(regionName || '')}</span><b>${escapeHtml(art?.name || '')}</b></div>
    ${marks}
  </div>`;
}
