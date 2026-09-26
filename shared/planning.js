export function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error('Ungültiges Datum');
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  if (dateKey(date) !== value || y < 2000 || y > 2200) throw new Error('Ungültiges Datum');
  return date;
}
export function period(granularity, value) {
  const date = parseDate(value);
  if (!['day', 'week', 'month'].includes(granularity)) throw new Error('Ungültiger Zeitraum');
  if (granularity === 'week') date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  if (granularity === 'month') date.setDate(1);
  const start = dateKey(date);
  if (granularity === 'month') date.setMonth(date.getMonth() + 1);
  else date.setDate(date.getDate() + (granularity === 'week' ? 7 : 1));
  return { granularity, start, end: dateKey(date) };
}
export function normalizePlan(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new Error('Ungültige Planung');
  const plan = period(value.granularity, value.start);
  const time = value.time ?? null;
  if (time !== null && (plan.granularity !== 'day' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) throw new Error('Ungültige Uhrzeit');
  const duration = time ? Number(value.duration ?? 30) : null;
  if (time && (!Number.isInteger(duration) || duration < 5 || duration > 480)) throw new Error('Ungültige Dauer');
  return { ...plan, time, duration };
}
export function monthWeeks(value) {
  const first = parseDate(period('week', period('month', value).start).start);
  return Array.from({ length: 6 }, (_, row) => Array.from({ length: 7 }, (_, col) => {
    const date = new Date(first); date.setDate(date.getDate() + row * 7 + col); return dateKey(date);
  }));
}
export function suggestTime(day, busy = [], duration = 30) {
  const start = parseDate(day); start.setHours(9, 0, 0, 0);
  const end = new Date(start); end.setHours(18);
  for (let time = start.getTime(); time + duration * 60000 <= end.getTime(); time += 15 * 60000) {
    if (!busy.some((event) => time < new Date(event.end).getTime() && time + duration * 60000 > new Date(event.start).getTime())) {
      const date = new Date(time); return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
  }
  return null;
}

export function weekNumber(value) {
  const local = parseDate(value);
  const date = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - first) / 86400000) + 1) / 7);
}
