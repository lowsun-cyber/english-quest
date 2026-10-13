#!/usr/bin/env node
// Проверка сервера (server/): вход, ученики, подключение устройств, синхронизация, права доступа.
// Поднимает встроенный сервер PHP с временной базой SQLite.
//   node tests/api.mjs
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
export const API_PORT = 8766;
const API = `http://127.0.0.1:${API_PORT}`;
const ORIGIN = 'http://127.0.0.1:8765';

// Временная база и настройки; возвращает { api, ownerCode, stop }
// serverDir — папка с кодом сервера (для проверки обновления базы со старой версии), sqlite — готовый файл базы
export async function startApi({ init = true, setupKey = '', serverDir = join(ROOT, 'server'), sqlite = null, freshDb = true, mysqlCharset = 'utf8' } = {}){
  const dir = mkdtempSync(join(tmpdir(), 'eq-api-'));
  const mailLog = join(dir, 'mail.log');
  const cfg = join(dir, 'config.php');
  // по умолчанию — временная SQLite; EQ_TEST_MYSQL=1 — настоящая MySQL (как на хостинге), база пересоздаётся
  const my = process.env.EQ_TEST_MYSQL ? { host: process.env.MYSQL_HOST || '127.0.0.1', port: process.env.MYSQL_PORT || '3306', user: process.env.MYSQL_USER || 'root', pass: process.env.MYSQL_PASSWORD || 'root', db: 'eq_test' } : null;
  if (my && freshDb) execFileSync('mysql', ['-h', my.host, '-P', my.port, '-u', my.user, `-p${my.pass}`, '-e', `DROP DATABASE IF EXISTS ${my.db}; CREATE DATABASE ${my.db} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`]);
  const db = my
    // charset=utf8 (3 байта) — как бывает на хостинге: сервер сам должен включить utf8mb4, иначе эмодзи-аватары не сохранятся
    ? `['dsn' => 'mysql:host=${my.host};port=${my.port};dbname=${my.db};charset=${mysqlCharset}', 'user' => '${my.user}', 'password' => '${my.pass}']`
    : `['dsn' => 'sqlite:${sqlite || join(dir, 'eq.sqlite')}']`;
  // письма не отправляются, а пишутся в файл — тест читает из него ссылки
  writeFileSync(cfg, `<?php return ['db' => ${db}, 'origins' => ['${ORIGIN}'], 'secret' => 'test', 'setup_key' => '${setupKey}', 'debug' => true,
    'app_url' => 'https://quest.example/', 'mail' => ['transport' => 'log', 'log_file' => '${mailLog}', 'from' => 'noreply@example.org']];`);
  const env = { ...process.env, EQ_CONFIG: cfg };
  const out = init ? execFileSync('php', [join(serverDir, 'bin/setup.php'), 'init', 'Тестовая школа', 'Владелец'], { env, encoding: 'utf8' }) : '';
  const ownerCode = init ? /Код входа: (\S+)/.exec(out)[1] : null;
  const proc = spawn('php', ['-S', `127.0.0.1:${API_PORT}`, '-t', join(serverDir, 'public'), join(serverDir, 'public/index.php')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let log = ''; proc.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 50; i++){
    try { if ((await fetch(API + '/')).ok) break; } catch (e) {}
    await new Promise(r => setTimeout(r, 100));
    if (i === 49) throw new Error('Сервер PHP не запустился:\n' + log);
  }
  const mails = () => existsSync(mailLog) ? readFileSync(mailLog, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const stop = () => new Promise(r => { proc.once('exit', r); proc.kill(); }).then(() => rmSync(dir, { recursive: true, force: true }));
  return { api: API, ownerCode, env, mails, stop };
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
    r = await call('/me/code', { token: owner, body: {} });
    check('код для входа на другом устройстве', /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(r.data.code || ''), r.data);
    r = await call('/login', { body: { code: r.data.code } });
    check('…по нему входит тот же человек', r.status === 200 && r.data.user.role === 'owner' && r.data.token !== owner);
    check('код для себя без входа не выдаётся', (await call('/me/code', { body: {} })).status === 401);
    const second = r.data.token;   // вход «на другом устройстве» из проверки выше
    await call('/me/code', { token: owner, body: {} });
    r = await call('/me/sessions', { token: owner });
    check('мои входы: оба устройства, текущее отмечено', r.data.sessions.length === 2 && r.data.sessions.filter(x => x.current).length === 1 && r.data.codes.count === 1, r.data);
    check('чужой вход не отключить', (await call('/me/sessions/t0000000000000000/delete', { token: owner, body: {} })).status === 404);
    r = await call('/me/codes/delete', { token: owner, body: {} });
    check('неиспользованные коды отменены', r.data.deleted === 1 && (await call('/me/sessions', { token: owner })).data.codes.count === 0);
    r = await call('/me/sessions/others/delete', { token: owner, body: {} });
    check('выйти на других устройствах', r.data.deleted === 1 && (await call('/me', { token: second })).status === 401 && (await call('/me', { token: owner })).status === 200);
    const third = (await call('/login', { body: { code: (await call('/me/code', { token: owner, body: {} })).data.code } })).data.token;
    const thirdId = (await call('/me/sessions', { token: owner })).data.sessions.find(x => !x.current).id;
    await call(`/me/sessions/${thirdId}/delete`, { token: owner, body: {} });
    check('отключить одно устройство', (await call('/me', { token: third })).status === 401);

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

    // администрирование: роли, смена репетитора, удаление с передачей учеников
    r = await call('/users', { token: owner });
    const anna = r.data.users.find(u => u.name === 'Анна Петровна');
    check('список взрослых со счётчиком учеников', anna?.students === 1 && anna.role === 'teacher', r.data.users);
    r = await call('/users', { token: owner, body: { name: 'Завуч', role: 'admin' } });
    check('владелец создаёт администратора', r.data.user?.role === 'admin');
    const admin = (await call('/login', { body: { code: r.data.login.code } })).data.token;
    const adminId = r.data.user.id;
    check('администратор не создаёт администраторов', (await call('/users', { token: admin, body: { name: 'X', role: 'admin' } })).status === 403);
    check('…и не меняет владельца', (await call(`/users/${(await call('/me', { token: owner })).data.user.id}`, { token: admin, body: { name: 'Взлом' } })).status === 403);
    r = await call(`/users/${anna.id}`, { token: admin, body: { name: 'Анна П.' } });
    check('администратор переименовывает репетитора', r.data.user?.name === 'Анна П.');
    check('неизвестная роль не принимается', (await call(`/users/${anna.id}`, { token: owner, body: { role: 'boss' } })).status === 400);
    check('свою роль поменять нельзя', (await call(`/users/${adminId}`, { token: admin, body: { role: 'teacher' } })).status === 403);
    const petya = (await call('/students', { token: teacher })).data.students[0];
    check('репетитор не передаёт ученика другому', (await call(`/students/${petya.id}`, { token: teacher, body: { teacherId: adminId } })).status === 403);
    r = await call(`/students/${masha}`, { token: admin, body: { teacherId: anna.id } });
    check('администратор меняет репетитора ученика', r.data.student?.teacherId === anna.id);
    check('теперь Анна видит Машу', (await call('/students', { token: teacher })).data.students.some(x => x.id === masha));

    // домашнее задание из админ-панели
    r = await call(`/students/${masha}/progress`, { token: teacher });
    const hwBase = r.data.version;
    const hw = { id: 'g2-hello|vocab|2026-10-10|', lessonId: 'g2-hello', tasks: ['vocab', 'listen'], due: '2026-10-10', note: 'Повтори слова', assigned: Date.now(), baseline: { vocab: 0, listen: 0 }, doneAt: null };
    r = await call(`/students/${masha}/homework`, { token: teacher, body: { base: hwBase, homework: hw } });
    check('домашка назначена с сервера', r.status === 200 && r.data.version === hwBase + 1, r.data);
    r = await call('/progress', { token: devA });
    check('устройство получает домашку, остальное не тронуто', r.data.state.homework?.note === 'Повтори слова' && r.data.state.xp === 20 && r.data.version === hwBase + 1);
    check('старая версия — 409', (await call(`/students/${masha}/homework`, { token: teacher, body: { base: hwBase, homework: null } })).status === 409);
    check('кривое задание не принимается', (await call(`/students/${masha}/homework`, { token: teacher, body: { base: hwBase + 1, homework: { ...hw, tasks: ['<script>'] } } })).status === 400);
    r = await call(`/students/${masha}/homework`, { token: teacher, body: { base: hwBase + 1, homework: null } });
    check('домашку можно отменить', r.status === 200 && (await call('/progress', { token: devA })).data.state.homework === null);
    const sonya = (await call('/students', { token: owner, body: { name: 'Соня' } })).data.student.id;
    r = await call(`/students/${sonya}/homework`, { token: owner, body: { base: 0, homework: hw } });
    check('домашка ученику без прогресса', r.status === 200 && r.data.version === 1);
    await call(`/students/${sonya}/delete`, { token: owner, body: {} });

    // посылка от Dr. Harlow (итерация 5): кладётся в parcels, с проверкой версии; отзыв — отметка withdrawn
    {
      const pk = JSON.parse(readFileSync(join(ROOT, 'docs/ai-pack/example-parcel.json'), 'utf8'));
      let v = (await call(`/students/${masha}/progress`, { token: teacher })).data.version;
      r = await call(`/students/${masha}/parcel`, { token: teacher, body: { base: v, parcel: pk } });
      check('посылка отправлена с сервера', r.status === 200 && r.data.version === v + 1, r.data);
      r = await call('/progress', { token: devA });
      const got = r.data.state.parcels?.[pk.id];
      check('устройство получает посылку, остальное не тронуто', got?.pack?.reward?.title === pk.reward.title && got.sent > 0 && got.withdrawn === null && r.data.state.xp === 20, got);
      check('посылка: старая версия — 409', (await call(`/students/${masha}/parcel`, { token: teacher, body: { base: v, parcel: pk } })).status === 409);
      check('посылка: чужой формат не принимается', (await call(`/students/${masha}/parcel`, { token: teacher, body: { base: v + 1, parcel: { ...pk, format: 'x' } } })).status === 400);
      check('посылка: кривой id не принимается', (await call(`/students/${masha}/parcel`, { token: teacher, body: { base: v + 1, parcel: { ...pk, id: '../x' } } })).status === 400);
      check('посылка: слишком большая не принимается', (await call(`/students/${masha}/parcel`, { token: teacher, body: { base: v + 1, parcel: { ...pk, note: 'я'.repeat(70000) } } })).status === 400);
      check('посылка: без входа — 401', (await call(`/students/${masha}/parcel`, { body: { base: v + 1, parcel: pk } })).status === 401);
      r = await call(`/students/${masha}/parcel`, { token: teacher, body: { base: v + 1, withdraw: pk.id } });
      check('посылку можно отозвать', r.status === 200 && (await call('/progress', { token: devA })).data.state.parcels[pk.id].withdrawn > 0);
      check('отозвать несуществующую — 404', (await call(`/students/${masha}/parcel`, { token: teacher, body: { base: v + 2, withdraw: 'no-such' } })).status === 404);
    }

    // удаление репетитора: ученики переходят
    check('владельца удалить нельзя', (await call(`/users/${(await call('/me', { token: owner })).data.user.id}/delete`, { token: admin, body: {} })).status === 403);
    r = await call(`/users/${anna.id}/delete`, { token: admin, body: {} });
    check('репетитор удалён', r.status === 200);
    check('его ключ больше не работает', (await call('/me', { token: teacher })).status === 401);
    r = await call('/students', { token: admin });
    check('его ученики перешли к удалившему', r.data.students.filter(x => x.teacherId === adminId).length === 2, r.data.students.map(x => x.teacherId));

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
  } finally { await srv.stop(); }

  // первый запуск из админ-панели (сервер без владельца)
  for (const [key, label] of [['', 'без ключа в config.php'], ['секретный-ключ-установки', 'с ключом']]){
    const s2 = await startApi({ init: false, setupKey: key });
    try {
      let r = await call('/setup');
      check(`первый запуск ${label}: сервер просит настройку`, r.data.needed === true && r.data.enabled === !!key, r.data);
      if (!key){
        r = await call('/setup', { body: { key: 'что-угодно', org: 'Школа', name: 'Я' } });
        check('без ключа в config.php — подсказка, что вписать', r.status === 403 && /setup_key/.test(r.data.message), r.data);
        continue;
      }
      check('неверный ключ не принимается', (await call('/setup', { body: { key: 'не тот', org: 'Школа', name: 'Я' } })).status === 403);
      check('пустое имя не принимается', (await call('/setup', { body: { key, org: 'Школа', name: ' ' } })).status === 400);
      r = await call('/setup', { body: { key, org: 'Мои ученики', name: 'Эльмар' } });
      check('верный ключ — владелец создан и сразу вошёл', r.status === 200 && r.data.token?.length === 64 && r.data.user.role === 'owner', r.data);
      const me = await call('/me', { token: r.data.token });
      check('…организация создана', me.data.org?.name === 'Мои ученики' && me.data.user.name === 'Эльмар');
      check('повторный запуск невозможен', (await call('/setup', { body: { key, org: 'Чужая', name: 'Захватчик' } })).status === 409);
      check('сервер больше не просит настройку', (await call('/setup')).data.needed === false);
      check('восстановление: неверный ключ не принимается', (await call('/setup/recover', { body: { key: 'не тот' } })).status === 403);
      r = await call('/setup/recover', { body: { key } });
      check('восстановление по ключу — вход владельцем', r.status === 200 && r.data.user.role === 'owner' && (await call('/me', { token: r.data.token })).data.user.name === 'Эльмар', r.data);
    } finally { await s2.stop(); }
  }

  // пароли, приглашения и восстановление по почте
  {
    const s3 = await startApi();
    const linkOf = m => /#reset=([0-9a-f]{64})/.exec(m.text)?.[1];
    try {
      const owner = (await call('/login', { body: { code: s3.ownerCode } })).data.token;
      // взрослый: приглашение на почту → задаёт пароль → входит по почте
      let r = await call('/users', { token: owner, body: { name: 'Ольга', email: ' Olga@Example.org ', access: 'invite' } });
      check('приглашение репетитору ушло на почту', r.status === 200 && r.data.mailed === 'olga@example.org' && r.data.user.email === 'olga@example.org', r.data);
      const olgaId = r.data.user.id;
      let mail = s3.mails().at(-1);
      check('в письме — ссылка «задать пароль»', mail?.to === 'olga@example.org' && /https:\/\/quest\.example\/admin\/#reset=/.test(mail.text) && /7 дней/.test(mail.text), mail);
      const invite = linkOf(mail);
      r = await call(`/password/reset/${invite}`);
      check('ссылка знает, для кого она', r.data.kind === 'user' && r.data.name === 'Ольга' && r.data.purpose === 'invite', r.data);
      check('короткий пароль не принимается', (await call('/password/reset', { body: { token: invite, password: '123' } })).status === 400);
      r = await call('/password/reset', { body: { token: invite, password: 'olga-secret-1' } });
      check('пароль задан — сразу вход', r.status === 200 && r.data.token?.length === 64 && r.data.user.hasPassword === true, r.data);
      check('ссылка одноразовая', (await call('/password/reset', { body: { token: invite, password: 'another-pass' } })).status === 400);
      r = await call('/login', { body: { email: 'OLGA@example.org', password: 'olga-secret-1' } });
      check('вход по почте и паролю (регистр почты не важен)', r.status === 200 && r.data.user.name === 'Ольга', r.data);
      check('неверный пароль не подходит', (await call('/login', { body: { email: 'olga@example.org', password: 'wrong-pass' } })).status === 400);
      check('несуществующая почта — тот же ответ', (await call('/login', { body: { email: 'nobody@example.org', password: 'wrong-pass' } })).data.message === 'Почта или пароль не подошли.');
      check('почту нельзя занять второй раз', (await call('/users', { token: owner, body: { name: 'Двойник', email: 'olga@example.org' } })).status === 400);

      // временный пароль: администратор выдаёт, взрослый меняет при первом входе
      r = await call(`/users/${olgaId}/password`, { token: owner, body: { mode: 'temp' } });
      check('временный пароль выдан', /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(r.data.tempPassword || ''), r.data);
      r = await call('/login', { body: { email: 'olga@example.org', password: r.data.tempPassword } });
      check('вход по временному паролю — просит сменить', r.status === 200 && r.data.user.mustChange === true, r.data);
      const olga = r.data.token;
      r = await call('/me/password', { token: olga, body: { password: 'olga-new-pass' } });
      check('смена временного пароля без старого', r.status === 200 && (await call('/me', { token: olga })).data.user.mustChange === false, r.data);
      check('дальше смена — только со старым паролем', (await call('/me/password', { token: olga, body: { current: 'не тот', password: 'olga-pass-3' } })).status === 400);
      check('…и со старым — можно', (await call('/me/password', { token: olga, body: { current: 'olga-new-pass', password: 'olga-pass-3' } })).status === 200);

      // «Забыли пароль?»
      const before = s3.mails().length;
      r = await call('/password/forgot', { body: { email: 'unknown@example.org' } });
      check('чужая почта — обычный ответ, письма нет', r.status === 200 && s3.mails().length === before, r.data);
      r = await call('/password/forgot', { body: { email: 'olga@example.org' } });
      mail = s3.mails().at(-1);
      check('восстановление — письмо со ссылкой на 1 час', r.status === 200 && mail.to === 'olga@example.org' && /1 час/.test(mail.text), mail);
      r = await call('/password/reset', { body: { token: linkOf(mail), password: 'olga-restored' } });
      check('новый пароль по ссылке работает', r.status === 200 && (await call('/login', { body: { email: 'olga@example.org', password: 'olga-restored' } })).status === 200);
      const sent = () => s3.mails().filter(m => m.to === 'olga@example.org' && /1 час/.test(m.text)).length;
      const was = sent();
      for (let i = 0; i < 4; i++) await call('/password/forgot', { body: { email: 'olga@example.org' } });
      check('не больше 3 писем восстановления в час', sent() - was === 3, sent() - was);

      // своя почта и пароль (владелец, созданный без них)
      r = await call('/me/email', { token: owner, body: { email: 'owner@example.org' } });
      check('владелец добавил себе почту', r.data.user?.email === 'owner@example.org', r.data);
      r = await call('/me/password', { token: owner, body: { password: 'owner-pass-1' } });
      check('…и пароль', r.status === 200 && (await call('/login', { body: { email: 'owner@example.org', password: 'owner-pass-1' } })).status === 200);
      check('теперь сменить почту — только с паролем', (await call('/me/email', { token: owner, body: { email: 'x@example.org' } })).status === 400);

      // ученики: логин, почта родителя, согласие, вход по логину
      check('кривой логин не принимается', (await call('/students', { token: owner, body: { name: 'Петя', login: 'Петя!' } })).status === 400);
      const kidsBefore = (await call("/students", { token: owner })).data.students.length;
      r = await call('/students', { token: owner, body: { name: 'Петя', login: 'petya', access: 'invite' } });
      check('приглашение без почты — ошибка, и ученик не создаётся', r.status === 400 && r.data.error === 'email' && (await call('/students', { token: owner })).data.students.length === kidsBefore, r.data);
      r = await call('/students', { token: owner, body: { name: 'Маша', login: 'Masha.K', email: 'parent@example.org', access: 'invite' } });
      check('ученик с логином и приглашением родителю', r.status === 200 && r.data.student.login === 'masha.k' && r.data.mailed === 'parent@example.org', r.data);
      const masha = r.data.student.id;
      mail = s3.mails().at(-1);
      check('родителю — логин ребёнка и ссылка', mail.to === 'parent@example.org' && /Логин: masha\.k/.test(mail.text), mail);
      const kidLink = linkOf(mail);
      r = await call(`/password/reset/${kidLink}`);
      check('ссылка ученика просит согласие родителя', r.data.kind === 'student' && r.data.needsConsent === true && r.data.login === 'masha.k', r.data);
      check('без согласия пароль не задать', (await call('/password/reset', { body: { token: kidLink, password: 'kitty7' } })).status === 400);
      r = await call('/password/reset', { body: { token: kidLink, password: 'kitty7', consent: true } });
      check('с согласием — пароль ученика задан', r.status === 200 && r.data.login === 'masha.k', r.data);
      check('согласие записано', (await call('/students', { token: owner })).data.students.find(x => x.id === masha).consentAt > 0);
      check('логин не повторяется', (await call('/students', { token: owner, body: { name: 'Маша 2', login: 'masha.k' } })).status === 400);
      r = await call('/student/login', { body: { login: 'MASHA.K', password: 'kitty7', label: 'Школьный компьютер' } });
      check('ученик входит по логину — получает устройство', r.status === 200 && r.data.student.name === 'Маша' && !('email' in r.data.student), r.data);
      check('…и может сохранять прогресс', (await call('/progress', { token: r.data.token, body: { base: 0, state: { xp: 5 } } })).status === 200);
      check('неверный пароль ученика', (await call('/student/login', { body: { login: 'masha.k', password: 'nope' } })).status === 400);
      r = await call(`/students/${masha}/password`, { token: owner, body: { mode: 'temp' } });
      check('временный пароль ученику', (await call('/student/login', { body: { login: 'masha.k', password: r.data.tempPassword } })).status === 200);
      // брат с той же почтой родителя — одно письмо на двоих
      await call('/students', { token: owner, body: { name: 'Петя', login: 'petya', email: 'parent@example.org', access: 'temp' } });
      const n0 = s3.mails().length;
      await call('/password/forgot', { body: { email: 'parent@example.org' } });
      mail = s3.mails().at(-1);
      check('братья и сёстры — одно письмо с двумя ссылками', s3.mails().length === n0 + 1 && (mail.text.match(/#reset=/g) || []).length === 2 && /petya/.test(mail.text), mail);
      check('ученику без логина нельзя выдать пароль', (await call(`/students/${(await call('/students', { token: owner, body: { name: 'Без логина' } })).data.student.id}/password`, { token: owner, body: { mode: 'temp' } })).status === 400);
    } finally { await s3.stop(); }
  }

  // обновление базы со старой версии сервера (как на хостинге): данные сохраняются, пароли добавляются
  {
    const old = mkdtempSync(join(tmpdir(), 'eq-old-'));
    try {
      execFileSync('sh', ['-c', `git -C '${ROOT}' archive 1e3a7f6 server | tar -x -C '${old}'`]);
      const file = join(old, 'eq.sqlite');
      const v1 = await startApi({ serverDir: join(old, 'server'), sqlite: file, mysqlCharset: 'utf8mb4' });   // старая версия сама utf8mb4 не включала
      const oldOwner = (await call('/login', { body: { code: v1.ownerCode } })).data.token;
      await call('/students', { token: oldOwner, body: { name: 'Старый ученик' } });
      await v1.stop();
      const v2 = await startApi({ init: false, sqlite: file, freshDb: false });
      try {
        let r = await call('/students', { token: oldOwner });
        check('после обновления базы: вход и ученики на месте', r.status === 200 && r.data.students[0]?.name === 'Старый ученик', r.data);
        r = await call('/me/password', { token: oldOwner, body: { password: 'после-обновления' } });
        check('…и можно задать пароль', r.status === 200, r.data);
      } finally { await v2.stop(); }
    } finally { rmSync(old, { recursive: true, force: true }); }
  }
  // ключ семьи: прогресс детей без логинов (server/src/family.php)
  {
    const s4 = await startApi();
    try {
      const KEY_RE = /^[А-Я]+(-[А-Я]+){3}-\d\d$/;
      check('семья: без согласия родителя — нельзя', (await call('/family', { body: { label: 'iPad' } })).status === 400);
      let r = await call('/family', { body: { consent: true, label: 'iPad' } });
      check('семья: ключ из 4 слов и 2 цифр, номера для QR, вход устройства', r.status === 200 && KEY_RE.test(r.data.key || '') && /^\d+(\.\d+){3}\.\d\d$/.test(r.data.keyCode || '') && r.data.token?.length === 64, r.data);
      const key = r.data.key, keyCode = r.data.keyCode, famA = r.data.token;
      r = await call('/family', { token: famA });
      check('семья: детей нет, одно устройство — это', r.data.children.length === 0 && r.data.devices.length === 1 && r.data.devices[0].current && r.data.email === null, r.data);
      r = await call('/family/children', { token: famA, body: { avatar: '🐼', name: 'Маша' } });
      check('ребёнок: на сервере прозвище по аватару, не имя', r.status === 200 && /^Панда-\d\d$/.test(r.data.student.name) && r.data.token?.length === 64, r.data);
      const kid = r.data.student.id, kidA = r.data.token;
      r = await call('/progress', { token: kidA, body: { base: 0, state: { xp: 7 } } });
      check('ребёнок синхронизирует прогресс', r.status === 200 && r.data.version === 1, r.data);
      check('ключ семьи не открывает список учеников', (await call('/students', { token: famA })).status === 401);
      check('ключ ребёнка не открывает семью', (await call('/family', { token: kidA })).status === 401);
      // другое устройство: ключ строчными, с «ё», пробелами вместо дефисов
      const loose = key.toLowerCase().replace(/-/g, '  ').replace(/е/, 'ё');
      r = await call('/family/login', { body: { key: loose, label: 'Телефон' } });
      check('вход по ключу: регистр, «ё» и пробелы не важны', r.status === 200 && r.data.family.children[0]?.xp === 7 && r.data.family.devices.length === 2, r.data);
      const famB = r.data.token;
      r = await call(`/family/children/${kid}/link`, { token: famB, body: {} });
      check('ребёнок на втором устройстве: тот же прогресс', r.status === 200 && (await call('/progress', { token: r.data.token })).data.state?.xp === 7, r.data);
      const kidB = r.data.token;
      r = await call('/family/login', { body: { key: keyCode, label: 'QR' } });
      check('вход по номерам из QR-кода', r.status === 200, r.data);
      const famC = r.data.token;
      check('неверный ключ — 400', (await call('/family/login', { body: { key: key.replace(/-\d\d$/, d => d === '-00' ? '-01' : '-00') } })).status === 400);
      check('чужие слова — 400', (await call('/family/login', { body: { key: 'абв-где-жзи-клм-12' } })).status === 400);
      // предел устройств
      await call('/family/login', { body: { key } }); await call('/family/login', { body: { key } });
      r = await call('/family/login', { body: { key } });
      check('шестое устройство — 409 «отключите одно»', r.status === 409 && r.data.error === 'devices_full', r.data);
      r = await call('/family', { token: famA });
      const devC = r.data.devices.find(d => d.label === 'QR');
      r = await call(`/family/devices/${devC.id}/delete`, { token: famA, body: {} });
      check('отключить устройство семьи', r.status === 200 && (await call('/family', { token: famC })).status === 401);
      check('чужое устройство не отключить', (await call('/family/devices/t0000000000000000/delete', { token: famA, body: {} })).status === 404);
      // выход на устройстве B: и семья, и ребёнок на нём отключены, на A всё работает
      await call('/logout', { token: famB, body: {} });
      check('выход семьи на устройстве — дети на нём тоже отключены', (await call('/progress', { token: kidB })).status === 401 && (await call('/progress', { token: kidA })).status === 200);
      // новый ключ
      r = await call('/family/key', { token: famA, body: {} });
      check('новый ключ: старый не действует, новый — да', KEY_RE.test(r.data.key || '') && (await call('/family/login', { body: { key } })).status === 400 && (await call('/family/login', { body: { key: r.data.key } })).status === 200, r.data);
      // почта и восстановление
      check('почта без согласия — нельзя', (await call('/family/email', { token: famA, body: { email: 'mama@example.org' } })).status === 400);
      r = await call('/family/email', { token: famA, body: { email: 'Mama@Example.org', consent: true } });
      check('почта для восстановления', r.data.email === 'mama@example.org', r.data);
      r = await call('/family/forgot', { body: { email: 'mama@example.org' } });
      const mail = s4.mails().at(-1), link = /#famkey=([0-9a-f]{64})/.exec(mail?.text || '')?.[1];
      check('«Забыли ключ?» — письмо со ссылкой в игру', r.status === 200 && mail?.to === 'mama@example.org' && /quest\.example\/#famkey=/.test(mail.text) && link, mail);
      const n0 = s4.mails().length;
      await call('/family/forgot', { body: { email: 'other@example.org' } });
      check('чужая почта — тот же ответ, письма нет', s4.mails().length === n0);
      check('ссылка семьи не задаёт пароль', (await call('/password/reset', { body: { token: link, password: 'xxxxxxxx' } })).status === 400);
      r = await call('/family/recover', { body: { token: link, label: 'Новый телефон' } });
      check('по ссылке — новый ключ и вход, даже если устройств 5', r.status === 200 && KEY_RE.test(r.data.key) && r.data.family.devices.length <= 5 && r.data.family.children.length === 1, r.data);
      const famR = r.data.token;
      check('ссылка одноразовая', (await call('/family/recover', { body: { token: link } })).status === 400);
      // учитель не видит детей семьи
      const owner = (await call('/login', { body: { code: s4.ownerCode } })).data.token;
      check('владелец школы не видит детей семьи', (await call('/students', { token: owner })).data.students.length === 0 && (await call(`/students/${kid}/progress`, { token: owner })).status === 404);
      r = await call('/stats/families', { token: owner });
      check('владельцу — только общие числа по семьям', r.status === 200 && r.data.families === 1 && r.data.children === 1 && r.data.withEmail === 1 && r.data.active7 === 1 && r.data.new30 === 1 && r.data.weeks[0] === 1 && !JSON.stringify(r.data).includes('mama@') && !JSON.stringify(r.data).includes(kid), r.data);
      const admin2 = (await call('/users', { token: owner, body: { name: 'Админ', role: 'admin' } })).data;
      const adminTok = (await call('/login', { body: { code: admin2.login.code } })).data.token;
      check('…администратору и семье — нельзя', (await call('/stats/families', { token: adminTok })).status === 403 && (await call('/stats/families', { token: famR })).status === 401);
      // удалить ребёнка и всё
      r = await call('/family/children', { token: famR, body: { avatar: '🦊' } });
      await call(`/family/children/${r.data.student.id}/delete`, { token: famR, body: {} });
      check('удалить ребёнка', (await call('/progress', { token: r.data.token })).status === 401 && (await call('/family', { token: famR })).data.children.length === 1);
      r = await call('/family/delete', { token: famR, body: {} });
      check('«Удалить всё»: семья, дети и устройства', r.status === 200 && (await call('/family', { token: famR })).status === 401 && (await call('/family', { token: famA })).status === 401 && (await call('/progress', { token: kidA })).status === 401);
      // неактивные семьи: через год — удаление; с почтой — сначала письмо, удаление не раньше чем через 30 дней
      const withMail = await call('/family', { body: { consent: true } });
      await call('/family/email', { token: withMail.data.token, body: { email: 'papa@example.org', consent: true } });
      const noMail = await call('/family', { body: { consent: true } });
      const cleanup = days => execFileSync('php', [join(ROOT, 'server/bin/setup.php'), 'cleanup', String(days)], { env: s4.env, encoding: 'utf8' });
      const alive = k => call('/family/login', { body: { key: k } }).then(x => x.status === 200);
      const m0 = s4.mails().length;
      check('через 300 дней — никого', /предупреждено 0, удалено 0/.test(cleanup(300)));
      check('через 340 дней — письмо семье с почтой', /предупреждено 1, удалено 0/.test(cleanup(340)) && s4.mails().length === m0 + 1 && s4.mails().at(-1).to === 'papa@example.org');
      check('через 366 дней — семья без почты удалена, с почтой ждёт 30 дней', /удалено 1/.test(cleanup(366)) && !(await alive(noMail.data.key)) && await alive(withMail.data.key));
    } finally { await s4.stop(); }
  }
  // sw.js на сайте с API по тому же адресу (quest.logiqa.ru/api): запросы к API идут мимо sw.js —
  // иначе он перезапрашивает их без заголовка входа X-EQ-Token и админ-панель «просит войти заново»
  {
    const { default: vm } = await import('node:vm');
    const handlers = {};
    const self = { location: new URL('https://quest.logiqa.ru/sw.js'), addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting(){}, clients: { claim(){} } };
    vm.runInNewContext(readFileSync(join(ROOT, 'sw.js'), 'utf8'), { self, caches: {}, fetch(){}, URL, Response: class {}, console });
    const handled = (url, method = 'GET', mode = 'cors') => { let r = false; handlers.fetch({ request: { url, method, mode, headers: new Map() }, respondWith(){ r = true; } }); return r; };
    check('sw.js: GET /api/… с того же адреса — мимо sw.js', !handled('https://quest.logiqa.ru/api/me') && !handled('https://quest.logiqa.ru/api/students/s1/progress'));
    check('sw.js: файлы сайта и переходы — через sw.js', handled('https://quest.logiqa.ru/js/admin.js') && handled('https://quest.logiqa.ru/admin/', 'GET', 'navigate'));
    check('sw.js: адрес, похожий на api, — через sw.js', handled('https://quest.logiqa.ru/apiary.html'));
  }
  console.log(`\n${total - fail} из ${total} проверок сервера прошли (база: ${process.env.EQ_TEST_MYSQL ? 'MySQL' : 'SQLite'})`);
  process.exit(fail ? 1 : 0);
}
