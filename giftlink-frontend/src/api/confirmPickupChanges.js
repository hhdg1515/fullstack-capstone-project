import { apiRequest } from './client';

export async function confirmPickupChanges(path, options) {
  try { return await apiRequest(path, options); }
  catch (error) {
    if (error.code !== 'PICKUP_CONFIRMATION_REQUIRED' || !window.confirm(`${error.message}\nCancel the affected requests and continue?`)) throw error;
    return apiRequest(path, { ...options, body: { ...options.body, confirmCancelRequests: true } });
  }
}
