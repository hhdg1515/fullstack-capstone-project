function errorResponse(res, status, code, message) {
    return res.status(status).json({ error: { code, message } });
}

function createIdentityMiddleware({ identity, appOrigin, secureCookies = false, sessionTtlSeconds = 28800 }) {
    const cookieName = secureCookies ? '__Host-giftlink_session' : 'giftlink_session';
    const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: 'lax', path: '/' };
    const readToken = req => req.cookies && req.cookies[cookieName];
    const clearCookie = res => res.clearCookie(cookieName, cookieOptions);
    const setCookie = (res, token) => res.cookie(cookieName, token,
        Object.assign({}, cookieOptions, { maxAge: sessionTtlSeconds * 1000 }));

    function protectWrites(req, res, next) {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
        // HTML forms cannot set this non-simple header; preflight and Origin are
        // checked against one configured application origin, never a supplied Host.
        if (req.get('Origin') !== appOrigin || req.get('X-CSRF-Protection') !== '1') {
            return errorResponse(res, 403, 'CSRF_REJECTED', 'Request origin or CSRF header is invalid');
        }
        if (!req.is('application/json')) {
            return errorResponse(res, 415, 'JSON_REQUIRED', 'Use application/json');
        }
        next();
    }

    async function requireAuth(req, res, next) {
        try {
            const token = readToken(req);
            const authentication = await identity.authenticate(token);
            res.set('Cache-Control', 'no-store');
            if (!authentication) {
                clearCookie(res);
                return errorResponse(res, 401, token ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED',
                    token ? 'Your session ended. Please log in again.' : 'Please log in.');
            }
            req.user = authentication.user;
            req.sessionId = authentication.sessionId;
            next();
        } catch (error) { next(error); }
    }
    return { requireAuth, protectWrites, readToken, setCookie, clearCookie, cookieName };
}

module.exports = { createIdentityMiddleware, errorResponse };
