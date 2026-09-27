// English Quest — Всплывающие сообщения, конфетти, пузырь гида и окно урока.
import { endView } from './backup.js';
import { CHARACTERS } from './eq.js';
import { speak, stopSpeech } from './tts.js';

// ---------- TOAST / CONFETTI ----------
export function toast(msg){
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}
export function confetti(){
  const wrap = document.createElement('div');
  wrap.className = 'confetti-wrap';
  const colors = ['#3fb650','#3a9fe0','#f5c02b','#ff7bb0','#a870ff','#ff6b3a'];
  for (let i=0;i<60;i++){
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = Math.random()*100 + '%';
    p.style.background = colors[i%colors.length];
    p.style.animationDuration = (2 + Math.random()*2) + 's';
    p.style.animationDelay = (Math.random()*0.3) + 's';
    p.style.transform = `rotate(${Math.random()*360}deg)`;
    wrap.appendChild(p);
  }
  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 4000);
}

// ---------- GUIDE BUBBLE ----------
export let guideTimer = null;
export function showGuide(name, text, character=null){
  const g = document.getElementById('guide');
  const c = character || CHARACTERS.harlow;
  g.hidden = false;
  const av = document.getElementById('guide-avatar');
  av.textContent = c.emoji;
  av.style.background = c.color;
  av.style.boxShadow = `0 6px 0 ${c.accent}`;
  document.getElementById('guide-name').textContent = name;
  document.getElementById('guide-name').style.setProperty('--guide-accent', c.accent);
  document.getElementById('guide-text').textContent = text;
  clearTimeout(guideTimer);
  guideTimer = setTimeout(() => { g.hidden = true; }, 8000);
  guideScrollY = window.scrollY;
}
// Прячем гида, как только ребёнок начинает листать — он не должен закрывать уроки
export let guideScrollY = 0;
window.addEventListener('scroll', () => {
  const g = document.getElementById('guide');
  if (!g.hidden && Math.abs(window.scrollY - guideScrollY) > 80) g.hidden = true;
}, { passive: true });
document.getElementById('guide-close').addEventListener('click', () => document.getElementById('guide').hidden = true);
document.getElementById('guide-listen').addEventListener('click', () => speak(document.getElementById('guide-text').textContent));
document.getElementById('guide-avatar').addEventListener('click', () => {
  // Читаем ровно то, что написано в пузыре, на его языке (реплики гида — по-русски)
  speak(document.getElementById('guide-text').textContent);
});

// ---------- MODAL ----------
export const back = document.getElementById('modal-back');
export const modalBody = document.getElementById('modal-body');
export const modal = document.getElementById('modal');
export let modalOpener = null;
export function openModal(html, opts={}){
  if (!back.classList.contains('open')) modalOpener = document.activeElement;
  modal.classList.toggle('wide', !!opts.wide);
  modal.onkeydown = null; // упражнения со своей клавиатурой (карточки, «Напиши») ставят его заново
  modalBody.innerHTML = html;
  back.classList.add('open');
  // каждый вопрос перерисовывает окно — держим фокус внутри, чтобы клавиатура не терялась
  if (!modal.contains(document.activeElement) || document.activeElement === document.body) modal.focus();
}
// Таймеры «показать ответ → следующий вопрос» не должны заново открывать окно,
// если ребёнок успел его закрыть (или открыть другой урок).
export let modalGen = 0;
export function afterFeedback(fn, ms){
  const gen = modalGen;
  setTimeout(() => { if (gen === modalGen && back.classList.contains('open')) fn(); }, ms);
}
let _onClose = null;
// Вызвать fn один раз, когда окно закроют (крестиком, Escape или кодом)
export function onNextClose(fn){ _onClose = fn; }
export function closeModal(){
  endView();
  modalGen++;
  modal.onkeydown = null;
  back.classList.remove('open');
  stopSpeech();
  if (modalOpener && document.contains(modalOpener)) modalOpener.focus();
  modalOpener = null;
  const cb = _onClose; _onClose = null; cb?.();
}
document.addEventListener('keydown', (e) => {
  if (!back.classList.contains('open')) return;
  if (e.key === 'Escape'){ closeModal(); return; }
  if (e.key === 'Tab'){
    const f = [...modal.querySelectorAll('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])')].filter(x => x.offsetParent);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === modal)){ e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
});
document.getElementById('modal-close').addEventListener('click', closeModal);
back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
