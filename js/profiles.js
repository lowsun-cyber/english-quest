// English Quest — Несколько учеников на одном устройстве: выбор, добавление, переименование, удаление.
import { applyFreezes } from './activity.js';
import { applyLoadedState } from './backup.js';
import { levelFromXp } from './eq.js';
import { activeId, activeProfile, deleteStoredState, freshState, loadState, profiles, saveProfiles, saveState, setState, state, takeDeviceSettings, writeStoredState } from './state.js';
import { closeModal, onNextClose, openModal, toast } from './ui.js';
import { dayKey, escapeHtml } from './util.js';

export const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐯', '🐨', '🐵', '🦄', '🐙', '🐧', '🐢', '🐝'];
const MAX_NAME = 20;

export const multi = () => (profiles?.list.length || 0) > 1;
const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

export function renderProfileChip(){
  const chip = document.getElementById('btn-profile');
  if (!chip) return;
  const p = activeProfile();
  chip.hidden = !multi();
  document.getElementById('pf-avatar').textContent = p.avatar;
  document.getElementById('pf-name').textContent = p.name;
  chip.setAttribute('aria-label', `Сейчас занимается ${p.name}. Сменить ученика`);
}

export async function switchProfile(id){
  if (id === activeId() || !profiles.list.some(p => p.id === id)) return;
  await saveState();
  profiles.active = id;
  await saveProfiles();
  setState(takeDeviceSettings(await loadState(id)));
  applyFreezes();
  applyLoadedState();
  renderProfileChip();
  toast(`${activeProfile().avatar} Привет, ${activeProfile().name}!`);
}

// Короткая сводка по ученику для карточек (без переключения)
async function brief(p){
  const s = p.id === activeId() ? state : await loadState(p.id);
  const today = s.activity?.[dayKey()] || { sec: 0 };
  const goal = [5, 10, 15, 20].includes(s.settings?.dailyGoal) ? s.settings.dailyGoal : 10;
  return { level: levelFromXp(s.xp || 0), xp: s.xp || 0, min: Math.floor(today.sec / 60), goal, met: !!today.goalMet };
}

// «Кто сегодня занимается?» — onPick(id) после выбора; note — пояснение сверху
export async function openProfileChooser({ note = '', onPick } = {}){
  const cards = await Promise.all(profiles.list.map(async p => ({ p, b: await brief(p) })));
  openModal(`
    <h2>Кто сегодня занимается?</h2>
    ${note ? `<p class="pf-note">${escapeHtml(note)}</p>` : ''}
    <div class="pf-grid">
      ${cards.map(({ p, b }) => `
        <button class="pf-card${p.id === activeId() ? ' current' : ''}" data-id="${escapeHtml(p.id)}">
          <span class="pf-av" aria-hidden="true">${p.avatar}</span>
          <span class="pf-name">${escapeHtml(p.name)}</span>
          <span class="pf-sub">Уровень ${b.level} · ${b.xp} XP</span>
          <span class="pf-sub">${b.met ? '🎯 цель дня выполнена' : `🎯 ${b.min} / ${b.goal} мин`}</span>
        </button>`).join('')}
    </div>
    <p class="t-muted pf-hint">Добавить ученика можно в панели «Для репетитора и родителей».</p>
  `);
  let picked = false;
  document.querySelectorAll('.pf-card').forEach(btn => btn.onclick = async () => {
    picked = true;
    const id = btn.dataset.id;
    closeModal();
    await switchProfile(id);
    onPick?.(id);
  });
  onNextClose(() => { if (!picked) onPick?.(activeId()); });
}

export async function createProfile(name, avatar, st){
  const id = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const fresh = st || freshState();
  profiles.list.push({ id, name: cleanName(name) || `Ученик ${profiles.list.length + 1}`, avatar: AVATARS.includes(avatar) ? avatar : AVATARS[profiles.list.length % AVATARS.length], created: Date.now() });
  await writeStoredState(id, fresh);
  await saveProfiles();
  renderProfileChip();
  return id;
}

// ---- раздел «Ученики на этом устройстве» в панели для взрослых ----
export function profilesSectionHtml(){
  const next = AVATARS.find(a => !profiles.list.some(p => p.avatar === a)) || AVATARS[0];
  return `
    <ul class="pf-list" role="list">
      ${profiles.list.map(p => `
        <li class="pf-row${p.id === activeId() ? ' current' : ''}">
          <button class="pf-av-btn" data-act="avatar" data-id="${escapeHtml(p.id)}" aria-label="Сменить аватар ${escapeHtml(p.name)}">${p.avatar}</button>
          <span class="pf-row-name">${escapeHtml(p.name)}${p.id === activeId() ? ' <span class="t-muted">— сейчас</span>' : ''}</span>
          <span class="pf-row-acts">
            ${p.id === activeId() ? '' : `<button class="icon-btn" data-act="switch" data-id="${escapeHtml(p.id)}">Перейти</button>`}
            <button class="icon-btn" data-act="rename" data-id="${escapeHtml(p.id)}">Переименовать</button>
            ${profiles.list.length > 1 ? `<button class="icon-btn" data-act="delete" data-id="${escapeHtml(p.id)}" aria-label="Удалить ${escapeHtml(p.name)}">Удалить</button>` : ''}
          </span>
        </li>`).join('')}
    </ul>
    <form class="pf-add" id="pf-add">
      <label>Имя нового ученика <input id="pf-add-name" maxlength="${MAX_NAME}" autocomplete="off" placeholder="Например, Маша" /></label>
      <fieldset class="pf-avatars"><legend>Аватар</legend>
        ${AVATARS.map(a => `<label class="pf-av-pick"><input type="radio" name="pf-av" value="${a}" ${a === next ? 'checked' : ''} /><span>${a}</span></label>`).join('')}
      </fieldset>
      <button class="btn" type="submit">➕ Добавить ученика</button>
    </form>`;
}

export function wireProfilesSection(reopen){
  document.querySelectorAll('.pf-list [data-act]').forEach(btn => btn.onclick = async () => {
    const p = profiles.list.find(x => x.id === btn.dataset.id);
    if (!p) return;
    const act = btn.dataset.act;
    if (act === 'avatar'){
      p.avatar = AVATARS[(AVATARS.indexOf(p.avatar) + 1) % AVATARS.length];
      await saveProfiles(); renderProfileChip(); reopen();
    } else if (act === 'rename'){
      const name = cleanName(prompt('Новое имя ученика:', p.name));
      if (!name) return;
      p.name = name; await saveProfiles(); renderProfileChip(); reopen();
    } else if (act === 'switch'){
      closeModal(); await switchProfile(p.id);
    } else if (act === 'delete'){
      if (!confirm(`Удалить ученика «${p.name}» и весь его прогресс на этом устройстве? Это нельзя отменить — сначала можно сохранить копию.`)) return;
      const wasActive = p.id === activeId();
      profiles.list = profiles.list.filter(x => x.id !== p.id);
      if (wasActive){
        profiles.active = profiles.list[0].id;
        setState(takeDeviceSettings(await loadState(profiles.active)));
        applyLoadedState();
      }
      await deleteStoredState(p.id);
      await saveProfiles();
      renderProfileChip();
      toast(`Ученик «${p.name}» удалён`);
      reopen();
    }
  });
  const form = document.getElementById('pf-add');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const name = cleanName(document.getElementById('pf-add-name').value);
    if (!name){ document.getElementById('pf-add-name').focus(); return; }
    const avatar = form.querySelector('input[name=pf-av]:checked')?.value;
    await createProfile(name, avatar);
    toast(`${avatar} Добавлен ученик «${name}»`);
    reopen();
  };
}

