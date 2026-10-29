export const regions = { version: 'test', states: [{ id: '06', code: 'CA', label: 'California' }, { id: '02', code: 'AK', label: 'Alaska' }, { id: '41', code: 'OR', label: 'Oregon' }, { id: '53', code: 'WA', label: 'Washington' }],
  metros: [{ id: '41860', label: 'San Francisco-Oakland-Berkeley, CA', stateIds: ['06'], suggestedTimeZone: 'America/Los_Angeles' },
    { id: '31080', label: 'Los Angeles-Long Beach-Anaheim, CA', stateIds: ['06'], suggestedTimeZone: 'America/Los_Angeles' },
    { id: '38900', label: 'Portland-Vancouver-Hillsboro, OR-WA', stateIds: ['41', '53'], suggestedTimeZone: null }] };
export const taxonomy = { categories: [
  { id: 'living-room', label: 'Living Room', itemTypes: [{ id: 'sofa', label: 'Sofa', searchTerms: ['couch'] }, { id: 'television', label: 'Television', searchTerms: ['tv'] }, { id: 'living-room-other', label: 'Other Living Room', custom: true }, { id: 'coffee-table', label: 'Coffee Table' }] },
  { id: 'office-lighting', label: 'Office & Lighting', itemTypes: [{ id: 'desk', label: 'Desk' }, { id: 'monitor', label: 'Monitor' }] },
  { id: 'other-household', label: 'Other Household', itemTypes: [{ id: 'other', label: 'Other', custom: true }, { id: 'bicycle', label: 'Bicycle', searchTerms: ['bike'] }, { id: 'vacuum-cleaner', label: 'Vacuum Cleaner' }] }],
  conditions: [{ id: 'good', label: 'Good' }, { id: 'fair', label: 'Fair' }] };
