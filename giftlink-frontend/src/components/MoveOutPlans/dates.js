export const utcToday = () => new Date().toISOString().slice(0, 10);

export function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// A deadline is a calendar date, never an instant shifted into browser time.
export const formatDeadline = value => new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined,
  { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
