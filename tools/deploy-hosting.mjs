#!/usr/bin/env node
// Выкладка на хостинг по SFTP: загружаются только изменённые файлы.
//
// На сервере рядом с сайтом хранится манифест (путь → sha256) прошлой выкладки. Сравниваем с текущими
// файлами, загружаем новые и изменённые, удаляем то, что убрали из проекта. Чужие файлы (config.php,
// заглушки хостинга) не трогаются: удаляется только то, что раньше выложили мы сами.
// Порядок: сервер → файлы сайта → страницы .html (последними, чтобы не ссылались на ещё не загруженное) → удаление → манифест.
//
//   node tools/deploy-hosting.mjs [--dry-run]
// Переменные окружения:
//   DEPLOY_URL     sftp://пользователь@хост[:порт]  (или file:///папка — для проверки без хостинга)
//   SITE_PATH      папка сайта, например domains/logiqa.ru/public_html/quest
//   SERVER_PATH    папка кода сервера вне сайта, например domains/logiqa.ru/eq-server
//   STATE_PATH     служебная папка выкладки вне сайта, например domains/logiqa.ru/eq-deploy
//   LFTP_PASSWORD  пароль SFTP (если вход по паролю), SSH_COMMAND — команда ssh с ключом (если по ключу)
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const DRY = process.argv.includes('--dry-run');
const env = name => { const v = (process.env[name] || '').trim().replace(/\/+$/, ''); if (!v) { console.error(`Не задано ${name}`); process.exit(2); } return v; };
const URL_ = env('DEPLOY_URL'), SITE = env('SITE_PATH'), SERVER = env('SERVER_PATH'), STATE = env('STATE_PATH');

// ---------- что выкладываем: локальный путь → путь на сервере ----------
const SKIP_SITE = /^(tests|tools|server|\.github|\.claude)\/|^(README\.md|DESIGN\.md|phrases\.json|\.gitignore|CNAME)$/;
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const files = new Map();
for (const f of tracked){
  if (f.startsWith('server/src/') || f.startsWith('server/bin/')) files.set(`${SERVER}/${f.slice('server/'.length)}`, f);
  else if (!SKIP_SITE.test(f)) files.set(`${SITE}/${f}`, f);
}
files.set(`${SERVER}/.htaccess`, 'server/.htaccess');               // закрывает код сервера от браузера
files.set(`${SITE}/api/index.php`, 'server/public/index.php');
files.set(`${SITE}/api/.htaccess`, 'server/public/.htaccess');

const sha = f => createHash('sha256').update(readFileSync(join(ROOT, f))).digest('hex');
const manifest = Object.fromEntries([...files].map(([remote, local]) => [remote, sha(local)]));

// ---------- lftp ----------
const q = s => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;
const pass = process.env.LFTP_PASSWORD;
const head = [
  'set cmd:fail-exit yes',
  'set net:max-retries 3',
  'set net:reconnect-interval-base 5',
  'set net:timeout 30',
  'set xfer:clobber yes',
  ...(process.env.SSH_COMMAND ? [`set sftp:connect-program ${q(process.env.SSH_COMMAND)}`] : []),
  `open ${pass ? '--env-password ' : ''}${q(URL_)}`,
];
function lftp(lines){
  const dir = mkdtempSync(join(tmpdir(), 'eq-deploy-'));
  const script = join(dir, 'script.lftp');
  writeFileSync(script, [...head, ...lines].join('\n') + '\n');
  const r = spawnSync('lftp', ['-f', script], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: process.env });
  rmSync(dir, { recursive: true, force: true });
  return r;
}

// прошлый манифест (при первой выкладке его нет — тогда ничего не удаляем)
const tmp = mkdtempSync(join(tmpdir(), 'eq-manifest-'));
const got = lftp([`set cmd:fail-exit no`, `get ${q(STATE + '/manifest.json')} -o ${q(join(tmp, 'old.json'))}`]);
let old = {};
try { if (existsSync(join(tmp, 'old.json'))) old = JSON.parse(readFileSync(join(tmp, 'old.json'), 'utf8')); } catch (e) { console.error('Манифест на сервере повреждён — выкладываю всё заново, без удаления.'); old = {}; }
if (got.status !== 0 && !existsSync(join(tmp, 'old.json')) && /Login failed|Access failed: .*(denied|auth)|Permission denied|Host key verification failed|Fatal error/i.test(got.stderr)){
  console.error('Не удалось подключиться к хостингу:\n' + got.stderr.trim());
  process.exit(1);
}

const changed = Object.keys(manifest).filter(p => old[p] !== manifest[p]);
const removed = Object.keys(old).filter(p => !(p in manifest));
const order = p => p.startsWith(SERVER + '/') || p.startsWith(SITE + '/api/') ? 0 : /\.html$/.test(p) ? 2 : 1;
changed.sort((a, b) => order(a) - order(b) || a.localeCompare(b));

console.log(`Файлов в выкладке: ${Object.keys(manifest).length}; изменено: ${changed.length}; удалить: ${removed.length}${Object.keys(old).length ? '' : ' (первая выкладка — старые файлы не удаляются)'}`);
for (const p of changed) console.log(`  + ${p}`);
for (const p of removed) console.log(`  - ${p}`);
if (DRY){ console.log('Пробный запуск — на сервере ничего не менялось.'); process.exit(0); }
if (!changed.length && !removed.length && JSON.stringify(old) === JSON.stringify(manifest)){ console.log('Всё уже выложено.'); process.exit(0); }

writeFileSync(join(tmp, 'new.json'), JSON.stringify(manifest, null, 1));
const dirs = [...new Set([STATE, ...changed.map(p => dirname(p))])];
const r = lftp([
  ...dirs.map(d => `mkdir -p -f ${q(d)}`),
  ...changed.map(p => `put ${q(files.get(p))} -o ${q(p)}`),
  ...(removed.length ? ['set cmd:fail-exit no', ...removed.map(p => `rm -f ${q(p)}`), 'set cmd:fail-exit yes'] : []),
  `put ${q(join(tmp, 'new.json'))} -o ${q(STATE + '/manifest.json')}`,
]);
rmSync(tmp, { recursive: true, force: true });
if (r.status !== 0){ console.error('Выкладка прервалась:\n' + (r.stderr || r.stdout).trim()); process.exit(1); }
console.log('Готово.');
