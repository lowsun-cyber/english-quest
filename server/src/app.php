<?php
// English Quest — сервер: вход по коду, ученики, подключение устройств, хранение прогресса.
// Обычный PHP 8.1+ и PDO без фреймворков: работает на виртуальном хостинге и так же — на VDS.
// База: MySQL/MariaDB (хостинг), PostgreSQL или SQLite (тесты) — SQL написан переносимо.
declare(strict_types=1);

namespace EQ;

use PDO;
use Throwable;

require_once __DIR__ . '/auth.php';   // пароли, почта, восстановление доступа

const SCHEMA_VERSION = 2;
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
    try { $cfg = require $file; }
    catch (\ParseError $e){
      // только номер строки и суть ошибки — содержимое файла (пароли) не показываем
      throw new HttpError(500, 'config_error', 'Ошибка в config.php около строки ' . $e->getLine() . ' (или строкой выше): проверьте запятые в конце строк и прямые кавычки \' вместо «» и ‘’.');
    }
    if (!is_array($cfg)) throw new HttpError(500, 'config_error', 'config.php должен начинаться с <?php и возвращать настройки: return [ ... ];');
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
    // всегда 4-байтовая кодировка: без charset в dsn хостинг может дать utf8mb3, и эмодзи-аватары не сохраняются
    if (driver($pdo) === 'mysql') $pdo->exec('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci');
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
  if ($cur < 1) migrate_v1($pdo, $big, $tail);
  if ($cur < 2) migrate_v2($pdo, $tail);
  $pdo->prepare("DELETE FROM meta WHERE k = 'schema'")->execute();
  $pdo->prepare("INSERT INTO meta (k, v) VALUES ('schema', ?)")->execute([(string)SCHEMA_VERSION]);
}
// Команды схемы можно безопасно повторить: «уже есть» пропускаем (установка могла прерваться на середине)
function try_exec(PDO $pdo, string $sql): void {
  try { $pdo->exec($sql); } catch (\PDOException $e){ /* столбец или индекс уже есть */ }
}

// Схема 1: организации, взрослые, ученики, прогресс, ключи, коды
function migrate_v1(PDO $pdo, string $big, string $tail): void {
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
  ] as $sql) try_exec($pdo, $sql);
}

// Схема 2: пароли и почта. У взрослого — почта (вход и восстановление); у ученика — логин,
// почта родителя (только для восстановления) и отметка о согласии родителя на обработку данных.
// В базе — только отпечатки паролей (password_hash) и одноразовых ссылок.
function migrate_v2(PDO $pdo, string $tail): void {
  foreach ([
    'ALTER TABLE users ADD COLUMN email VARCHAR(190)',
    'ALTER TABLE users ADD COLUMN pass_hash VARCHAR(255)',
    'ALTER TABLE users ADD COLUMN must_change INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE students ADD COLUMN login VARCHAR(40)',
    'ALTER TABLE students ADD COLUMN email VARCHAR(190)',
    'ALTER TABLE students ADD COLUMN pass_hash VARCHAR(255)',
    'ALTER TABLE students ADD COLUMN consent_at BIGINT',
  ] as $sql) try_exec($pdo, $sql);
  // одноразовые ссылки: purpose = invite (задать пароль, 7 дней) или reset (сменить, 1 час)
  $pdo->exec("CREATE TABLE IF NOT EXISTS resets (hash CHAR(64) PRIMARY KEY, kind VARCHAR(8) NOT NULL, subject VARCHAR(24) NOT NULL, purpose VARCHAR(8) NOT NULL, expires BIGINT NOT NULL, created BIGINT NOT NULL)$tail");
  foreach ([
    'CREATE UNIQUE INDEX users_email ON users (email)',
    'CREATE UNIQUE INDEX students_login ON students (login)',
    'CREATE INDEX students_email ON students (email)',
    'CREATE INDEX resets_subject ON resets (subject)',
  ] as $sql) try_exec($pdo, $sql);
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

// Слишком много неверных кодов (и ключей установки) с одного адреса — пауза
function check_fails(): string {
  $ip = client_ip();
  q('DELETE FROM fails WHERE at < ?', [now() - FAIL_WINDOW]);
  $n = (int)one('SELECT COUNT(*) AS n FROM fails WHERE ip = ?', [$ip])['n'];
  if ($n >= FAIL_LIMIT) throw new HttpError(429, 'too_many', 'Слишком много неверных кодов. Попробуйте через 15 минут.');
  return $ip;
}

// Первый запуск: организация и её владелец (из админ-панели или php bin/setup.php init)
function owner_exists(): bool { return (bool)one("SELECT id FROM users WHERE role = 'owner'"); }
function create_owner(string $orgName, string $name): array {
  $org = new_id('o'); $user = new_id('u');
  q('INSERT INTO orgs (id, name, created) VALUES (?, ?, ?)', [$org, $orgName, now()]);
  q('INSERT INTO users (id, org_id, role, name, created) VALUES (?, ?, ?, ?, ?)', [$user, $org, 'owner', $name, now()]);
  return one('SELECT * FROM users WHERE id = ?', [$user]);
}
// Ключ установки из config.php (setup_key): не короче 12 символов, иначе первый запуск через панель выключен
function setup_key(): string { $k = (string)(config()['setup_key'] ?? ''); return strlen($k) >= 12 ? $k : ''; }

// Обменивает одноразовый код на постоянный ключ. Неверные попытки считаются по адресу.
function redeem_code(string $kind, mixed $raw): array {
  $ip = check_fails();
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
function is_admin(array $u): bool { return in_array($u['role'], ['owner', 'admin'], true); }
// Роль при создании/изменении: администраторов назначает только владелец
function role_for_change(array $u, mixed $role): string {
  if (!in_array($role, ['teacher', 'admin'], true)) throw new HttpError(400, 'role', 'Неизвестная роль.');
  if ($role === 'admin' && $u['role'] !== 'owner') throw new HttpError(403, 'forbidden', 'Администраторов назначает только владелец.');
  return $role;
}
// Взрослый своей организации, которым можно управлять: администратор не трогает владельца и других администраторов
function managed_user(array $u, string $id, bool $selfOk): array {
  $t = one('SELECT * FROM users WHERE id = ? AND org_id = ?', [$id, $u['org_id']]);
  if (!$t) throw new HttpError(404, 'not_found', 'Пользователь не найден.');
  if ($t['id'] === $u['id'] && $selfOk) return $t;
  if ($u['role'] === 'admin' && $t['role'] !== 'teacher') throw new HttpError(403, 'forbidden', 'Это может сделать только владелец.');
  return $t;
}
// Проверка формы домашнего задания (как в js/stats.js → makeHomeworkFor)
function valid_homework(object $hw): bool {
  $tasks = $hw->tasks ?? null;
  return is_string($hw->id ?? null) && strlen($hw->id) <= 600
    && is_string($hw->lessonId ?? null) && preg_match('/^[a-z0-9-]{1,40}$/', $hw->lessonId)
    && is_array($tasks) && count($tasks) >= 1 && count($tasks) <= 10
    && count(array_filter($tasks, fn($t) => is_string($t) && preg_match('/^[a-z]{2,10}$/', $t))) === count($tasks)
    && is_string($hw->due ?? '') && preg_match('/^(\d{4}-\d{2}-\d{2})?$/', $hw->due ?? '')
    && is_string($hw->note ?? '') && mb_strlen($hw->note ?? '') <= 300
    && is_numeric($hw->assigned ?? null) && is_object($hw->baseline ?? null)
    && (($hw->doneAt ?? null) === null || is_numeric($hw->doneAt));
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
  $out = ['id' => $s['id'], 'name' => $s['name'], 'avatar' => $s['avatar'], 'teacherId' => $s['teacher_id'], 'created' => (int)$s['created'],
    'login' => $s['login'] ?? null, 'email' => $s['email'] ?? null, 'hasPassword' => !empty($s['pass_hash']), 'consentAt' => isset($s['consent_at']) ? (int)$s['consent_at'] : null];
  if ($withSummary){
    $p = one('SELECT state, version, updated FROM progress WHERE student_id = ?', [$s['id']]);
    $out['version'] = $p ? (int)$p['version'] : 0;
    $out['updated'] = $p ? (int)$p['updated'] : null;
    $out['summary'] = summary($p ? json_decode($p['state'], true) : null);
    $out['devices'] = (int)one("SELECT COUNT(*) AS n FROM tokens WHERE kind = 'device' AND subject = ?", [$s['id']])['n'];
  }
  return $out;
}
// Устройству ученика — только имя и аватар (почта родителя и логин ему не нужны)
function student_public(array $s): array { return ['id' => $s['id'], 'name' => $s['name'], 'avatar' => $s['avatar']]; }
function user_out(array $u): array {
  return ['id' => $u['id'], 'name' => $u['name'], 'role' => $u['role'], 'orgId' => $u['org_id'],
    'email' => $u['email'] ?? null, 'hasPassword' => !empty($u['pass_hash']), 'mustChange' => !empty($u['must_change'])];
}

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
  return [...auth_routes(), ...base_routes()];
}
function base_routes(): array {
  return [
    ['GET', '#^/$#', fn() => ['app' => 'english-quest', 'ok' => true]],

    // первый запуск из админ-панели: пока владельца нет, его можно создать по ключу установки
    ['GET', '#^/setup$#', fn() => ['needed' => !owner_exists(), 'enabled' => setup_key() !== '']],
    ['POST', '#^/setup$#', function(){
      if (owner_exists()) throw new HttpError(409, 'already', 'Сервер уже настроен — войдите по коду входа.');
      $key = setup_key();
      if ($key === '') throw new HttpError(403, 'setup_off', "Впишите в config.php строку 'setup_key' => '…' (не короче 12 символов) и повторите.");
      $ip = check_fails();
      if (!hash_equals($key, (string)(body()['key'] ?? ''))){
        q('INSERT INTO fails (ip, at) VALUES (?, ?)', [$ip, now()]);
        throw new HttpError(403, 'bad_key', 'Ключ установки не подошёл. Сверьте его с config.php.');
      }
      $orgName = clean_name(body()['org'] ?? '', 100);
      $name = clean_name(body()['name'] ?? '', 60);
      if ($orgName === '' || $name === '') throw new HttpError(400, 'name', 'Введите название и ваше имя.');
      $email = norm_email(body()['email'] ?? '', false);
      $pass = isset(body()['password']) && body()['password'] !== '' ? check_password(body()['password'], MIN_PASSWORD_ADULT) : null;
      $u = create_owner($orgName, $name);
      if ($email || $pass){
        q('UPDATE users SET email = ?, pass_hash = ? WHERE id = ?', [$email, $pass ? hash_password($pass) : null, $u['id']]);
        $u = one('SELECT * FROM users WHERE id = ?', [$u['id']]);
      }
      $t = issue_token('user', $u['id'], clean_name(body()['label'] ?? '', 60));
      return ['token' => $t['token'], 'user' => user_out($u)];
    }],

    // Восстановление доступа владельца по тому же ключу установки (когда нет SSH для php bin/setup.php code).
    // Работает, только пока в config.php есть setup_key — после входа строку можно снова удалить.
    ['POST', '#^/setup/recover$#', function(){
      $key = setup_key();
      if ($key === '') throw new HttpError(403, 'setup_off', "Впишите в config.php строку 'setup_key' => '…' (не короче 12 символов) и повторите.");
      $ip = check_fails();
      if (!hash_equals($key, (string)(body()['key'] ?? ''))){
        q('INSERT INTO fails (ip, at) VALUES (?, ?)', [$ip, now()]);
        throw new HttpError(403, 'bad_key', 'Ключ установки не подошёл. Сверьте его с config.php.');
      }
      $u = one("SELECT * FROM users WHERE role = 'owner' ORDER BY created");
      if (!$u) throw new HttpError(409, 'no_owner', 'Владельца ещё нет — пройдите первый запуск.');
      $t = issue_token('user', $u['id'], clean_name(body()['label'] ?? '', 60));
      return ['token' => $t['token'], 'user' => user_out($u)];
    }],

    // вход взрослого по одноразовому коду (коды выдаёт администратор)
    ['POST', '#^/login$#', function(){
      if (isset(body()['email'])){
        // вход по почте и паролю
        $ip = check_fails();
        $email = mb_strtolower(trim((string)body()['email']));
        $u = $email !== '' ? one('SELECT * FROM users WHERE email = ?', [$email]) : null;
        if (!verify_password($u['pass_hash'] ?? null, (string)(body()['password'] ?? ''))){
          q('INSERT INTO fails (ip, at) VALUES (?, ?)', [$ip, now()]);
          throw new HttpError(400, 'bad_login', 'Почта или пароль не подошли.');
        }
      } else {
        $c = redeem_code('login', body()['code'] ?? '');
        $u = one('SELECT * FROM users WHERE id = ?', [$c['subject']]);
        if (!$u) throw new HttpError(400, 'bad_code', 'Код не подошёл.');
      }
      $t = issue_token('user', $u['id'], clean_name(body()['label'] ?? '', 60));
      return ['token' => $t['token'], 'user' => user_out($u)];
    }],
    ['POST', '#^/logout$#', function(){
      $w = auth();
      if ($w) q('DELETE FROM tokens WHERE id = ?', [$w['token']['id']]);
      return ['ok' => true];
    }],
    // код входа для себя — чтобы войти на другом устройстве (телефон, второй компьютер)
    ['POST', '#^/me/code$#', function(){
      $u = need_user();
      return issue_code('login', $u['id']);
    }],
    // «Мои входы»: устройства, где этот взрослый вошёл, и неиспользованные коды входа.
    // Сами коды не показываем (в базе только их отпечатки) — только сколько их и до какого числа они действуют.
    ['GET', '#^/me/sessions$#', function(){
      $u = need_user();
      $cur = auth()['token']['id'];
      $rows = all("SELECT id, label, created, last_used FROM tokens WHERE kind = 'user' AND subject = ? ORDER BY last_used DESC", [$u['id']]);
      $codes = all("SELECT expires FROM codes WHERE kind = 'login' AND subject = ? AND expires > ? ORDER BY expires", [$u['id'], now()]);
      return [
        'sessions' => array_map(fn($r) => ['id' => $r['id'], 'label' => $r['label'], 'created' => (int)$r['created'], 'lastUsed' => (int)$r['last_used'], 'current' => $r['id'] === $cur], $rows),
        'codes' => ['count' => count($codes), 'until' => $codes ? (int)end($codes)['expires'] : null],
      ];
    }],
    ['POST', '#^/me/sessions/(t[0-9a-f]{16})/delete$#', function($id){
      $u = need_user();
      $n = q("DELETE FROM tokens WHERE id = ? AND kind = 'user' AND subject = ?", [$id, $u['id']])->rowCount();
      if (!$n) throw new HttpError(404, 'not_found', 'Такого входа нет.');
      return ['ok' => true];
    }],
    ['POST', '#^/me/sessions/others/delete$#', function(){
      $u = need_user();
      $n = q("DELETE FROM tokens WHERE kind = 'user' AND subject = ? AND id <> ?", [$u['id'], auth()['token']['id']])->rowCount();
      return ['deleted' => $n];
    }],
    ['POST', '#^/me/codes/delete$#', function(){
      $u = need_user();
      $n = q("DELETE FROM codes WHERE kind = 'login' AND subject = ?", [$u['id']])->rowCount();
      return ['deleted' => $n];
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
      $login = norm_login(body()['login'] ?? '');
      if ($login && login_taken($login)) throw new HttpError(400, 'login', 'Такой логин уже занят — придумайте другой.');
      $email = norm_email(body()['email'] ?? '', false);
      // проверяем до записи, чтобы ошибка в способе доступа не оставила ученика «наполовину»
      $mode = (string)(body()['access'] ?? 'none');
      if (in_array($mode, ['temp', 'invite'], true) && !$login) throw new HttpError(400, 'login', 'Сначала задайте ученику логин.');
      if ($mode === 'invite' && !$email) throw new HttpError(400, 'email', 'Сначала укажите почту родителя.');
      $id = new_id('s');
      q('INSERT INTO students (id, org_id, teacher_id, name, avatar, created, login, email) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$id, $u['org_id'], $teacher, $name, $avatar, now(), $login, $email]);
      $access = grant_student_access(one('SELECT * FROM students WHERE id = ?', [$id]), $mode);
      return ['student' => student_out(one('SELECT * FROM students WHERE id = ?', [$id]))] + $access;
    }],
    ['POST', '#^/students/(s[0-9a-f]{16})$#', function($id){
      $u = need_user();
      $s = student_for($u, $id);
      $name = array_key_exists('name', body()) ? clean_name(body()['name'], 20) : $s['name'];
      if ($name === '') throw new HttpError(400, 'name', 'Введите имя ученика.');
      $avatar = in_array(body()['avatar'] ?? '', AVATARS, true) ? body()['avatar'] : $s['avatar'];
      $teacher = $s['teacher_id'];
      if (array_key_exists('teacherId', body()) && body()['teacherId'] !== $teacher){
        if (!is_admin($u)) throw new HttpError(403, 'forbidden', 'Сменить репетитора может только администратор.');
        if (!one('SELECT id FROM users WHERE id = ? AND org_id = ?', [(string)body()['teacherId'], $u['org_id']])) throw new HttpError(400, 'teacher', 'Репетитор не найден.');
        $teacher = (string)body()['teacherId'];
      }
      $login = $s['login'];
      if (array_key_exists('login', body())){
        $login = norm_login(body()['login']);
        if ($login && login_taken($login, $id)) throw new HttpError(400, 'login', 'Такой логин уже занят — придумайте другой.');
      }
      $email = array_key_exists('email', body()) ? norm_email(body()['email'], false) : $s['email'];
      q('UPDATE students SET name = ?, avatar = ?, teacher_id = ?, login = ?, email = ? WHERE id = ?', [$name, $avatar, $teacher, $login, $email, $id]);
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
      q('DELETE FROM resets WHERE subject = ?', [$id]);
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
    // Домашнее задание из админ-панели: меняется только поле homework, с проверкой версии, как у устройства.
    // Устройство получит задание при следующей синхронизации (объединение — js/merge.js).
    ['POST', '#^/students/(s[0-9a-f]{16})/homework$#', function($id){
      student_for(need_user(), $id);
      $o = json_decode(raw_body());
      $hw = is_object($o) ? ($o->homework ?? null) : null;
      if ($hw !== null && !valid_homework($hw)) throw new HttpError(400, 'bad_homework', 'Задание в неверном формате.');
      $base = (int)(body()['base'] ?? -1);
      $cur = one('SELECT version, state, updated FROM progress WHERE student_id = ?', [$id]);
      $curVersion = $cur ? (int)$cur['version'] : 0;
      if ($base !== $curVersion) throw new HttpError(409, 'conflict', 'Прогресс ученика только что изменился. Обновите страницу и повторите.', ['version' => $curVersion]);
      $st = $cur ? state_out($cur['state']) : new \stdClass();
      $st->homework = $hw;
      $json = json_encode($st, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
      $n = $cur
        ? q('UPDATE progress SET state = ?, version = ?, updated = ?, device_id = NULL WHERE student_id = ? AND version = ?', [$json, $curVersion + 1, now(), $id, $curVersion])->rowCount()
        : (function() use ($id, $json){ try { q('INSERT INTO progress (student_id, state, version, updated, device_id) VALUES (?, ?, 1, ?, NULL)', [$id, $json, now()]); return 1; } catch (\PDOException $e){ return 0; } })();
      if ($n !== 1) throw new HttpError(409, 'conflict', 'Прогресс ученика только что изменился. Обновите страницу и повторите.', ['version' => $curVersion]);
      return ['version' => $curVersion + 1, 'homework' => $hw];
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
      return ['token' => $t['token'], 'deviceId' => $t['id'], 'student' => student_public($s)];
    }],
    ['GET', '#^/progress$#', function(){
      $w = need_device();
      $p = one('SELECT * FROM progress WHERE student_id = ?', [$w['student']['id']]);
      return ['student' => student_public($w['student']), 'state' => $p ? state_out($p['state']) : null, 'version' => $p ? (int)$p['version'] : 0, 'updated' => $p ? (int)$p['updated'] : null];
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

    // взрослые: репетиторы и администраторы — управляют владелец и администраторы
    ['GET', '#^/users$#', function(){
      $u = need_owner();
      $rows = all('SELECT * FROM users WHERE org_id = ? ORDER BY created', [$u['org_id']]);
      return ['users' => array_map(fn($r) => user_out($r) + [
        'created' => (int)$r['created'],
        'students' => (int)one('SELECT COUNT(*) AS n FROM students WHERE teacher_id = ?', [$r['id']])['n'],
        'lastSeen' => ($t = one("SELECT MAX(last_used) AS t FROM tokens WHERE kind = 'user' AND subject = ?", [$r['id']])['t']) ? (int)$t : null,
      ], $rows)];
    }],
    ['POST', '#^/users$#', function(){
      $u = need_owner();
      $name = clean_name(body()['name'] ?? '', 60);
      if ($name === '') throw new HttpError(400, 'name', 'Введите имя.');
      $role = role_for_change($u, body()['role'] ?? 'teacher');
      $email = norm_email(body()['email'] ?? '', false);
      if ($email && email_taken($email)) throw new HttpError(400, 'email', 'Эта почта уже занята.');
      $mode = (string)(body()['access'] ?? 'code');
      if ($mode === 'invite' && !$email) throw new HttpError(400, 'email', 'Для приглашения нужна почта.');
      $id = new_id('u');
      q('INSERT INTO users (id, org_id, role, name, created, email) VALUES (?, ?, ?, ?, ?, ?)', [$id, $u['org_id'], $role, $name, now(), $email]);
      $new = one('SELECT * FROM users WHERE id = ?', [$id]);
      $access = grant_user_access($new, $mode);
      return ['user' => user_out(one('SELECT * FROM users WHERE id = ?', [$id]))] + $access;
    }],
    ['POST', '#^/users/(u[0-9a-f]{16})$#', function($id){
      $u = need_owner();
      $t = managed_user($u, $id, true);
      $name = array_key_exists('name', body()) ? clean_name(body()['name'], 60) : $t['name'];
      if ($name === '') throw new HttpError(400, 'name', 'Введите имя.');
      $role = $t['role'];
      if (array_key_exists('role', body()) && body()['role'] !== $t['role']){
        if ($t['role'] === 'owner' || $t['id'] === $u['id']) throw new HttpError(403, 'forbidden', 'Свою роль и роль владельца поменять нельзя.');
        $role = role_for_change($u, body()['role']);
      }
      $email = $t['email'];
      if (array_key_exists('email', body())){
        $email = norm_email(body()['email'], false);
        if ($email && email_taken($email, $id)) throw new HttpError(400, 'email', 'Эта почта уже занята.');
      }
      q('UPDATE users SET name = ?, role = ?, email = ? WHERE id = ?', [$name, $role, $email, $id]);
      return ['user' => user_out(one('SELECT * FROM users WHERE id = ?', [$id]))];
    }],
    // удаление взрослого: его ученики переходят другому (transferTo) или тому, кто удаляет
    ['POST', '#^/users/(u[0-9a-f]{16})/delete$#', function($id){
      $u = need_owner();
      $t = managed_user($u, $id, false);
      if ($t['role'] === 'owner' || $t['id'] === $u['id']) throw new HttpError(403, 'forbidden', 'Владельца и себя удалить нельзя.');
      $to = (string)(body()['transferTo'] ?? $u['id']);
      if ($to === $id || !one('SELECT id FROM users WHERE id = ? AND org_id = ?', [$to, $u['org_id']])) throw new HttpError(400, 'teacher', 'Кому передать учеников — не найден.');
      db()->beginTransaction();
      q('UPDATE students SET teacher_id = ? WHERE teacher_id = ?', [$to, $id]);
      q("DELETE FROM tokens WHERE kind = 'user' AND subject = ?", [$id]);
      q("DELETE FROM codes WHERE kind = 'login' AND subject = ?", [$id]);
      q('DELETE FROM resets WHERE subject = ?', [$id]);
      q('DELETE FROM users WHERE id = ?', [$id]);
      db()->commit();
      return ['ok' => true];
    }],
    ['POST', '#^/users/(u[0-9a-f]{16})/code$#', function($id){
      $u = need_owner();
      managed_user($u, $id, false);
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
