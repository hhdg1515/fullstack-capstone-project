const { ObjectId } = require('mongodb');
const { assertOperation, integer, validateImageConfig } = require('./item-image-policy');

// Optional media is a separate, bounded read after discovery pagination/counting.
// It never reads storage or changes listing eligibility, totals or cursor values.
function createPublicItemMedia({ connectToDatabase, configuration, visibilityPipeline, initialMatch }) {
    const binding = validateImageConfig(configuration).storageBinding;
    const variant = (image, name) => ({ url: '/api/item-images/' + image._id.toHexString() + '/' + name,
        width: image.variants[name].width, height: image.variants[name].height });
    const photo = (image, detail) => Object.assign({ id: image._id.toHexString(), thumbnail: variant(image, 'thumbnail') },
        detail ? { display: variant(image, 'display') } : {});
    const empty = (detail, availability) => Object.assign({ imageAvailability: availability }, detail ? { images: [] } : { coverImage: null });
    return async function enrich(selected, detail, now) {
        if (!selected.length) return [];
        if (selected.length > 50 || selected.some(row => !(row._id instanceof ObjectId))) throw new Error('Invalid media page bound');
        const fallback = selected.map(() => empty(detail, 'unavailable'));
        try {
            const db = await connectToDatabase();
            const rows = await db.collection('items').aggregate(visibilityPipeline(Object.assign(initialMatch(now.getTime()), {
                _id: { $in: selected.map(row => row._id) }
            }), now.toISOString().slice(0, 10)).concat([
                { $lookup: { from: 'users', localField: 'ownerId', foreignField: '_id', pipeline: [{ $project: { _id: 1 } }, { $limit: 1 }], as: 'mediaOwner' } },
                { $match: { 'mediaOwner.0': { $exists: true } } },
                { $lookup: { from: 'itemImages', let: { item: '$_id' }, pipeline: [
                    { $match: { $expr: { $eq: ['$itemId', '$$item'] }, state: 'ready' } },
                    { $sort: { sortPosition: 1, _id: 1 } }, { $limit: 6 }
                ], as: 'photos' } },
                { $project: { _id: 1, planId: 1, ownerId: 1, imageRevision: 1, photos: 1 } }
            ]), { readConcern: { level: 'snapshot' }, collation: { locale: 'simple' }, maxTimeMS: 5000, allowDiskUse: false }).toArray();
            const byId = new Map(rows.map(row => [row._id.toHexString(), row]));
            return selected.map((original, index) => {
                const row = byId.get(original._id.toHexString());
                try {
                    if (!row || !(row.planId instanceof ObjectId) || !(row.ownerId instanceof ObjectId) ||
                        !row.ownerId.equals(original.ownerId) || !row.planId.equals(original.planId) ||
                        !integer(row.imageRevision === undefined ? 0 : row.imageRevision) || row.photos.length > 5) return fallback[index];
                    row.photos.forEach((image, position) => {
                        assertOperation(image);
                        if (!image.itemId.equals(row._id) || !image.planId.equals(row.planId) || !image.ownerId.equals(row.ownerId) || image.sortPosition !== position ||
                            image.storageBinding.fingerprint !== binding.fingerprint || image.storageBinding.namespace !== binding.namespace) throw Error('Invalid media binding');
                    });
                    return row.photos.length ? Object.assign({ imageAvailability: 'ready' }, detail ? { images: row.photos.map(image => photo(image, true)) } : { coverImage: photo(row.photos[0], false) }) : empty(detail, 'none');
                } catch (error) { return fallback[index]; }
            });
        } catch (error) { return fallback; } // Optional media failure must not invent an empty marketplace.
    };
}
module.exports = { createPublicItemMedia };
