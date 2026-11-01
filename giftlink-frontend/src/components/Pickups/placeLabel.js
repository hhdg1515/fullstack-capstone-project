export const placeLabel = item => [item.neighborhood, item.city].filter(Boolean).join(', ') || item.metroLabel || 'General area not listed';
