import { apiRequest } from './client';
import { createOwnerListing, getOwnerListing, listOwnerListings, updateOwnerListing } from './ownerListings';

jest.mock('./client', () => ({ apiRequest: jest.fn() }));

test('uses owner endpoints and preserves cursor query encoding', () => {
  listOwnerListings({ cursor: 'a+b/c', status: 'draft', limit: 10 });
  expect(apiRequest.mock.calls[0][0]).toBe('/api/me/items?cursor=a%2Bb%2Fc&status=draft&limit=10');
  getOwnerListing('item/id');
  expect(apiRequest.mock.calls[1][0]).toBe('/api/me/items/item%2Fid');
});

test('makes one mutation request and forwards the content version', async () => {
  apiRequest.mockRejectedValueOnce(new Error('uncertain'));
  await expect(createOwnerListing({ name: 'Chair' })).rejects.toThrow('uncertain');
  expect(apiRequest).toHaveBeenCalledTimes(1);
  updateOwnerListing('abc', { version: 2, name: 'Desk' });
  expect(apiRequest).toHaveBeenLastCalledWith('/api/items/abc', expect.objectContaining({ method: 'PATCH', body: { version: 2, name: 'Desk' } }));
});
