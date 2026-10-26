# Milestone 6.3 — Location-first discovery

## Architecture decision (before implementation)

Baseline: merged main `3f8c452d700d9d4f5593a973311b4dd6d22afb2c` (PRs #40–#41).
Plans already own city/neighborhood labels and an explicit IANA pickup timezone;
items inherit those through `planId`. Keep those canonical relationships. Add
optional validated state FIPS/metro CBSA IDs to plans, never duplicate them on
items or infer a legacy location from free text. Preserve old labels and direct
listing links; owners explicitly assign regions before metro discovery includes
their older plans. A static, dated public directory provides IDs and display
labels, not geocoding or verification of a residence. Unsupported coverage stays
explicit. Prefill only a blank timezone where directory coverage supports it;
preserve explicit zones and existing DST/transaction rules.

Add optional category/type IDs and condition separately from legacy category
text. Validate the full resulting category/type relationship on partial edits.
Keep titles/descriptions and existing category strings. No destructive migration,
new collection, map API, geolocation permission or dependency is needed.

Discovery will require a validated state/metro pair, query canonical plan region
IDs and join their items. One cross-state metro covers its member states; the
state selector is an entry point, not a separate inventory. Use a shared MongoDB
eligibility pipeline for counts and pages, excluding reservations and unavailable
listings, with existing date filters/sorts/cursors plus category/type/condition
and literal text/small explicit synonyms. Add a guarded plan-region index only
if the query uses it. Browser-local region preference stores IDs only and never
changes a plan. API errors must remain distinct from empty results.

## Ownership audit and first fix

The existing `createPickupService.create` compares the session-derived requester
with the canonical plan owner inside `planTransaction`, after checking item/plan
ownership. It already rejects self-requests with `409 OWN_ITEM`; baseline tests
cover this. The reported problem is a frontend action, not a demonstrated server
authorization bypass. Public DTOs intentionally exclude account/owner IDs.

Expose only an `isOwner` boolean on public detail after optional **server session
authentication**, never a private owner identifier. Anonymous/expired sessions can
still browse. Render Your listing instead of Request pickup on owned details and
on the direct request form. Existing no-store responses, authenticated writes,
Origin/CSRF checks and backend rejection remain authoritative. Refresh public
details when the authenticated viewer changes, ignoring stale replies.

Review order: owner-facing fix, directory/plan association, structured taxonomy,
then discovery query/UI integration and regressions. Each dependent PR names its
base and must be retargeted after its prerequisite merges. Nothing is merged,
deployed, remotely seeded/prepared or verified through hosted E2E in this task.

## Directory and plan association

`GET /api/regions` serves the one canonical static catalog in backend
`data/us-regions.json`; React consumes it rather than maintaining another region
list. It contains all 50 states and DC (two-digit Census/state FIPS IDs, USPS codes
and separate display labels) and 12 explicitly curated five-digit CBSA metro IDs.
Membership comes from the official Census CitySDK snapshot, not guessed city
names: [2021 metros](https://github.com/uscensusbureau/citysdk/blob/fc5d7880529fedcde181269fc5d518767221281e/v2/GeoJSON/20m/2021/metropolitan-statistical-area!micropolitan-statistical-area.json)
and [2022 states](https://github.com/uscensusbureau/citysdk/blob/fc5d7880529fedcde181269fc5d518767221281e/v2/GeoJSON/20m/2022/state.json).
The source commit and full-file SHA-256 hashes are recorded in the catalog.
Only identifiers/names/membership are bundled, not geometry or a mapping SDK.

This is **2021 metro geography**, not a claim of current OMB boundaries or all
cities covered. For example NY–NJ–PA and IL–IN–WI retain that snapshot's explicit
membership. The UI states the vintage. Coverage expansion uses reviewed CBSA
entries with existing IDs, not item rewrites. A future vintage change needs a
membership/retired-ID compatibility review before changing assignments; do not
silently reinterpret an existing plan under changed boundaries.

Plans may store `stateId` and `metroId`; items never store them. A state without
curated coverage may be saved with null metro. Older plans omit both stored
fields and return null IDs/labels; ordinary edits preserve them unassigned. Owners
can explicitly assign or clear a pair. No city strings are geocoded, normalized
into regions or evidence of residency. City/neighborhood labels stay unchanged.
Only supported IDs and valid state/metro membership are accepted by the backend,
including after a partial update. Any state/metro change uses the existing plan
transaction and explicit cancellation confirmation for outstanding requests.

The form suggests a zone only for an empty field in the reviewed single-zone
subset (California, Seattle, Boston/New York/Washington and Denver entries).
Chicago, Dallas, Phoenix and Portland remain explicit selections because this
snapshot alone does not verify county-level timezone coverage in their
multi-timezone states. Existing explicit zones, including UTC, are preserved.
Suggestions do not change server publication, IANA/DST or pickup validation rules.
Review the timezone after changing region. Saving without a metro is supported,
with a clear warning that the plan will not appear in regional discovery.
