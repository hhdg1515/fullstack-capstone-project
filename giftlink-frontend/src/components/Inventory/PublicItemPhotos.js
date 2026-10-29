import React, { useRef, useState } from 'react';
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
export default function PublicItemGallery({ item }) {
  const media = publicItemMedia(item, true);
  if (!media) return null;
  return <section className="public-item-gallery" aria-label="Item photos"><h2>Photos</h2>
    {media.imageAvailability === 'ready' ? <Gallery key={media.images.map(image => image.id).join(':')} images={media.images} name={item.name} /> :
      <p>{media.imageAvailability === 'none' ? 'No photos yet.' : 'Photos unavailable. Refresh the listing to try again.'}</p>}
  </section>;
}
function Gallery({ images, name }) {
  const [selected, setSelected] = useState(0), [failedThumbs, setFailedThumbs] = useState({});
  const buttons = useRef([]), image = images[selected];
  return <>
    <GalleryImage key={image.id} image={image} name={name} position={selected} count={images.length} />
    {images.length > 1 && <>
      <div className="public-gallery-navigation">
        <button type="button" className="ui-button ui-button--secondary" onClick={() => setSelected(value => value - 1)} disabled={selected === 0}>Previous photo</button>
        <p role="status" aria-live="polite">Photo {selected + 1} of {images.length}</p>
        <button type="button" className="ui-button ui-button--secondary" onClick={() => setSelected(value => value + 1)} disabled={selected === images.length - 1}>Next photo</button>
      </div>
      <div className="public-gallery-thumbnails" role="group" aria-label="Choose a photo" onKeyDown={event => {
        const index = buttons.current.indexOf(document.activeElement); if (index < 0) return;
        let target;
        if (event.key === 'ArrowRight') target = Math.min(index + 1, images.length - 1);
        if (event.key === 'ArrowLeft') target = Math.max(index - 1, 0);
        if (event.key === 'Home') target = 0; if (event.key === 'End') target = images.length - 1;
        if (target !== undefined) { event.preventDefault(); setSelected(target); buttons.current[target]?.focus(); }
      }}>
        {images.map((photo, index) => <button type="button" key={photo.id} ref={node => { buttons.current[index] = node; }} className="ui-button ui-button--secondary"
          aria-label={`Show photo ${index + 1} of ${images.length}`} aria-pressed={index === selected} onClick={() => setSelected(index)}>
          {failedThumbs[photo.id] ? <span>{index + 1}</span> : <img src={publicImageUrl(photo.thumbnail)} width={photo.thumbnail.width} height={photo.thumbnail.height} alt=""
            crossOrigin="use-credentials" loading="lazy" decoding="async" onError={() => setFailedThumbs(values => ({ ...values, [photo.id]: true }))} />}
        </button>)}
      </div>
    </>}
  </>;
}
function GalleryImage({ image, name, position, count }) {
  const [failed, setFailed] = useState(false), [loaded, setLoaded] = useState(false);
  return <div className="public-gallery-primary" aria-busy={!failed && !loaded}>
    {failed ? <p role="status">{count > 1 ? 'Photo unavailable. Choose another photo or refresh the listing.' : 'Photo unavailable. Refresh the listing to try again.'}</p> : <>
      {!loaded && <p className="public-gallery-loading" role="status">Loading photo…</p>}
      <img src={publicImageUrl(image.display)} width={image.display.width} height={image.display.height} alt={`${name} (${position + 1} of ${count})`}
        crossOrigin="use-credentials" decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
    </>}
  </div>;
}
