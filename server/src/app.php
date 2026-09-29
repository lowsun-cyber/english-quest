<?php
// English Quest — сервер: вход по коду, ученики, подключение устройств, хранение прогресса.
// Обычный PHP 8.1+ и PDO без фреймворков: работает на виртуальном хостинге и так же — на VDS.
// База: MySQL/MariaDB (хостинг), PostgreSQL или SQLite (тесты) — SQL написан переносимо.
declare(strict_types=1);

namespace EQ;

use PDO;
use Throwable;

const SCHEMA_VERSION = 1;
const MAX_STATE_BYTES = 512 * 1024;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без 0/O и 1/I — легко продиктовать
const CODE_TTL = 7 * 86400 * 1000;                          // код подключения живёт неделю
const FAIL_WINDOW = 15 * 60 * 1000;                          // окно для подсчёта неверных кодов
const FAIL_LIMIT = 20;                                       // столько неверных кодов с одного адреса за окно
const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐯', '🐨', '🐵', '🦄', '🐙', '🐧', '🐢', '🐝'];

final class HttpError extends \Exception {
  public function __construct(public int $status, public string $key, string $message, public array $extra = []){ parent::__construct($message); }
}

// ---------- настройки и база ----------
function config(): array {
  static $cfg = null;
  if ($cfg === null){
    $file = getenv('EQ_CONFIG') ?: dirname(__DIR__) . '/config.php';
    if (!is_file($file)) throw new HttpError(500, 'no_config', 'Сервер не настроен: нет config.php');
    $cfg = require $file;
    date_default_timezone_set($cfg['timezone'] ?? 'Europe/Moscow');
  }
  return $cfg;
}

function db(): PDO {
  static $pdo = null;
  if ($pdo === null){
    $c = config()['db'];
    $pdo = new PDO($c['dsn'], $c['user'] ?? null, $c['password'] ?? null, [
      PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
      PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    if (driver($pdo) === 'sqlite') $pdo->exec('PRAGMA foreign_keys = ON');
  }
  return $pdo;
}
function driver(?PDO $pdo = null): string { return ($pdo ?? db())->getAttribute(PDO::ATTR_DRIVER_NAME); }

function q(string $sql, array $args = []): \PDOStatement {
  $st = db()->prepare($sql);
  $st->execute($args);
  return $st;
}
function one(string $sql, array $args = []): ?array { $r = q($sql, $args)->fetch(); return $r === false ? null : $r; }
function all(string $sql, array $args = []): array { return q($sql, $args)->fetchAll(); }

// Таблицы создаются один раз; номер схемы — в meta, чтобы потом добавлять изменения по порядку.
function migrate(PDO $pdo): void {
  $drv = driver($pdo);
  $big = $drv === 'mysql' ? 'MEDIUMTEXT' : 'TEXT';
  $tail = $drv === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
  $pdo->exec("CREATE TABLE IF NOT EXISTS meta (k VARCHAR(32) PRIMARY KEY, v VARCHAR(255) NOT NULL)$tail");
  $cur = (int)($pdo->query("SELECT v FROM meta WHERE k = 'schema'")->fetchColumn() ?: 0);
  if ($cur >= SCHEMA_VERSION) return;
  $tables = [
    // организация: сейчас одна (ваши ученики), потом — школа, языковой центр, заказчик
    "CREATE TABLE orgs (id VARCHAR(24) PRIMARY KEY, name VARCHAR(100) NOT NULL, created BIGINT NOT NULL)",
    // взрослые: owner — владелец платформы, admin — администратор организации, teacher — учитель
    "CREATE TABLE users (id VARCHAR(24) PRIMARY KEY, org_id VARCHAR(24) NOT NULL, role VARCHAR(16) NOT NULL, name VARCHAR(60) NOT NULL, created BIGINT NOT NULL)",
    // ученик: только имя или прозвище и аватар — никаких фамилий и дат рождения
    "CREATE TABLE students (id VARCHAR(24) PRIMARY KEY, org_id VARCHAR(24) NOT NULL, teacher_id VARCHAR(24), name VARCHAR(40) NOT NULL, avatar VARCHAR(16) NOT NULL, created BIGINT NOT NULL)",
    // прогресс целиком (как в приложении) и номер версии для объединения с разных устройств
    "CREATE TABLE progress (student_id VARCHAR(24) PRIMARY KEY, state $big NOT NULL, version INTEGER NOT NULL, updated BIGINT NOT NULL, device_id VARCHAR(24))",
    // постоянные ключи: kind = user (взрослый) или device (устройство ученика); в базе только хэш
    "CREATE TABLE tokens (id VARCHAR(24) PRIMARY KEY, hash CHAR(64) NOT NULL UNIQUE, kind VARCHAR(8) NOT NULL, subject VARCHAR(24) NOT NULL, label VARCHAR(60), created BIGINT NOT NULL, last_used BIGINT)",
    // одноразовые коды: login — вход взрослого, device — подключение устройства к ученику
    "CREATE TABLE codes (hash CHAR(64) PRIMARY KEY, kind VARCHAR(8) NOT NULL, subject VARCHAR(24) NOT NULL, expires BIGINT NOT NULL, created BIGINT NOT NULL)",
    // неверные коды — чтобы коды нельзя было подбирать
    "CREATE TABLE fails (ip CHAR(64) NOT NULL, at BIGINT NOT NULL)",
  ];
  // без общей транзакции: в MySQL CREATE TABLE всё равно завершает её сам. Поэтому каждый шаг
  // можно безопасно повторить, если установка прервалась на середине.
  foreach ($tables as $sql) $pdo->exec(str_replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ', $sql) . $tail);
  foreach ([
    'CREATE INDEX students_org ON students (org_id)',
    'CREATE INDEX tokens_subject ON tokens (subject)',
    'CREATE INDEX codes_subject ON codes (subject)',
    'CREATE INDEX fails_ip ON fails (ip)',
  ] as $sql){
    try { $pdo->exec($sql); } catch (\PDOException $e){ /* индекс уже есть */ }
  }
  $pdo->prepare("DELETE FROM meta WHERE k = 'schema'")->execute();
  $pdo->prepare("INSERT INTO meta (k, v) VALUES ('schema', ?)")->execute([(string)SCHEMA_VERSION]);
}

// ---------- мелочи ----------
function now(): int { return (int)floor(microtime(true) * 1000); }
function new_id(string $prefix): string { return $prefix . bin2hex(random_bytes(8)); }
function sha(string $s): string { return hash('sha256', $s); }
function new_token(): string { return bin2hex(random_bytes(32)); }
function new_code(): string {
  $s = '';
  for ($i = 0; $i < 8; $i++) $s .= CODE_ALPHABET[random_int(0, strlen(CODE_ALPHABET) - 1)];
  return substr($s, 0, 4) . '-' . substr($s, 4);
}
function norm_code(string $s): string { return strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $s)); }
function clean_name(mixed $s, int $max): string {
  $s = trim(preg_replace('/\s+/u', ' ', (string)$s));
  return mb_substr($s, 0, $max);
}
function client_ip(): string { return sha(($_SERVER['REMOTE_ADDR'] ?? '') . '|' . (config()['secret'] ?? '')); }

function issue_code(string $kind, string $subject): array {
  $code = new_code();
  $expires = now() + CODE_TTL;
  q('INSERT INTO codes (hash, kind, subject, expires, created) VALUES (?, ?, ?, ?, ?)', [sha(norm_code($code)), $kind, $subject, $expires, now()]);
  return ['code' => $code, 'expires' => $expires];
}

// Обменивает одноразовый код на постоянный ключ. Неверные попытки считаются по адресу.
function redeem_code(string $kind, mixed $raw): array {
  $ip = client_ip();
  q('DELETE FROM fails WHERE at < ?', [now() - FAIL_WINDOW]);
  $n = (int)one('SELECT COUNT(*) AS n FROM fails WHERE ip = ?', [$ip])['n'];
  if ($n >= FAIL_LIMIT) throw new HttpError(429, 'too_many', 'Слишком много неверных кодов. Попробуйте через 15 минут.');
  $code = norm_code((string)$raw);
  $row = strlen($code) === 8 ? one('SELECT * FROM codes WHERE hash = ? AND kind = ?', [sha($code), $kind]) : null;
  if (!$row || $row['expires'] < now()){
    q('INSERT INTO fails (ip, at) VALUES (?, ?)', [$ip, now()]);
    throw new HttpError(400, 'bad_code', $row ? 'Срок действия кода истёк — попросите новый.' : 'Код не подошёл. Проверьте буквы и цифры.');
  }
  q('DELETE FROM codes WHERE hash = ?', [$row['hash']]);
  return $row;
}

function issue_token(string $kind, string $subject, string $label = ''): array {
  $token = new_token();
  $id = new_id('t');
  q('INSERT INTO tokens (id, hash, kind, subject, label, created, last_used) VALUES (?, ?, ?, ?, ?, ?, ?)', [$id, sha($token), $kind, $subject, mb_substr($label, 0, 60), now(), now()]);
  return ['id' => $id, 'token' => $token];
}

// ---------- кто спрашивает ----------
function auth(): ?array {
  static $who = false;
  if ($who !== false) return $who;
  $raw = $_SERVER['HTTP_X_EQ_TOKEN'] ?? '';
  $who = null;
  if (!preg_match('/^[0-9a-f]{64}$/', $raw)) return null;
  $t = one('SELECT * FROM tokens WHERE hash = ?', [sha($raw)]);
  if (!$t) return null;
  if (now() - (int)$t['last_used'] > 3600 * 1000) q('UPDATE tokens SET last_used = ? WHERE id = ?', [now(), $t['id']]);
  if ($t['kind'] === 'user'){
    $u = one('SELECT * FROM users WHERE id = ?', [$t['subject']]);
    if ($u) $who = ['kind' => 'user', 'token' => $t, 'user' => $u];
  } elseif ($t['kind'] === 'device'){
    $s = one('SELECT * FROM students WHERE id = ?', [$t['subject']]);
    if ($s) $who = ['kind' => 'device', 'token' => $t, 'student' => $s];
  }
  return $who;
}
function need_user(): array {
  $w = auth();
  if (!$w || $w['kind'] !== 'user') throw new HttpError(401, 'login', 'Нужно войти заново.');
  return $w['user'];
}
function need_device(): array {
  $w = auth();
  if (!$w || $w['kind'] !== 'device') throw new HttpError(401, 'unlinked', 'Устройство отключено от ученика.');
  return $w;
}
function need_owner(): array {
  $u = need_user();
  if (!in_array($u['role'], ['owner', 'admin'], true)) throw new HttpError(403, 'forbidden', 'Это может сделать только администратор.');
  return $u;
}
// Учитель видит только своих учеников; владелец и администратор — всех в организации.
function student_for(array $u, string $id): array {
  $s = one('SELECT * FROM students WHERE id = ? AND org_id = ?', [$id, $u['org_id']]);
  if (!$s || ($u['role'] === 'teacher' && $s['teacher_id'] !== $u['id'])) throw new HttpError(404, 'not_found', 'Ученик не найден.');
  return $s;
}

// ---------- сводка для списка учеников ----------
function day_key(int $offset = 0): string { return date('Y-m-d', strtotime("$offset day")); }
function summary(?array $st): array {
  $act = is_array($st['activity'] ?? null) ? $st['activity'] : [];
  $week = ['sec' => 0, 'ok' => 0, 'bad' => 0, 'days' => 0];
  for ($i = 0; $i < 7; $i++){
    $d = $act[day_key(-$i)] ?? null;
    if (!is_array($d)) continue;
    foreach (['sec', 'ok', 'bad'] as $k) $week[$k] += (int)($d[$k] ?? 0);
    if (($d['sec'] ?? 0) > 0 || ($d['ok'] ?? 0) + ($d['bad'] ?? 0) > 0) $week['days']++;
  }
  $days = array_keys($act);
  sort($days);
  return ['xp' => (int)($st['xp'] ?? 0), 'week' => $week, 'lastDay' => $days ? end($days) : null,
    'homework' => is_array($st['homework'] ?? null) ? ['lessonId' => $st['homework']['lessonId'] ?? null, 'doneAt' => $st['homework']['doneAt'] ?? null] : null];
}
function student_out(array $s, bool $withSummary = true): array {
  $out = ['id' => $s['id'], 'name' => $s['name'], 'avatar' => $s['avatar'], 'teacherId' => $s['teacher_id'], 'created' => (int)$s['created']];
  if ($withSummary){
    $p = one('SELECT state, version, updated FROM progress WHERE student_id = ?', [$s['id']]);
    $out['version'] = $p ? (int)$p['version'] : 0;
    $out['updated'] = $p ? (int)$p['updated'] : null;
    $out['summary'] = summary($p ? json_decode($p['state'], true) : null);
    $out['devices'] = (int)one("SELECT COUNT(*) AS n FROM tokens WHERE kind = 'device' AND subject = ?", [$s['id']])['n'];
  }
  return $out;
}
function user_out(array $u): array { return ['id' => $u['id'], 'name' => $u['name'], 'role' => $u['role'], 'orgId' => $u['org_id']]; }

// ---------- ввод и вывод ----------
function raw_body(): string {
  static $raw = null;
  return $raw ??= (file_get_contents('php://input') ?: '');
}
// Прогресс храним и отдаём объектами, а не массивами PHP: иначе пустые {} превратятся в [].
function state_out(?string $json): ?object { return $json === null ? null : json_decode($json); }
function body(): array {
  static $b = null;
  if ($b === null){
    $raw = raw_body();
    if (strlen($raw) > MAX_STATE_BYTES + 4096) throw new HttpError(413, 'too_big', 'Слишком большой запрос.');
    $b = $raw === '' ? [] : json_decode($raw, true);
    if (!is_array($b)) throw new HttpError(400, 'bad_json', 'Запрос не в формате JSON.');
  }
  return $b;
}
function send(int $status, array $data): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  header('Cache-Control: no-store');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
function cors(): void {
  $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
  if ($origin && in_array($origin, config()['origins'] ?? [], true)){
    header("Access-Control-Allow-Origin: $origin");
    header('Vary: Origin');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-EQ-Token');
    header('Access-Control-Max-Age: 86400');
  }
}

// ---------- маршруты ----------
// Только GET и POST: на виртуальных хостингах PUT/DELETE иногда режутся защитой.
function routes(): array {
  return [
    ['GET', '#^/$#', fn() => ['app' => 'english-quest', 'ok' => true]],

    // вход взрослого по одноразовому коду (коды выдаёт администратор)
    ['POST', '#^/login$#', function(){
      $c = redeem_code('login', body()['code'] ?? '');
      $u = one('SELECT * FROM users WHERE id = ?', [$c['subject']]);
      if (!$u) throw new HttpError(400, 'bad_code', 'Код не подошёл.');
      $t = issue_token('user', $u['id'], clean_name(body()['label'] ?? '', 60));
      return ['token' => $t['token'], 'user' => user_out($u)];
    }],
    ['POST', '#^/logout$#', function(){
      $w = auth();
      if ($w) q('DELETE FROM tokens WHERE id = ?', [$w['token']['id']]);
      return ['ok' => true];
    }],
    ['GET', '#^/me$#', function(){
      $u = need_user();
      $o = one('SELECT * FROM orgs WHERE id = ?', [$u['org_id']]);
      return ['user' => user_out($u), 'org' => ['id' => $o['id'], 'name' => $o['name']]];
    }],

    // ученики
    ['GET', '#^/students$#', function(){
      $u = need_user();
      $rows = $u['role'] === 'teacher'
        ? all('SELECT * FROM students WHERE org_id = ? AND teacher_id = ? ORDER BY name', [$u['org_id'], $u['id']])
        : all('SELECT * FROM students WHERE org_id = ? ORDER BY name', [$u['org_id']]);
      return ['students' => array_map('EQ\student_out', $rows)];
    }],
    ['POST', '#^/students$#', function(){
      $u = need_user();
      $name = clean_name(body()['name'] ?? '', 20);
      if ($name === '') throw new HttpError(400, 'name', 'Введите имя ученика.');
      $avatar = in_array(body()['avatar'] ?? '', AVATARS, true) ? body()['avatar'] : AVATARS[0];
      $teacher = $u['role'] === 'teacher' ? $u['id'] : (body()['teacherId'] ?? $u['id']);
      if (!one('SELECT id FROM users WHERE id = ? AND org_id = ?', [$teacher, $u['org_id']])) throw new HttpError(400, 'teacher', 'Учитель не найден.');
      $id = new_id('s');
      q('INSERT INTO students (id, org_id, teacher_id, name, avatar, created) VALUES (?, ?, ?, ?, ?, ?)', [$id, $u['org_id'], $teacher, $name, $avatar, now()]);
      return ['student' => student_out(one('SELECT * FROM students WHERE id = ?', [$id]))];
    }],
    ['POST', '#^/students/(s[0-9a-f]{16})$#', function($id){
      $u = need_user();
      $s = student_for($u, $id);
      $name = array_key_exists('name', body()) ? clean_name(body()['name'], 20) : $s['name'];
      if ($name === '') throw new HttpError(400, 'name', 'Введите имя ученика.');
      $avatar = in_array(body()['avatar'] ?? '', AVATARS, true) ? body()['avatar'] : $s['avatar'];
      q('UPDATE students SET name = ?, avatar = ? WHERE id = ?', [$name, $avatar, $id]);
      return ['student' => student_out(one('SELECT * FROM students WHERE id = ?', [$id]))];
    }],
    // удаление — полностью: прогресс, ключи устройств и неиспользованные коды
    ['POST', '#^/students/(s[0-9a-f]{16})/delete$#', function($id){
      $u = need_user();
      student_for($u, $id);
      db()->beginTransaction();
      q('DELETE FROM progress WHERE student_id = ?', [$id]);
      q("DELETE FROM tokens WHERE kind = 'device' AND subject = ?", [$id]);
      q("DELETE FROM codes WHERE kind = 'device' AND subject = ?", [$id]);
      q('DELETE FROM students WHERE id = ?', [$id]);
      db()->commit();
      return ['ok' => true];
    }],
    ['POST', '#^/students/(s[0-9a-f]{16})/code$#', function($id){
      $s = student_for(need_user(), $id);
      return issue_code('device', $s['id']);
    }],
    ['GET', '#^/students/(s[0-9a-f]{16})/progress$#', function($id){
      $s = student_for(need_user(), $id);
      $p = one('SELECT * FROM progress WHERE student_id = ?', [$id]);
      return ['student' => student_out($s, false), 'state' => $p ? state_out($p['state']) : null, 'version' => $p ? (int)$p['version'] : 0, 'updated' => $p ? (int)$p['updated'] : null];
    }],
    ['GET', '#^/students/(s[0-9a-f]{16})/devices$#', function($id){
      student_for(need_user(), $id);
      $rows = all("SELECT id, label, created, last_used FROM tokens WHERE kind = 'device' AND subject = ? ORDER BY created", [$id]);
      return ['devices' => array_map(fn($r) => ['id' => $r['id'], 'label' => $r['label'], 'created' => (int)$r['created'], 'lastUsed' => (int)$r['last_used']], $rows)];
    }],
    ['POST', '#^/devices/(t[0-9a-f]{16})/delete$#', function($id){
      $u = need_user();
      $t = one("SELECT * FROM tokens WHERE id = ? AND kind = 'device'", [$id]);
      if (!$t) throw new HttpError(404, 'not_found', 'Устройство не найдено.');
      student_for($u, $t['subject']);
      q('DELETE FROM tokens WHERE id = ?', [$id]);
      return ['ok' => true];
    }],

    // устройство ученика: подключение по коду и синхронизация
    ['POST', '#^/claim$#', function(){
      $c = redeem_code('device', body()['code'] ?? '');
      $s = one('SELECT * FROM students WHERE id = ?', [$c['subject']]);
      if (!$s) throw new HttpError(400, 'bad_code', 'Код не подошёл.');
      $t = issue_token('device', $s['id'], clean_name(body()['label'] ?? '', 60));
      return ['token' => $t['token'], 'deviceId' => $t['id'], 'student' => student_out($s, false)];
    }],
    ['GET', '#^/progress$#', function(){
      $w = need_device();
      $p = one('SELECT * FROM progress WHERE student_id = ?', [$w['student']['id']]);
      return ['student' => student_out($w['student'], false), 'state' => $p ? state_out($p['state']) : null, 'version' => $p ? (int)$p['version'] : 0, 'updated' => $p ? (int)$p['updated'] : null];
    }],
    // Запись с проверкой версии: base — версия, от которой устройство считало изменения.
    // Если кто-то успел записать раньше — 409 и свежий прогресс; устройство объединит и пришлёт снова.
    ['POST', '#^/progress$#', function(){
      $w = need_device();
      $sid = $w['student']['id'];
      $b = body();
      $base = (int)($b['base'] ?? -1);
      $o = json_decode(raw_body());
      $st = is_object($o) ? ($o->state ?? null) : null;
      if (!is_object($st)) throw new HttpError(400, 'bad_state', 'Прогресс в неверном формате.');
      $json = json_encode($st, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      if (strlen($json) > MAX_STATE_BYTES) throw new HttpError(413, 'too_big', 'Прогресс слишком большой.');
      $cur = one('SELECT version, state, updated FROM progress WHERE student_id = ?', [$sid]);
      $curVersion = $cur ? (int)$cur['version'] : 0;
      if ($base !== $curVersion){
        throw new HttpError(409, 'conflict', 'Прогресс изменился на другом устройстве.', ['version' => $curVersion, 'state' => $cur ? state_out($cur['state']) : null, 'updated' => $cur ? (int)$cur['updated'] : null]);
      }
      $next = $curVersion + 1;
      // условие на версию в самом UPDATE — два одновременных запроса не затрут друг друга
      $n = $cur
        ? q('UPDATE progress SET state = ?, version = ?, updated = ?, device_id = ? WHERE student_id = ? AND version = ?', [$json, $next, now(), $w['token']['id'], $sid, $curVersion])->rowCount()
        : (function() use ($sid, $json, $next, $w){ try { q('INSERT INTO progress (student_id, state, version, updated, device_id) VALUES (?, ?, ?, ?, ?)', [$sid, $json, $next, now(), $w['token']['id']]); return 1; } catch (\PDOException $e){ return 0; } })();
      if ($n !== 1){
        $cur = one('SELECT version, state, updated FROM progress WHERE student_id = ?', [$sid]);
        throw new HttpError(409, 'conflict', 'Прогресс изменился на другом устройстве.', ['version' => (int)$cur['version'], 'state' => state_out($cur['state']), 'updated' => (int)$cur['updated']]);
      }
      return ['version' => $next, 'updated' => now()];
    }],

    // взрослые (учителя) — создаёт владелец или администратор
    ['GET', '#^/users$#', function(){
      $u = need_owner();
      return ['users' => array_map('EQ\user_out', all('SELECT * FROM users WHERE org_id = ? ORDER BY created', [$u['org_id']]))];
    }],
    ['POST', '#^/users$#', function(){
      $u = need_owner();
      $name = clean_name(body()['name'] ?? '', 60);
      if ($name === '') throw new HttpError(400, 'name', 'Введите имя учителя.');
      $id = new_id('u');
      q('INSERT INTO users (id, org_id, role, name, created) VALUES (?, ?, ?, ?, ?)', [$id, $u['org_id'], 'teacher', $name, now()]);
      return ['user' => user_out(one('SELECT * FROM users WHERE id = ?', [$id])), 'login' => issue_code('login', $id)];
    }],
    ['POST', '#^/users/(u[0-9a-f]{16})/code$#', function($id){
      $u = need_owner();
      if (!one('SELECT id FROM users WHERE id = ? AND org_id = ?', [$id, $u['org_id']])) throw new HttpError(404, 'not_found', 'Учитель не найден.');
      return issue_code('login', $id);
    }],
  ];
}

function run(): void {
  try {
    cors();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'OPTIONS'){ http_response_code(204); return; }
    // путь после папки, где лежит index.php (сервер может жить и в корне поддомена, и в подпапке)
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $baseDir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    if ($baseDir !== '' && str_starts_with($path, $baseDir)) $path = substr($path, strlen($baseDir));
    $path = '/' . trim(preg_replace('#^/index\.php#', '', $path), '/');
    migrate(db());
    foreach (routes() as [$m, $re, $fn]){
      if (preg_match($re, $path, $mm)){
        if ($m !== $method) continue;
        send(200, $fn(...array_slice($mm, 1)));
        return;
      }
    }
    throw new HttpError(404, 'not_found', 'Нет такого адреса.');
  } catch (HttpError $e){
    send($e->status, ['error' => $e->key, 'message' => $e->getMessage()] + $e->extra);
  } catch (Throwable $e){
    error_log('english-quest: ' . $e);
    $debug = false;
    try { $debug = !empty(config()['debug']); } catch (Throwable $ignored){}
    send(500, ['error' => 'server', 'message' => 'Ошибка на сервере. Попробуйте позже.'] + ($debug ? ['debug' => $e->getMessage()] : []));
  }
}
