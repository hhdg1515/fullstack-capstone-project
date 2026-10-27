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

## Plan timezone and appointment input implementation

Create/Edit Plan now reuse PageHeader, Surface, Feedback and shared control tokens.
A valid zone is shown as one plan-level contextual setting. Change pickup timezone
opens the native correction disclosure; missing/ambiguous settings remain open,
and setup links/server errors open and focus that same labeled input. Curated
suggestions still fill only a blank value; assigning a different metro never
overwrites an explicit zone. No per-item timezone is introduced.

New appointment/proposal minimums use the next minute of an explicit instant
formatted in the pickup IANA timezone. They never parse browser-local midnight
as an appointment. Submit-time hints are recalculated; server Temporal validation
remains authoritative for the actual instant, DST gaps/folds, UTC end cutoff and
stale proposals. The browser hint cannot prove DST validity and does not replace
any server check. No server pickup or rescheduling rule changes in this PR.

Plan screenshots: [desktop before](assets/milestone-6.4b/before-plan-timezone-desktop.png)
and [after](assets/milestone-6.4b/timezone-plan-timezone-desktop.png);
[320px before](assets/milestone-6.4b/before-plan-timezone-mobile.png) and
[after](assets/milestone-6.4b/timezone-plan-timezone-mobile.png).

## Owner status model and clearance provenance

| Owner label | Authoritative meaning / next action |
| --- | --- |
| Draft | Stored draft; private. Complete details and publish when ready. |
| Posted | Available/public according to the backend and no accepted reservation. Future pickup starts are shown separately. |
| Reserved | Backend accepted-request flag; review pickup requests. This never means handed over. |
| Hidden | Withdrawn, or an available item that is not public (for example an inactive plan). No clearance increment. |
| Expired | Effective UTC pickup end passed. Review dates/plan and explicitly publish again. An existing accepted reservation remains visible as secondary context. |
| Picked Up | Cleared with verified current-clearance completion provenance. Recorded handoff, not acceptance. |
| Cleared | Dealt with manually or historical clearance without verified provenance. No assertion that collection did or did not happen. |

The existing completion transaction additionally records a private
`clearedByPickupRequestId`; normal manual clearance/reopen removes it. Private
owner-list reads use the existing `_id` index, project only bounded first/last
history events and reference/status fields, and verify item/plan/giver/original
participants, completed/closed state and completion event/time. Only an
`isPickedUp` boolean is serialized; identifiers/events never enter public APIs.
Deleted, corrupt, cross-owner or unrelated references fail conservatively.
Unmarked historical records stay unchanged and display Cleared. No backfill,
index creation, appointment or message lifecycle change is introduced.

Cards group title/status, type/condition, pickup bounds and owner actions. Edit/
Publish/Hide listing are explicit; incomplete drafts offer Complete listing to
open the existing editor. More actions contains confirmed manual clearance or
reopening. Accepted reservations link to requests for the formal handoff; no new
direct “picked up” action bypasses its time/role checks. Filters use the same
owner labels and progress still comes from the backend's full inventory.

Write guards prevent simultaneous form/card mutations. A failed/stale save keeps
its draft; a consequential action on the edited item first checks draft discard
and retains the draft if cancelled/failed. Inventory reload/authorization errors
remain recoverable and never masquerade as empty success. No localStorage draft,
automatic write retry, deletion or public disclosure is added.

## Final visual evidence and acceptance

All images are actual production-build pages with disposable synthetic local
records. Baseline and final audits each cover 12 views at desktop/320px with no
axe WCAG A/AA violations, horizontal overflow or server errors. Long titles and
descriptions, blank/first item, field validation, unsaved edits, date overrides,
Draft/Posted/Reserved/Cleared and newly confirmed Picked Up are included. Concept
generation is not used as implementation evidence.

| State | Desktop before / final | 320px before / final |
| --- | --- | --- |
| Inventory and real statuses | [Before](assets/milestone-6.4b/before-inventory-desktop.png) / [Final](assets/milestone-6.4b/after-inventory-desktop.png) | [Before](assets/milestone-6.4b/before-inventory-mobile.png) / [Final](assets/milestone-6.4b/after-inventory-mobile.png) |
| Creation | [Before](assets/milestone-6.4b/before-empty-desktop.png) / [Final](assets/milestone-6.4b/after-empty-desktop.png) | [Before](assets/milestone-6.4b/before-empty-mobile.png) / [Final](assets/milestone-6.4b/after-empty-mobile.png) |
| Validation | [Before](assets/milestone-6.4b/before-validation-desktop.png) / [Final](assets/milestone-6.4b/after-validation-desktop.png) | [Before](assets/milestone-6.4b/before-validation-mobile.png) / [Final](assets/milestone-6.4b/after-validation-mobile.png) |
| Unsaved edits | [Before](assets/milestone-6.4b/before-unsaved-desktop.png) / [Final](assets/milestone-6.4b/after-unsaved-desktop.png) | [Before](assets/milestone-6.4b/before-unsaved-mobile.png) / [Final](assets/milestone-6.4b/after-unsaved-mobile.png) |

The additional strictly local desktop/mobile browser journey exercises missing
publication fields/focus, name-only draft, atomic complete-and-publish with double
click prevention, region suggestion/explicit timezone preservation, reservation
versus actual completion, manual-clearance cancellation, unsaved navigation/edit
cancellation and stale-version recovery. The existing two-account
discovery/pickup/chat/rescheduling suite is retained. CI links/exact counts are
recorded at immutable PR heads, in review order #49 → #50 → the inventory PR.
No hosted E2E or production readiness claim follows. Physical Safari/iOS,
screen-reader testing and earlier public-launch gates remain unverified.

Rollback reverts UI adoption before its prerequisites. There is no migration to
undo; optional markers can remain. Rolling back backend publication enforcement
also restores its older permissive policy, so a future release/rollback must pair
compatible UI/API versions. No rollback, merge or deployment is executed here.

Final local checks: backend lint and **299 tests**, **279 frontend tests**, strict
production build and **56 policy tests** passed, plus actionlint, whitespace,
documentation targets and byte-identical preservation of all 16 demo gifts.
The full isolated HTTPS suite includes **26 desktop/mobile scenarios** (24
existing plus two refinement scenarios); immutable final results/CI links are
recorded in the PR. No workflow, dependency/lockfile, guarded preparation/index
definition, remote data budget, cleanup or provider configuration changed.
