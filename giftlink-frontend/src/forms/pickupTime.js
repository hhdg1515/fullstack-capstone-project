// Calendar hints only. The server resolves actual instants and rejects DST gaps/folds.
export function validPickupTimeZone(zone) {
  if (typeof zone !== 'string' || zone.length > 100 || (!/^(?:[A-Za-z0-9_+-]+\/)+[A-Za-z0-9_+-]+$/.test(zone) && zone !== 'UTC')) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; }
}
export function pickupMinimum(zone, now = new Date()) {
  if (!validPickupTimeZone(zone) || !Number.isFinite(now.getTime())) return undefined;
  const instant = new Date(Math.floor(now.getTime() / 60000) * 60000 + 60000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day + 'T' + parts.hour + ':' + parts.minute;
}
export function pastPickupSelection(value, zone) {
  const minimum = pickupMinimum(zone);
  return Boolean(value && minimum && value < minimum);
}
