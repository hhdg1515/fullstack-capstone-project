import React, { useEffect, useRef, useState } from 'react';
import { publicImageUrl, publicItemMedia } from '../../api/publicItemMedia';
import './PublicItemPhotos.css';

export function PublicItemCover({ item }) {
  const media = publicItemMedia(item), [failed, setFailed] = useState(false);
  if (!media) return null;
  return <div className="public-item-cover">
    {media.coverImage && !failed ? <img src={publicImageUrl(media.coverImage.thumbnail)} width={media.coverImage.thumbnail.width} height={media.coverImage.thumbnail.height}
      alt="" crossOrigin="use-credentials" loading="lazy" decoding="async" onError={() => setFailed(true)} /> :
      <span>{media.imageAvailability === 'none' ? 'No photo' : 'Photo unavailable'}</span>}
  </div>;
}
export default function PublicItemGallery({ item, retryToken = 0 }) {
  const media = publicItemMedia(item, true);
  if (!media) return null;
  return <section className="public-item-gallery" aria-label="Item photos"><h2 className="visually-hidden">Photos</h2>
    {media.imageAvailability === 'ready' ? <Gallery key={media.images.map(image => image.id).join(':')} images={media.images} name={item.name} retryToken={retryToken} /> :
      <p>{media.imageAvailability === 'none' ? 'No photos yet.' : 'Photos unavailable. Refresh the listing to try again.'}</p>}
  </section>;
}
function Gallery({ images, name, retryToken }) {
  const [selected, setSelected] = useState(0), [failedThumbs, setFailedThumbs] = useState({});
  const buttons = useRef([]), image = images[selected];
  // Explicit retry only: ordinary focus refreshes retain loaded and failed state.
  useEffect(() => { setFailedThumbs({}); }, [retryToken]);
  return <>
    <div className="public-gallery-stage">
      <GalleryImage key={image.id} image={image} name={name} position={selected} count={images.length} retryToken={retryToken} />
      {images.length > 1 && <div className="public-gallery-navigation">
        <button type="button" className="public-gallery-arrow public-gallery-arrow--previous" aria-label="Previous photo" onClick={() => setSelected(value => value - 1)} disabled={selected === 0}><span aria-hidden="true">‹</span></button>
        <p role="status" aria-live="polite">Photo {selected + 1} of {images.length}</p>
        <button type="button" className="public-gallery-arrow public-gallery-arrow--next" aria-label="Next photo" onClick={() => setSelected(value => value + 1)} disabled={selected === images.length - 1}><span aria-hidden="true">›</span></button>
      </div>}
    </div>
    {images.length > 1 && <>
      <div className="public-gallery-thumbnails" role="group" aria-label="Choose a photo" onKeyDown={event => {
        const index = buttons.current.indexOf(document.activeElement); if (index < 0) return;
        let target;
        if (event.key === 'ArrowRight') target = Math.min(index + 1, images.length - 1);
        if (event.key === 'ArrowLeft') target = Math.max(index - 1, 0);
        if (event.key === 'Home') target = 0; if (event.key === 'End') target = images.length - 1;
        if (target !== undefined) { event.preventDefault(); setSelected(target); buttons.current[target]?.focus(); }
      }}>
        {images.map((photo, index) => <button type="button" key={photo.id} ref={node => { buttons.current[index] = node; }} className="public-gallery-thumbnail"
          aria-label={`Show photo ${index + 1} of ${images.length}`} aria-pressed={index === selected} onClick={() => setSelected(index)}>
          {failedThumbs[photo.id] ? <span>{index + 1}</span> : <img src={publicImageUrl(photo.thumbnail)} width={photo.thumbnail.width} height={photo.thumbnail.height} alt=""
            crossOrigin="use-credentials" loading="lazy" decoding="async" onError={() => setFailedThumbs(values => ({ ...values, [photo.id]: true }))} />}
        </button>)}
      </div>
    </>}
  </>;
}
function GalleryImage({ image, name, position, count, retryToken }) {
  const [failed, setFailed] = useState(false), [loaded, setLoaded] = useState(false);
  useEffect(() => { setFailed(false); }, [retryToken]);
  return <div className="public-gallery-primary" aria-busy={!failed && !loaded}>
    {failed ? <p role="status">{count > 1 ? 'Photo unavailable. Choose another photo or refresh the listing.' : 'Photo unavailable. Refresh the listing to try again.'}</p> : <>
      {!loaded && <p className="public-gallery-loading" role="status">Loading photo…</p>}
      <img src={publicImageUrl(image.display)} width={image.display.width} height={image.display.height} alt={`${name} (${position + 1} of ${count})`}
        crossOrigin="use-credentials" decoding="async" onLoad={() => setLoaded(true)} onError={() => { setLoaded(false); setFailed(true); }} />
    </>}
  </div>;
}
