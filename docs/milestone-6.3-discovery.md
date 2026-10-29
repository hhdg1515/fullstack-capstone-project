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
and separate display labels) and initially 12 curated five-digit CBSA metro IDs; the additive
[6.4C directory expansion](geographic-directory.md) supplies 50 at the same vintage.
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
Category and type are optional on drafts and historical posts; 6.4B requires
complete classification/description on explicit publication. Other Household
→ Other is the original global fallback. The additive [classification UX update](item-classification-ux.md) expands types, adds category-specific Other options and optional bounded custom labels without changing existing IDs. Condition is independently optional: Like New,
Good, Fair, or For Parts / Repair. Name-only draft creation remains supported.

Native items may store `categoryId`, `itemTypeId` and `condition`. The old
`category` string is retained unchanged, including unmapped legacy values. The
new form never sends an edit to that string and displays it on legacy records.
Older API clients may still use the original bounded category field; this adds
no new free-form tags. The classification UX follow-up adds only an optional, validated public `customItemType` description for controlled Other types. The server checks the full resulting category/type tuple
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
the existing normalization and bounded metadata endpoint. Listing queries now
require a state/metro pair (`400 REGION_REQUIRED` when missing); there is no
unscoped fallback. Bounded legacy label-only metadata and individual public item
links remain compatible without a selected browsing region.
Older application cursors must refresh because the filter fingerprint expanded.

The new index is an application definition only. Readiness fails without it;
startup performs no DDL. A future deployment requires a separately approved
remote dry-run and exact target/fingerprint-confirmed apply, covering this index
and any missing Phase 1 message index. Local preparation tests preserve every
record and never assign regions, seed gifts or rewrite accounts. No remote
preview/apply is part of this milestone.

## Browsing preference, UI and compatibility

The discovery page first asks Where would you like to find free items? No listing
query occurs until the directory validates State → Metro. Picking a metro loads
it directly; Change region remains available and returns keyboard focus safely.
The selected metro and exact filtered count form the page heading. Category,
type, condition and existing date/city/neighborhood/sort controls remain under
Filters. A type/condition label replaces redundant category badges on item cards;
owner listings stay visible with Your listing and no self-request action.

Browser-local `moveout.browse-region.v1` contains only `{ stateId, metroId }`.
Explicit URL values override it, invalid/unsupported preferences are ignored,
and blocked storage still permits URL-based browsing. This preference is shared
by accounts using that browser, not synchronized to an account or a plan. Direct
item views do not change it. Search/filter URLs preserve sharing and Back/Forward;
Clear filters retains the region. Region changes drop incompatible city,
neighborhood and cursor values while preserving applied search filters.

The frontend rejects missing counts, reserved/misrouted region rows and malformed
feed/catalog responses as service errors, never zero results. A changed total
while loading another page starts a fresh first page instead of combining known
inconsistent availability snapshots. Other errors keep an explicit retry; POSTs
are not retried automatically. Location errors have an independent retry.

Older plans keep their labels and direct links, and can be created/saved before
metro assignment or timezone setup. Their owner sees clear setup actions. They
enter regional discovery only after an explicit valid assignment and configured
timezone. Browsing preference never edits those records. The 16 bundled demo
gifts use their existing separate legacy collection/routes, so no synthetic region
assignments, fixture rewrite or change to the guarded demo seed is necessary.

Review/merge order: **#42 owner-facing state → #43 directory/plans → #44 taxonomy
→ #45 regional query/counts → the dependent region-first UI PR**. Retarget each
dependent PR to main after its prerequisite merges. Rollout must pair the new
frontend/backend and prepare required indexes only after separate approval.
Unscoped native-list clients receive 400 and old cursors need refresh. No schema
migration, user preference expansion or remote operation accompanies a merge.

## Verification boundary

Local backend lint and **292 tests**, **261 frontend tests**, strict production
build, **56 policy tests**, **22 local HTTPS browser scenarios**, actionlint and
whitespace checks passed. Desktop and 320px mobile include automated WCAG A/AA
checks. CI links and immutable heads are recorded in the PRs. Fixtures verify
region selection/persistence, controlled creation, synonym search,
counts/excluded reservations, filter empty/error recovery, plan-location
independence and owner actions, alongside existing chat/rescheduling journeys.

A separate default `db:prepare` preview on a verified disposable local replica
set reported 12 definitions, zero conflicts and a valid fingerprint without
creating collections. Required-index tests cover fail-closed startup and repeated
local initialization without rewriting plans/accounts/messages/gifts. No remote
dry-run/apply or hosted browser test was performed. Existing Vercel Git-linked
preview statuses are not live staging verification. Real iOS/Safari keyboards,
screen readers, provider capacity and production readiness remain unverified;
the earlier Atlas/recovery/dependency/public-launch gates remain separate.
