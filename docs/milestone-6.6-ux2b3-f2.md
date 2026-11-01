# UX-2B3 F2 — Timezone and draft form validation

Branch: `codex/m66-ux2b3-item-first-frontend`. All prior uncommitted B3/F1
work is retained. This checkpoint is F2 only; nothing is committed or pushed.

## Form and API behavior

The independent form is now `components/Listings/ListingForm.js`, still exported
through `Listings.js` so existing routes and account/path keys remain intact.
It uses the existing PageHeader, Surface, Feedback, useFormErrors,
ItemTypeSelector, RegionFields, catalog API and scoped design-system styling.
Legacy v1 Inventory forms and backend validators are not modified.

Timezone suggestions come exclusively from the selected canonical metro's existing
`suggestedTimeZone`. They appear as a suggestion/button, not an implicit value or
confirmation. Choosing a suggestion fills the zone but leaves it unconfirmed.
Existing server-confirmed context is displayed checked. Actual changes to state,
metro, city, neighborhood or timezone clear confirmation; explicit uncheck also
sends `pickupTimeZoneConfirmed:false`. Confirmation edits send the exact selected
zone and content version through the approved API. Untouched confirmation is
omitted, preserving the server's confirmation timestamp rather than silently
issuing fresh confirmation on every text/deadline edit. No browser/account timezone
is inferred and no v1 UTC or appointment semantics change.

A private draft requires only a valid name. Classification, condition, region,
zone and dates stay optional. Supplied dates/zones receive format/window hints;
the backend remains authoritative for local dates, past starts and publication
policy. Category/type relationships and custom Other reuse the existing catalog.
The UI never submits publication or image/pickup operations.

Backend field errors are associated with all relevant native controls; category
errors map to the searchable type control that actually assigns the category.
The alert summary includes focusable links, fields use aria-invalid/describedby,
and the existing hook focuses the first invalid control after submission. Editing
clears the affected errors, removing the summary when its last field error clears.
An unclassified 409 is shown as a changed/unavailable record, not a field error:
values remain, resubmission is blocked, and a new-tab canonical review is offered.
Cancel remains an explicit guarded discard path. No automatic overwrite or retry.
Feature-disabled 503 is a definite unavailable state, not an ambiguous creation.
Network/ambiguous creates retain their content and duplicate-submit block.

Save Draft exists immediately after the name and again at the form end, using one
submit handler/in-flight fence. Neither uses a sticky overlay. Scoped CSS allows
wrapping and narrow native fields. Selector selection does not move the top save
control; keyboard Tab/Enter reaches and activates it. F1 test click selectors now
explicitly choose the first of these equivalent controls; ownership/response-race
assertions are retained.

## Executed checks

- Focused frontend: **92 passing, 7 suites, 0 failures**. Includes 18 form cases
  alongside all six F1 suites. Checks cover name-only drafts, one in-flight POST,
  opt-in suggestion, all five context invalidations, explicit uncheck, unchanged
  confirmation, exact-zone new confirmation, deadline-only preservation, local
  validation/focus/ARIA/error clearing, server metro/category/condition mapping,
  stale edit retention, ambiguous creation, and feature-disabled handling.
- Strict production build: `CI=true REACT_APP_BACKEND_URL='' npm --prefix
  giftlink-frontend run build` passed. Whitespace check passed.
- Actual HTTPS Chromium: **9 passing, 0 failures** across two commands:
  three F2 cases (`listing-form-f2.spec.cjs`, project desktop with explicit actual
  widths **1440, 320, 375**) plus F1 desktop three and F1 mobile/320 three.
  These are local verified disposable MongoDB replica sets using existing guarded
  preparation; only their injected owner API flag is enabled. Photos remain off.
- Each F2 width creates a name-only draft and verifies no hidden plan, keyboard
  Tab/Enter save, real searchable type selection followed by a pointer save,
  explicit LA confirmation producing BSON expiry `2027-11-13T08:00:00.000Z` for
  deadline `2027-11-12`, city change removing confirmation/expiry, actual backend
  past-start field error/focus, and a real concurrent PATCH causing stale-version
  rejection without overwriting the local edit. Three axe scans of the validation
  state report zero WCAG A/AA violations; all three assert no horizontal overflow.
- F1 rerun retains actual-account delayed 200/401 response isolation, DOM checks,
  logout/login, direct ownership denial, refresh/Back/Forward, exact v1/v2 PATCH
  separation and actual session expiry. Not just component remount/build evidence.

Initial checks found an unused import after form extraction and a duplicate-submit
unit fixture looking for the old Save Draft label after it became Saving. The
import was removed; the test now submits the form twice while the same request is
pending. No security assertion, rate limit, timeout or retry policy was relaxed.

## Remaining scope and limits

No full milestone-wide backend/frontend/photo/browser regression or GitHub CI is
claimed for this focused checkpoint. The pre-existing intermittent C1 browser
timeout remains documented in F1/B2; the focused runs do not establish its repair.
Headless Chromium keyboard interactions and responsive viewports do not certify
physical iOS/Safari virtual keyboards or manual screen-reader behavior.

F3/F4 and original B3 final acceptance still need their separately scoped remaining
page/UX review, genuine screenshot evidence, and complete milestone regression /
review delivery. This is not completion of all UX-2B3 requirements. V2 publishing,
withdrawal, photos, pickups and messaging remain UX-2C dependencies and disabled.
No backend authorization/schema, production setting, remote Atlas/R2 resource,
provider or deployment was changed. No commit, push, PR or merge was performed.
