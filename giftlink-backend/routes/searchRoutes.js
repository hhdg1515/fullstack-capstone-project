
const express = require('express');
const router = express.Router();
const connectToDatabase = require('../models/db');

// Search for gifts
router.get('/', async (req, res, next) => {
    try {
        // Task 1: Connect to MongoDB
        const db = await connectToDatabase();
        const collection = db.collection("gifts");

        // Initialize the query object
        let query = {};

        // Task 2: Filter by name (case-insensitive)
        if (req.query.name && req.query.name.trim() !== '') {
            query.name = {
                $regex: req.query.name.trim(),
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
        const gifts = await collection.find(query).toArray();

        res.json(gifts);
    } catch (e) {
        next(e);
    }
});

module.exports = router;

