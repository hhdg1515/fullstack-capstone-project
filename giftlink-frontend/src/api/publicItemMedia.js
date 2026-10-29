import { urlConfig } from '../config';
const keys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === fields.slice().sort().join(',');
const id = value => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
const variant = (value, imageId, name) => keys(value, ['url', 'width', 'height']) &&
  value.url === `/api/item-images/${imageId}/${name}` && ['width', 'height'].every(key => Number.isSafeInteger(value[key]) && value[key] > 0 && value[key] <= (name === 'thumbnail' ? 400 : 1280));
const photo = (value, detail) => keys(value, detail ? ['id', 'thumbnail', 'display'] : ['id', 'thumbnail']) && id(value.id) &&
  variant(value.thumbnail, value.id, 'thumbnail') && (!detail || variant(value.display, value.id, 'display'));
// Bad optional media is isolated from the listing itself. No unvalidated URL
// reaches an img; an older API with absent media remains a text-first listing.
export function publicItemMedia(item, detail = false) {
  if (item.imageAvailability === undefined && item.images === undefined && item.coverImage === undefined) return null;
  const unavailable = { imageAvailability: 'unavailable', images: [], coverImage: null };
  if (!['ready', 'none', 'unavailable'].includes(item.imageAvailability)) return unavailable;
  if (item.imageAvailability !== 'ready') {
    if (item.coverImage != null || (item.images !== undefined && (!Array.isArray(item.images) || item.images.length))) return unavailable;
    return { ...unavailable, imageAvailability: item.imageAvailability };
  }
  if (detail) {
    const images = item.images;
    return Array.isArray(images) && images.length >= 1 && images.length <= 5 && new Set(images.map(image => image?.id)).size === images.length && images.every(image => photo(image, true)) ?
      { imageAvailability: 'ready', images } : unavailable;
  }
  return photo(item.coverImage, false) ? { imageAvailability: 'ready', coverImage: item.coverImage } : unavailable;
}
export const publicImageUrl = variant => `${urlConfig.backendUrl}${variant.url}`;
