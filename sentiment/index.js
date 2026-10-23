
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const logger = require('./logger');
const expressPino = require('express-pino-logger')({ logger });

// Task 1: Import the Natural library
const natural = require("natural");

// Task 2: Initialize the Express server
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(expressPino);

// Task 3: Create the POST /sentiment endpoint
app.post('/sentiment', async (req, res) => {

    // Task 4: Extract sentence from query parameters
    const { sentence } = req.query;

    if (!sentence) {
        logger.error('No sentence provided');
        return res.status(400).json({
            error: 'No sentence provided'
        });
    }

    // Initialize Natural SentimentAnalyzer
    const Analyzer = natural.SentimentAnalyzer;
    const stemmer = natural.PorterStemmer;
    const analyzer = new Analyzer("English", stemmer, "afinn");

    try {
        // Analyze sentiment
        const analysisResult = analyzer.getSentiment(
            sentence.split(' ')
        );

        let sentiment = "neutral";

        // Task 5: Classify sentiment
        if (analysisResult < 0) {
            sentiment = "negative";
        } else if (analysisResult > 0.33) {
            sentiment = "positive";
        }

        logger.info(`Sentiment analysis result: ${analysisResult}`);

        // Task 6: Return success
        res.status(200).json({
            sentimentScore: analysisResult,
            sentiment: sentiment
        });

    } catch (error) {
        logger.error(`Error performing sentiment analysis: ${error}`);

        // Task 7: Return error
        res.status(500).json({
            message: 'Error performing sentiment analysis'
        });
    }
});

app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
});
