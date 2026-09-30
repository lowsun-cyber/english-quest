<?php
// Скопируйте в config.php и впишите свои значения. На хостинге файл лежит в eq-server/ — рядом с public_html, НЕ внутри.
// config.php в git не попадает.
return [
  'db' => [
    // MySQL на хостинге:
    'dsn' => 'mysql:host=localhost;dbname=f1185464_123;charset=utf8mb4',
    'user' => 'Пf1185464_123',
    'password' => '3vr-SdH-RHK-RaN',
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
