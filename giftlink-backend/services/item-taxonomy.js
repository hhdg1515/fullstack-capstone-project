const taxonomy = require('../data/item-taxonomy.json');
const { InventoryError } = require('./inventory-error');
const category = id => taxonomy.categories.find(value => value.id === id);
const type = (categoryId, id) => (category(categoryId) || { itemTypes: [] }).itemTypes.find(value => value.id === id);
const condition = id => taxonomy.conditions.find(value => value.id === id);
const label = value => value ? { id: value.id, label: value.label } : null;
function customType(value) {
    return typeof value === 'string' && value.length <= 240 && !/[<>\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value) && Array.from(value.trim()).length <= 60 &&
        !/[^\s@]+@[^\s@]+\.[^\s@]+/.test(value);
}
function classificationResponse(item) {
    const result = { category: label(category(item.categoryId)), itemType: label(type(item.categoryId, item.itemTypeId)), condition: label(condition(item.condition)) };
    if ((type(item.categoryId, item.itemTypeId) || {}).custom && customType(item.customItemType) && item.customItemType.trim()) result.customItemType = item.customItemType.trim().replace(/\s+/g, ' ');
    return result;
}
function classificationChanges(previous, input) {
    const fields = ['categoryId', 'itemTypeId', 'condition'];
    if (!fields.concat('customItemType').some(key => Object.prototype.hasOwnProperty.call(input, key))) return {};
    const result = {}, errors = [];
    for (const key of fields) result[key] = input[key] === undefined ? previous[key] || null : input[key];
    if (result.categoryId !== null && (typeof result.categoryId !== 'string' || !category(result.categoryId))) errors.push({ field: 'categoryId', message: 'Choose a listed category, or leave it unspecified.' });
    if (result.itemTypeId !== null && (typeof result.itemTypeId !== 'string' || !type(result.categoryId, result.itemTypeId))) errors.push({ field: 'itemTypeId', message: 'Choose an item type in the selected category.' });
    if (result.condition !== null && (typeof result.condition !== 'string' || !condition(result.condition))) errors.push({ field: 'condition', message: 'Choose a listed condition, or leave it unspecified.' });
    if (Object.prototype.hasOwnProperty.call(input, 'customItemType')) {
        if (input.customItemType !== null && (!customType(input.customItemType) || (input.customItemType.trim() && !(type(result.categoryId, result.itemTypeId) || {}).custom))) {
            errors.push({ field: 'customItemType', message: 'For Other, use up to 60 plain-text characters without contact details.' });
        } else result.customItemType = input.customItemType ? input.customItemType.trim().replace(/\s+/g, ' ') || null : null;
    } else if (previous.customItemType && (result.categoryId !== previous.categoryId || result.itemTypeId !== previous.itemTypeId)) result.customItemType = null;
    if (errors.length) throw new InventoryError(400, 'INVALID_CLASSIFICATION', 'Check the category, item type and condition.', { fields: errors });
    return result;
}
module.exports = { taxonomy, category, type, condition, classificationChanges, classificationResponse };
