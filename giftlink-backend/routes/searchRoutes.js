const express = require('express');
const { publicGiftProjection } = require('../serializers/gifts');
const { errorResponse } = require('../middleware/identity');
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function createSearchRoutes({ connectToDatabase }) {
    const router = express.Router();

    // Search for gifts
    router.get('/', async (req, res, next) => {
        const allowed = ['name', 'category', 'condition', 'age_years'];
        if (Object.keys(req.query).some(key => !allowed.includes(key) || typeof req.query[key] !== 'string' || req.query[key].length > 200) ||
            (req.query.age_years !== undefined && !/^\d{1,3}$/.test(req.query.age_years))) {
            return errorResponse(res, 400, 'INVALID_SEARCH_QUERY', 'Use supported single-value search fields, text up to 200 characters and a whole-number age.');
        }
        try {
            // Task 1: Connect to MongoDB
            const db = await connectToDatabase();
            const collection = db.collection("gifts");

            // Initialize the query object
            let query = {};

            // Task 2: Filter by name (case-insensitive)
            if (req.query.name && req.query.name.trim() !== '') {
                query.name = {
                    $regex: escape(req.query.name.trim()),
                    $options: "i"
                };
            }

            // Task 3: Filter by category
            if (req.query.category) {
                query.category = req.query.category;
            }

            // Filter by condition
            if (req.query.condition) {
                query.condition = req.query.condition;
            }

            // Filter by maximum age in years
            if (req.query.age_years) {
                query.age_years = {
                    $lte: parseInt(req.query.age_years, 10)
                };
            }

            // Task 4: Fetch filtered gifts
            const gifts = await collection.find(query, { projection: publicGiftProjection, maxTimeMS: 5000 }).toArray();

            res.json(gifts);
        } catch (e) {
            if (e.code === 50) return errorResponse(res, 503, 'SEARCH_BUSY', 'Search is busy. Narrow the filters and retry.');
            next(e);
        }
    });

    return router;
}

module.exports = createSearchRoutes;
