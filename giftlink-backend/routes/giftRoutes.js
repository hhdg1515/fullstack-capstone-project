const express = require('express');

function createGiftRoutes({ connectToDatabase, logger }) {
    const router = express.Router();

    // Get all gifts
    router.get('/', async (req, res, next) => {
        logger.info('/ called');
        try {
            const db = await connectToDatabase();
            const collection = db.collection("gifts");
            const gifts = await collection.find({}).toArray();
            res.json(gifts);
        } catch (e) {
            logger.error('Error fetching gifts', e);
            next(e);
        }
    });

    // Get a single gift by ID
    router.get('/:id', async (req, res, next) => {
        try {
            const db = await connectToDatabase();
            const collection = db.collection("gifts");
            const id = req.params.id;
            const gift = await collection.findOne({ id: id });

            if (!gift) {
                return res.status(404).send("Gift not found");
            }

            res.json(gift);
        } catch (e) {
            next(e);
        }
    });

    // Add a new gift
    router.post('/', async (req, res, next) => {
        try {
            const db = await connectToDatabase();
            const collection = db.collection("gifts");
            const result = await collection.insertOne(req.body);

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
