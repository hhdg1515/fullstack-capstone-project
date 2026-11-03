import React from 'react';
import { Link } from 'react-router-dom';
import { PublicItemCover } from './PublicItemPhotos';
import { formatDeadline } from '../MoveOutPlans/dates';

// Photo-first tile: a square cover with status chips on it, then plain text.
export default function PublicItemCard({ item, search, stateCode }) {
  const type = item.classification?.customItemType || item.classification?.itemType?.label;
  const category = item.classification?.category?.label || item.category;
  const condition = item.classification?.condition?.label;
  const later = item.availability === 'later';
  return <li className="discovery-listing">
    <Link className="public-item-card-link" aria-label={item.name} to={`/app/items/${item.id}`} state={{ discoverySearch: search ? `?${search}` : '' }}>
      <span className="discovery-listing-media">
        <PublicItemCover key={item.coverImage?.id || item.imageAvailability || 'legacy'} item={item} />
        <span className="discovery-listing-status">
          <span className={`ui-status ${later ? 'ui-status--later' : 'ui-status--now'}`}>{later ? 'Available Later' : 'Available Now'}</span>
          {item.isOwner === true && <span className="ui-status ui-status--owner">Your listing</span>}</span>
      </span>
      <h3>{item.name}</h3>
    </Link>
    {(type || category) && <p className="discovery-listing-type">{[type, category].filter((value, index, all) => value && all.indexOf(value) === index).join(' · ')}</p>}
    <p className="discovery-listing-place">{[item.neighborhood, item.city || item.metroLabel, item.city ? stateCode : null].filter(Boolean).join(', ')}</p>
    {condition && <p className="discovery-listing-condition">Condition: {condition}</p>}
    <p className="discovery-listing-pickup">{later && <>From <time dateTime={item.availableFrom}>{formatDeadline(item.availableFrom)}</time> · </>}Pickup until <time dateTime={item.effectiveAvailableUntil}>{formatDeadline(item.effectiveAvailableUntil)}</time></p>
  </li>;
}
