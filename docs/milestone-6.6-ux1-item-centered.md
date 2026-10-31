# Milestone 6.6 UX-1 — Item-centered interaction cleanup

## Scope and baseline

PR #75 was confirmed merged before work began. This branch starts at main
`61fdc25455e9db23200406d9309fc5fae88b33bd`. This is a presentation and navigation
change, with one narrowly scoped, read-only owner lookup. No database preparation,
storage activation, remote E2E, deployment or provider changes are required.

The actual baseline showed the creation form below the inventory, competing photo
ordering controls, catalog-order search results, a plan detour to edit a public
listing, collapsed discovery filters and technical request references. Real local
before/after images are linked below; generated designs are not evidence.

## Behavior and compatibility

* **Creation:** the existing form opens directly below Add item and before saved
  cards. Item name receives focus with `preventScroll`. Successful save still
  closes creation; another item requires Add item. There is no second create API
  or automatic retry after an uncertain save.
* **Editing:** an authenticated owner can open Edit item from the established
  `/app/items/:itemId` detail URL. `/app/items/:itemId/edit` reuses the same form,
  plan-scoped PATCH, optimistic version and independent text/photo buffers.
  Description, classification and pickup remain primary; condition and pickup-end
  changes use native disclosures. The single save area remains in document flow,
  without sticky overlays. Server errors retain the draft and focus the relevant
  field; hidden invalid fields are disclosed before focus.
* **Owner lookup:** `GET /api/items/:itemId/edit-context` requires a valid session
  and matching item **and parent-plan** ownership. It returns only canonical
  item/plan IDs to that owner, uses two indexed `_id` reads with query deadlines,
  inherits rate limiting and `no-store`, and returns 404 for invalid ownership or
  parent references. Public DTOs gain no private identifiers. Public draft access
  remains denied. All subsequent reads and writes recheck their own authorization.
  Release the compatible backend before or with the new frontend: an older API
  lacks this lookup and the additive Microwave/Mirror types.
* **Photos:** first usable selected photo is the default cover; FileList entries
  are prepared one at a time and uploaded sequentially under the existing single
  Save/Publish authorization. Unsupported entries cannot become covers. No order
  mutation is introduced. Existing C2 server order is preserved, including covers
  chosen before this release. Deleting the cover selects the next surviving Ready
  photo. Persisted-photo × has a 44px target, descriptive accessible name and the
  existing safe confirmation, revision and canonical status/list checks. Staged ×
  removes only that staged entry. No blind retry, quota refund or cleanup change.
* **Classification:** exact label, exact synonym, label prefix, synonym prefix,
  then substring; catalog order breaks ties. `tv` puts Television before TV Stand.
  Microwave (`microwave`) and Mirror (`mirror`) are additive canonical types.
  Every previous ID, label and category membership remains unchanged. Six category
  groups, global Other, custom validation and legacy text remain supported.
* **Discovery:** all existing filters remain visible and responsive. Only the
  disclosure state/control disappears; region preferences, URL precedence,
  server-side matching, exact counts and cursors are unchanged.
* **Pickup:** request IDs remain in routes, APIs and audit records, not visible
  prose. Empty optional notes and duplicate descriptions are omitted. Meaningful
  notes, requested time, appointment, status, item link and conversation/history
  remain available. No invented unread counts or identity badges are added.
* **Demo compatibility:** global demo footer links disappear, while demo routes,
  APIs and all 16 bundled records remain intact.

## Withdrawal safety primitive and UX-2 dependencies

The visible Hide listing button and its frontend action/confirmation mapping are
removed. Backend `unlist` remains an owner-authorized, CSRF-protected,
version-checked action. Existing cancellation confirmation, transaction and photo
revocation semantics remain tested. It is an internal safety primitive for urgent
privacy withdrawal, **not** an instruction to mark an item cleared or claim a
handoff. UX-2 must design a clear privacy/withdrawal entry point before public
launch; this milestone does not replace it with another confusing UI.

Mandatory plans are unchanged. A future standalone-item design must address all
of these current dependencies explicitly:

| Contract | Current plan dependency / migration requirement |
| --- | --- |
| Item identity and routes | `items.planId` plus owner; create/list/PATCH/actions are plan-scoped. The new edit-context lookup resolves this existing relationship, not a substitute parent. |
| Concurrency | `planTransaction` verifies plan ownership and increments `inventoryRevision` to serialize inventory/pickup/photo changes. Replacing this requires an equally strong transaction/fencing strategy. |
| Publication and availability | Plan active status, move-out deadline and item end override determine publication/expiry. Define independent item dates and legacy inheritance without silent reinterpretation. |
| Geographic discovery | City, neighborhood, canonical state/metro and pickup timezone come from the plan; query joins, DTOs, counts, cursors and eligibility depend on this. Preserve saved assignments and regional isolation. |
| Pickup and history | Requests bind item, plan, giver and original participants; appointment availability, timezone/DST and cancellation/withdrawal/handoff transactions verify those references. Preserve historical ownership and canonical request IDs. |
| Private media | Metadata, authorized delivery, upload permits, leases, durable recovery and cleanup manifests bind owner/plan/item and exact storage generation/target. Existing records must remain verifiable; do not rewrite tombstones or unknown operations. |
| Quotas and recovery | Existing account/day/lifetime and five-photo bounds, exact-once settlement and recovery records survive any parent-model change. No inferred deletion or automatic refunds. |
| Existing clients and drafts | Preserve plan URLs/APIs, owner text/photo drafts and demo compatibility; explicitly version any future contract and separately review migration/index preparation. |

UX-2 must propose a compatibility/migration plan and rollback before changing any
of these contracts. This PR creates no default plans and migrates no records.

## Visual evidence

Synthetic accounts, messages and solid-color photos were used with a disposable
local MongoDB replica set, private receipt-verified SeaweedFS and real Sharp
processing. Widths are CSS pixels; Chromium mobile emulation is not physical iOS.

| View | Desktop before / after | 320px before / after | 375px before / after |
| --- | --- | --- | --- |
| Add item location | [Before](assets/milestone-6.6-ux1/before/1440-add-item.png) · [After](assets/milestone-6.6-ux1/after/1440-add-item.png) | [Before](assets/milestone-6.6-ux1/before/320-add-item.png) · [After](assets/milestone-6.6-ux1/after/320-add-item.png) | [Before](assets/milestone-6.6-ux1/before/375-add-item.png) · [After](assets/milestone-6.6-ux1/after/375-add-item.png) |
| Type search | [Before](assets/milestone-6.6-ux1/before/1440-type-search.png) · [After](assets/milestone-6.6-ux1/after/1440-type-search.png) | [Before](assets/milestone-6.6-ux1/before/320-type-search.png) · [After](assets/milestone-6.6-ux1/after/320-type-search.png) | [Before](assets/milestone-6.6-ux1/before/375-type-search.png) · [After](assets/milestone-6.6-ux1/after/375-type-search.png) |
| Photo controls | [Before](assets/milestone-6.6-ux1/before/1440-photos.png) · [After](assets/milestone-6.6-ux1/after/1440-photos.png) | [Before](assets/milestone-6.6-ux1/before/320-photos.png) · [After](assets/milestone-6.6-ux1/after/320-photos.png) | [Before](assets/milestone-6.6-ux1/before/375-photos.png) · [After](assets/milestone-6.6-ux1/after/375-photos.png) |
| Owner detail | [Before](assets/milestone-6.6-ux1/before/1440-owner-detail.png) · [After](assets/milestone-6.6-ux1/after/1440-owner-detail.png) | [Before](assets/milestone-6.6-ux1/before/320-owner-detail.png) · [After](assets/milestone-6.6-ux1/after/320-owner-detail.png) | [Before](assets/milestone-6.6-ux1/before/375-owner-detail.png) · [After](assets/milestone-6.6-ux1/after/375-owner-detail.png) |
| Discovery | [Before](assets/milestone-6.6-ux1/before/1440-discovery.png) · [After](assets/milestone-6.6-ux1/after/1440-discovery.png) | [Before](assets/milestone-6.6-ux1/before/320-discovery.png) · [After](assets/milestone-6.6-ux1/after/320-discovery.png) | [Before](assets/milestone-6.6-ux1/before/375-discovery.png) · [After](assets/milestone-6.6-ux1/after/375-discovery.png) |
| Incoming requests | [Before](assets/milestone-6.6-ux1/before/1440-requests.png) · [After](assets/milestone-6.6-ux1/after/1440-requests.png) | [Before](assets/milestone-6.6-ux1/before/320-requests.png) · [After](assets/milestone-6.6-ux1/after/320-requests.png) | [Before](assets/milestone-6.6-ux1/before/375-requests.png) · [After](assets/milestone-6.6-ux1/after/375-requests.png) |

Focused editor: [desktop](assets/milestone-6.6-ux1/after/1440-focused-edit.png),
[320px](assets/milestone-6.6-ux1/after/320-focused-edit.png),
[375px](assets/milestone-6.6-ux1/after/375-focused-edit.png).

## Verification and limitations

The PR verification record supplies the final immutable head, complete-suite totals
and CI job URLs. Local frontend checks pass **456 tests in 25 suites** with
`CI=true TZ=America/Los_Angeles npm test -- --watchAll=false --runInBand`.
Dependency compatibility passes **6 tests**, deployment/security policy passes
**56 tests**, and backend lint, strict production build (`CI=true`), actionlint
and whitespace checks pass. The added canonical compatibility test passes with
all **5 taxonomy tests**. No dependency graph or workflow changes are included.

Complete backend verification uses `npm --prefix giftlink-backend test`, including
real private storage, processing, quotas, distributed fencing, recovery and restore
processes. Full HTTPS verification uses `npm --prefix e2e test`; the added local
UX fixture checks desktop, 320px and 375px, including no scroll jump and owner
access. `UX1_EVIDENCE_STAGE=after` captures the implemented UI after metadata and
actual image loads, without changing production behavior. The final focused UX
run also checks owner-detail link contrast with axe.

Removed-control browser tests exercise legacy ordering through the existing
authorized API and deletion through the real UI; stale deletion and lost-response
checks retain the no-replay, independent-draft and account-isolation assertions.
Visual review checked form placement, no thumbnail/button overlap, TV relevance,
owner edit contrast, in-flow save controls, visible filters and concise request
cards. Removing duplicate navigation and controls is observable; filters remain
longer on mobile, and the editor still contains necessary safety/recovery controls.
All 16 gift records are unchanged (SHA-256 of the bundled JSON:
`23f3868a6c90695b112c453f7d642354970f632a337d3b432f16ed5cef78cc04`).

No claim is made for manual screen-reader testing, Windows Docker Desktop,
physical Safari/iOS, hosted Vercel/R2/Atlas or production readiness. The focused
editor currently loads the existing owner plan inventory before selecting the
item; this avoids a competing editor/API but retains that existing list cost.
Permanently visible filters increase mobile page height by design. Existing
public-launch infrastructure/security blockers are unaffected.

## Rollback

No migration, index change or provider setting must be undone. Reverting the UX
and owner-lookup additions restores the previous screens and routes; the existing
plan-scoped editor and server ordering/unlist APIs remain compatible throughout.
**Retain the additive Microwave/Mirror catalog entries when rolling back UI code
after those types have been saved.** An older catalog does not understand the new
IDs; do not delete/reclassify those records or claim a catalog rollback is fully
compatible. Photo order, quotas, tombstones, uncertain operations and all recovery
authority remain server-managed and must never be reset for a UI rollback.
