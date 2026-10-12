// English Quest — «Карта пробелов» для родителя: группы кодов ошибок (ERROR_GROUPS) и их состояние.
// Данные — errorGaps() в stats.js; здесь только разметка, общая для панели репетитора и админ-панели.
import { GAP_STATES } from './stats.js';
import { escapeHtml } from './util.js';

const ICON = { gap: '🔴', watch: '🟡', fixed: '🟢', none: '⚪' };
const badge = s => `<span class="gap-badge gap-${s}"><span aria-hidden="true">${ICON[s]}</span> ${GAP_STATES[s]}</span>`;

export function gapMapHtml(g){
  if (!g.codes.some(c => c.total || c.active)) return '<p class="t-muted">Пока нет — карта появится после первых ошибок в упражнениях.</p>';
  const clean = g.groups.filter(gr => gr.state === 'none');
  const codeRow = c => `<li class="gap-code gap-${c.state}">
      <span class="gap-code-main"><span class="gap-code-id">${c.code}</span> ${escapeHtml(c.title)} ${badge(c.state)}</span>
      <span class="t-muted">${c.active ? `в «Моих ошибках»: ${c.active}` : ''}${c.active && c.total ? ' · ' : ''}${c.total ? `ошибок всего: ${c.total}` : ''}${c.weak.length ? ` · слабый навык: ${c.weak.map(k => escapeHtml(k.title)).join(', ')}` : ''}</span>
      ${c.state === 'gap' ? `<span class="gap-tip">Что делать: ${escapeHtml(c.tip)}</span>` : ''}
    </li>`;
  return `<p class="t-muted">По каждому коду: пробел — сейчас трудно (3 и больше карточек в «Моих ошибках» или слабый навык), следим — 1–2 карточки, исправлено — ошибки были, но выучены.</p>
    ${g.gaps.length ? `<p><b>Главное сейчас:</b> ${g.gaps.slice(0, 3).map(c => `${escapeHtml(c.title)} (${c.code})`).join(', ')}.</p>` : '<p><b>Пробелов сейчас нет</b> — все ошибки выучены или на повторении.</p>'}
    <div class="gap-map">${g.groups.filter(gr => gr.state !== 'none').map(gr => `
      <section class="gap-group gap-${gr.state}" aria-label="${escapeHtml(`${gr.title}: ${GAP_STATES[gr.state]}`)}">
        <h4>${escapeHtml(gr.title)} ${badge(gr.state)}</h4>
        <ul role="list">${gr.codes.filter(c => c.state !== 'none').map(codeRow).join('')}</ul>
      </section>`).join('')}
    </div>
    ${clean.length ? `<p class="t-muted">Ошибок не было: ${clean.map(gr => escapeHtml(gr.title)).join(', ')}.</p>` : ''}`;
}
