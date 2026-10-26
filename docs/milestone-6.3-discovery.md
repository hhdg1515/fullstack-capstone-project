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
