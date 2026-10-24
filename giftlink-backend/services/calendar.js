const todayUTC = (now = new Date()) => now.toISOString().slice(0, 10);
function isCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00.000Z');
    return !Number.isNaN(date.getTime()) && todayUTC(date) === value;
}
module.exports = { todayUTC, isCalendarDate };
