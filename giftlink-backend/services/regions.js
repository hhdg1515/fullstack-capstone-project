const directory = require('../data/us-regions.json');
const { InventoryError } = require('./inventory-error');
const state = id => directory.states.find(value => value.id === id);
const metro = id => directory.metros.find(value => value.id === id);
const regionResponse = plan => ({ stateId: plan.stateId || null, metroId: plan.metroId || null,
    stateLabel: (state(plan.stateId) || {}).label || null, metroLabel: (metro(plan.metroId) || {}).label || null });

function validateRegion(stateId, metroId) {
    const fields = [];
    if (stateId != null && (typeof stateId !== 'string' || !state(stateId))) fields.push({ field: 'stateId', message: 'Choose a supported U.S. state or Washington, DC.' });
    if (metroId != null && (typeof metroId !== 'string' || !metro(metroId) || !metro(metroId).stateIds.includes(stateId))) {
        fields.push({ field: 'metroId', message: 'Choose a listed metro for this state, or leave the metro unassigned.' });
    }
    if (fields.length) throw new InventoryError(400, 'INVALID_REGION', 'Check the state and metro selection.', { fields });
}
function regionChanges(previous, input) {
    if (!['stateId', 'metroId'].some(key => Object.prototype.hasOwnProperty.call(input, key))) return {};
    const stateId = input.stateId === undefined ? previous.stateId || null : input.stateId;
    const metroId = input.metroId === undefined ? previous.metroId || null : input.metroId;
    validateRegion(stateId, metroId);
    return { stateId, metroId };
}
module.exports = { directory, state, metro, validateRegion, regionChanges, regionResponse };
