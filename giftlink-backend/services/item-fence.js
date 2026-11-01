const { ObjectId } = require('mongodb');
const { InventoryError } = require('./inventory-error');

// Independent (listingSchemaVersion 2) items have no parent plan. Every write
// that must not interleave with another write to the same item (draft edits,
// photo operations, pickup requests, decisions, scheduling and messages)
// compare-and-increments the item's own coordinationRevision inside one
// snapshot/majority transaction. Concurrent writers conflict and the driver's
// bounded withTransaction retry re-reads current state; nothing is lost.
const independentItem = (ownerId, itemId) => ({ _id: itemId, ownerId, listingSchemaVersion: 2, planId: { $exists: false } });
async function independentItemTransaction(db, ownerId, itemId, operation, { missing, changed } = {}) {
    if (!(ownerId instanceof ObjectId) || !(itemId instanceof ObjectId)) throw missing();
    const session = db.client.startSession();
    try {
        return await session.withTransaction(async () => {
            const filter = independentItem(ownerId, itemId);
            const item = await db.collection('items').findOne(filter, { session });
            if (!item || !Number.isSafeInteger(item.coordinationRevision) || item.coordinationRevision < 0 || item.coordinationRevision >= Number.MAX_SAFE_INTEGER) throw missing();
            const fenced = await db.collection('items').updateOne(Object.assign({}, filter, { coordinationRevision: item.coordinationRevision }),
                { $inc: { coordinationRevision: 1 } }, { session });
            if (fenced.modifiedCount !== 1) throw changed();
            return operation(session);
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
    } catch (error) {
        if (error.code === 20) throw new InventoryError(503, 'TRANSACTIONS_REQUIRED', 'Inventory updates require a MongoDB replica set. Check the documented local setup.');
        throw error;
    } finally { await session.endSession(); }
}
// The database's own clock, read in the caller's session when one is given.
// V2 timestamps (confirmation, publication, expiry) are database times, so
// comparing them against an app server clock would admit skew in either direction.
async function databaseNow(db, session) {
    const row = await db.aggregate([{ $documents: [{}] }, { $project: { _id: 0, now: '$$NOW' } }], session ? { session } : {}).next();
    if (!row || !(row.now instanceof Date) || !Number.isFinite(row.now.getTime())) throw new Error('Database clock unavailable');
    return row.now;
}
module.exports = { independentItem, independentItemTransaction, databaseNow };
