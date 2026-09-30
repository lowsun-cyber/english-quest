<?php
// English Quest — пароли, почта и восстановление доступа.
//  • Взрослые входят по почте и паролю; ученики — по логину и паролю (почта у ученика — родительская,
//    только для восстановления). Вход по одноразовому коду и подключение устройства по коду остаются.
//  • Администратор создаёт учётную запись и выбирает: приглашение на почту (пароль задаёт сам человек)
//    или временный пароль (взрослый сменит его при первом входе).
//  • «Забыли пароль?» — ссылка на почту: действует 1 час и один раз. На вопрос «есть ли такая почта»
//    сервер не отвечает — ответ всегда одинаковый.
//  • В базе — только отпечатки паролей (password_hash) и ссылок (sha256).
declare(strict_types=1);

namespace EQ;

const INVITE_TTL = 7 * 86400 * 1000;
const RESET_TTL = 3600 * 1000;
const RESETS_PER_HOUR = 3;                 // писем восстановления одному человеку в час
const MIN_PASSWORD_ADULT = 8;
const MIN_PASSWORD_STUDENT = 6;
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

// ---------- проверка ввода ----------
function norm_email(mixed $raw, bool $required = true): ?string {
  $e = mb_strtolower(trim((string)$raw));
  if ($e === '') {
    if ($required) throw new HttpError(400, 'email', 'Введите почту.');
    return null;
  }
  if (strlen($e) > 190 || !filter_var($e, FILTER_VALIDATE_EMAIL)) throw new HttpError(400, 'email', 'Почта указана с ошибкой.');
  return $e;
}
function norm_login(mixed $raw): ?string {
  $l = strtolower(trim((string)$raw));
  if ($l === '') return null;
  if (!preg_match('/^[a-z0-9][a-z0-9._-]{2,29}$/', $l)) throw new HttpError(400, 'login', 'Логин: от 3 до 30 латинских букв, цифр, точек, дефисов или подчёркиваний.');
  return $l;
}
function check_password(mixed $raw, int $min): string {
  $p = (string)$raw;
  if (mb_strlen($p) < $min) throw new HttpError(400, 'password', "Пароль — не короче $min символов.");
  if (strlen($p) > 200) throw new HttpError(400, 'password', 'Слишком длинный пароль.');
  return $p;
}
function temp_password(): string {
  $s = '';
  for ($i = 0; $i < 8; $i++) $s .= TEMP_ALPHABET[random_int(0, strlen(TEMP_ALPHABET) - 1)];
  return substr($s, 0, 4) . '-' . substr($s, 4);
}
function hash_password(string $p): string { return password_hash($p, PASSWORD_DEFAULT); }
function email_taken(string $email, ?string $exceptUser = null): bool {
  return (bool)one('SELECT id FROM users WHERE email = ? AND id <> ?', [$email, $exceptUser ?? '']);
}
function login_taken(string $login, ?string $exceptStudent = null): bool {
  return (bool)one('SELECT id FROM students WHERE login = ? AND id <> ?', [$login, $exceptStudent ?? '']);
}
// Одинаковая по времени проверка, даже если такого человека нет (чтобы нельзя было угадать, кто есть)
function verify_password(?string $hash, string $password): bool {
  static $dummy = null;
  $dummy ??= password_hash('eq-dummy-password', PASSWORD_DEFAULT);
  $ok = password_verify($password, $hash ?: $dummy);
  return $ok && (bool)$hash;
}

// ---------- ссылки «задать пароль» ----------
function app_url(): string { return rtrim((string)(config()['app_url'] ?? 'https://quest.logiqa.ru/'), '/') . '/'; }
function issue_reset(string $kind, string $subject, string $purpose): string {
  $token = new_token();
  q('INSERT INTO resets (hash, kind, subject, purpose, expires, created) VALUES (?, ?, ?, ?, ?, ?)',
    [sha($token), $kind, $subject, $purpose, now() + ($purpose === 'invite' ? INVITE_TTL : RESET_TTL), now()]);
  return $token;
}
function reset_link(string $token): string { return app_url() . 'admin/#reset=' . $token; }
function find_reset(mixed $token): array {
  $t = (string)$token;
  $r = preg_match('/^[0-9a-f]{64}$/', $t) ? one('SELECT * FROM resets WHERE hash = ?', [sha($t)]) : null;
  if (!$r || $r['expires'] < now()) throw new HttpError(400, 'bad_link', 'Ссылка устарела или уже использована. Запросите новую.');
  return $r;
}
function recent_resets(string $subject): int {
  return (int)one('SELECT COUNT(*) AS n FROM resets WHERE subject = ? AND created > ?', [$subject, now() - 3600 * 1000])['n'];
}

// ---------- письма ----------
// config.php → 'mail' => ['transport' => 'smtp' | 'mail' | 'log', ...] (см. config.example.php)
function send_mail(string $to, string $subject, string $text): ?string {
  $c = config()['mail'] ?? [];
  $transport = $c['transport'] ?? '';
  $from = (string)($c['from'] ?? '');
  $fromName = (string)($c['from_name'] ?? 'English Quest');
  if ($transport === '' || $from === '') return 'Отправка писем не настроена (раздел mail в config.php).';
  $enc = fn($s) => '=?UTF-8?B?' . base64_encode($s) . '?=';
  $host = substr(strrchr($from, '@') ?: '@localhost', 1);
  $headers = [
    'Date: ' . date('r'),
    'From: ' . $enc($fromName) . " <$from>",
    "To: <$to>",
    'Subject: ' . $enc($subject),
    'Message-ID: <' . bin2hex(random_bytes(12)) . "@$host>",
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  $body = chunk_split(base64_encode($text), 76, "\r\n");
  try {
    if ($transport === 'log'){
      // для тестов и отладки: письмо дописывается в файл
      file_put_contents((string)$c['log_file'], json_encode(['to' => $to, 'subject' => $subject, 'text' => $text], JSON_UNESCAPED_UNICODE) . "\n", FILE_APPEND);
      return null;
    }
    if ($transport === 'mail'){
      $h = array_values(array_filter($headers, fn($l) => !str_starts_with($l, 'To:') && !str_starts_with($l, 'Subject:')));
      return mail($to, $enc($subject), $body, implode("\r\n", $h), '-f' . $from) ? null : 'Хостинг не принял письмо (mail).';
    }
    if ($transport === 'smtp'){
      smtp_send($c, $from, $to, implode("\r\n", $headers) . "\r\n\r\n" . $body);
      return null;
    }
    return "Неизвестный способ отправки: $transport";
  } catch (\Throwable $e){
    error_log('english-quest mail: ' . $e->getMessage());
    return 'Письмо не отправилось: ' . $e->getMessage();
  }
}

// Минимальный SMTP-клиент: SSL (порт 465) или STARTTLS (587), вход по логину и паролю ящика
function smtp_send(array $c, string $from, string $to, string $message): void {
  $host = (string)($c['host'] ?? '');
  $port = (int)($c['port'] ?? 465);
  $secure = $c['secure'] ?? ($port === 465 ? 'ssl' : 'tls');
  if ($host === '') throw new \RuntimeException('не указан host');
  $ctx = stream_context_create(['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]]);
  $fp = @stream_socket_client(($secure === 'ssl' ? 'ssl://' : 'tcp://') . "$host:$port", $errno, $errstr, 15, STREAM_CLIENT_CONNECT, $ctx);
  if (!$fp) throw new \RuntimeException("нет соединения с $host:$port ($errstr)");
  stream_set_timeout($fp, 15);
  $read = function() use ($fp): string {
    $all = '';
    while (($line = fgets($fp, 1024)) !== false){ $all .= $line; if (strlen($line) < 4 || $line[3] !== '-') break; }
    return $all;
  };
  $cmd = function(?string $line, int $expect) use ($fp, $read): string {
    if ($line !== null) fwrite($fp, $line . "\r\n");
    $r = $read();
    if ((int)substr($r, 0, 3) !== $expect) throw new \RuntimeException('сервер ответил: ' . trim(explode("\n", $r)[0]));
    return $r;
  };
  $me = gethostname() ?: 'localhost';
  $cmd(null, 220);
  $cmd("EHLO $me", 250);
  if ($secure === 'tls'){
    $cmd('STARTTLS', 220);
    if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new \RuntimeException('не удалось включить шифрование');
    $cmd("EHLO $me", 250);
  }
  if (!empty($c['user'])){
    $cmd('AUTH LOGIN', 334);
    $cmd(base64_encode((string)$c['user']), 334);
    $cmd(base64_encode((string)($c['password'] ?? '')), 235);
  }
  $cmd("MAIL FROM:<$from>", 250);
  $cmd("RCPT TO:<$to>", 250);
  $cmd('DATA', 354);
  $data = preg_replace('/^\./m', '..', $message);   // строки с точкой в начале удваиваем (правило SMTP)
  $cmd($data . "\r\n.", 250);
  fwrite($fp, "QUIT\r\n");
  fclose($fp);
}

// ---------- тексты писем ----------
const ROLE_TITLES = ['owner' => 'владелец', 'admin' => 'администратор', 'teacher' => 'репетитор'];
function org_name(string $orgId): string { return (string)(one('SELECT name FROM orgs WHERE id = ?', [$orgId])['name'] ?? 'English Quest'); }
function mail_user_link(array $u, string $purpose): ?string {
  if (!$u['email']) return 'У этого человека не указана почта.';
  $link = reset_link(issue_reset('user', $u['id'], $purpose));
  $org = org_name($u['org_id']);
  $text = $purpose === 'invite'
    ? "Здравствуйте, {$u['name']}!\n\nВас добавили в English Quest ({$org}) — роль: " . (ROLE_TITLES[$u['role']] ?? $u['role']) . ".\n\nЧтобы задать пароль, откройте ссылку (действует 7 дней):\n$link\n\nПотом входите на " . app_url() . "admin/ — почта {$u['email']} и ваш пароль.\n\nЕсли вы не ждали этого письма, просто удалите его."
    : "Здравствуйте, {$u['name']}!\n\nЧтобы задать новый пароль для English Quest, откройте ссылку (действует 1 час):\n$link\n\nЕсли вы не просили сменить пароль, ничего не делайте — старый пароль продолжит работать.";
  return send_mail($u['email'], $purpose === 'invite' ? 'Приглашение в English Quest' : 'Новый пароль для English Quest', $text);
}
// Ученикам — одно письмо на почту родителя (у братьев и сестёр она может быть общей)
function mail_student_links(string $email, array $students, string $purpose): ?string {
  $parts = [];
  foreach ($students as $s){
    $link = reset_link(issue_reset('student', $s['id'], $purpose));
    $parts[] = "Ученик: {$s['name']}\nЛогин: {$s['login']}\nЗадать пароль: $link";
  }
  $org = org_name($students[0]['org_id']);
  $where = app_url() . ' → внизу «Для репетитора и родителей» → «Сервер учителя» → «Вход по логину»';
  $text = $purpose === 'invite'
    ? "Здравствуйте!\n\nДля вашего ребёнка создан вход в English Quest ({$org}) — игровой тренажёр английского.\n\n" . implode("\n\n", $parts) . "\n\nСсылка действует 7 дней. Задав пароль, войдите на устройстве ребёнка: $where. Прогресс будет сохраняться, и его увидит репетитор.\n\nЕсли вы не ждали этого письма, просто удалите его."
    : "Здравствуйте!\n\nСсылки, чтобы задать новый пароль в English Quest (каждая действует 1 час):\n\n" . implode("\n\n", $parts) . "\n\nЕсли вы не просили сменить пароль, ничего не делайте — старый продолжит работать.";
  return send_mail($email, $purpose === 'invite' ? 'Вход в English Quest для ребёнка' : 'Новый пароль для English Quest', $text);
}

// Выдать доступ: 'invite' — письмо со ссылкой; 'temp' — временный пароль (показывается один раз);
// 'reset' — письмо «задать новый пароль»; 'code' — только код входа (для взрослых, как раньше).
function grant_user_access(array $u, string $mode): array {
  if ($mode === 'temp'){
    $p = temp_password();
    q('UPDATE users SET pass_hash = ?, must_change = 1 WHERE id = ?', [hash_password($p), $u['id']]);
    return ['tempPassword' => $p];
  }
  if ($mode === 'invite' || $mode === 'reset'){
    $err = mail_user_link($u, $mode);
    return $err ? ['mailError' => $err] : ['mailed' => $u['email']];
  }
  if ($mode === 'code') return ['login' => issue_code('login', $u['id'])];
  throw new HttpError(400, 'mode', 'Неизвестный способ выдачи доступа.');
}
function grant_student_access(array $s, string $mode): array {
  if ($mode === 'temp'){
    if (!$s['login']) throw new HttpError(400, 'login', 'Сначала задайте ученику логин.');
    $p = temp_password();
    q('UPDATE students SET pass_hash = ? WHERE id = ?', [hash_password($p), $s['id']]);
    return ['tempPassword' => $p];
  }
  if ($mode === 'invite' || $mode === 'reset'){
    if (!$s['login']) throw new HttpError(400, 'login', 'Сначала задайте ученику логин.');
    if (!$s['email']) throw new HttpError(400, 'email', 'Сначала укажите почту родителя.');
    $err = mail_student_links($s['email'], [$s], $mode);
    return $err ? ['mailError' => $err] : ['mailed' => $s['email']];
  }
  if ($mode === 'none') return [];
  throw new HttpError(400, 'mode', 'Неизвестный способ выдачи доступа.');
}

// ---------- маршруты ----------
function auth_routes(): array {
  return [
    // вход ученика по логину и паролю — выдаёт ключ устройства, как подключение по коду
    ['POST', '#^/student/login$#', function(){
      $ip = check_fails();
      $login = strtolower(trim((string)(body()['login'] ?? '')));
      $s = $login !== '' ? one('SELECT * FROM students WHERE login = ?', [$login]) : null;
      if (!verify_password($s['pass_hash'] ?? null, (string)(body()['password'] ?? ''))){
        q('INSERT INTO fails (ip, at) VALUES (?, ?)', [$ip, now()]);
        throw new HttpError(400, 'bad_login', 'Логин или пароль не подошли.');
      }
      $t = issue_token('device', $s['id'], clean_name(body()['label'] ?? '', 60));
      return ['token' => $t['token'], 'deviceId' => $t['id'], 'student' => student_public($s)];
    }],

    // «Забыли пароль?» — для взрослых и учеников; ответ одинаковый, есть такая почта или нет
    ['POST', '#^/password/forgot$#', function(){
      $ip = check_fails();
      q('INSERT INTO fails (ip, at) VALUES (?, ?)', [$ip, now()]);   // считается как попытка — чтобы не рассылать письма без конца
      $email = norm_email(body()['email'] ?? '');
      $u = one('SELECT * FROM users WHERE email = ?', [$email]);
      if ($u && recent_resets($u['id']) < RESETS_PER_HOUR) mail_user_link($u, 'reset');
      $kids = array_values(array_filter(all('SELECT * FROM students WHERE email = ? AND login IS NOT NULL ORDER BY name', [$email]), fn($s) => recent_resets($s['id']) < RESETS_PER_HOUR));
      if ($kids) mail_student_links($email, $kids, 'reset');
      return ['ok' => true, 'message' => 'Если такая почта есть в English Quest, на неё придёт письмо со ссылкой. Проверьте и папку «Спам».'];
    }],
    // что за ссылка: кому задаём пароль
    ['GET', '#^/password/reset/([0-9a-f]{64})$#', function($token){
      $r = find_reset($token);
      if ($r['kind'] === 'user'){
        $u = one('SELECT * FROM users WHERE id = ?', [$r['subject']]);
        if (!$u) throw new HttpError(400, 'bad_link', 'Ссылка устарела.');
        return ['kind' => 'user', 'purpose' => $r['purpose'], 'name' => $u['name'], 'email' => $u['email'], 'minLength' => MIN_PASSWORD_ADULT];
      }
      $s = one('SELECT * FROM students WHERE id = ?', [$r['subject']]);
      if (!$s) throw new HttpError(400, 'bad_link', 'Ссылка устарела.');
      return ['kind' => 'student', 'purpose' => $r['purpose'], 'name' => $s['name'], 'login' => $s['login'], 'minLength' => MIN_PASSWORD_STUDENT, 'needsConsent' => !$s['consent_at']];
    }],
    ['POST', '#^/password/reset$#', function(){
      $r = find_reset(body()['token'] ?? '');
      if ($r['kind'] === 'user'){
        $p = check_password(body()['password'] ?? '', MIN_PASSWORD_ADULT);
        q('UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?', [hash_password($p), $r['subject']]);
        q('DELETE FROM resets WHERE subject = ?', [$r['subject']]);
        $u = one('SELECT * FROM users WHERE id = ?', [$r['subject']]);
        $t = issue_token('user', $u['id'], clean_name(body()['label'] ?? '', 60));
        return ['kind' => 'user', 'token' => $t['token'], 'user' => user_out($u)];
      }
      $s = one('SELECT * FROM students WHERE id = ?', [$r['subject']]);
      if (!$s['consent_at'] && empty(body()['consent'])) throw new HttpError(400, 'consent', 'Нужно согласие родителя на обработку данных ребёнка.');
      $p = check_password(body()['password'] ?? '', MIN_PASSWORD_STUDENT);
      q('UPDATE students SET pass_hash = ?, consent_at = COALESCE(consent_at, ?) WHERE id = ?', [hash_password($p), now(), $s['id']]);
      q('DELETE FROM resets WHERE subject = ?', [$s['id']]);
      return ['kind' => 'student', 'name' => $s['name'], 'login' => $s['login']];
    }],

    // свой пароль и почта
    ['POST', '#^/me/password$#', function(){
      $u = need_user();
      if (!$u['must_change'] && $u['pass_hash'] && !verify_password($u['pass_hash'], (string)(body()['current'] ?? ''))){
        throw new HttpError(400, 'current', 'Текущий пароль не подошёл.');
      }
      $p = check_password(body()['password'] ?? '', MIN_PASSWORD_ADULT);
      q('UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?', [hash_password($p), $u['id']]);
      return ['ok' => true];
    }],
    ['POST', '#^/me/email$#', function(){
      $u = need_user();
      if ($u['pass_hash'] && !verify_password($u['pass_hash'], (string)(body()['current'] ?? ''))) throw new HttpError(400, 'current', 'Текущий пароль не подошёл.');
      $email = norm_email(body()['email'] ?? '');
      if (email_taken($email, $u['id'])) throw new HttpError(400, 'email', 'Эта почта уже занята.');
      q('UPDATE users SET email = ? WHERE id = ?', [$email, $u['id']]);
      return ['user' => user_out(one('SELECT * FROM users WHERE id = ?', [$u['id']]))];
    }],

    // администратор: выдать доступ взрослому или ученику (письмо или временный пароль)
    ['POST', '#^/users/(u[0-9a-f]{16})/password$#', function($id){
      $u = need_owner();
      $t = managed_user($u, $id, false);
      if ($t['id'] === $u['id']) throw new HttpError(400, 'self', 'Свой пароль меняйте в разделе «Мои входы».');
      return grant_user_access($t, (string)(body()['mode'] ?? ''));
    }],
    ['POST', '#^/students/(s[0-9a-f]{16})/password$#', function($id){
      $s = student_for(need_user(), $id);
      return grant_student_access($s, (string)(body()['mode'] ?? ''));
    }],
  ];
}
