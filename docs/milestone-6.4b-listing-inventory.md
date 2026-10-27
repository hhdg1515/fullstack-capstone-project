# Milestone 6.4B: listing and inventory refinement

Baseline: merged main `1e8bab2bd2228bbb21167c2c8d89788759b2aa94`, including
6.4A PRs #47–#48. This audit/proposal precedes implementation. Reuse the
[existing design system](design-system.md); no new framework or dependencies.

## Existing behavior

- Item form: name, optional category/type, collapsed description/condition and
  two optional UTC calendar dates; Save draft & add another / Publish & add
  another. Only name is required by the API, including publication.
- Plan owns region, city/neighborhood, IANA timezone and move-out deadline.
  There is **no separate plan pickup-window start/end model**. Null item end
  inherits the deadline; explicit item end may be earlier but never later.
- Item dates are calendar bounds, not midnight appointments. Earlier availability
  can remain ongoing. Publication requires an effective end today or later UTC.
  Appointments are actual future instants interpreted in the giver's timezone;
  Temporal rejects nonexistent/repeated DST times and checks the UTC end cutoff.
- Items store draft/available/unlisted/cleared/expired; expiration is also derived
  on read. Accepted request means reserved, not collected. Recorded completion
  clears the item; manual clearance also clears it, so existing `cleared` alone
  cannot truthfully be relabeled Picked Up.
- All owner writes use authenticated owner/plan/item filters, item version checks
  and the shared plan transaction lock. Availability/location/timezone/withdrawal
  changes invalidate requests only after explicit cancellation confirmation.
- Inventory has Edit, Publish/Relist, Unlist, Mark cleared, Reopen as draft and
  Public listing. Existing items precede a collapsed add form; repeated creation
  preserves focus. Drafts stay in memory with navigation/beforeunload protection.
- The plan owns canonical region IDs; item taxonomy has six groups/28 types,
  condition separate, legacy category strings preserved. No per-item geography
  or timezone entry is needed. Valid configured plan zones already suppress setup
  prompts; plan forms still always show the full timezone input/help.

## Proposed focused implementation

1. **Publication/form:** keep name-only drafts. Require name, canonical category,
   matching item type and nonblank description on every explicit publication or
   republication, enforced within the server transaction. Mark successful new
   publications with a server-only requirements version; edits to these posted
   items must keep their required details. Existing unmarked public items remain
   readable/editable without migration, but their next explicit publication uses
   the new rules. Preserve their original category text. Permit a versioned draft
   edit and publication in one existing PATCH transaction rather than two writes.
   Use concise Save Draft / Publish / Save Changes, with repeated creation intact.
2. **Availability/timezone:** show Available from and an inherited end summary;
   remove Available until from creation and remove Use plan availability. Keep an
   editable advanced end override only on existing items, including conflict
   resolution. New past start dates are rejected using UTC calendar comparisons;
   unchanged historical starts and immediate/today availability remain valid.
   Appointments keep the existing server instant/DST rules; add browser minimums
   computed in the explicit pickup timezone, never the browser zone. Suggested/
   configured plan timezone is contextual; a labeled correction control retains
   explicit input, errors/focus and cancellation safeguards. Never change an
   already configured zone just because the region changes.
3. **Owner inventory:** shared PageHeader/Surface/Feedback and compact cards.
   Draft, Posted, Reserved, Hidden, Expired and Cleared retain distinct meanings.
   Picked Up is shown only with verified completion provenance for the current
   clearance; old ambiguous clearance stays Cleared. Record a private link on
   new existing handoff completions, clear it on manual clearance/reopen and
   verify its request/owner/item/plan/status references before returning a boolean.
   No participant or request details enter public APIs. Keep manual clearance in
   labeled More actions with confirmation; do not invent a direct pickup action
   or delete records. Reserved items link to incoming requests for the formal
   handoff process. Hidden does not count as cleared.

These change presentation and narrow publication validation, not pickup/chat/
rescheduling state machines. No retroactive normalization, migration or new index.
The publication marker and handoff provenance are written only by normal approved
application operations after a future deployment, not by any remote operation
during this task. Legacy clients publishing name-only records must add details.

## Verification and review

Capture actual before/after production-build screens with verified disposable
local data, desktop and 320px: empty, draft, posted, reserved, cleared/completed,
validation and unsaved edits. Test publication requirements, legacy edits,
inheritance/overrides, historical/today/future date boundaries, timezone/DST,
atomic publication/version conflicts, authorization, reservation confirmation,
provenance and duplicate writes. Preserve all existing request/chat/reschedule,
regional discovery and 16-gift tests. CI/policy/hosted limits stay intact.

Use three dependent focused PRs in the order above, each with its own normal CI,
changed files, compatibility notes and evidence. No merges, manual deployment,
hosted E2E, remote data/index or provider/secret/DNS changes. Existing Vercel Git
previews may run automatically on PR pushes; they are not hosted readiness proof.

## Publication/form implementation and compatibility

`POST .../items` with `publish:true`, the existing publish action and a versioned
`PATCH .../items/:id` with `publish:true` now validate the full candidate in the
same transaction. The PATCH supports completing a draft and publishing in one
write; a false/missing publish flag never withdraws a posted item. Failed detail,
classification, policy, version, date or ownership checks commit no changes.
The private `requiresPublicationDetails` boolean reflects a server-only version
marker; neither marker nor private boolean enters public discovery. Legacy
unmarked posts retain ordinary edit compatibility and original category text.

Draft saving still needs only a name; condition is optional. The item form now
uses the shared Surface/Feedback, native controls and tokens. Description and
classification are visible, end is inherited on creation, and existing overrides
remain editable/can be cleared under Pickup end override. Save Draft / Publish /
Save Changes are distinct; a synchronous guard blocks competing submits. Existing
draft guards, conflict/error focus and reservation cancellation remain.

Before/after evidence uses actual local HTTPS production builds and disposable
accounts, not generated mockups:

| State | Desktop before / after | 320px before / after |
| --- | --- | --- |
| Empty / first creation | [Before](assets/milestone-6.4b/before-empty-desktop.png) / [After](assets/milestone-6.4b/publication-empty-desktop.png) | [Before](assets/milestone-6.4b/before-empty-mobile.png) / [After](assets/milestone-6.4b/publication-empty-mobile.png) |
| Field validation | [Before](assets/milestone-6.4b/before-validation-desktop.png) / [After](assets/milestone-6.4b/publication-validation-desktop.png) | [Before](assets/milestone-6.4b/before-validation-mobile.png) / [After](assets/milestone-6.4b/publication-validation-mobile.png) |
| Existing end override | [Before](assets/milestone-6.4b/before-override-desktop.png) / [After](assets/milestone-6.4b/publication-override-desktop.png) | [Before](assets/milestone-6.4b/before-override-mobile.png) / [After](assets/milestone-6.4b/publication-override-mobile.png) |

The publishing test fixtures now supply canonical classification/description.
The bounded two-account browser journey keeps exactly the same three items and
existing data limits: its shorter per-item expiry fixtures use the existing owned
versioned PATCH after publication. No extra remote fixtures or cleanup scope.
Backend tests also cover atomic failures, legacy posts, required-detail removal,
past/today/unchanged historical dates and competing publish versions. Screenshot
audits before/after each sampled 12 views with no axe violations/overflow.
Exact verification and immutable CI heads are recorded per PR.
