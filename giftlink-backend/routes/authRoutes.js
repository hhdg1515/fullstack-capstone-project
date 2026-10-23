const express = require('express');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

function createAuthRoutes({ connectToDatabase, jwtSecret, logger }) {
    const router = express.Router();
    const JWT_SECRET = jwtSecret;

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


    router.post('/login', async (req, res) => {
        try {
            if (!JWT_SECRET) {
                logger.error('JWT_SECRET is not configured');
                return res.status(500).json({ error: 'Internal server error' });
            }

            const { email, password } = req.body;
            if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
                return res.status(400).json({ error: 'Email and password are required' });
            }

            const db = await connectToDatabase();
            const collection = db.collection('users');
            const theUser = await collection.findOne({ email: email.trim().toLowerCase() });

            if (!theUser) {
                logger.error('User not found');
                return res.status(404).json({ error: 'User not found' });
            }

            const result = await bcryptjs.compare(password, theUser.password);
            if (!result) {
                logger.error('Passwords do not match');
                return res.status(404).json({ error: 'Wrong password' });
            }

            const payload = { user: { id: theUser._id.toString() } };
            const userName = theUser.firstName;
            const userEmail = theUser.email;
            const authtoken = jwt.sign(payload, JWT_SECRET);
            logger.info('User logged in successfully');
            return res.status(200).json({ authtoken, userName, userEmail });
        } catch (e) {
            logger.error({ err: e }, 'Login failed');
            return res.status(500).json({ error: 'Internal server error' });
        }
    });


    router.put('/update', [
        body('name').isString().trim().notEmpty().withMessage('Name is required')
    ], async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            logger.error({ errors: errors.array() }, 'Validation errors in update request');
            return res.status(400).json({ errors: errors.array() });
        }

        try {
            const email = req.headers.email;
            if (typeof email !== 'string' || !email.trim()) {
                logger.error('Email not found in the request headers');
                return res.status(400).json({ error: 'Email not found in the request headers' });
            }

            const authorization = req.headers.authorization || '';
            const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
            if (!token) {
                return res.status(401).json({ error: 'Authentication required' });
            }
            if (!JWT_SECRET) {
                logger.error('JWT_SECRET is not configured');
                return res.status(500).json({ error: 'Internal server error' });
            }

            let decoded;
            try {
                decoded = jwt.verify(token, JWT_SECRET);
            } catch (error) {
                return res.status(401).json({ error: 'Invalid or expired token' });
            }

            const db = await connectToDatabase();
            const collection = db.collection('users');
            const normalizedEmail = email.trim().toLowerCase();
            const existingUser = await collection.findOne({ email: normalizedEmail });

            if (!existingUser) {
                logger.error('User not found');
                return res.status(404).json({ error: 'User not found' });
            }
            if (!decoded.user || decoded.user.id !== existingUser._id.toString()) {
                return res.status(403).json({ error: 'Not authorized to update this user' });
            }

            const updatedUser = await collection.findOneAndUpdate(
                { _id: existingUser._id },
                { $set: { firstName: req.body.name.trim(), updatedAt: new Date() } },
                { returnDocument: 'after' }
            );

            if (!updatedUser) {
                return res.status(404).json({ error: 'User not found' });
            }

            const payload = { user: { id: updatedUser._id.toString() } };
            const authtoken = jwt.sign(payload, JWT_SECRET);
            logger.info('User updated successfully');
            return res.json({ authtoken });
        } catch (error) {
            logger.error({ err: error }, 'Update failed');
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}

module.exports = createAuthRoutes;
