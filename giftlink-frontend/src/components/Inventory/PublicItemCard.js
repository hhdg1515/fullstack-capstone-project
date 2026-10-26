import React from 'react';
import { Link } from 'react-router-dom';
import { Surface } from '../../design-system/primitives';
import { formatDeadline } from '../MoveOutPlans/dates';

export default function PublicItemCard({ item, search, stateCode }) {
  const type = item.classification?.itemType?.label;
  const category = item.classification?.category?.label || item.category;
  const condition = item.classification?.condition?.label;
  return <Surface as="li" className="discovery-listing">
    <div className="discovery-listing-heading">
      <h3><Link to={`/app/items/${item.id}`} state={{ discoverySearch: search ? `?${search}` : '' }}>{item.name}</Link></h3>
      {(type || category) && <p className="discovery-listing-type">{[type, category].filter((value, index, all) => value && all.indexOf(value) === index).join(' · ')}</p>}
    </div>
    <p className="discovery-listing-place">{[item.neighborhood, item.city, stateCode].filter(Boolean).join(', ')}</p>
    {condition && <p>Condition: {condition}</p>}
    <div className="discovery-listing-pickup">
      <div className="discovery-listing-status"><span className="ui-status">Free</span><span className="ui-status">{item.availability === 'later' ? 'Available Later' : 'Available Now'}</span>
        {item.isOwner === true && <span className="ui-status">Your listing</span>}</div>
      <p>{item.availability === 'later' && <>From <time dateTime={item.availableFrom}>{formatDeadline(item.availableFrom)}</time> · </>}Pickup until <time dateTime={item.effectiveAvailableUntil}>{formatDeadline(item.effectiveAvailableUntil)}</time> <span className="discovery-listing-utc">(UTC)</span></p>
    </div>
  </Surface>;
}
