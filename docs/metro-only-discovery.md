# Metro-only discovery

Find items asks for one metro area. City and Neighborhood are no longer browse
controls: an inventory-derived list of labels could be mistaken for a coverage
directory and make a new resident think their community is unsupported.

- Keep the canonical state/metro binding, remembered browser-local metro,
  cross-state metro coverage, server filtering, exact totals and cursor bounds.
- Keep search, category/type, condition, sort, three-column desktop cards,
  anonymous browsing and owner-aware actions.
- Keep general location labels on cards/details when present. Existing records
  and plan references are untouched. Independent listing city/neighborhood
  remain optional; there is no account-city eligibility requirement.
- Coordinate an exact handoff location in the participant-only conversation.
  Do not add public residential addresses, infer a location or create a new
  city/community directory.

## Old links and compatibility

The frontend removes `city` and `neighborhood` from old discovery links and
replaces the history entry. It also drops the cursor tied to those filters.
Normalization happens before the first listing request: hidden filters never
silently exclude items, while metro/search/classification/sort choices remain.
Clearing does not overwrite saved item/plan labels or browser-local metro.

The frontend no longer requests `/api/items/locations`, including on focus or
session changes. The backend endpoint and city/neighborhood query parameters
remain available for compatibility with old clients. Their authentication,
privacy, publication, reservation, time-window and exact-count rules are unchanged.
An older cached frontend can still show the previous controls until it updates.

## Verification and rollback

Component tests cover legacy link cleanup before any fetch, removal of a bound
cursor, Back/Forward and detail return links, all optional labels, viewer/session
isolation and no location-facet request. Isolated HTTPS tests cover the same URL
behavior, real regional counts, cross-state metros, visible filters, pagination,
private editing and handoff, responsive layouts and axe checks. A different
condition in the synthetic cross-state fixture replaces the removed city filter
in the combined-filter test; no backend filter or authorization assertion is removed.

Actual local screenshots: [desktop](evidence/metro-only-discovery/desktop-discovery.png)
and [mobile](evidence/metro-only-discovery/mobile-discovery.png).
Exact totals and final-head CI status are recorded in the pull request. Physical
Safari/iOS and hosted providers are not verified by local Chromium evidence.

Rollback is frontend-only. The retained backend API supports the prior selector
UI; no database/index changes, data conversion or provider configuration rollback
is needed. Leave all production photo gates unchanged.
