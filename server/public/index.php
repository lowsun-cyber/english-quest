<?php
// Точка входа API English Quest. Код (src/) и настройки (config.php) лежат вне веб-папки:
//  • рядом с ней — как в репозитории (server/public → server/src);
//  • или в папке eq-server рядом с public_html — когда API живёт в подпапке сайта:
//      <папка сайта>/public_html/api/index.php  →  <папка сайта>/eq-server/src/app.php
$root = is_file(dirname(__DIR__) . '/src/app.php') ? dirname(__DIR__) : dirname(__DIR__, 2) . '/eq-server';
require $root . '/src/app.php';
EQ\run();
