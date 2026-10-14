<?php
// English Quest — командная игра по сети (docs/design-v2/CONCEPT.md, «Командный add-on»): 2–4 ученика с разных
// устройств вместе против квеста — лечат пациента или побеждают босса. Комната — по короткому коду; каждый
// отвечает на свои задания своего уровня (подбирает устройство), на сервер уходит только «верно / неверно».
// Сервер двигает общую шкалу, ведёт общий запас подсказок и ленту событий. Устройства опрашивают комнату раз
// в 1–2 секунды (на обычном хостинге нет постоянных соединений). Комната живёт 2 часа после последнего действия.
// Играют ученики с ключом устройства (вход учителя или ключ семьи); в комнате видны прозвище, аватар и герой.
declare(strict_types=1);

namespace EQ;

use PDO;

const ROOM_MAX = 4;                      // игроков в комнате
const ROOM_MIN = 2;                      // начать можно вдвоём
const ROOM_PER_PLAYER = 6;               // верных ответов на игрока — столько очков у общей шкалы
const ROOM_HINTS = 3;                    // общий запас подсказок команды
const ROOM_TTL = 2 * 3600 * 1000;        // комната живёт 2 часа после последнего действия
const ROOM_ONLINE = 20 * 1000;           // игрок «на связи», если спрашивал комнату за последние 20 секунд
const ROOM_EVENTS = 12;                  // событий в ленте
const ROOM_MODES = ['patient', 'boss'];
const ROOM_CODE_LEN = 4;                 // K7M2 — из того же алфавита, что коды подключения

// Схема 4: комнаты и игроки в них
function migrate_v4(PDO $pdo, string $tail): void {
  $pdo->exec("CREATE TABLE IF NOT EXISTS rooms (id VARCHAR(24) PRIMARY KEY, code VARCHAR(8) NOT NULL, host VARCHAR(24) NOT NULL, mode VARCHAR(8) NOT NULL,
    status VARCHAR(8) NOT NULL, goal INTEGER NOT NULL, progress INTEGER NOT NULL, hints INTEGER NOT NULL, events TEXT NOT NULL,
    version INTEGER NOT NULL, created BIGINT NOT NULL, updated BIGINT NOT NULL)$tail");
  // ok_n / bad_n: «right» в MySQL — служебное слово
  $pdo->exec("CREATE TABLE IF NOT EXISTS room_players (room_id VARCHAR(24) NOT NULL, student_id VARCHAR(24) NOT NULL, name VARCHAR(40) NOT NULL,
    avatar VARCHAR(16) NOT NULL, hero VARCHAR(16), joined BIGINT NOT NULL, seen BIGINT NOT NULL, ok_n INTEGER NOT NULL, bad_n INTEGER NOT NULL,
    PRIMARY KEY (room_id, student_id))$tail");
  foreach (['CREATE UNIQUE INDEX rooms_code ON rooms (code)', 'CREATE INDEX rooms_updated ON rooms (updated)', 'CREATE INDEX room_players_student ON room_players (student_id)'] as $sql) try_exec($pdo, $sql);
}

function new_room_code(): string {
  $s = '';
  for ($i = 0; $i < ROOM_CODE_LEN; $i++) $s .= CODE_ALPHABET[random_int(0, strlen(CODE_ALPHABET) - 1)];
  return $s;
}
// Старые комнаты — прочь (вызывается при создании комнаты: дёшево и без планировщика)
function drop_old_rooms(): void {
  $old = all('SELECT id FROM rooms WHERE updated < ?', [now() - ROOM_TTL]);
  foreach ($old as $r){ q('DELETE FROM room_players WHERE room_id = ?', [$r['id']]); q('DELETE FROM rooms WHERE id = ?', [$r['id']]); }
}
function room_of(string $id): array {
  $r = one('SELECT * FROM rooms WHERE id = ?', [$id]);
  if (!$r || (int)$r['updated'] < now() - ROOM_TTL) throw new HttpError(404, 'no_room', 'Комната закрылась. Создайте новую.');
  return $r;
}
function room_player(array $room, string $sid): array {
  $p = one('SELECT * FROM room_players WHERE room_id = ? AND student_id = ?', [$room['id'], $sid]);
  if (!$p) throw new HttpError(403, 'not_in_room', 'Вы не в этой комнате.');
  return $p;
}
// Изменить комнату с проверкой версии: два ответа в одну и ту же миллисекунду не затрут друг друга
function room_change(string $id, callable $fn): array {
  for ($try = 0; $try < 8; $try++){
    $r = room_of($id);
    $r['events'] = json_decode($r['events'], true) ?: [];
    $next = $fn($r);
    if ($next === null) return $r;
    $next['events'] = array_slice($next['events'], -ROOM_EVENTS);
    $n = q('UPDATE rooms SET host = ?, status = ?, goal = ?, progress = ?, hints = ?, events = ?, version = ?, updated = ? WHERE id = ? AND version = ?',
      [$next['host'], $next['status'], $next['goal'], $next['progress'], $next['hints'], json_encode($next['events'], JSON_UNESCAPED_UNICODE), (int)$r['version'] + 1, now(), $id, (int)$r['version']])->rowCount();
    if ($n === 1) return $next;
    usleep(20000);
  }
  throw new HttpError(409, 'busy', 'Комната занята, повторите.');
}
function room_event(array $r, string $kind, string $sid): array {
  $seq = $r['events'] ? (int)end($r['events'])['n'] + 1 : 1;
  $r['events'][] = ['n' => $seq, 'k' => $kind, 's' => $sid, 'at' => now()];
  return $r;
}
// Что видит устройство: код, режим, шкала, игроки (прозвище, аватар, герой, счёт, на связи) и лента событий
function room_out(string $id, string $me): array {
  $r = room_of($id);
  $players = all('SELECT * FROM room_players WHERE room_id = ? ORDER BY joined', [$id]);
  return ['id' => $r['id'], 'code' => $r['code'], 'mode' => $r['mode'], 'status' => $r['status'], 'goal' => (int)$r['goal'], 'progress' => (int)$r['progress'],
    'hints' => (int)$r['hints'], 'version' => (int)$r['version'], 'host' => $r['host'], 'me' => $me, 'min' => ROOM_MIN, 'max' => ROOM_MAX,
    'players' => array_map(fn($p) => ['id' => $p['student_id'], 'name' => $p['name'], 'avatar' => $p['avatar'], 'hero' => $p['hero'],
      'ok' => (int)$p['ok_n'], 'bad' => (int)$p['bad_n'], 'online' => (int)$p['seen'] > now() - ROOM_ONLINE], $players),
    'events' => json_decode($r['events'], true) ?: []];
}
function room_join(array $room, array $s): void {
  $have = one('SELECT student_id FROM room_players WHERE room_id = ? AND student_id = ?', [$room['id'], $s['id']]);
  if ($have){ q('UPDATE room_players SET seen = ? WHERE room_id = ? AND student_id = ?', [now(), $room['id'], $s['id']]); return; }   // вернулся по тому же коду
  if ($room['status'] !== 'lobby') throw new HttpError(409, 'started', 'Команда уже играет. Дождитесь конца квеста.');
  if ((int)one('SELECT COUNT(*) AS n FROM room_players WHERE room_id = ?', [$room['id']])['n'] >= ROOM_MAX) throw new HttpError(409, 'full', 'В комнате уже ' . ROOM_MAX . ' игрока.');
  q('INSERT INTO room_players (room_id, student_id, name, avatar, hero, joined, seen, ok_n, bad_n) VALUES (?, ?, ?, ?, NULL, ?, ?, 0, 0)',
    [$room['id'], $s['id'], $s['name'], $s['avatar'], now(), now()]);
  room_change($room['id'], fn($r) => room_event($r, 'join', $s['id']));
}

function room_routes(): array {
  return [
    // создать комнату: режим «пациент» или «босс»; создатель сразу в ней
    ['POST', '#^/rooms$#', function(){
      $s = need_device()['student'];
      $mode = in_array(body()['mode'] ?? '', ROOM_MODES, true) ? body()['mode'] : 'patient';
      drop_old_rooms();
      for ($try = 0; $try < 8; $try++){
        $id = new_id('r'); $code = new_room_code();
        try {
          q("INSERT INTO rooms (id, code, host, mode, status, goal, progress, hints, events, version, created, updated) VALUES (?, ?, ?, ?, 'lobby', 0, 0, ?, '[]', 0, ?, ?)",
            [$id, $code, $s['id'], $mode, ROOM_HINTS, now(), now()]);
          room_join(room_of($id), $s);
          return room_out($id, $s['id']);
        } catch (\PDOException $e){ /* такой код занят — другой */ }
      }
      throw new HttpError(500, 'room', 'Не получилось создать комнату. Попробуйте ещё раз.');
    }],
    // войти по коду (регистр и пробелы не важны); неверные коды считаются, как при подключении устройства
    ['POST', '#^/rooms/join$#', function(){
      $s = need_device()['student'];
      $ip = check_fails();
      $code = norm_code((string)(body()['code'] ?? ''));
      $r = strlen($code) === ROOM_CODE_LEN ? one('SELECT * FROM rooms WHERE code = ? AND updated >= ?', [$code, now() - ROOM_TTL]) : null;
      if (!$r){
        q('INSERT INTO fails (ip, at) VALUES (?, ?)', [$ip, now()]);
        throw new HttpError(404, 'no_room', 'Комнаты с таким кодом нет. Проверьте буквы и цифры.');
      }
      room_join($r, $s);
      return room_out($r['id'], $s['id']);
    }],
    // состояние комнаты (опрос раз в 1–2 с); заодно отмечает, что игрок на связи
    ['GET', '#^/rooms/(r[0-9a-f]{16})$#', function($id){
      $s = need_device()['student'];
      room_player(room_of($id), $s['id']);
      q('UPDATE room_players SET seen = ? WHERE room_id = ? AND student_id = ?', [now(), $id, $s['id']]);
      return room_out($id, $s['id']);
    }],
    // герой игрока: в команде герои не повторяются (список героев — данными в приложении)
    ['POST', '#^/rooms/(r[0-9a-f]{16})/hero$#', function($id){
      $s = need_device()['student'];
      $room = room_of($id);
      room_player($room, $s['id']);
      $hero = (string)(body()['hero'] ?? '');
      if (!preg_match('/^[a-z]{2,16}$/', $hero)) throw new HttpError(400, 'hero', 'Неизвестный герой.');
      if ($room['status'] !== 'lobby') throw new HttpError(409, 'started', 'Квест уже идёт.');
      if (one('SELECT student_id FROM room_players WHERE room_id = ? AND hero = ? AND student_id <> ?', [$id, $hero, $s['id']])) throw new HttpError(409, 'hero_taken', 'Этого героя уже выбрал другой игрок.');
      q('UPDATE room_players SET hero = ? WHERE room_id = ? AND student_id = ?', [$hero, $id, $s['id']]);
      room_change($id, fn($r) => $r);   // версия +1 — остальные увидят выбор
      return room_out($id, $s['id']);
    }],
    // начать: только создатель, игроков 2–4, у всех выбран герой; шкала — по числу игроков
    ['POST', '#^/rooms/(r[0-9a-f]{16})/start$#', function($id){
      $s = need_device()['student'];
      $room = room_of($id);
      if ($room['host'] !== $s['id']) throw new HttpError(403, 'not_host', 'Начинает тот, кто создал комнату.');
      $players = all('SELECT hero FROM room_players WHERE room_id = ?', [$id]);
      if (count($players) < ROOM_MIN) throw new HttpError(409, 'few', 'Нужно хотя бы ' . ROOM_MIN . ' игрока.');
      if (array_filter($players, fn($p) => !$p['hero'])) throw new HttpError(409, 'no_hero', 'Не все выбрали героя.');
      room_change($id, function($r) use ($s, $players){
        if ($r['status'] !== 'lobby') return null;
        $r['status'] = 'play'; $r['goal'] = ROOM_PER_PLAYER * count($players); $r['progress'] = 0; $r['hints'] = ROOM_HINTS;
        return room_event($r, 'start', $s['id']);
      });
      return room_out($id, $s['id']);
    }],
    // ответ: верный двигает общую шкалу; неверный — только в счёт игрока (ошибки пишет его устройство)
    ['POST', '#^/rooms/(r[0-9a-f]{16})/answer$#', function($id){
      $s = need_device()['student'];
      $room = room_of($id);
      room_player($room, $s['id']);
      $ok = !empty(body()['ok']);
      $counted = false;
      room_change($id, function($r) use ($s, $ok, &$counted){
        if ($r['status'] !== 'play') return null;
        $counted = true;
        if (!$ok) return $r;
        $r['progress'] = min($r['goal'], (int)$r['progress'] + 1);
        $r = room_event($r, 'ok', $s['id']);
        if ($r['progress'] >= $r['goal']){ $r['status'] = 'done'; $r = room_event($r, 'done', $s['id']); }
        return $r;
      });
      if ($counted) q('UPDATE room_players SET ' . ($ok ? 'ok_n = ok_n + 1' : 'bad_n = bad_n + 1') . ', seen = ? WHERE room_id = ? AND student_id = ?', [now(), $id, $s['id']]);
      return room_out($id, $s['id']);
    }],
    // подсказка — из общего запаса команды
    ['POST', '#^/rooms/(r[0-9a-f]{16})/hint$#', function($id){
      $s = need_device()['student'];
      room_player(room_of($id), $s['id']);
      $given = false;
      room_change($id, function($r) use ($s, &$given){
        if ($r['status'] !== 'play' || (int)$r['hints'] < 1) return null;
        $given = true;
        $r['hints'] = (int)$r['hints'] - 1;
        return room_event($r, 'hint', $s['id']);
      });
      if (!$given) throw new HttpError(409, 'no_hints', 'Подсказки команды закончились.');
      return room_out($id, $s['id']);
    }],
    // выйти: в ожидании создатель передаёт комнату следующему; последний закрывает её
    ['POST', '#^/rooms/(r[0-9a-f]{16})/leave$#', function($id){
      $s = need_device()['student'];
      $room = room_of($id);
      q('DELETE FROM room_players WHERE room_id = ? AND student_id = ?', [$id, $s['id']]);
      $left = all('SELECT student_id FROM room_players WHERE room_id = ? ORDER BY joined', [$id]);
      if (!$left){ q('DELETE FROM rooms WHERE id = ?', [$id]); return ['ok' => true]; }
      room_change($id, function($r) use ($s, $left){
        if ($r['host'] === $s['id']) $r['host'] = $left[0]['student_id'];
        return room_event($r, 'leave', $s['id']);
      });
      return ['ok' => true];
    }],
  ];
}
