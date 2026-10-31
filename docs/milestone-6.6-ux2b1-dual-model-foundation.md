# Milestone 6.6 UX-2B1 — Dual-model listing foundation

Base: main `16c0fa01924e26020508dd1f9d3c749ede8ea4e0`, including merged #77.
Branch: `codex/m66-ux2b1-dual-model-foundation`.
The [approved architecture](milestone-6.6-ux2a-item-first-architecture.md) remains
authoritative. This is a backend foundation, **not operational v2 publishing**.

## Changes and boundary

New internal modules under `giftlink-backend/services/`:

- `listing-model.js`: absence-only legacy discrimination, explicit v2, unknown or
  inconsistent metadata rejection, shared legacy Mongo filter.
- `listing-deadline.js`: Temporal-based local-day boundaries, exclusive expiry,
  confirmation/zone/rules-version binding and corruption detection.
- `listing-context.js`: owner/item identity, parent inheritance for v1, strict
  item-owned context for v2, region/classification/window/status/fence resolution.
  Reuses existing publication and listing policy validators. It does not expose
  an HTTP DTO or confer authorization to use a storage adapter.
- `listing-transaction.js`: internal existing-item snapshot/majority transaction
  with an optimistic content version and monotonic item coordination fence.

Changed legacy consumers: `inventory.js`, `plans.js`, `discovery.js`,
`pickup-policy.js`, `pickups.js`, `pickup-communication.js`, `item-images.js`,
`item-image-delivery.js`, `item-image-recovery.js`, `pickup-item-media.js`.
Tests: `test/listing-foundation.test.js`, `test/items.test.js`,
`test/item-image-pipeline.test.js`. Documentation: this report and README link.
No frontend, dependencies, index registry, workflow, feature configuration or demo
records change. Normal startup performs no new DDL or conversion.

## Context and public gating

Existing items without `listingSchemaVersion` retain their valid owned plan
relationship. State/metro, city/neighborhood, timezone, parent status and fallback
end date still come from the plan. Existing explicit item deadline overrides and
UTC expiration rules remain. No globally rewritten calendar helper is introduced.

V2 context has `listingSchemaVersion: 2`, no parent `planId`, item-owned location,
confirmed timezone, deadline tuple, content and coordination versions. Complete
context can be resolved internally, but `publicEnabled` is always false with
`V2_NOT_ACTIVATED`. `policyEligible` describes a structural/internal policy check,
not permission to publish, accept pickups or read photos. Incomplete v2 drafts
are refused by this strict resolver; a safe draft-aware contract remains B2 work.
Unknown versions (including an explicit `1`, which is not the deployed legacy
wire format), partial deadline-policy metadata on an untagged row, forged parent
references and foreign ownership fail closed. No fallback to a supplied plan can
repair invalid v2 context.

All existing item APIs remain v1-only. Their current allowlists reject client
schema/coordination/deadline/ownership fields. Plan-scoped lookups exclude tagged
or partial-policy records, including a forged v2 record with an otherwise valid
parent. Discovery filters these records before counting/pagination/media summaries;
there is no public v2 branch or global fallback. Existing plan edits refuse an
unsupported child rather than mutating it as legacy. Operators must investigate
such records; do not erase their version tags or silently convert them.

Photo owner context/delivery, pickup media and historical communication validate
legacy references as before and additionally refuse unsupported listing records.
Recovery treats a live unsupported item as an integrity conflict, not an orphan
whose objects can be deleted or refunded. Legacy pictures, quota journals,
tombstones, receipts and keys are never rewritten. No version-2 media/request
format, new publication route, conversion command or activation flag is added.

## Deadline policy

V1 uses existing UTC calendar eligibility and the existing appointment policy.
V2 derivation takes the confirmed IANA zone and a real local deadline date. It
uses Temporal's first valid start of the next local day, including a midnight gap
or earlier midnight fold occurrence, rather than adding 24 hours. A selected date
that does not exist locally is rejected. The following skipped date can move the
boundary to the next existing local day without moving the selected deadline.

The internal derivation returns a BSON-compatible Date `expiresAt`, policy 2,
`deadlineTimeZone` and rules identity `temporal-0.5.1/tz-<Node tzdb version>`.
Trusted future save code must store this tuple atomically; ordinary clients cannot
submit it through current APIs. Tests persist it only in a disposable database.
Resolution requires a valid server confirmation Date, exact zone binding, supported
rules identity, a matching stored expiry and valid optional local availability
start. At `now === expiresAt`, the item is expired. Stored values are never
rewritten when rules change: a rules mismatch is refused, not silently recalculated
under new rules. B2 needs reviewed handling of heterogeneous runtime tzdb versions.
Historical appointment instants/wall times/zones are not recomputed.

Tests cover LA and New York DST, non-DST Phoenix, Kathmandu quarter-hour offset,
Sao Paulo midnight gap and Apia's skipped date, exact before/at/after expiry,
future start, missing/unconfirmed/invalid zones, invalid policy/rules/expiry,
region/owner/model corruption and legacy UTC behavior. These foundation tests do
not replace later formal appointment DST tests or real-provider verification.

## Transaction and writer audit

`listingTransaction(db, ownerId, itemId, expectedVersion, callback)` is internal,
not a route. It reads an existing item scoped to the authenticated caller's trusted
owner identity, validates its model/context using database `$$NOW`, then acquires
a compare-and-set coordination write. There is no upsert. Exhausted, negative,
non-integer or stale revisions/versions fail. Legacy missing coordination counters
initialize only inside that explicit existing-item transaction; there is no scan
or backfill. Content `version`, photo `imageRevision` and coordination revision are
separate. The callback receives the preimage; a final transactional check prevents overwriting
the acquired fence, changing owner/model/legacy parent, or decreasing content
version. Content callbacks must retain their own state/authorization predicates
and increment content version when changing content/lifecycle.

For legacy, the helper first updates the owned plan's `inventoryRevision`, then
updates the owned item: **Plan → Item**. For v2 there is no plan acquisition.
The transaction uses snapshot reads, majority writes, primary read preference and
the native driver's bounded `withTransaction` retry behavior, with a 10-second
maximum commit time (not a claim of a ten-second overall callback deadline).
Do not nest this helper inside another plan transaction or open a second
transaction from its callback; composition must share the provided session.
Callbacks must perform database work only: never place PUTs, external effects or
non-idempotent provider operations inside a retryable transaction.

| Current writer | Fence / compatibility behavior |
| --- | --- |
| Inventory create/edit/publish/unlist/clear/reopen | Existing plan transaction retained; existing-item operations now reject unsupported models. No v2 creation is possible. |
| Plan context/deadline/status edits | Existing plan transaction and cancellation logic retained; unsupported children cause rollback. |
| Pickup create/accept/decline/cancel/handoff and formal scheduling | Existing plan transaction retained; current item lookups and eligibility reject unsupported models. |
| Message send | Existing plan transaction and original-participant checks retained; closed history stays read-only. |
| Legacy metadata reservation/order/delete/claim/finalization | Existing plan transaction, owner/account checks, image revisions and F4 shared admission fence retained; item context is v1-only. |
| Physical recovery | Existing operation/cleanup leases, receipt/target and account settlement transactions retained; unsupported live parent is an integrity failure. No conversion compatibility is inferred. |
| New internal helper | Legacy uses plan then item, so it conflicts with all existing plan-only writers; v2 uses item CAS. No current public consumer invokes a v2 mutation through it. |

The old plan fence is deliberately **not removed or bypassed**. Old plan-only
writers and the new legacy helper still share that fence, so item fencing does
not allow a legacy edit to race around a plan deadline/cancellation update.
Valid v2 records cannot be targeted by those legacy writers; conversion is absent
and disabled. This is not a claim that all old writers already increment an item
counter. Before any conversion or mixed-model activation, B2/C must route every
participating writer through the agreed fence/context contract and test the full
state machine, including photo control transactions. The new helper alone does
not implement v2 acceptance, media receipts or recovery.

Native Mongo tests use two independent client/session pools against one verified
local replica set: concurrent coordination increments, conflicting content versions,
plan-only writer versus plan-then-item writer, stale/foreign/missing targets and
rollback of both fences after callback failure. Existing pickup tests retain the
real acceptance-versus-confirmed-withdrawal race. New concurrent foundation tests
are not described as complete v2 pickup flows or new independent OS-process tests;
the existing F4/F5 process suites remain part of full regression.

## Verification record

Baseline merged-main checks were 684 backend, 457 frontend/25 suites and 70 local
HTTPS browser cases. The new tests are additive; original v1 fixtures remain.
Focused foundation/inventory tests pass, and a real Mongo/SeaweedFS/Sharp test
verifies unsupported model tags deny owner and outsider photo reads/metadata,
leave quota/ledger documents identical, and restore normal access only when the
synthetic test restores the original v1 record. No assertion is skipped or
runner retry added. Final counts, any failures and immutable-head CI links are
recorded in the PR after the complete runs finish; baseline counts are not claimed
as new v2 end-to-end evidence.

Full checks include backend lint/tests (storage, pipeline, recovery, distributed
control and restore), frontend tests, strict production build, dependency
compatibility, deployment/security policy, isolated local HTTPS desktop/mobile
and existing axe checks, actionlint and whitespace. They do not verify Windows
Docker Desktop, physical Safari/iOS, real R2, remote Atlas or hosted staging.

## B2/C dependencies and rollback

B2 must implement trusted creation/confirmation and atomic deadline-tuple storage,
a draft-aware context contract, bounded private owner queries and explicitly
reviewed index proposals. No new index is necessary for B1's `_id`-scoped work.
C must implement versioned request/media/ticket/recovery formats, original-history
compatibility, full v2 withdrawal/acceptance/scheduling races and mixed-model
bounded discovery/counts/cursors before any public v2 activation. No automatic
legacy conversion or hidden plans are a shortcut. Runtime/tzdb rollout and
schema integrity errors remain explicit review items.

With only legacy production records and v2 still disabled, the application can
roll back without data migration; retain any initialized coordination fields
rather than deleting metadata. Once v2 records or new signed operation formats
exist, the minimum rollback is a release that understands/refuses them safely,
not an old legacy-only binary that might reinterpret context or expiry. Stop new
admission and conversion first; retain authorized status/read and separately
approved recovery paths, using a full photo outage if integrity is uncertain.
Never refund unknown writes, replay PUTs, erase tombstones, downgrade schema tags,
rewrite receipts or recompute historical appointments. F4/F5's rollback-of-trust
limitation is unchanged. No production gate, provider, index or remote data changes
are authorized by this milestone.
