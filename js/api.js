// English Quest — Запросы к серверу (общие для приложения и кабинета учителя).
import { API_BASE } from './config.js';

export class ApiError extends Error {
  constructor(message, status, data){ super(message); this.status = status; this.data = data; }
}

// body есть — POST, нет — GET (сервер понимает только их, см. server/src/app.php)
export async function api(path, { token, body, timeout = 15000 } = {}){
  if (!API_BASE) throw new ApiError('Сервер не настроен.', 0, {});
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-EQ-Token': token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
      cache: 'no-store',
    });
  } catch (e) {
    throw new ApiError('Нет связи с сервером. Проверьте интернет.', 0, {});
  } finally { clearTimeout(timer); }
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new ApiError(data.message || `Ошибка сервера (${res.status})`, res.status, data);
  return data;
}

// Короткое имя устройства для списка «Устройства ученика»
export function deviceLabel(){
  const ua = navigator.userAgent;
  const kind = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android-телефон' : 'Android-планшет')
    : /Windows/.test(ua) ? 'Компьютер Windows' : /Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Компьютер Linux' : 'Устройство';
  return `${kind} · ${new Date().toLocaleDateString('ru-RU')}`;
}
