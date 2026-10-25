const { randomUUID } = require('crypto');
const requestId = Symbol('serverRequestId');

function requestDiagnostics(req, res, next) {
    // Never trust a caller-supplied ID: it may contain private data or log text.
    if (!req[requestId]) req[requestId] = randomUUID();
    req.id = req[requestId];
    res.set('X-Request-Id', req.id);
    next();
}

function failureCategory(phase, error) {
    if (error && error.code === 18) return 'database_authentication';
    if (error && error.code === 13) return 'database_permissions';
    if (phase === 'configuration') return 'configuration_invalid';
    if (phase === 'target_validation') return 'target_configuration_invalid';
    if (phase === 'index_verification') return 'required_indexes_unavailable';
    if (phase === 'topology_verification') return 'transaction_topology_unavailable';
    if (phase === 'app_construction') return 'application_initialization_failed';
    return 'database_unavailable';
}

function createFailureDiagnostics(logger, now) {
    const last = new Map();
    return function (event, phase, error, id) {
        const category = failureCategory(phase, error);
        const key = event + ':' + phase + ':' + category;
        const at = now();
        // Best-effort per warm instance, not global alerting or rate limiting.
        if (!last.has(key) || at - last.get(key) >= 30000) {
            last.set(key, at);
            logger.error({ event, phase, category, requestId: id }, 'Hosted operation unavailable');
        }
    };
}
module.exports = { requestDiagnostics, failureCategory, createFailureDiagnostics };
