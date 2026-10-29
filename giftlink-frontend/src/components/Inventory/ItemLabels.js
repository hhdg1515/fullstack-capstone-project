import React from 'react';
export default function ItemLabels({ item }) {
  const type = item.classification?.customItemType || item.classification?.itemType?.label || item.classification?.category?.label || item.category;
  const condition = item.classification?.condition?.label;
  const labels = [type, condition].filter(value => typeof value === 'string' && value);
  return labels.length ? <p className="discovery-category">{labels.join(' · ')}</p> : null;
}
