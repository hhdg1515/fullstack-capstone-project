export function ownerStatus(item) {
  if (item.status === 'cleared') return item.isPickedUp === true ? 'Picked Up' : 'Cleared';
  if (item.status === 'draft') return 'Draft';
  if (item.status === 'expired') return 'Expired';
  if (item.status === 'unlisted') return 'Hidden';
  if (item.status === 'available') return item.isReserved === true ? 'Reserved' : item.isPublic === true ? 'Posted' : 'Hidden';
  return 'Unavailable';
}
export const inventoryFilters = ['Draft', 'Posted', 'Reserved', 'Picked Up', 'Hidden', 'Cleared', 'Expired'];
export const publicationComplete = item => Boolean(item.name?.trim() && item.description?.trim() && item.classification?.category?.id && item.classification?.itemType?.id);
