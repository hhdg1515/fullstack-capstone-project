const { expectedEmails, runPattern } = require('./policy.cjs');
async function scopedRecords(db, runId, session) {
  const options = session ? { session } : {};
  if (!runPattern.test(runId)) throw Error('Invalid run ID');
  const users = await db.collection('users').find({ email: { $in: expectedEmails(runId) } }, options).toArray();
  if (users.length > 4 || users.some(u => u.firstName !== 'E2E' || u.lastName !== runId)) throw Error('Synthetic account ownership check failed');
  const ids = users.map(u => u._id);
  const plans = await db.collection('moveOutPlans').find({ ownerId: { $in: ids } }, options).toArray();
  const items = await db.collection('items').find({ ownerId: { $in: ids } }, options).toArray();
  const requests = await db.collection('pickupRequests').find({ $or: [{ giverId: { $in: ids } }, { receiverId: { $in: ids } }] }, options).toArray();
  const sessions = await db.collection('sessions').find({ userId: { $in: ids } }, options).toArray();
  const owns = value => ids.some(id => id.equals(value));
  if (plans.length > 2 || items.length > 6 || requests.length > 10 || sessions.length > 16 ||
      plans.some(p => !p.title.startsWith('E2E ' + runId)) || items.some(i => !i.name.startsWith('E2E ' + runId)) ||
      requests.some(r => !owns(r.giverId) || !owns(r.receiverId))) throw Error('Fixture bounds/ownership changed; refuse automatic cleanup and review securely');
  return { users, plans, items, requests, sessions };
}
const counts = records => Object.fromEntries(Object.entries(records).map(([name, values]) => [name, values.length]));
async function cleanup(db, runId, apply = false) {
  let records = await scopedRecords(db, runId); if (!apply) return counts(records);
  const session = db.client.startSession();
  try {
    await session.withTransaction(async () => {
      // Every predicate includes explicit owned IDs; never clear a collection or gifts.
      records = await scopedRecords(db, runId, session);
      for (const [name, collection] of [['requests', 'pickupRequests'], ['items', 'items'], ['plans', 'moveOutPlans'], ['sessions', 'sessions'], ['users', 'users']]) {
        const ids = records[name].map(row => row._id);
        if (ids.length) await db.collection(collection).deleteMany({ _id: { $in: ids } }, { session });
      }
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
  } finally { await session.endSession(); }
  return counts(records);
}
module.exports = { cleanup, scopedRecords };
