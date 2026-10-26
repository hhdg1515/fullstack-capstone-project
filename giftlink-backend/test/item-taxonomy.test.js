const assert = require('node:assert/strict');
const { taxonomy, classificationChanges, classificationResponse } = require('../services/item-taxonomy');
describe('household classification catalog', function () {
    it('provides unique stable IDs, category/type relationships and an explicit Other fallback', function () {
        const types = taxonomy.categories.flatMap(category => category.itemTypes);
        assert.equal(taxonomy.categories.length, 6); assert.equal(new Set(types.map(type => type.id)).size, types.length);
        assert.ok(taxonomy.categories.find(row => row.id === 'other-household').itemTypes.some(type => type.id === 'other'));
        assert.deepEqual(taxonomy.conditions.map(row => row.id), ['like-new', 'good', 'fair', 'for-repair']);
        assert.deepEqual(classificationResponse({ category: 'Unmapped legacy text' }), { category: null, itemType: null, condition: null });
    });
    it('validates partial edits against the full resulting classification without rewriting legacy text', function () {
        const previous = { category: 'Legacy Furniture', categoryId: 'living-room', itemTypeId: 'sofa', condition: 'good' };
        assert.deepEqual(classificationChanges(previous, { name: 'New title' }), {});
        assert.throws(() => classificationChanges(previous, { categoryId: 'bedroom' }), error => error.code === 'INVALID_CLASSIFICATION');
        assert.deepEqual(classificationChanges(previous, { categoryId: 'bedroom', itemTypeId: 'mattress' }), { categoryId: 'bedroom', itemTypeId: 'mattress', condition: 'good' });
        for (const input of [{ itemTypeId: 'sofa' }, { categoryId: 'made-up' }, { condition: 'new' }, { categoryId: ['living-room'] }, { itemTypeId: { $ne: null } }]) {
            assert.throws(() => classificationChanges({}, input), error => error.code === 'INVALID_CLASSIFICATION');
        }
        assert.equal(previous.category, 'Legacy Furniture');
    });
});
