<?php
// Точка входа API English Quest. Код (src/) и настройки (config.php) лежат вне веб-папки:
//  • рядом с ней — как в репозитории (server/public → server/src);
//  • или в папке eq-server где-то выше по дереву (ищем на несколько уровней вверх), например:
//      ~/quest/api/index.php  →  ~/eq-server/src/app.php
// Файл нарочно написан без новых возможностей PHP: он запускается даже на PHP 5
// и честно отвечает, в чём дело, вместо пустой ошибки 500.
function eq_fail($error, $message){
  header('HTTP/1.1 500 Internal Server Error');
  header('Content-Type: application/json; charset=utf-8');
  echo '{"error":"' . $error . '","message":"' . addslashes($message) . '"}';
  exit;
}
if (version_compare(PHP_VERSION, '8.1.0', '<')) eq_fail('old_php', 'Нужен PHP 8.1 или новее, сейчас ' . PHP_VERSION . '. Выберите PHP 8.3 для сайта quest.logiqa.ru в панели хостинга.');
if (!extension_loaded('pdo_mysql') && !extension_loaded('pdo_pgsql') && !extension_loaded('pdo_sqlite')) eq_fail('no_pdo', 'В PHP не включено расширение PDO для базы данных (pdo_mysql).');
$here = dirname(dirname(__FILE__));
$root = is_file($here . '/src/app.php') ? $here : null;
for ($d = $here, $i = 0; !$root && $i < 6; $i++, $d = dirname($d)){
  if (@is_file($d . '/eq-server/src/app.php')) $root = $d . '/eq-server';
}
if (!$root) eq_fail('no_server', 'Не найдена папка eq-server с кодом сервера. Положите её выше веб-папки сайта (см. server/README.md). Искали, начиная с ' . $here);
require $root . '/src/app.php';
call_user_func('EQ\\run');
