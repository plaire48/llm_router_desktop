export function relativeNotificationTime(value, now = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const seconds = Math.max(0, Math.floor((now-time)/1000));
  if (seconds < 60) return '방금 전';
  if (seconds < 3600) return `${Math.floor(seconds/60)}분 전`;
  if (seconds < 86400) return `${Math.floor(seconds/3600)}시간 전`;
  return `${Math.floor(seconds/86400)}일 전`;
}

export function notificationDateGroup(value, now = Date.now()) {
  const date = new Date(value), today = new Date(now);
  if (!Number.isFinite(date.getTime())) return '이전';
  // Calendar days, not elapsed 24-hour periods (including DST boundaries).
  const day = d => Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());
  const elapsed = Math.round((day(today)-day(date))/86400000);
  return elapsed <= 0 ? '오늘' : elapsed === 1 ? '어제' : elapsed < 7 ? '최근 7일' : '이전';
}
