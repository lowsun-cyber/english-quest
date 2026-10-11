// English Quest — Квесты: упражнение темы как квест — счёт ответов, результат в %, награда за редкость.
// Редкость и условия открытия — questRarity (content.js) и questLock (stats.js).
import { QUEST_PASS_PCT, questRarity } from './eq.js';
import { reward } from './hud.js';
import { saveState, state } from './state.js';
import { questKey, questLock, rarityOf } from './stats.js';
import { confetti, modalClosedHooks, toast } from './ui.js';
import { escapeHtml } from './util.js';

let run = null;   // идущий квест: { lesson, kind, key, ok, bad, replay }
// Начало квеста; false — квест закрыт (ребёнку показана причина)
let hooked = false;
export function startQuest(lesson, kind){
  // окно закрыли посреди квеста — результат не засчитываем (подписка здесь, а не при загрузке: модули ссылаются друг на друга)
  if (!hooked){ modalClosedHooks.add(() => { run = null; }); hooked = true; }
  const why = questLock(lesson, kind, state);
  if (why){ toast(`🔒 ${why}`); run = null; return false; }
  const key = questKey(lesson, kind);
  run = { lesson, kind, key, ok: 0, bad: 0, replay: (state.quests[key]?.best ?? -1) >= QUEST_PASS_PCT };
  return true;
}
// Повтор уже пройденного квеста даёт меньше опыта (см. reward в hud.js)
export const isReplay = () => !!run?.replay;
// Каждый ответ в упражнении (activity.logAnswer)
export function noteAnswer(ok){ if (run) run[ok ? 'ok' : 'bad']++; }

// Конец квеста: результат, первое прохождение на 80% — награда за редкость (один раз). Возвращает HTML для экрана итога.
export function questResult(){
  if (!run) return '';
  const { lesson, kind, key, ok, bad } = run;
  run = null;
  const pct = ok + bad ? Math.round(ok * 100 / (ok + bad)) : 100;
  const q = state.quests[key] || { best: 0, runs: 0 };
  q.best = Math.max(q.best || 0, pct); q.last = pct; q.at = Date.now(); q.runs = (q.runs || 0) + 1;
  const rarity = rarityOf(questRarity(kind, lesson.grade));
  const first = pct >= QUEST_PASS_PCT && !q.passedAt;
  if (first) q.passedAt = Date.now();
  state.quests[key] = q;
  if (pct >= QUEST_PASS_PCT) confetti();   // экран завершения появляется после озвучки последнего слова (afterFeedback)
  if (first && (rarity.xp || rarity.coins)) reward(rarity.xp, rarity.coins, { bonus: true });   // сохраняет состояние и обновляет шапку
  else saveState();
  const prize = first ? ` <b>+${rarity.xp} XP, +${rarity.coins} 🪙</b> за ${escapeHtml(rarity.title.toLowerCase())} квест!` : '';
  return `<p class="quest-result" style="--rarity:${rarity.color}">Результат квеста: <b>${pct}%</b>.${
    pct >= QUEST_PASS_PCT ? (first ? ` Квест пройден!${prize}` : ` Лучший результат: ${q.best}%.`) : ` Чтобы пройти квест, нужно ${QUEST_PASS_PCT}% — попробуй ещё раз!`}</p>`;
}
