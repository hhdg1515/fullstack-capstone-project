import React, { useState } from 'react';
import { publicImageUrl, publicItemMedia } from '../../api/publicItemMedia';

// Same strict thumbnail contract as D1. No gallery or metadata HTTP request.
export default function PickupItemPhoto({ item, detail = false }) {
  const media = publicItemMedia(item, detail), [failed, setFailed] = useState(false), [loaded, setLoaded] = useState(false);
  if (!media) return null;
  const cover = detail ? media.images[0] : media.coverImage;
  return <div className="pickup-item-thumbnail" aria-busy={Boolean(cover && !failed && !loaded)}>
    {cover && !failed ? <>
      {!loaded && <span role="status">Loading…</span>}
      <img src={publicImageUrl(cover.thumbnail)} width={cover.thumbnail.width} height={cover.thumbnail.height}
        alt={`${item.name} (current cover)`} crossOrigin="use-credentials" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
    </> : <span>{media.imageAvailability === 'none' ? 'No photo' : 'Photo unavailable'}</span>}
  </div>;
}
