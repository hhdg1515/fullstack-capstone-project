// Retain the app-factory import contract. Vercel discovers the concrete Express
// application in index.js; this compatibility module deliberately only re-exports.
module.exports = require('./app-factory');
