class InventoryError extends Error {
    constructor(status, code, message, details = {}) {
        super(message); Object.assign(this, { status, code, details });
    }
}
module.exports = { InventoryError };
