const { body, validationResult } = require('express-validator');
const { errorResponse } = require('./identity');

const name = field => body(field).isString().withMessage('Use text').bail().trim()
    .isLength({ min: 1, max: 80 }).withMessage('Use 1 to 80 characters');
const email = () => body('email').isString().withMessage('Use an email address').bail().trim()
    .isLength({ max: 254 }).isEmail().withMessage('Use a valid email address');
const password = (minimum, maximumBytes = 72) => body('password').isString().withMessage('Use a password').bail()
    .custom(value => Array.from(value).length >= minimum && Buffer.byteLength(value, 'utf8') <= maximumBytes)
    .withMessage('Password needs at least ' + minimum + ' characters and at most ' + maximumBytes + ' UTF-8 bytes');

function validate(allowed, rules, requireAny = false) {
    return [function (req, res, next) {
        if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object' ||
            Object.keys(req.body).some(key => !allowed.includes(key)) ||
            (requireAny && !Object.keys(req.body).length)) {
            return errorResponse(res, 400, 'VALIDATION_FAILED', 'Unsupported or missing fields');
        }
        next();
    }].concat(rules, function (req, res, next) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'Check your details',
                fields: errors.array().map(error => ({ field: error.path, message: error.msg })) } });
        }
        next();
    });
}
const registration = () => validate(['firstName', 'lastName', 'email', 'password'], [name('firstName'), name('lastName'), email(), password(12)]);
// Preserve existing bcrypt verification, including legacy truncation, with a
// bounded request. New registrations always enforce bcrypt's 72-byte maximum.
const login = () => validate(['email', 'password'], [email(), password(1, 1024)]);
const profile = () => validate(['firstName', 'lastName'], [name('firstName').optional(), name('lastName').optional()], true);
const legacyProfile = () => validate(['name'], [name('name')]);
const gift = () => validate(['id', 'name', 'category', 'condition', 'zipcode', 'date_added', 'age_days', 'age_years', 'description', 'image'], [
    body('id').isString().bail().trim().isLength({ min: 1, max: 100 }),
    body('name').isString().bail().trim().isLength({ min: 1, max: 200 }),
    body(['category', 'condition', 'zipcode', 'description', 'image']).optional().isString().bail().isLength({ max: 5000 }),
    body(['date_added', 'age_days', 'age_years']).optional().isFloat({ min: 0 })
]);
module.exports = { registration, login, profile, legacyProfile, gift, validate };
