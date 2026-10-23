const express = require('express');
const { publicGiftProjection } = require('../serializers/gifts');
const validation = require('../middleware/validation');

function createGiftRoutes({ connectToDatabase, logger, auth }) {
    const router = express.Router();

    // Get all gifts
    router.get('/', async (req, res, next) => {
        logger.info('/ called');
        try {
            const db = await connectToDatabase();
            const collection = db.collection("gifts");
            const gifts = await collection.find({}, { projection: publicGiftProjection }).toArray();
            res.json(gifts);
        } catch (e) {
            next(e);
        }
    });

    // Get a single gift by ID
    router.get('/:id', async (req, res, next) => {
        try {
            const db = await connectToDatabase();
            const collection = db.collection("gifts");
            const id = req.params.id;
            const gift = await collection.findOne({ id: id }, { projection: publicGiftProjection });

            if (!gift) {
                return res.status(404).send("Gift not found");
            }

            res.json(gift);
        } catch (e) {
            next(e);
        }
    });

    // Add a new gift
    router.post('/', auth.requireAuth, validation.gift(), async (req, res, next) => {
        try {
            const db = await connectToDatabase();
            const collection = db.collection("gifts");
            const gift = {};
            for (const field of Object.keys(publicGiftProjection)) {
                if (field !== '_id' && field !== 'posted_by' && Object.prototype.hasOwnProperty.call(req.body, field)) {
                    gift[field] = req.body[field];
                }
            }
            gift.posted_by = req.user._id.toString();
            const result = await collection.insertOne(gift);

            res.status(201).json({
                acknowledged: result.acknowledged,
                insertedId: result.insertedId
            });
        } catch (e) {
            next(e);
        }
    });

    return router;
}

module.exports = createGiftRoutes;
