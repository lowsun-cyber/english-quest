#!/usr/bin/env node
// Проверка сервера (server/): вход, ученики, подключение устройств, синхронизация, права доступа.
// Поднимает встроенный сервер PHP с временной базой SQLite.
//   node tests/api.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
export const API_PORT = 8766;
const API = `http://127.0.0.1:${API_PORT}`;
const ORIGIN = 'http://127.0.0.1:8765';

// Временная база и настройки; возвращает { api, ownerCode, stop }
export async function startApi(){
  const dir = mkdtempSync(join(tmpdir(), 'eq-api-'));
  const cfg = join(dir, 'config.php');
  writeFileSync(cfg, `<?php return ['db' => ['dsn' => 'sqlite:${join(dir, 'eq.sqlite')}'], 'origins' => ['${ORIGIN}'], 'secret' => 'test', 'debug' => true];`);
  const env = { ...process.env, EQ_CONFIG: cfg };
  const out = execFileSync('php', [join(ROOT, 'server/bin/setup.php'), 'init', 'Тестовая школа', 'Владелец'], { env, encoding: 'utf8' });
  const ownerCode = /Код входа: (\S+)/.exec(out)[1];
  const proc = spawn('php', ['-S', `127.0.0.1:${API_PORT}`, '-t', join(ROOT, 'server/public'), join(ROOT, 'server/public/index.php')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = ''; proc.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 50; i++){
    try { if ((await fetch(API + '/')).ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
    if (i === 49) throw new Error('Сервер PHP не запустился:\n' + log);
  }
  return { api: API, ownerCode, env, stop(){ proc.kill(); rmSync(dir, { recursive: true, force: true }); } };
}

export async function call(path, { token, body, method } = {}){
  const res = await fetch(API + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...(token ? { 'X-EQ-Token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch (e) {}
  return { status: res.status, data, headers: res.headers };
}

if (import.meta.url === `file://${process.argv[1]}`){
  let fail = 0, total = 0;
  const check = (name, cond, info = '') => { total++; if (!cond){ fail++; console.log(`FAIL  ${name}${info ? '  — ' + JSON.stringify(info) : ''}`); } else console.log(`ok    ${name}`); };
  const srv = await startApi();
  try {
    // вход владельца
    let r = await call('/login', { body: { code: srv.ownerCode.toLowerCase().replace('-', ' ') } });
    check('вход по коду (регистр и пробелы не важны)', r.status === 200 && r.data.token?.length === 64, r.data);
    const owner = r.data.token;
    check('код одноразовый', (await call('/login', { body: { code: srv.ownerCode } })).status === 400);
    r = await call('/me', { token: owner });
    check('/me — владелец и организация', r.data.user?.role === 'owner' && r.data.org?.name === 'Тестовая школа', r.data);
    check('CORS для приложения', r.headers.get('access-control-allow-origin') === ORIGIN);
    check('без ключа — 401', (await call('/students')).status === 401);

    // ученики
    r = await call('/students', { token: owner, body: { name: '  Маша   Иванова  ', avatar: '🐼' } });
    check('добавить ученика', r.status === 200 && r.data.student.name === 'Маша Иванова' && r.data.student.avatar === '🐼', r.data);
    const masha = r.data.student.id;
    check('пустое имя не принимается', (await call('/students', { token: owner, body: { name: '  ' } })).status === 400);
    r = await call(`/students/${masha}`, { token: owner, body: { name: 'Маша' } });
    check('переименовать', r.data.student?.name === 'Маша');

    // устройство
    r = await call(`/students/${masha}/code`, { token: owner, body: {} });
    check('код подключения', /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.data.code || ''), r.data);
    r = await call('/claim', { body: { code: r.data.code, label: 'Планшет' } });
    check('устройство подключено', r.status === 200 && r.data.student.name === 'Маша', r.data);
    const devA = r.data.token;
    r = await call(`/students/${masha}/code`, { token: owner, body: {} });
    const devB = (await call('/claim', { body: { code: r.data.code, label: 'Телефон' } })).data.token;

    r = await call('/progress', { token: devA });
    check('прогресса пока нет', r.status === 200 && r.data.state === null && r.data.version === 0, r.data);
    r = await call('/progress', { token: devA, body: { base: 0, state: { xp: 10, gold: 5 } } });
    check('первая запись — версия 1', r.status === 200 && r.data.version === 1, r.data);
    r = await call('/progress', { token: devB, body: { base: 0, state: { xp: 3 } } });
    check('устаревшая версия — 409 с свежим прогрессом', r.status === 409 && r.data.version === 1 && r.data.state.xp === 10, r.data);
    r = await call('/progress', { token: devB, body: { base: 1, state: { xp: 13, gold: 5 } } });
    check('после объединения — версия 2', r.status === 200 && r.data.version === 2);
    r = await call('/progress', { token: devA });
    check('другое устройство видит новое', r.data.version === 2 && r.data.state.xp === 13);
    await call('/progress', { token: devA, body: { base: 2, state: { xp: 13, inventory: {}, homework: null, activity: {} } } });
    r = await call('/progress', { token: devB });
    check('пустые {} остаются объектами', JSON.stringify(r.data.state) === '{"xp":13,"inventory":{},"homework":null,"activity":{}}', r.data.state);
    check('список вместо объекта не принимается', (await call('/progress', { token: devA, body: { base: 3, state: [1, 2] } })).status === 400);
    check('слишком большой прогресс', (await call('/progress', { token: devA, body: { base: 3, state: { big: 'x'.repeat(600 * 1024) } } })).status === 413);
    check('устройство не видит список учеников', (await call('/students', { token: devA })).status === 401);

    // сводка для учителя
    const today = new Date(); const dk = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await call('/progress', { token: devA, body: { base: 3, state: { xp: 20, activity: { [dk]: { sec: 600, ok: 8, bad: 2 } } } } });
    r = await call('/students', { token: owner });
    const row = r.data.students.find(s => s.id === masha);
    check('сводка: XP, минуты за неделю, устройства', row.summary.xp === 20 && row.summary.week.sec === 600 && row.summary.week.days === 1 && row.devices === 2 && row.version === 4, row);
    r = await call(`/students/${masha}/progress`, { token: owner });
    check('учитель видит прогресс целиком', r.data.state?.xp === 20);

    // учитель видит только своих
    r = await call('/users', { token: owner, body: { name: 'Анна Петровна' } });
    check('создать учителя с кодом входа', r.status === 200 && r.data.login?.code, r.data);
    const teacher = (await call('/login', { body: { code: r.data.login.code } })).data.token;
    r = await call('/students', { token: teacher });
    check('учитель не видит чужих учеников', r.data.students.length === 0);
    check('…и не открывает их прогресс', (await call(`/students/${masha}/progress`, { token: teacher })).status === 404);
    check('учитель не создаёт учителей', (await call('/users', { token: teacher, body: { name: 'X' } })).status === 403);
    r = await call('/students', { token: teacher, body: { name: 'Петя', teacherId: 'подмена' } });
    check('учитель добавляет ученика себе', r.status === 200 && (await call('/students', { token: teacher })).data.students.length === 1);

    // устройства и удаление
    r = await call(`/students/${masha}/devices`, { token: owner });
    check('список устройств', r.data.devices.length === 2 && r.data.devices[0].label === 'Планшет');
    await call(`/devices/${r.data.devices[1].id}/delete`, { token: owner, body: {} });
    check('отключённое устройство больше не пишет', (await call('/progress', { token: devB })).status === 401);
    await call(`/students/${masha}/delete`, { token: owner, body: {} });
    check('удалённый ученик: устройство отключено', (await call('/progress', { token: devA })).status === 401);
    check('…и его нет в списке', !(await call('/students', { token: owner })).data.students.some(s => s.id === masha));

    // защита от подбора кодов
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await call('/claim', { body: { code: 'AAAA-AAAA' } })).status;
    check('после 20 неверных кодов — пауза', last === 429);

    await call('/logout', { token: owner, body: {} });
    check('выход — ключ больше не работает', (await call('/me', { token: owner })).status === 401);
    check('неизвестный адрес — 404', (await call('/nope')).status === 404);
  } finally { srv.stop(); }
  console.log(`\n${total - fail} из ${total} проверок сервера прошли`);
  process.exit(fail ? 1 : 0);
}
