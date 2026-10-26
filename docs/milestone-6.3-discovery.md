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

## Structured classification

`GET /api/item-taxonomy` supplies six household category groups, their controlled
item types and four optional conditions. IDs are stable slugs; display labels and
a small explicit search-term list live in backend `data/item-taxonomy.json`.
Category and type are optional (Uncategorized / Not specified); Other Household
→ Other is the explicit fallback. Condition is independently optional: Like New,
Good, Fair, or For Parts / Repair. Only the item name remains required.

Native items may store `categoryId`, `itemTypeId` and `condition`. The old
`category` string is retained unchanged, including unmapped legacy values. The
new form never sends an edit to that string and displays it on legacy records.
Older API clients may still use the original bounded category field; this adds
no new free-form tags. The server checks the full resulting category/type tuple
inside the existing item transaction on partial edits; changing category must
clear or replace an incompatible type. Public/private item DTOs add a
`classification` with ID/label pairs, never private account or pickup details.
Titles/descriptions, save-draft/publish, item versions and all date rules remain
separate and unchanged. No collection, migration, dependency or index is added.

## Regional query and counts

Regional browsing starts at `moveOutPlans` using the `plan_metro_discovery`
index (`metroId`, `status`, `stateId`, `_id`), then joins items through the
existing plan/owner index. Validate the selected state/metro pair first; query
the metro across all its member states, never guess from city text. Native plan
region IDs and configured timezone must be scalar strings. Existing publication,
plan/item ownership, active status and UTC-date eligibility rules apply. A regional
feed excludes accepted reservations and plans without pickup timezone setup;
public individual links remain readable with existing reservation/setup notices.

One snapshot aggregation uses a facet for the page and **total filtered eligible
count before the cursor boundary**. All filters precede that facet, including
availability, inherited dates, exact normalized city/neighborhood, category/type,
condition and text. Newest/deadline sorting keeps ObjectId tie-breakers and
publication cutoffs; cursor fingerprints bind every filter and page size.
Counts/pages are coherent per response, not a permanent snapshot across separate
HTTP calls. Availability can change; refresh remains necessary. Query execution
is limited to five seconds with disk spill disabled; busy/errors are not emptiness.

Text remains literal/escaped and bounded. An explicit catalog mapping supports
sofa/couch, bookshelf/bookcase, nightstand/bedside table, kitchenware/cookware and
clothes rack/clothing rack; exact type labels/terms also match standardized IDs
when a custom title does not repeat the type. Existing name, full-description and
legacy-category text matching remains. There is no external search or tag service.

Public DTOs include only canonical region ID/label pairs and a session-validated
owner boolean, never an owner/account ID. Scoped city/neighborhood options reuse
the existing normalization and bounded metadata endpoint. The backend query PR
temporarily retains the old unscoped feed for its unchanged frontend; the dependent
region-first UI PR removes that compatibility path and requires region selection.
Older application cursors must refresh because the filter fingerprint expanded.

The new index is an application definition only. Readiness fails without it;
startup performs no DDL. A future deployment requires a separately approved
remote dry-run and exact target/fingerprint-confirmed apply, covering this index
and any missing Phase 1 message index. Local preparation tests preserve every
record and never assign regions, seed gifts or rewrite accounts. No remote
preview/apply is part of this milestone.
