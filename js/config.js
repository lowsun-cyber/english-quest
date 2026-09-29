// English Quest — Адрес сервера. Пусто — приложение работает как раньше, только на устройстве.
// Для проверки можно указать другой сервер: localStorage.setItem('eq_api', 'http://127.0.0.1:8766').
const DEFAULT_API = '';
export const API_BASE = (() => {
  try { return (localStorage.getItem('eq_api') || DEFAULT_API).replace(/\/+$/, ''); } catch (e) { return DEFAULT_API; }
})();
export const TEACHER_KEY = 'eq_teacher';   // ключ входа учителя на этом устройстве
