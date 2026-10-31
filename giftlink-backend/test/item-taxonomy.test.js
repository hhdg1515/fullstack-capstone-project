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
    it('adds common goods and category-specific fallbacks without reassigning any existing type ID', function () {
        const original = {
            'living-room': ['sofa', 'loveseat', 'coffee-table', 'tv-stand', 'bookshelf'],
            bedroom: ['bed-frame', 'mattress', 'dresser', 'nightstand'],
            'dining-kitchen': ['dining-table', 'dining-chair', 'bar-stool', 'kitchenware', 'small-appliance'],
            'office-lighting': ['desk', 'office-chair', 'desk-lamp', 'floor-lamp'],
            'storage-organization': ['cabinet', 'shelving', 'clothes-rack', 'hangers', 'storage-container'],
            'other-household': ['plant', 'home-decor', 'books', 'childrens-items', 'other']
        };
        for (const group of taxonomy.categories) {
            for (const id of original[group.id]) assert.ok(group.itemTypes.some(row => row.id === id));
            assert.equal(group.itemTypes.filter(row => row.custom).length, 1);
        }
        const all = taxonomy.categories.flatMap(group => group.itemTypes);
        for (const id of ['television', 'monitor', 'rug', 'curtains', 'bicycle', 'fan', 'heater', 'vacuum-cleaner', 'bedding']) assert.ok(all.some(row => row.id === id));
        for (const row of all) { assert.match(row.id, /^[a-z][a-z-]+$/); assert.ok(Array.isArray(row.searchTerms)); }
    });
    it('preserves every pre-UX1 canonical ID, label, category and legacy classification', function () {
        const previous = {
            "living-room": {"sofa": "Sofa", "loveseat": "Loveseat", "coffee-table": "Coffee Table", "tv-stand": "TV Stand", "bookshelf": "Bookshelf", "television": "Television", "rug": "Rug", "curtains": "Curtains", "living-room-other": "Other Living Room"},
            "bedroom": {"bed-frame": "Bed Frame", "mattress": "Mattress", "dresser": "Dresser", "nightstand": "Nightstand", "bedding": "Bedding", "bedroom-other": "Other Bedroom"},
            "dining-kitchen": {"dining-table": "Dining Table", "dining-chair": "Dining Chair", "bar-stool": "Bar Stool", "kitchenware": "Kitchenware", "small-appliance": "Small Appliance", "dining-kitchen-other": "Other Dining & Kitchen"},
            "office-lighting": {"desk": "Desk", "office-chair": "Office Chair", "desk-lamp": "Desk Lamp", "floor-lamp": "Floor Lamp", "monitor": "Monitor", "office-lighting-other": "Other Office & Lighting"},
            "storage-organization": {"cabinet": "Cabinet", "shelving": "Shelving", "clothes-rack": "Clothes Rack", "hangers": "Hangers", "storage-container": "Storage Container", "storage-organization-other": "Other Storage & Organization"},
            "other-household": {"plant": "Plant", "home-decor": "Home Decor", "books": "Books", "childrens-items": "Children's Items", "bicycle": "Bicycle", "fan": "Fan", "heater": "Heater", "vacuum-cleaner": "Vacuum Cleaner", "other": "Other"}
        };
        assert.deepEqual(taxonomy.categories.map(group => group.id), Object.keys(previous));
        for (const group of taxonomy.categories) {
            for (const [id, label] of Object.entries(previous[group.id])) {
                assert.equal(group.itemTypes.find(type => type.id === id).label, label);
                assert.equal(classificationResponse({ categoryId: group.id, itemTypeId: id }).itemType.id, id);
            }
        }
    });
    it('bounds and normalizes explicit Other text, rejects non-text and markup, and never invents a canonical ID', function () {
        const other = { categoryId: 'other-household', itemTypeId: 'other' };
        assert.equal(classificationChanges(other, { customItemType: '  Sewing   machine  ' }).customItemType, 'Sewing machine');
        for (const customItemType of [{ $ne: '' }, [], 1, true, '<img>', 'x'.repeat(61), 'bad\ntext', 'bad\u202etext', 'owner@example.test']) {
            assert.throws(() => classificationChanges(other, { customItemType }), error => error.code === 'INVALID_CLASSIFICATION');
        }
        assert.throws(() => classificationChanges({ categoryId: 'living-room', itemTypeId: 'sofa' }, { customItemType: 'Different type' }));
        assert.equal(classificationChanges(other, { customItemType: null }).customItemType, null);
        assert.deepEqual(classificationChanges(Object.assign({}, other, { customItemType: 'Custom' }), { name: 'Renamed' }), {});
        assert.equal(classificationChanges(Object.assign({}, other, { customItemType: 'Custom' }), { categoryId: 'bedroom', itemTypeId: 'bedding' }).customItemType, null);
        assert.equal(classificationResponse(Object.assign({}, other, { customItemType: '<private>' })).customItemType, undefined);
        assert.equal(classificationResponse(Object.assign({}, other, { customItemType: 'Sewing machine' })).itemType.id, 'other');
    });

});
