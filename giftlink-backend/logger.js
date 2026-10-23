const pino = require('pino');

function createLogger(destination) {
    const options = { level: 'info',
        serializers: { err: () => ({ message: 'Operation failed' }) },
        redact: { paths: ['password', 'token', 'email', 'req.headers', 'req.body', 'res.headers'], remove: true } };
    if (!destination && process.env.NODE_ENV !== 'production') {
        options.transport = { target: 'pino-pretty' };
    }
    return pino(options, destination);
}
module.exports = createLogger();
module.exports.createLogger = createLogger;
