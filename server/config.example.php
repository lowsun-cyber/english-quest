<?php
// Скопируйте в config.php и впишите свои значения. На хостинге файл лежит в eq-server/ — рядом с public_html, НЕ внутри.
// config.php в git не попадает.
return [
  'db' => [
    // MySQL на хостинге:
    'dsn' => 'mysql:host=localhost;dbname=ИМЯ_БАЗЫ;charset=utf8mb4',
    'user' => 'ПОЛЬЗОВАТЕЛЬ_БАЗЫ',
    'password' => 'ПАРОЛЬ_БАЗЫ',
    // PostgreSQL: 'dsn' => 'pgsql:host=localhost;dbname=ИМЯ_БАЗЫ'
    // SQLite (только для проверки): 'dsn' => 'sqlite:' . __DIR__ . '/data/eq.sqlite'
  ],
  // С каких адресов приложение может обращаться к серверу
  'origins' => [
    'https://lowsun-cyber.github.io',
    'https://quest.logiqa.ru',
  ],
  // Любая длинная случайная строка (для обезличивания адресов в защите от подбора кодов)
  'secret' => 'ЗАМЕНИТЕ_НА_СЛУЧАЙНУЮ_СТРОКУ',
  // Ключ первого запуска из админ-панели (не короче 12 символов). Пока владельца нет, по нему в панели
  // создаётся организация и её владелец; после этого ключ больше не действует — строку можно удалить.
  'setup_key' => '',
  // Адрес сайта — для ссылок в письмах («задать пароль»)
  'app_url' => 'https://quest.logiqa.ru/',
  // Письма: приглашения и восстановление пароля. Ящик noreply@… создайте в панели хостинга.
  'mail' => [
    'transport' => 'smtp',               // smtp — через почтовый ящик (надёжнее); mail — функцией PHP; '' — не отправлять
    'host' => 'АДРЕС_SMTP_ИЗ_ПАНЕЛИ',     // SMTP-сервер из настроек почты хостинга
    'port' => 465,                        // 465 — SSL; 587 — STARTTLS
    'user' => 'noreply@logiqa.ru',
    'password' => 'ПАРОЛЬ_ЯЩИКА',
    'from' => 'noreply@logiqa.ru',
    'from_name' => 'English Quest',
  ],
  'timezone' => 'Europe/Moscow',
  'debug' => false,
];
