<?php
// Скопируйте в config.php (рядом с этим файлом, НЕ в папку public) и впишите свои значения.
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
  'timezone' => 'Europe/Moscow',
  'debug' => false,
];
