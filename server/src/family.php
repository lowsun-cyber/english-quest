<?php
// English Quest — ключ семьи (docs/concept-entry-test-and-key.md, раздел 5): родитель сохраняет прогресс детей
// без логинов и паролей. Семья — организация вида family; у родителя — ключ из 4 слов и 2 цифр, на сервере
// только его отпечаток. Ребёнок ключ не вводит: устройство подключается один раз и дальше работает по
// постоянному ключу (tokens: family — взрослый на устройстве, device — ребёнок; у device в parent — чей family).
// Имена детей на сервер не уходят: там «Лис-47» по аватару, настоящее имя — только на устройстве.
declare(strict_types=1);

namespace EQ;

use PDO;

require_once __DIR__ . '/words.php';

const FAMILY_DEVICES = 5;                         // устройств семьи одновременно (ключ раздали — предел)
const FAMILY_CHILDREN = 6;                        // детей в семье
const FAMILY_IDLE = 365 * 86400 * 1000;           // без занятий и входов год — семья удаляется (решение владельца)
const FAMILY_WARN = 30 * 86400 * 1000;            // за 30 дней — письмо, если почта указана
const CLEANUP_EVERY = 86400 * 1000;               // проверка неактивных семей — не чаще раза в сутки
// прозвище ребёнка на сервере — по аватару (как AVATARS в app.php и js/profiles.js)
const AVATAR_NAMES = ['🦊' => 'Лис', '🐼' => 'Панда', '🐸' => 'Лягушонок', '🦁' => 'Лев', '🐯' => 'Тигр', '🐨' => 'Коала',
  '🐵' => 'Мартышка', '🦄' => 'Единорог', '🐙' => 'Осьминог', '🐧' => 'Пингвин', '🐢' => 'Черепаха', '🐝' => 'Пчела'];

// Схема 3: семьи. У организации — вид, отпечаток ключа, почта для восстановления (по желанию) и согласие;
// у постоянного ключа устройства ребёнка — каким входом семьи он выдан (отключили устройство — отключились и дети).
function migrate_v3(PDO $pdo): void {
  foreach ([
    "ALTER TABLE orgs ADD COLUMN kind VARCHAR(8) NOT NULL DEFAULT 'school'",
    'ALTER TABLE orgs ADD COLUMN key_hash CHAR(64)',
    'ALTER TABLE orgs ADD COLUMN email VARCHAR(190)',
    'ALTER TABLE orgs ADD COLUMN consent_at BIGINT',
    'ALTER TABLE orgs ADD COLUMN warned BIGINT',
    'ALTER TABLE tokens ADD COLUMN parent VARCHAR(24)',
    'CREATE UNIQUE INDEX orgs_key ON orgs (key_hash)',
    'CREATE INDEX orgs_email ON orgs (email)',
    'CREATE INDEX tokens_parent ON tokens (parent)',
  ] as $sql) try_exec($pdo, $sql);
}

// ---------- ключ ----------
// Ввод терпим к регистру, «ё», пробелам и дефисам; принимается и запись номерами из QR-кода («12.408.77.1003.47»).
// Возвращает «лиса-ракета-пирог-зонт-47» или null.
function norm_family_key(mixed $raw): ?string {
  $s = mb_strtolower(trim((string)$raw));
  $s = str_replace('ё', 'е', $s);
  if (preg_match('/^\d{1,4}(\.\d{1,4}){3}\.\d{2}$/', $s)){
    $p = explode('.', $s);
    $w = [];
    for ($i = 0; $i < 4; $i++){ $n = (int)$p[$i]; if (!isset(KEY_WORDS[$n])) return null; $w[] = KEY_WORDS[$n]; }
    return implode('-', $w) . '-' . $p[4];
  }
  preg_match_all('/[а-я]+|\d+/u', $s, $m);
  $parts = $m[0];
  if (count($parts) !== 5 || !preg_match('/^\d{2}$/', $parts[4])) return null;
  for ($i = 0; $i < 4; $i++) if (!in_array($parts[$i], KEY_WORDS, true)) return null;
  return implode('-', $parts);
}
// Отпечаток с секретом сервера: даже из копии базы ключи не подобрать перебором словаря
function family_key_hash(string $norm): string { return hash_hmac('sha256', $norm, (string)(config()['secret'] ?? '')); }
// Новый ключ: слова — для карточки, номера — для QR-кода
function new_family_key(): array {
  $idx = [];
  for ($i = 0; $i < 4; $i++) $idx[] = random_int(0, count(KEY_WORDS) - 1);
  $digits = str_pad((string)random_int(0, 99), 2, '0', STR_PAD_LEFT);
  $norm = implode('-', array_map(fn($n) => KEY_WORDS[$n], $idx)) . '-' . $digits;
  return ['norm' => $norm, 'key' => mb_strtoupper($norm), 'code' => implode('.', $idx) . '.' . $digits];
}
// Выпустить ключ семье (старый перестаёт действовать); совпадение отпечатков почти невозможно — на всякий случай повтор
function set_family_key(string $orgId): array {
  for ($try = 0; $try < 5; $try++){
    $k = new_family_key();
    try {
      q('UPDATE orgs SET key_hash = ? WHERE id = ?', [family_key_hash($k['norm']), $orgId]);
      return ['key' => $k['key'], 'keyCode' => $k['code']];
    } catch (\PDOException $e){ /* такой ключ уже есть — другой */ }
  }
  throw new HttpError(500, 'key', 'Не получилось выпустить ключ. Попробуйте ещё раз.');
}

// ---------- кто спрашивает ----------
function need_family(): array {
  $w = auth();
  if (!$w || $w['kind'] !== 'family') throw new HttpError(401, 'family_login', 'Устройство отключено от семьи — введите ключ семьи заново.');
  if ($w['org']['warned']) q('UPDATE orgs SET warned = NULL WHERE id = ?', [$w['org']['id']]);   // семья снова занимается
  return $w;
}
function family_child(array $w, string $id): array {
  $s = one('SELECT * FROM students WHERE id = ? AND org_id = ?', [$id, $w['org']['id']]);
  if (!$s) throw new HttpError(404, 'not_found', 'Ребёнок не найден.');
  return $s;
}
function child_out(array $s): array {
  $p = one('SELECT state, updated FROM progress WHERE student_id = ?', [$s['id']]);
  $st = $p ? json_decode($p['state'], true) : null;
  return ['id' => $s['id'], 'name' => $s['name'], 'avatar' => $s['avatar'], 'created' => (int)$s['created'],
    'updated' => $p ? (int)$p['updated'] : null, 'xp' => (int)($st['xp'] ?? 0)];
}
function family_out(array $w): array {
  $org = one('SELECT * FROM orgs WHERE id = ?', [$w['org']['id']]);
  $kids = all('SELECT * FROM students WHERE org_id = ? ORDER BY created', [$org['id']]);
  $devs = all("SELECT id, label, created, last_used FROM tokens WHERE kind = 'family' AND subject = ? ORDER BY created", [$org['id']]);
  return ['id' => $org['id'], 'email' => $org['email'], 'created' => (int)$org['created'], 'maxDevices' => FAMILY_DEVICES, 'maxChildren' => FAMILY_CHILDREN,
    'children' => array_map('EQ\child_out', $kids),
    'devices' => array_map(fn($d) => ['id' => $d['id'], 'label' => $d['label'], 'created' => (int)$d['created'], 'lastUsed' => (int)$d['last_used'], 'current' => $d['id'] === $w['token']['id']], $devs)];
}
// Вход семьи на устройстве: постоянный ключ вида family
function family_login_out(string $orgId, string $label, array $extra = []): array {
  $t = issue_token('family', $orgId, $label);
  $w = ['org' => one('SELECT * FROM orgs WHERE id = ?', [$orgId]), 'token' => one('SELECT * FROM tokens WHERE id = ?', [$t['id']])];
  return $extra + ['token' => $t['token'], 'tokenId' => $t['id'], 'family' => family_out($w)];
}
// Ключ ребёнка для этого устройства — выдан текущим входом семьи
function child_device(array $w, array $s): array {
  $t = issue_token('device', $s['id'], (string)$w['token']['label']);
  q('UPDATE tokens SET parent = ? WHERE id = ?', [$w['token']['id'], $t['id']]);
  return ['token' => $t['token'], 'deviceId' => $t['id'], 'student' => student_public($s)];
}
// Отключить вход семьи на устройстве вместе с ключами детей, выданными им
function drop_family_token(string $tokenId): void {
  q("DELETE FROM tokens WHERE kind = 'device' AND parent = ?", [$tokenId]);
  q("DELETE FROM tokens WHERE id = ? AND kind = 'family'", [$tokenId]);
}
function delete_student(string $id): void {
  q('DELETE FROM progress WHERE student_id = ?', [$id]);
  q("DELETE FROM tokens WHERE kind = 'device' AND subject = ?", [$id]);
  q("DELETE FROM codes WHERE kind = 'device' AND subject = ?", [$id]);
  q('DELETE FROM resets WHERE subject = ?', [$id]);
  q('DELETE FROM students WHERE id = ?', [$id]);
}
// «Удалить всё»: дети, прогресс, устройства, ссылки восстановления и сама семья
function delete_family(string $orgId): void {
  db()->beginTransaction();
  foreach (all('SELECT id FROM students WHERE org_id = ?', [$orgId]) as $s) delete_student($s['id']);
  q("DELETE FROM tokens WHERE kind = 'family' AND subject = ?", [$orgId]);
  q('DELETE FROM resets WHERE subject = ?', [$orgId]);
  q("DELETE FROM orgs WHERE id = ? AND kind = 'family'", [$orgId]);
  db()->commit();
}

// ---------- неактивные семьи ----------
// Последняя активность: вход взрослого или ребёнка, запись прогресса, создание семьи
function family_last_active(string $orgId): int {
  $t = (int)(one("SELECT MAX(last_used) AS t FROM tokens WHERE kind = 'family' AND subject = ?", [$orgId])['t'] ?? 0);
  $d = (int)(one("SELECT MAX(t.last_used) AS t FROM tokens t JOIN students s ON s.id = t.subject WHERE t.kind = 'device' AND s.org_id = ?", [$orgId])['t'] ?? 0);
  $p = (int)(one('SELECT MAX(p.updated) AS t FROM progress p JOIN students s ON s.id = p.student_id WHERE s.org_id = ?', [$orgId])['t'] ?? 0);
  $c = (int)(one('SELECT created FROM orgs WHERE id = ?', [$orgId])['created'] ?? 0);
  return max($t, $d, $p, $c);
}
// Через год без активности семья удаляется. Если указана почта — сначала письмо, и удаление не раньше чем
// через 30 дней после него. Возвращает ['warned' => n, 'deleted' => n].
function family_cleanup(int $at): array {
  $res = ['warned' => 0, 'deleted' => 0];
  foreach (all("SELECT * FROM orgs WHERE kind = 'family'") as $o){
    $idle = $at - family_last_active($o['id']);
    if ($idle < FAMILY_IDLE - FAMILY_WARN) continue;
    if ($o['email'] && !$o['warned']){
      $date = date('d.m.Y', (int)(($at + FAMILY_WARN) / 1000));
      send_mail($o['email'], 'English Quest: прогресс детей будет удалён',
        "Здравствуйте!\n\nВ English Quest почти год никто из вашей семьи не занимался. По нашим правилам данные неактивных семей удаляются: прогресс детей на сервере будет удалён после $date.\n\nЧтобы сохранить его, просто откройте игру на устройстве, где она подключена к семье, или войдите по ключу семьи: " . app_url() . "\n\nНа самих устройствах прогресс останется в любом случае.\n\nЕсли вы не ждали этого письма, просто удалите его.");
      q('UPDATE orgs SET warned = ? WHERE id = ?', [$at, $o['id']]);
      $res['warned']++;
      continue;
    }
    if ($idle >= FAMILY_IDLE && (!$o['email'] || (int)$o['warned'] <= $at - FAMILY_WARN)){
      delete_family($o['id']);
      $res['deleted']++;
    }
  }
  return $res;
}
// Раз в сутки при обычном запросе (на хостинге нет планировщика)
function maybe_cleanup(): void {
  $last = (int)(one("SELECT v FROM meta WHERE k = 'cleanup'")['v'] ?? 0);
  if (now() - $last < CLEANUP_EVERY) return;
  q("DELETE FROM meta WHERE k = 'cleanup'");
  q("INSERT INTO meta (k, v) VALUES ('cleanup', ?)", [(string)now()]);
  try { family_cleanup(now()); } catch (\Throwable $e){ error_log('english-quest cleanup: ' . $e->getMessage()); }
}

// ---------- маршруты ----------
function family_routes(): array {
  return [
    // «Сохранить прогресс»: новая семья с ключом; нужно согласие родителя (ребёнку меньше 14 лет)
    ['POST', '#^/family$#', function(){
      if (empty(body()['consent'])) throw new HttpError(400, 'consent', 'Нужно согласие родителя на обработку данных ребёнка.');
      // новая семья считается попыткой, как неверный код: с одного адреса — не больше FAIL_LIMIT за 15 минут
      q('INSERT INTO fails (ip, at) VALUES (?, ?)', [check_fails(), now()]);
      $id = new_id('o');
      q("INSERT INTO orgs (id, name, created, kind, consent_at) VALUES (?, 'Семья', ?, 'family', ?)", [$id, now(), now()]);
      $key = set_family_key($id);
      return family_login_out($id, clean_name(body()['label'] ?? '', 60), $key);
    }],
    // вход по ключу на новом устройстве; replace — отключить все устройства семьи (если занято 5)
    ['POST', '#^/family/login$#', function(){
      $ip = check_fails();
      $norm = norm_family_key(body()['key'] ?? '');
      $org = $norm ? one("SELECT * FROM orgs WHERE key_hash = ? AND kind = 'family'", [family_key_hash($norm)]) : null;
      if (!$org){
        q('INSERT INTO fails (ip, at) VALUES (?, ?)', [$ip, now()]);
        throw new HttpError(400, 'bad_key', 'Ключ не подошёл. Проверьте слова и цифры.');
      }
      $devs = all("SELECT id FROM tokens WHERE kind = 'family' AND subject = ?", [$org['id']]);
      if (count($devs) >= FAMILY_DEVICES){
        if (empty(body()['replace'])) throw new HttpError(409, 'devices_full', 'К семье уже подключено ' . FAMILY_DEVICES . ' устройств. Отключите одно на подключённом устройстве или отключите все и подключите это.');
        foreach ($devs as $d) drop_family_token($d['id']);
      }
      q('UPDATE orgs SET warned = NULL WHERE id = ?', [$org['id']]);
      return family_login_out($org['id'], clean_name(body()['label'] ?? '', 60));
    }],
    ['GET', '#^/family$#', fn() => family_out(need_family())],

    // дети: прозвище по аватару, ключ для этого устройства
    ['POST', '#^/family/children$#', function(){
      $w = need_family();
      if ((int)one('SELECT COUNT(*) AS n FROM students WHERE org_id = ?', [$w['org']['id']])['n'] >= FAMILY_CHILDREN) throw new HttpError(400, 'children_full', 'В семье уже ' . FAMILY_CHILDREN . ' детей.');
      $avatar = in_array(body()['avatar'] ?? '', AVATARS, true) ? body()['avatar'] : AVATARS[0];
      $name = AVATAR_NAMES[$avatar] . '-' . random_int(10, 99);
      $id = new_id('s');
      q('INSERT INTO students (id, org_id, teacher_id, name, avatar, created, consent_at) VALUES (?, ?, NULL, ?, ?, ?, ?)', [$id, $w['org']['id'], $name, $avatar, now(), $w['org']['consent_at']]);
      return child_device($w, one('SELECT * FROM students WHERE id = ?', [$id]));
    }],
    // ребёнок из семьи будет играть на этом устройстве
    ['POST', '#^/family/children/(s[0-9a-f]{16})/link$#', function($id){
      $w = need_family();
      return child_device($w, family_child($w, $id));
    }],
    ['POST', '#^/family/children/(s[0-9a-f]{16})/delete$#', function($id){
      $w = need_family();
      family_child($w, $id);
      db()->beginTransaction();
      delete_student($id);
      db()->commit();
      return ['ok' => true];
    }],
    ['POST', '#^/family/devices/(t[0-9a-f]{16})/delete$#', function($id){
      $w = need_family();
      if (!one("SELECT id FROM tokens WHERE id = ? AND kind = 'family' AND subject = ?", [$id, $w['org']['id']])) throw new HttpError(404, 'not_found', 'Устройство не найдено.');
      drop_family_token($id);
      return ['ok' => true];
    }],
    // новый ключ: старый перестаёт действовать, подключённые устройства продолжают работать
    ['POST', '#^/family/key$#', fn() => set_family_key(need_family()['org']['id'])],
    // почта для восстановления ключа — по желанию, с отдельным согласием; пустая — убрать
    ['POST', '#^/family/email$#', function(){
      $w = need_family();
      $email = norm_email(body()['email'] ?? '', false);
      if ($email && empty(body()['consent'])) throw new HttpError(400, 'consent', 'Отметьте согласие на хранение почты.');
      q('UPDATE orgs SET email = ? WHERE id = ?', [$email, $w['org']['id']]);
      return family_out($w);
    }],
    // «Забыли ключ?» — письмо со ссылкой на новый ключ; ответ одинаковый, есть такая почта или нет
    ['POST', '#^/family/forgot$#', function(){
      $ip = check_fails();
      q('INSERT INTO fails (ip, at) VALUES (?, ?)', [$ip, now()]);
      $email = norm_email(body()['email'] ?? '');
      foreach (all("SELECT * FROM orgs WHERE kind = 'family' AND email = ?", [$email]) as $o){
        if (recent_resets($o['id']) >= RESETS_PER_HOUR) continue;
        $link = app_url() . '#famkey=' . issue_reset('family', $o['id'], 'key');
        send_mail($email, 'English Quest: новый ключ семьи',
          "Здравствуйте!\n\nВы попросили новый ключ семьи English Quest. Откройте ссылку на устройстве, где ребёнок занимается (действует 1 час):\n$link\n\nСтарый ключ перестанет действовать, подключённые устройства продолжат работать.\n\nЕсли вы ничего не просили, просто удалите это письмо — ключ не изменится.");
      }
      return ['ok' => true, 'message' => 'Если эта почта указана в семье, на неё придёт письмо со ссылкой. Проверьте и папку «Спам».'];
    }],
    ['POST', '#^/family/recover$#', function(){
      $r = find_reset(body()['token'] ?? '');
      if ($r['kind'] !== 'family' || !one("SELECT id FROM orgs WHERE id = ? AND kind = 'family'", [$r['subject']])) throw new HttpError(400, 'bad_link', 'Ссылка устарела или уже использована. Запросите новую.');
      q('DELETE FROM resets WHERE subject = ?', [$r['subject']]);
      $key = set_family_key($r['subject']);
      // по ссылке из почты устройство подключается даже при занятом пределе: самое старое отключается
      $devs = all("SELECT id FROM tokens WHERE kind = 'family' AND subject = ? ORDER BY last_used", [$r['subject']]);
      for ($i = 0; $i <= count($devs) - FAMILY_DEVICES; $i++) drop_family_token($devs[$i]['id']);
      q('UPDATE orgs SET warned = NULL WHERE id = ?', [$r['subject']]);
      return family_login_out($r['subject'], clean_name(body()['label'] ?? '', 60), $key);
    }],
    // Владельцу платформы — только общие числа по семьям, без номеров, имён и прогресса (концепция, раздел 10)
    ['GET', '#^/stats/families$#', function(){
      $u = need_user();
      if ($u['role'] !== 'owner') throw new HttpError(403, 'forbidden', 'Это видит только владелец.');
      $at = now(); $day = 86400 * 1000;
      $orgs = all("SELECT id, created, email, warned FROM orgs WHERE kind = 'family'");
      $out = ['families' => count($orgs), 'children' => (int)one("SELECT COUNT(*) AS n FROM students s JOIN orgs o ON o.id = s.org_id WHERE o.kind = 'family'")['n'],
        'withEmail' => 0, 'warned' => 0, 'active7' => 0, 'active30' => 0, 'new30' => 0, 'weeks' => array_fill(0, 8, 0), 'at' => $at];
      foreach ($orgs as $o){
        if ($o['email']) $out['withEmail']++;
        if ($o['warned']) $out['warned']++;
        if ((int)$o['created'] > $at - 30 * $day) $out['new30']++;
        $w = intdiv($at - (int)$o['created'], 7 * $day);
        if ($w >= 0 && $w < 8) $out['weeks'][$w]++;   // 0 — эта неделя (последние 7 дней)
        // «занимались» — была запись прогресса; создание семьи и вход взрослого не считаются
        $p = (int)(one('SELECT MAX(p.updated) AS t FROM progress p JOIN students s ON s.id = p.student_id WHERE s.org_id = ?', [$o['id']])['t'] ?? 0);
        if ($p > $at - 7 * $day) $out['active7']++;
        if ($p > $at - 30 * $day) $out['active30']++;
      }
      return $out;
    }],
    ['POST', '#^/family/delete$#', function(){
      delete_family(need_family()['org']['id']);
      return ['ok' => true];
    }],
  ];
}
