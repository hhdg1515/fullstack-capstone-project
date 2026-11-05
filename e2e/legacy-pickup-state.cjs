// Compatibility setup for historical accepted/declined API contracts. These
// controls are intentionally absent from the new chat-first application UI.
const { expect } = require('@playwright/test');
async function legacyPickupState(page, action) {
  expect(['accept', 'decline']).toContain(action);
  const requestId = new URL(page.url()).pathname.split('/').pop();
  expect(requestId).toMatch(/^[a-f0-9]{24}$/);
  const origin = new URL(page.url()).origin;
  const current = await page.request.get('/api/pickup-requests/' + requestId);
  expect(current.status()).toBe(200);
  const { request } = await current.json();
  const response = await page.request.post('/api/pickup-requests/' + requestId + '/actions', {
    headers: { Origin: origin, 'X-CSRF-Protection': '1' }, data: { action, version: request.version }
  });
  expect(response.status()).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}
module.exports = { legacyPickupState };
