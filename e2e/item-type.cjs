const taxonomy = require('../giftlink-backend/data/item-taxonomy.json');
async function selectItemType(page, id) {
  const category = taxonomy.categories.find(row => row.itemTypes.some(type => type.id === id));
  const type = category.itemTypes.find(row => row.id === id);
  await page.getByRole('combobox', { name: 'Item type', exact: true }).fill(type.label);
  await page.getByRole('option', { name: type.label + ' ' + category.label, exact: true }).click();
}
module.exports = { selectItemType };
