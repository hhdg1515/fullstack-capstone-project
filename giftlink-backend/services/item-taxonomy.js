const taxonomy = require('../data/item-taxonomy.json');
const { InventoryError } = require('./inventory-error');
const category = id => taxonomy.categories.find(value => value.id === id);
const type = (categoryId, id) => (category(categoryId) || { itemTypes: [] }).itemTypes.find(value => value.id === id);
const condition = id => taxonomy.conditions.find(value => value.id === id);
const label = value => value ? { id: value.id, label: value.label } : null;
function classificationResponse(item) {
    return { category: label(category(item.categoryId)), itemType: label(type(item.categoryId, item.itemTypeId)), condition: label(condition(item.condition)) };
}
function classificationChanges(previous, input) {
    const fields = ['categoryId', 'itemTypeId', 'condition'];
    if (!fields.some(key => Object.prototype.hasOwnProperty.call(input, key))) return {};
    const result = {}, errors = [];
    for (const key of fields) result[key] = input[key] === undefined ? previous[key] || null : input[key];
    if (result.categoryId !== null && (typeof result.categoryId !== 'string' || !category(result.categoryId))) errors.push({ field: 'categoryId', message: 'Choose a listed category, or leave it unspecified.' });
    if (result.itemTypeId !== null && (typeof result.itemTypeId !== 'string' || !type(result.categoryId, result.itemTypeId))) errors.push({ field: 'itemTypeId', message: 'Choose an item type in the selected category.' });
    if (result.condition !== null && (typeof result.condition !== 'string' || !condition(result.condition))) errors.push({ field: 'condition', message: 'Choose a listed condition, or leave it unspecified.' });
    if (errors.length) throw new InventoryError(400, 'INVALID_CLASSIFICATION', 'Check the category, item type and condition.', { fields: errors });
    return result;
}
module.exports = { taxonomy, category, type, condition, classificationChanges, classificationResponse };
