import { pickupMinimum, validPickupTimeZone } from './pickupTime';
test.each([
  ['America/Los_Angeles', '2030-01-01T00:00:30Z', '2029-12-31T16:01'],
  ['Asia/Kolkata', '2030-01-01T00:00:30Z', '2030-01-01T05:31'],
  ['UTC', '2030-01-01T23:59:59Z', '2030-01-02T00:00'],
  ['America/Los_Angeles', '2030-03-10T09:59:30Z', '2030-03-10T03:00'],
  ['America/Los_Angeles', '2030-11-03T08:59:30Z', '2030-11-03T01:00'],
])('next-minute minimum uses explicit %s across boundaries', (zone, now, expected) => {
  expect(pickupMinimum(zone, new Date(now))).toBe(expected);
});
test('missing, invalid and offset zones never fall back to the browser timezone', () => {
  for (const zone of ['', undefined, '+05:30', 'Not/A_Zone']) {
    expect(validPickupTimeZone(zone)).toBe(false); expect(pickupMinimum(zone)).toBeUndefined();
  }
  expect(validPickupTimeZone('UTC')).toBe(true);
});
