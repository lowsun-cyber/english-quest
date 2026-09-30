<?php
// Первая установка и служебные команды (запускать по SSH на хостинге):
//   php bin/setup.php init "Название организации" "Ваше имя"  — создать таблицы, организацию и владельца
//   php bin/setup.php code                                  — новый код входа для владельца
//   php bin/setup.php users                                 — список взрослых
declare(strict_types=1);
require dirname(__DIR__) . '/src/app.php';

use function EQ\{db, migrate, one, all, q, issue_code, clean_name, owner_exists, create_owner};

if (PHP_SAPI !== 'cli') exit("Только из командной строки\n");
$cmd = $argv[1] ?? '';
$pdo = db();
migrate($pdo);

$printCode = function(array $c){
  echo "Код входа: {$c['code']} (действует до " . date('d.m.Y H:i', intdiv($c['expires'], 1000)) . ")\n";
  echo "Введите его в админ-панели: адрес сайта/admin/ (например, https://quest.logiqa.ru/admin/).\n";
};

if ($cmd === 'init'){
  if (owner_exists()) exit("Владелец уже создан. Новый код входа: php bin/setup.php code\n");
  $orgName = clean_name($argv[2] ?? 'Мои ученики', 100);
  $name = clean_name($argv[3] ?? 'Владелец', 60);
  $owner = create_owner($orgName, $name);
  echo "Готово: организация «{$orgName}», владелец «{$name}».\n";
  $printCode(issue_code('login', $owner['id']));
} elseif ($cmd === 'code'){
  $u = one("SELECT * FROM users WHERE role = 'owner' ORDER BY created");
  if (!$u) exit("Сначала: php bin/setup.php init\n");
  $printCode(issue_code('login', $u['id']));
} elseif ($cmd === 'users'){
  foreach (all('SELECT u.*, o.name AS org FROM users u JOIN orgs o ON o.id = u.org_id ORDER BY u.created') as $u) echo "{$u['id']}  {$u['role']}  {$u['name']}  ({$u['org']})\n";
} else {
  echo "Команды: init \"Организация\" \"Имя\" | code | users\n";
  exit(1);
}
