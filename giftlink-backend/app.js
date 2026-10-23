const express = require('express');
const cors = require('cors');
const pinoHttp = require('pino-http');
const createGiftRoutes = require('./routes/giftRoutes');
const createSearchRoutes = require('./routes/searchRoutes');
const createAuthRoutes = require('./routes/authRoutes');

// Constructing/importing the application never connects, seeds, or listens.
function createApp({ connectToDatabase, jwtSecret, logger = require('./logger') }) {
    const app = express();
    app.use('*', cors());
    app.use(express.json());
    app.use(pinoHttp({ logger }));
    app.use('/api/gifts', createGiftRoutes({ connectToDatabase, logger }));
    app.use('/api/search', createSearchRoutes({ connectToDatabase }));
    app.use('/api/auth', createAuthRoutes({ connectToDatabase, jwtSecret, logger }));

    app.use((err, req, res, next) => {
        logger.error({ err }, 'Request failed');
        res.status(500).send('Internal Server Error');
    });

    app.get('/', (req, res) => {
        res.send('Inside the server');
    });
    return app;
}

module.exports = createApp;
