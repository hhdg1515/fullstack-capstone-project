// Keep legacy collection/detail responses from reaching render code in the wrong shape.
export const giftResponse = value => value && !Array.isArray(value) && typeof value.name === 'string' &&
  ['string', 'number'].includes(typeof value.id);
export const giftListResponse = value => Array.isArray(value) && value.every(giftResponse);
