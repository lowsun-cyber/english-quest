// English Quest — PDF-отчёт по ученикам для админ-панели.
// Собирается прямо в браузере библиотекой pdfmake (шрифт Roboto с кириллицей): данные никуда не отправляются.
// Библиотека загружается только при первой выгрузке.
import { LESSONS } from './eq.js';
import { CHECKPOINT_SIZE, EX_NAMES, PARTS, homeworkDone, reportText, studentStats } from './stats.js';
import { fmtDay } from './util.js';

const PDFMAKE = 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.12/';
let loading = null;
function loadScript(src){
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Не удалось загрузить модуль PDF — проверьте интернет.'));
    document.head.appendChild(s);
  });
}
function loadPdfMake(){
  if (window.pdfMake?.vfs) return Promise.resolve(window.pdfMake);
  loading ||= loadScript(PDFMAKE + 'pdfmake.min.js').then(() => loadScript(PDFMAKE + 'vfs_fonts.min.js')).then(() => window.pdfMake);
  loading.catch(() => { loading = null; });
  return loading;
}

// В шрифте нет эмодзи — убираем их, чтобы не было пустых квадратов
const plain = s => String(s ?? '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '').replace(/\s{2,}/g, ' ').trim();
const date = t => t ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
const dateTime = t => t ? new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const mins = sec => sec > 0 && sec < 60 ? '<1' : String(Math.round(sec / 60));
const pct = (ok, bad) => ok + bad ? Math.round(ok * 100 / (ok + bad)) + '%' : '—';
const EX_SHORT = { vocab: 'Слова', listen: 'Слушай', match: 'Пара', spell: 'Напиши', grammar: 'Грамм.', reading: 'Чтение', speak: 'Говори' };
const TYPE = { word: 'слово', grammar: 'грамматика', reading: 'чтение' };

const INK = '#1d2b36', MUTED = '#6b7a86', GRASS = '#3fb650', LINE = '#d7dde2';
const table = (widths, head, rows) => ({
  table: { headerRows: 1, widths, body: [head.map(h => ({ text: h, style: 'th' })), ...rows] },
  layout: { hLineWidth: (i) => i <= 1 ? 1 : 0.5, vLineWidth: () => 0, hLineColor: () => LINE, paddingTop: () => 3, paddingBottom: () => 3 },
  margin: [0, 4, 0, 10],
});
const h2 = t => ({ text: t, style: 'h2' });
const kv = rows => ({
  table: { widths: [170, '*'], body: rows.map(([k, v]) => [{ text: k, color: MUTED }, { text: String(v) }]) },
  layout: 'noBorders', margin: [0, 2, 0, 10],
});

// Столбики минут за 30 дней (SVG — pdfmake рисует его векторно)
function chartSvg(days, goal){
  const W = 515, H = 120, pad = 18, bw = (W - 10) / days.length;
  const vals = days.map(d => d.sec / 60), max = Math.max(...vals, goal || 0, 1);
  const y = v => H - pad - (v / max) * (H - pad - 8);
  const bars = days.map((d, i) => {
    const h = vals[i] ? Math.max(1.5, (H - pad) - y(vals[i])) : 0;
    return `<rect x="${(5 + i * bw + 1).toFixed(1)}" y="${(H - pad - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${d.goalMet ? GRASS : '#3a9fe0'}"/>`;
  }).join('');
  const labels = days.map((d, i) => i % 5 === 4 || i === days.length - 1 ? `<text x="${(5 + i * bw + bw / 2).toFixed(1)}" y="${H - 4}" font-size="7" text-anchor="middle" fill="${MUTED}">${fmtDay(d.key)}</text>` : '').join('');
  const goalLine = goal ? `<line x1="5" x2="${W - 5}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}" stroke="#f5a623" stroke-width="0.8" stroke-dasharray="3,2"/><text x="7" y="${(y(goal) - 3).toFixed(1)}" font-size="7" fill="${MUTED}">цель ${goal} мин</text>` : '';
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><line x1="5" x2="${W - 5}" y1="${H - pad}" y2="${H - pad}" stroke="${LINE}" stroke-width="0.8"/>${bars}${goalLine}${labels}</svg>`;
}

function studentContent({ student, state: st, updated, devices }, meta){
  const S = studentStats(st, 30), W7 = studentStats(st, 7);
  const hw = st.homework, hl = hw && LESSONS.find(l => l.id === hw.lessonId);
  const out = [
    { text: 'English Quest — отчёт об ученике', style: 'kicker' },
    { text: plain(student.name) || 'Ученик', style: 'h1' },
    { text: [meta.org && `Организация: ${plain(meta.org)}`, student.teacherName && `Репетитор: ${plain(student.teacherName)}`, `Данные на ${dateTime(updated)}`].filter(Boolean).join(' · '), color: MUTED, margin: [0, 0, 0, 12] },

    h2('Сводка'),
    kv([
      ['Уровень и звание', `${S.level} из ${S.maxLevel} · ${plain(S.rank?.title || '')}`],
      ['Опыт и золото', `${S.xp} XP · ${S.gold} золота`],
      ['Темы пройдено', `${S.lessonsDone} из ${LESSONS.length}`],
      ['Проверки сдано', `${S.checkpoints.filter(x => x.r?.passedAt).length} из ${S.checkpoints.length}`],
      ['Цель дня', `${S.goal} мин`],
      ['Серия дней', `${S.streak} (рекорд ${S.best}), заморозок ${S.freezes}`],
      ['За 7 дней', `${W7.min} мин, занятий в ${W7.active} из 7 дней, ответов ${W7.total}, верных ${pct(W7.ok, W7.bad)}`],
      ['За 30 дней', `${S.min} мин, занятий в ${S.active} из 30 дней, ответов ${S.total}, верных ${pct(S.ok, S.bad)}`],
      ['За всё время', `${S.allTime.min} мин, ${S.allTime.activeDays} дн. с занятиями${S.allTime.first ? ` (${fmtDay(S.allTime.first)} — ${fmtDay(S.allTime.last)})` : ''}, ответов ${S.allTime.ok + S.allTime.bad}, верных ${pct(S.allTime.ok, S.allTime.bad)}`],
      ['В «Моих ошибках»', `${S.hard.length}, выучено после ошибок ${S.mastered}`],
      ['Слов в коллекции', S.collected],
    ]),

    h2('Минуты занятий за 30 дней'),
    { svg: chartSvg(S.days, S.goal), margin: [0, 2, 0, 2] },
    { text: 'Зелёный — цель дня выполнена.', fontSize: 8, color: MUTED, margin: [0, 0, 0, 10] },

    h2('Домашнее задание'),
    hl ? kv([
      ['Тема', plain(hl.title)],
      ['Упражнения', hw.tasks.map(ex => `${plain(EX_NAMES[ex])} — ${homeworkDone(st, hw, ex) ? 'сделано' : 'нет'}`).join(', ')],
      ['Срок', hw.due ? fmtDay(hw.due) : 'без срока'],
      ['Статус', hw.doneAt ? `выполнено ${dateTime(hw.doneAt)}` : 'в работе'],
      ...(hw.note ? [['Комментарий', plain(hw.note)]] : []),
    ]) : { text: 'Сейчас задания нет.', color: MUTED, margin: [0, 2, 0, 10] },

    h2('Темы'),
    table(['*', 24, ...PARTS.map(() => 34), 38, 32],
      ['Тема', 'Кл.', ...PARTS.map(ex => EX_SHORT[ex]), 'Пройд.', 'Ошиб.'],
      S.lessons.map(x => [plain(x.l.title), String(x.l.grade), ...PARTS.map(ex => ({ text: x.p[ex] ? String(x.p[ex]) : '·', alignment: 'center' })), { text: x.done ? 'да' : '', alignment: 'center' }, { text: x.wrong ? String(x.wrong) : '—', alignment: 'center' }])),
    { text: 'Число — сколько раз упражнение пройдено.', fontSize: 8, color: MUTED, margin: [0, -6, 0, 10] },

    h2('Проверки'),
    table(['*', 80, 90], ['Проверка', 'Лучший результат', 'Сдана'],
      S.checkpoints.map(({ cp, r }) => [plain(cp.title), r ? `${r.best} из ${CHECKPOINT_SIZE}` : '—', r?.passedAt ? date(r.passedAt) : (r ? 'не сдана' : 'не начата')])),

    h2('Грамматика по навыкам'),
    S.skills.length ? table(['*', 40, 50, 50, 110], ['Навык', 'Код', 'Верно', 'Ответов', 'Чаще всего путает'],
      S.skills.map(x => [(x.weak ? '! ' : '') + plain(x.skill.title), x.code, `${x.pct}%`, String(x.ok + x.bad), x.wrong.slice(0, 3).map(([o, n]) => `${plain(o)} ×${n}`).join(', ') || '—'])) : { text: 'Пока нет — навыки появятся после упражнений «Грамматика».', color: MUTED, margin: [0, 2, 0, 10] },

    h2(`Трудные слова и вопросы (${S.hard.length})`),
    S.hard.length ? table(['*', 90, 60, 36, 70], ['Слово или вопрос', 'Тема', 'Тип', 'Ошиб.', 'Повтор'],
      S.hard.map(({ m, data }) => [
        m.type === 'word' ? `${data.word.en} — ${plain(data.word.ru)}` : plain(data.q.q),
        plain(data.lesson.title), TYPE[m.type] || m.type, { text: String(m.wrong), alignment: 'center' },
        m.due ? (m.due <= Date.now() ? 'сейчас' : new Date(m.due).toLocaleDateString('ru-RU')) : '—',
      ])) : { text: 'Нет — ошибок не было или все выучены.', color: MUTED, margin: [0, 2, 0, 10] },

    h2('Занятия по дням'),
    S.allTime.days.length ? table([80, 50, 50, 50, 50, '*'], ['День', 'Минуты', 'Верно', 'Ошибок', 'Точность', 'Цель'],
      [...S.allTime.days].reverse().map(d => [fmtDay(d.key) + '.' + d.key.slice(0, 4), mins(d.sec || 0), String(d.ok || 0), String(d.bad || 0), pct(d.ok || 0, d.bad || 0), d.goalMet ? 'выполнена' : d.frozen ? 'заморозка' : ''])) : { text: 'Занятий ещё не было.', color: MUTED, margin: [0, 2, 0, 10] },

    h2('Коллекция слов'),
    { text: Object.keys(st.inventory || {}).length ? Object.entries(st.inventory).map(([w, n]) => n > 1 ? `${w} ×${n}` : w).join(', ') : 'Пока пусто.', margin: [0, 2, 0, 10], color: Object.keys(st.inventory || {}).length ? INK : MUTED },

    h2('Устройства'),
    devices.length ? table(['*', 110, 110], ['Устройство', 'Подключено', 'Последний раз в сети'], devices.map(d => [plain(d.label || 'Устройство'), date(d.created), date(d.lastUsed)])) : { text: 'Устройств нет.', color: MUTED, margin: [0, 2, 0, 10] },

    h2('Короткий отчёт'),
    { text: plain(reportText(st, student.name, studentStats(st, 7)).replace(/✓/g, '(сделано)')), fontSize: 9, margin: [0, 2, 0, 0] },
  ];
  return out;
}

export async function buildPdf(items, meta){
  const pdfMake = await loadPdfMake();
  const content = items.flatMap((it, i) => [...(i ? [{ text: '', pageBreak: 'before' }] : []), ...studentContent(it, meta)]);
  const doc = {
    info: { title: items.length === 1 ? `English Quest — ${plain(items[0].student.name)}` : 'English Quest — ученики', author: plain(meta.by || ''), creator: 'English Quest' },
    pageSize: 'A4', pageMargins: [40, 40, 40, 44],
    content,
    defaultStyle: { font: 'Roboto', fontSize: 10, color: INK, lineHeight: 1.2 },
    styles: {
      kicker: { fontSize: 9, color: GRASS, bold: true, characterSpacing: 0.5 },
      h1: { fontSize: 20, bold: true, margin: [0, 2, 0, 4] },
      h2: { fontSize: 12, bold: true, margin: [0, 6, 0, 2] },
      th: { bold: true, fontSize: 8, color: MUTED },
    },
    footer: (page, pages) => ({
      columns: [
        { text: `English Quest · выгружено ${dateTime(Date.now())}${meta.by ? ` · ${plain(meta.by)}` : ''}`, fontSize: 7.5, color: MUTED },
        { text: `${page} / ${pages}`, alignment: 'right', fontSize: 7.5, color: MUTED },
      ],
      margin: [40, 14, 40, 0],
    }),
  };
  return new Promise((resolve, reject) => {
    try { pdfMake.createPdf(doc).getBlob(resolve); } catch (e) { reject(e); }
  });
}
