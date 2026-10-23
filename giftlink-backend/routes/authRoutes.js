const express = require('express');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const connectToDatabase = require('../models/db');
const router = express.Router();
const dotenv = require('dotenv');
const pino = require('pino');

const logger = pino();
dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET;

router.post('/register', [
    body('email').isEmail(),
    body('password').isString().notEmpty(),
    body('firstName').isString().notEmpty(),
    body('lastName').isString().notEmpty()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        if (!JWT_SECRET) {
            logger.error('JWT_SECRET is not configured');
            return res.status(500).send('Internal server error');
        }

        const db = await connectToDatabase();
        const collection = db.collection('users');
        const email = req.body.email.trim().toLowerCase();
        const existingEmail = await collection.findOne({ email });
        if (existingEmail) {
            return res.status(409).json({ message: 'Email already registered' });
        }

        const salt = await bcryptjs.genSalt(10);
        const hash = await bcryptjs.hash(req.body.password, salt);
        const newUser = await collection.insertOne({
            email,
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            password: hash,
            createdAt: new Date()
        });

        const payload = { user: { id: newUser.insertedId.toString() } };
        const authtoken = jwt.sign(payload, JWT_SECRET);
        logger.info('User registered successfully');
        return res.json({ authtoken, email });
    } catch (e) {
        logger.error({ err: e }, 'Registration failed');
        return res.status(500).send('Internal server error');
    }
});

module.exports = router;
