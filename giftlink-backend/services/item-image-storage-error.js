const categories = ['configuration', 'disabled', 'target_mismatch', 'invalid_input', 'closed', 'busy',
    'not_found', 'unconfirmed_absence', 'authorization', 'target_missing', 'conflict', 'timeout',
    'provider', 'integrity', 'put_already_attempted', 'artifact_unapproved'];
const issued = new WeakSet();

function storageError(category, operation, outcome) {
    const safe = categories.includes(category) ? category : 'provider';
    const error = new Error('Private object storage: ' + safe);
    error.name = 'ItemImageStorageError';
    error.code = 'ITEM_IMAGE_STORAGE_' + safe.toUpperCase();
    error.category = safe;
    error.operation = operation;
    error.outcome = outcome;
    issued.add(error);
    // Never attach a provider error/cause/request, response body, key or credential.
    return error;
}

module.exports = { storageError, isStorageError: error => issued.has(error) };
