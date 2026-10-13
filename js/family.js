// English Quest — Ключ семьи (docs/concept-entry-test-and-key.md, раздел 5; сервер — server/src/family.php).
// Родитель в панели для взрослых сохраняет прогресс детей на сервере и получает ключ из 4 слов и 2 цифр
// с QR-кодом. Ребёнок ключ не вводит: устройство подключается один раз. Имена детей остаются на устройстве,
// на сервере — прозвище по аватару («Панда-47»).
// На устройстве: profiles.family = { token, tokenId } — вход взрослого; у профиля ребёнка cloud.family = true.
import { api, ApiError, deviceLabel } from './api.js';
import { cloudOn, forgetLink, linkFamily, syncNow } from './cloud.js';
import { renderProfileChip } from './profiles.js';
import { activeId, profiles, saveProfiles, writeSyncBase } from './state.js';
import { qrSvg } from './qr.js';
import { closeModal, openModal, toast } from './ui.js';
import { escapeHtml } from './util.js';

const famToken = () => profiles?.family?.token || null;
const KEY_HINT = 'ЛИСА-РАКЕТА-ПИРОГ-ЗОНТ-47';
// профиль, который можно сохранить в семью: не подключён к серверу учителя
const ownProfiles = () => profiles.list.filter(p => !p.cloud || p.cloud.family);

// ---------- раздел в панели для взрослых ----------
export function familySectionHtml(){
  return `<div id="fam-box" class="fam-box">${famToken() ? '<p class="t-muted">Загружаю семью…</p>' : startHtml()}</div>`;
}
export function wireFamilySection(reopen){
  if (!cloudOn()) return;
  if (famToken()) loadFamily(reopen); else wireStart(reopen);
}

// Семьи на устройстве ещё нет: что это, что хранится, согласие, «у меня уже есть ключ», «забыли ключ»
function startHtml(note = ''){
  return `
    ${note ? `<p class="fam-note" role="status">${escapeHtml(note)}</p>` : ''}
    <p>Сейчас прогресс хранится только на этом устройстве. Сохраните его на сервере — получите <b>ключ семьи</b>: прогресс не потеряется, его можно продолжить на другом устройстве. Логины, пароли и имена детей не нужны.</p>
    <details class="cl-more"><summary>Что хранится на сервере</summary>
      <ul class="fam-what">
        <li>Прогресс детей и прозвище по аватару («Панда-47»). Имена — только на этом устройстве.</li>
        <li>Отпечаток ключа — сам ключ мы не храним и показать ещё раз не сможем.</li>
        <li>Названия подключённых устройств («iPad · 12.10.2026»).</li>
        <li>Почта — только если вы сами её укажете для восстановления ключа.</li>
        <li>Если год никто не занимается, данные удаляются (с почтой — после письма-предупреждения).</li>
      </ul>
      <p class="t-muted">Записи голоса («послушай себя») остаются только на устройстве. Подробнее — <a href="privacy.html#family" target="_blank" rel="noopener">политика конфиденциальности</a>.</p>
    </details>
    <label class="fam-check"><input type="checkbox" id="fam-consent" /> <span>Я родитель (законный представитель) и согласен(на) на обработку данных ребёнка на этих условиях.</span></label>
    <div class="controls"><button class="btn" id="fam-create">☁️ Сохранить прогресс и получить ключ</button></div>
    <p class="gate-err" id="fam-err" role="alert" hidden></p>
    ${keyFormsHtml('fam')}`;
}
// Ввод ключа и «забыли ключ» — в панели для взрослых и в панели «Войти»
export function keyFormsHtml(p){
  return `
    <details class="cl-more">
      <summary>У меня уже есть ключ семьи</summary>
      <form class="cl-form" id="${p}-key-form">
        <label>Ключ семьи <input id="${p}-key" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${KEY_HINT}" maxlength="80" /></label>
        <button class="btn secondary" type="submit">🔑 Подключить устройство</button>
      </form>
      <p class="gate-err" id="${p}-key-err" role="alert" hidden></p>
    </details>
    <details class="cl-more">
      <summary>Забыли ключ семьи?</summary>
      <p class="t-muted">Если вы указывали почту, пришлём ссылку на новый ключ. Ещё можно выпустить новый ключ на устройстве, которое уже подключено: «Для взрослых» → «Ключ семьи».</p>
      <form class="cl-form" id="${p}-forgot-form">
        <label>Почта <input id="${p}-forgot-email" type="email" autocomplete="email" /></label>
        <button class="btn secondary" type="submit">Прислать ссылку</button>
      </form>
      <p class="t-muted" id="${p}-forgot-msg" role="status" hidden></p>
    </details>`;
}
export function wireKeyForms(p, before, after){
  const form = document.getElementById(`${p}-key-form`);
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const input = document.getElementById(`${p}-key`), key = input.value.trim();
    if (!key){ input.focus(); return; }
    form.querySelector('button').disabled = true;
    try { before?.(); await familyLogin(key); }
    catch (ex){
      after?.();
      const err = document.getElementById(`${p}-key-err`);
      if (err){ err.textContent = ex.message; err.hidden = false; document.getElementById(`${p}-key`).value = key; }
      else toast('🔑 ' + ex.message);
    }
  };
  const forgot = document.getElementById(`${p}-forgot-form`);
  if (forgot) forgot.onsubmit = async (e) => {
    e.preventDefault();
    const msg = document.getElementById(`${p}-forgot-msg`);
    try { msg.textContent = (await api('/family/forgot', { body: { email: document.getElementById(`${p}-forgot-email`).value } })).message; }
    catch (ex){ msg.textContent = ex.message; }
    msg.hidden = false;
  };
}
function wireStart(reopen){
  const err = document.getElementById('fam-err');
  document.getElementById('fam-create').onclick = async (e) => {
    if (!document.getElementById('fam-consent').checked){ err.textContent = 'Отметьте согласие — без него сохранить прогресс на сервере нельзя.'; err.hidden = false; return; }
    e.target.disabled = true;
    try {
      const r = await api('/family', { body: { consent: true, label: deviceLabel() } });
      profiles.family = { token: r.token, tokenId: r.tokenId };
      await saveProfiles();
      for (const p of ownProfiles()) if (!p.cloud) await saveChild(p);
      showKeyCard(r, reopen);
    } catch (ex){ err.textContent = ex.message; err.hidden = false; e.target.disabled = false; }
  };
  wireKeyForms('fam', null, null);
}

// Семья подключена: дети, устройства, ключ, почта, выход и удаление
async function loadFamily(reopen){
  const box = document.getElementById('fam-box');
  let f;
  try { f = await api('/family', { token: famToken() }); }
  catch (ex){
    if (!box?.isConnected) return;
    if (ex instanceof ApiError && ex.status === 401){
      await forgetFamily();
      box.innerHTML = startHtml('Устройство отключено от семьи (ключ отключили на другом устройстве или удалили данные). Прогресс на устройстве остался.');
      wireStart(reopen);
    } else box.innerHTML = `<p class="t-muted">Не получилось связаться с сервером: ${escapeHtml(ex.message)} Прогресс сохраняется на устройстве и отправится позже.</p>`;
    return;
  }
  if (!box?.isConnected) return;
  const here = new Set(profiles.list.map(p => (p.cloud?.family && p.cloud.studentId) || p.wasFamily).filter(Boolean));
  const other = f.children.filter(c => !here.has(c.id));
  const kidOf = id => f.children.find(c => c.id === id);
  box.innerHTML = `
    <p>☁️ Семья подключена на этом устройстве. Прогресс детей сохраняется на сервере.</p>
    <h4 class="fam-h">Дети на этом устройстве</h4>
    <ul class="fam-list" role="list">${ownProfiles().map(p => {
      const kid = p.cloud?.family && kidOf(p.cloud.studentId), was = !kid && p.wasFamily && kidOf(p.wasFamily);
      return `<li><span class="fam-main">${escapeHtml(p.avatar)} <b>${escapeHtml(p.name)}</b> ${kid ? `<span class="t-muted">— сохраняется, на сервере «${escapeHtml(kid.name)}»</span>` : was ? `<span class="t-muted">— был на сервере «${escapeHtml(was.name)}», сейчас не сохраняется</span>` : '<span class="t-muted">— только на устройстве</span>'}</span>
        <span class="fam-acts">${kid ? `<button class="icon-btn" data-fam-del="${kid.id}">Удалить с сервера</button>` : was ? `<button class="btn secondary" data-fam-link="${was.id}">☁️ Подключить снова</button>` : `<button class="btn secondary" data-fam-save="${escapeHtml(p.id)}">☁️ Сохранить</button>`}</span></li>`;
    }).join('')}</ul>
    ${other.length ? `<h4 class="fam-h">Ещё в семье</h4>
      <ul class="fam-list" role="list">${other.map(c => `<li><span class="fam-main">${escapeHtml(c.avatar)} <b>${escapeHtml(c.name)}</b> <span class="t-muted">${c.xp} XP</span></span>
        <span class="fam-acts"><button class="btn secondary" data-fam-link="${c.id}">Играет здесь</button></span></li>`).join('')}</ul>` : ''}
    <h4 class="fam-h">Устройства семьи: ${f.devices.length} из ${f.maxDevices}</h4>
    <ul class="fam-list" role="list">${f.devices.map(d => `<li><span class="fam-main">${escapeHtml(d.label || 'Устройство')}${d.current ? ' <b>— это</b>' : ''} <span class="t-muted">· ${new Date(d.lastUsed).toLocaleDateString('ru-RU')}</span></span>
      ${d.current ? '' : `<span class="fam-acts"><button class="icon-btn" data-fam-dev="${d.id}">Отключить</button></span>`}</li>`).join('')}</ul>
    <p class="t-muted">На новом устройстве: «🔑 Войти» → «У меня уже есть ключ семьи», или наведите камеру телефона на QR-код с карточки.</p>
    <h4 class="fam-h">Почта для восстановления ключа</h4>
    ${f.email ? `<p>${escapeHtml(f.email)} <button class="icon-btn" id="fam-email-off">Убрать почту</button></p>` : `
      <p class="t-muted">По желанию. Только чтобы прислать ссылку на новый ключ, если этот потеряется, и предупредить перед удалением неактивной семьи.</p>
      <form class="cl-form" id="fam-email-form">
        <label>Почта <input id="fam-email" type="email" autocomplete="email" /></label>
        <label class="fam-check"><input type="checkbox" id="fam-email-ok" /> <span>Согласен(на) хранить почту для восстановления ключа.</span></label>
        <button class="btn secondary" type="submit">Сохранить почту</button>
      </form>`}
    <p class="gate-err" id="fam-err" role="alert" hidden></p>
    <div class="controls">
      <button class="btn secondary" id="fam-newkey">🔑 Выпустить новый ключ</button>
      <button class="icon-btn" id="fam-logout">Выйти из семьи на этом устройстве</button>
      <button class="icon-btn fam-danger" id="fam-delete">Удалить всё на сервере</button>
    </div>`;
  const err = msg => { const el = document.getElementById('fam-err'); el.textContent = msg; el.hidden = false; };
  // кнопка выключается на время запроса; при ошибке — сообщение и снова доступна
  const run = fn => async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await fn(btn); } catch (ex){ if (ex instanceof ApiError && ex.status === 401) return loadFamily(reopen); err(ex.message); btn.disabled = false; }
  };
  box.querySelectorAll('[data-fam-save]').forEach(b => b.onclick = run(async () => {
    await saveChild(profiles.list.find(p => p.id === b.dataset.famSave));
    toast('☁️ Прогресс сохраняется на сервере');
    loadFamily(reopen);
  }));
  box.querySelectorAll('[data-fam-link]').forEach(b => b.onclick = run(async () => {
    const r = await api(`/family/children/${b.dataset.famLink}/link`, { token: famToken(), body: {} });
    closeModal();
    await linkFamily(r);
  }));
  box.querySelectorAll('[data-fam-del]').forEach(b => b.onclick = run(async () => {
    const p = profiles.list.find(x => x.cloud?.studentId === b.dataset.famDel);
    if (!confirm(`Удалить прогресс «${p?.name || ''}» с сервера? На этом устройстве он останется, но перестанет сохраняться.`)){ b.disabled = false; return; }
    await api(`/family/children/${b.dataset.famDel}/delete`, { token: famToken(), body: {} });
    if (p) await unlinkProfile(p);
    loadFamily(reopen);
  }));
  box.querySelectorAll('[data-fam-dev]').forEach(b => b.onclick = run(async () => {
    await api(`/family/devices/${b.dataset.famDev}/delete`, { token: famToken(), body: {} });
    toast('Устройство отключено от семьи');
    loadFamily(reopen);
  }));
  const emailForm = document.getElementById('fam-email-form');
  if (emailForm) emailForm.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/family/email', { token: famToken(), body: { email: document.getElementById('fam-email').value, consent: document.getElementById('fam-email-ok').checked } }); loadFamily(reopen); }
    catch (ex){ err(ex.message); }
  };
  const off = document.getElementById('fam-email-off');
  if (off) off.onclick = run(async () => { await api('/family/email', { token: famToken(), body: { email: '' } }); loadFamily(reopen); });
  document.getElementById('fam-newkey').onclick = run(async (btn) => {
    if (!confirm('Выпустить новый ключ? Старый перестанет действовать. Подключённые устройства продолжат работать.')){ btn.disabled = false; return; }
    showKeyCard(await api('/family/key', { token: famToken(), body: {} }), reopen);
  });
  document.getElementById('fam-logout').onclick = run(async (btn) => {
    if (!confirm('Выйти из семьи на этом устройстве? Прогресс останется здесь, но перестанет сохраняться на сервере, пока снова не введёте ключ.')){ btn.disabled = false; return; }
    try { await api('/logout', { token: famToken(), body: {} }); } catch (ex) {}
    await forgetFamily();
    toast('Устройство отключено от семьи');
    reopen();
  });
  document.getElementById('fam-delete').onclick = run(async (btn) => {
    if (!confirm('Удалить с сервера всё: прогресс детей, ключ, почту и устройства? Это нельзя отменить. На этом устройстве прогресс останется.')){ btn.disabled = false; return; }
    await api('/family/delete', { token: famToken(), body: {} });
    await forgetFamily();
    toast('Данные семьи удалены с сервера');
    reopen();
  });
}

// ---------- действия ----------
async function saveChild(p){
  const r = await api('/family/children', { token: famToken(), body: { avatar: p.avatar } });
  p.cloud = { studentId: r.student.id, token: r.token, deviceId: r.deviceId, name: r.student.name, family: true, first: true };
  await writeSyncBase(p.id, null);
  await saveProfiles();
  renderProfileChip();
  if (p.id === activeId()) syncNow();
}
async function unlinkProfile(p){
  delete p.cloud;
  await writeSyncBase(p.id, null);
  await saveProfiles();
  renderProfileChip();
}
// Семья на устройстве больше не подключена: дети остаются, но не синхронизируются
async function forgetFamily(){
  delete profiles.family;
  for (const p of profiles.list) if (p.cloud?.family) await forgetLink(p);
  await saveProfiles();
  renderProfileChip();
}

// Вход по ключу (или номерам из QR). Устройств уже 5 — предложить отключить все и подключить это.
export async function familyLogin(key){
  let r;
  try { r = await api('/family/login', { body: { key, label: deviceLabel() } }); }
  catch (ex){
    if (!(ex instanceof ApiError) || ex.data?.error !== 'devices_full') throw ex;
    if (!confirm(ex.message + '\n\nОтключить все устройства семьи и подключить это?')) throw ex;
    r = await api('/family/login', { body: { key, label: deviceLabel(), replace: true } });
  }
  await joined(r);
}
async function joined(r){
  profiles.family = { token: r.token, tokenId: r.tokenId };
  await saveProfiles();
  closeModal();
  chooseChildren(r.family.children);
}
// Кто из детей семьи играет на этом устройстве
function chooseChildren(kids){
  if (!kids.length){ toast('🔑 Устройство подключено к семье. Сохранить прогресс детей — в «Для взрослых» → «Ключ семьи».'); return; }
  openModal(`
    <h2>🔑 Устройство в семье</h2>
    <p>Кто будет играть на этом устройстве? Можно выбрать нескольких — по очереди. Имя на устройстве потом можно поменять в «Для взрослых» → «Ученики».</p>
    <div class="controls fam-kids">${kids.map(c => `<button class="btn" data-kid="${c.id}">${escapeHtml(c.avatar)} ${escapeHtml(c.name)} <small>${c.xp} XP</small></button>`).join('')}</div>
    <div class="controls"><button class="btn secondary" id="fam-kids-done">Готово</button></div>`);
  document.getElementById('fam-kids-done').onclick = closeModal;
  document.querySelectorAll('[data-kid]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { const r = await api(`/family/children/${b.dataset.kid}/link`, { token: famToken(), body: {} }); closeModal(); await linkFamily(r); }
    catch (ex){ toast('🔑 ' + ex.message); b.disabled = false; }
  });
}

// ---------- карточка ключа ----------
const keyUrl = code => `${location.origin}${location.pathname}#fk=${code}`;
function cardHtml(r){
  return `<div class="fam-card">
      <div class="fam-card-title">🔑 Ключ семьи · English Quest</div>
      <div class="fam-key" lang="ru">${escapeHtml(r.key)}</div>
      ${qrSvg(keyUrl(r.keyCode), 'QR-код для подключения устройства к семье')}
      <div class="fam-card-note">Новое устройство: «🔑 Войти» → «У меня уже есть ключ семьи», или камера телефона на QR-код. Храните ключ как ключ от дома.</div>
    </div>`;
}
export function showKeyCard(r, after){
  openModal(`
    <h2>🔑 Ключ семьи</h2>
    ${cardHtml(r)}
    <p class="fam-warn" role="note"><b>Сохраните ключ сейчас.</b> Мы храним только его отпечаток и показать ключ ещё раз не сможем. Распечатайте карточку или сфотографируйте её. Если ключ потеряется, а почта не указана, восстановить прогресс на сервере будет нельзя (на устройствах он останется).</p>
    <div class="controls">
      <button class="btn secondary" id="fam-print">🖨️ Распечатать карточку</button>
      <button class="btn" id="fam-done">Я сохранил(а) ключ</button>
    </div>`);
  document.getElementById('fam-print').onclick = () => printCard(r);
  document.getElementById('fam-done').onclick = () => { closeModal(); after?.(); };
}
// Печать — в отдельном окне: только карточка, без интерфейса игры
function printCard(r){
  const w = window.open('', '_blank', 'width=480,height=640');
  if (!w){ toast('Браузер не открыл окно печати — сфотографируйте карточку'); return; }
  w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Ключ семьи</title><style>
    body{font-family:system-ui,sans-serif;margin:24px;color:#000;background:#fff}
    .fam-card{border:3px solid #000;border-radius:8px;padding:16px;max-width:360px;text-align:center}
    .fam-card-title{font-weight:700;margin-bottom:8px}.fam-key{font:700 22px/1.3 ui-monospace,monospace;word-break:break-word;margin:8px 0}
    .qr{width:200px;height:200px}.fam-card-note{font-size:13px;margin-top:8px}
  </style></head><body>${cardHtml(r)}<script>onload=()=>{print()}<\/script></body></html>`);
  w.document.close();
}

// ---------- ссылки: QR-код (#fk=…) и письмо «новый ключ» (#famkey=…) ----------
export function familyFromHash(){
  if (!cloudOn()) return false;
  const fk = /^#fk=(\d{1,4}(?:\.\d{1,4}){3}\.\d{2})$/.exec(location.hash);
  const rec = /^#famkey=([0-9a-f]{64})$/.exec(location.hash);
  if (!fk && !rec) return false;
  history.replaceState(null, '', location.pathname + location.search);
  if (fk){
    openModal(`
      <h2>🔑 Подключить устройство к семье?</h2>
      <p>Прогресс детей будет сохраняться на сервере и продолжится на этом устройстве.</p>
      <div class="controls"><button class="btn" id="fam-go">Подключить</button><button class="btn secondary" id="fam-no">Не сейчас</button></div>`);
    document.getElementById('fam-no').onclick = closeModal;
    document.getElementById('fam-go').onclick = async (e) => {
      e.target.disabled = true;
      try { await familyLogin(fk[1]); } catch (ex){ closeModal(); toast('🔑 ' + ex.message); }
    };
  } else {
    (async () => {
      try {
        const r = await api('/family/recover', { body: { token: rec[1], label: deviceLabel() } });
        profiles.family = { token: r.token, tokenId: r.tokenId };
        await saveProfiles();
        showKeyCard(r, () => chooseChildren(r.family.children.filter(c => !profiles.list.some(p => p.cloud?.studentId === c.id))));
      } catch (ex){ toast('🔑 ' + ex.message); }
    })();
  }
  return true;
}
