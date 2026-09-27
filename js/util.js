// English Quest — Общие мелочи.

// Общие мелочи: даты, склонения, экранирование, перемешивание, буфер обмена.
export const DAY = 86400000;

export function startOfDay(t){ const d = new Date(t); d.setHours(0,0,0,0); return d.getTime(); }

export function daysLabel(due){
  const d = Math.round((startOfDay(due) - startOfDay(Date.now())) / DAY);
  if (d <= 0) return 'сегодня';
  if (d === 1) return 'завтра';
  const n = d % 10, nn = d % 100;
  const word = (n === 1 && nn !== 11) ? 'день' : (n >= 2 && n <= 4 && (nn < 12 || nn > 14)) ? 'дня' : 'дней';
  return `через ${d} ${word}`;
}

export function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

export function shuffle(arr){ return arr.slice().sort(() => Math.random()-0.5); }

export function dayKey(t = Date.now()){
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function parseDay(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d).getTime(); }

export function fmtDay(s){ const d = new Date(parseDay(s)); return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`; }

// сдвиг даты по календарю, а не на 24 часа — иначе переход на летнее время «теряет» день
export function shiftDay(key, n){ const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d + n).getTime()); }

export function plural(n, one, few, many){
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
}

export async function copyText(text, input){
  try { await navigator.clipboard.writeText(text); return true; }
  catch(e){
    if (input){ input.focus(); input.select(); try { return document.execCommand('copy'); } catch(_){} }
    return false;
  }
}

export const WEEKDAYS = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
