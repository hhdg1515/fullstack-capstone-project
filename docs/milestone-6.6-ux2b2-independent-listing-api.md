# UX-2B2 — Independent private listings and owner inventory

Base: main `15153a96938f2dc398c0d07c4f71f2672e12fc49`, including merged #78.
Branch: `codex/m66-ux2b2-independent-listing-api`.
The [approved architecture](milestone-6.6-ux2a-item-first-architecture.md) and
[B1 foundation](milestone-6.6-ux2b1-dual-model-foundation.md) remain authoritative.
This release provides **private draft APIs**, not an Item-first React journey or
operational v2 publishing, photos, pickups or messaging.

## Activation and index preparation

`OWNER_LISTINGS_ENABLED` is a strict `true`/`false` backend setting, default false.
Both environment samples leave it false. It is independent of all photo flags.
With it false, existing application startup requires all old application indexes,
and photo indexes when metadata is enabled, but does not require the new owner-feed
index. Authenticated requests to the new APIs receive 503 `OWNER_LISTINGS_DISABLED`.
Legacy browsing, plan editing, authentication and pickup routes remain functional.

When explicitly enabled, startup refuses a missing/incompatible owner-feed index.
The registry adds **only** `items_owner_created`:

```js
{ ownerId: 1, createdAt: -1, _id: -1 } // simple collation, not unique/sparse/TTL
```

Preparation still inspects the entire application registry (17 definitions),
preserves account/data conflict checks, and requires the existing target approvals.
It never seeds, drops indexes, repairs documents or runs during ordinary startup.
For a verified disposable local replica set, use the existing commands:

```sh
npm --prefix giftlink-backend run db:prepare -- --dry-run
npm --prefix giftlink-backend run db:prepare -- --apply \
  --confirm-db '<exact MONGO_DB_NAME>' \
  --confirm-environment development \
  --confirm-target '<fingerprint from this target dry-run>'
```

Configure the explicit local `MONGO_URL`, `MONGO_DB_NAME` and `DB_ENVIRONMENT`
before those commands. These are placeholders, not authorization for a remote
operation. Remote preparation remains a separate owner-approved step with the
existing `--allow-remote`, exact tier/name/fingerprint and verified TLS protections.
No remote connection, index application or environment change was performed here.

The feed uses the exact compound **key** as its query hint, accepting a compatible
equivalent index with a different name. Missing-index requests fail 503 rather
than falling back to an unrestricted scan. A local native explain verifies an
indexed owner query without a blocking SORT. Status filters are residual filters:
a sparse requested status can examine many of that owner's entries. Every query
has a five-second server time limit; returned/enriched pages are bounded. No claim
of constant-time status filtering or measured production scale is made. A future
regional v2 index must wait for the reviewed mixed-model discovery query; none is
added speculatively here.

## API contracts

All new APIs require a validated session and no-store responses. Writes retain
exact configured Origin + `X-CSRF-Protection: 1`, JSON-only 32 KiB input, strict
field allowlists and a bounded per-process/IP owner-route rate limit (120/minute).
It is not a distributed abuse quota. Error responses never include supplied field
values, owner IDs, raw database errors or private request records.

| Method/path | Contract |
| --- | --- |
| `POST /api/items` | Create one independent private draft; 201 `{item}`. No hidden plan. |
| `GET /api/me/items?limit=20&status=all&cursor=…` | Owner-only mixed v1/v2 inventory; `{items,nextCursor}`. |
| `GET /api/me/items/:itemId` | Owner-only detail; missing/foreign/invalid ID returns the same 404. |
| `PATCH /api/items/:itemId` | Edit only a valid v2 draft, requiring integer `version`; 200 `{item}`. |
| `POST /api/items/:itemId/actions` | Validate owner, model, context, version and fence; reject currently unavailable actions atomically. |

Example creation and edit:

```json
{"name":"Chair"}
```

```json
{
  "version":1,
  "description":"Small household chair.",
  "categoryId":"office-lighting",
  "itemTypeId":"office-chair",
  "stateId":"06",
  "metroId":"31080",
  "pickupTimeZone":"America/Los_Angeles",
  "confirmPickupTimeZone":true,
  "availableUntil":"2027-11-12"
}
```

The classification values above illustrate API IDs, not a name-based inference;
choose the appropriate actual type from `/api/item-taxonomy`. No suggestions or
classification semantics change in this milestone. `publish:false` is accepted;
`publish:true` on creation returns 409 `V2_PUBLICATION_DISABLED` **without inserting
anything**. On edit, it rolls back all fields/fences. Actions accept `publish`,
`withdraw`, existing `unlist`, `clear`, `reopen` as reserved contracts; publish
returns that same disabled code and other actions return `V2_LIFECYCLE_DISABLED`.
No action updates lifecycle, cancels requests or revokes media halfway. V1 IDs on
new write endpoints return 409 `LEGACY_ITEM_ROUTE_REQUIRED`; use the existing
owner-authorized plan editor/edit-context route. Foreign IDs are always denied
before their model is disclosed. Stale/competing versions return 409; no automatic
POST replay or client creation retry is introduced.

Representative model-neutral item response (timestamps/ID are illustrative):

```json
{
  "id":"000000000000000000000001",
  "name":"Chair",
  "description":"",
  "classification":{"category":null,"itemType":null,"condition":null},
  "status":"draft",
  "version":1,
  "location":{"stateId":null,"metroId":null,"stateLabel":null,"metroLabel":null,"city":"","neighborhood":""},
  "pickup":{"availableFrom":null,"availableUntil":null,"timeZone":null,"timeZoneConfirmed":false,"datePolicy":"pickup-local","expiresAt":null},
  "photoPreview":{"availability":"disabled","images":[]},
  "pickupSummary":{"supported":false,"reserved":false},
  "capabilities":{"editDraft":true,"legacyEditor":false,"publish":false,"withdraw":false,"photos":false},
  "createdAt":"2026-10-31T00:00:00.000Z",
  "updatedAt":"2026-10-31T00:00:00.000Z"
}
```

`version` is the optimistic content version needed by the editor; internal
coordination/image counters, plan references, owner IDs, signature/ticket formats,
storage keys, receipts, private messages and account metadata are not returned.
Legacy classification/condition, inherited general location and effective deadline
use their existing meanings; `datePolicy: utc-calendar` avoids local reinterpretation.
`legacyEditor:true` means use the existing editor; false new-contract publication/
withdraw/photo capabilities do not disable any existing legacy route.
Legacy photo previews reuse the existing binding/ownership/order verification,
only when authorized read capability is available, returning at most five safe
IDs/dimensions, never tickets. V2 previews remain disabled even if photo flags are
injected. Pickup summary is only a conservative existing accepted-reservation
boolean, not request counts, participant details, verified handoff or an inbox.

## Draft schema and validation

Server-assigned `_id`, authenticated `ownerId`, `listingSchemaVersion:2`, `draft`,
`version:1`, `coordinationRevision:0`, `imageRevision:0`, BSON created/updated dates
and null publication timestamp. No `planId`. One authoritative database `$$NOW`
is used per transaction. Optional strings default empty, classification/location
IDs, dates, zone and confirmation default null. No invented metro/date/timezone.

Editable fields: `name`, `description`, `categoryId`, `itemTypeId`,
`customItemType`, `condition`, `stateId`, `metroId`, `city`, `neighborhood`,
`pickupTimeZone`, `confirmPickupTimeZone`, `availableFrom`, `availableUntil`.
Create has optional boolean `publish`; edit additionally requires positive safe
integer `version`. All unknown fields are rejected, including owner/schema/status,
coordination/image revisions, server confirmation time, derived expiry/policy,
publication timestamp, photo identity, storage binding and historical references.

Name is required, 1–160 Unicode code points. Description is up to 2,000; general
city/neighborhood labels up to 100. Bounded plain text rejects markup/control
characters; location labels reject email-like contact data. This is not complete
PII/address detection. Existing taxonomy validators preserve category/type/Other
relationships, normalization and condition IDs. State alone is a legitimate
incomplete selection; metro requires a compatible state. Classification category
alone is allowed; a type needs its actual category. Explicit null clears nullable
fields; clearing a prerequisite while retaining an incompatible dependent value
is rejected, never silently reclassified.

Calendar strings must be real dates, start <= deadline when both exist. If a zone
is supplied, both selected dates must exist there (including whole-day skips).
New/changed starts are checked against the giver's current local date when a zone
is available; selecting a zone later validates a previously incomplete start.
An unchanged start keeps its compatibility exception. Past deadlines are allowed
for private drafts but do not authorize public access or intake.

An explicit valid IANA zone can be saved unconfirmed. `confirmPickupTimeZone:true`
is owner intent; the server records confirmation time against the resulting
context. Changing state, metro, city, neighborhood or zone clears confirmation
unless the same edit explicitly reconfirms. False clears it. A confirmed zone plus
deadline derives the entire B1 Temporal tuple atomically: policy 2, exact zone,
rules identity and exclusive UTC BSON expiry. Removing context removes the tuple;
a deadline-only edit retains valid confirmation and derives a fresh tuple. No
24-hour arithmetic, zone inference, historical appointment rewriting or rules
upgrade migration occurs.

`resolveListingContext(...,{operation:'ownerDraft'})` accepts valid incomplete
v2 drafts only. Strict/default resolution still rejects missing public context;
a corrupt published/unlisted/expired row cannot enter draft mode. Owner draft
validation rejects partial/mismatched deadline tuples, invalid confirmation times,
unsupported schema, parent binding and damaged counters/timestamps before edits.
Malformed persisted context returns 409 rather than being repaired by PATCH.
Complete unpublished drafts remain private. Complete historical unlisted/expired
v2 context is owner-readable through strict validation, but no public route or
new writer can produce these states yet.

## Transactions, pagination and compatibility

Creation inserts only the new item in a native snapshot/majority transaction.
Editing uses B1's existing-item CAS fence and content-version check. The trusted
callback receives its transaction's database timestamp, increments content version
separately from the acquired coordination fence, validates the resulting whole
record and retains the final owner/model/fence integrity check. No storage PUTs
or external effects occur in retryable transactions. Failed actions/validation
leave content, fences, quotas and references unchanged.

Feed order is `createdAt DESC, _id DESC`, default 20, maximum 50. Cursor encodes a
strictly validated last tuple and hash binding to authenticated account + status;
it is not a credential/signature and never replaces server-side owner predicates.
Changing accounts/status rejects the cursor; changing page size is allowed.
Filters are `all/draft/available/unlisted/expired/cleared`, with derived expiration
for available rows according to their actual v1 UTC/v2 policy. Drafts keep draft
status even if a saved deadline is past. No fake picked-up/completed label.
Each page uses one snapshot aggregation; pages are a live feed, not one persistent
snapshot across concurrent edits. Status changes can move entries between filtered
pages; refresh is required for a current view. No exact total is advertised.

A bounded owner-plan lookup verifies legacy binding. At most limit+1 entries are
then enriched through bounded photo/reservation lookups; there are no per-card
application metadata queries or unbounded arrays. Bad model/parent/deadline context
on a returned row fails closed, never falls back to a plan or leaks a foreign row.
Public v1 detail, discovery counts/cursors/filters, media, pickup, scheduling and
communication retain B1 guards; v2 is excluded. No records are converted.

## Verification and remaining work

New native integration tests cover name-only drafts, independent contexts, zero
plans, local deadline confirmation/reset, invalid fields, malicious authority,
CSRF/sessions, foreign IDs, concurrent/stale edits, mixed feeds, tied cursor order,
status filtering, explain plans, corrupt contexts, v1 editing, public/media/pickup
refusal, DTO privacy, default gate and startup missing/incompatible/equivalent
indexes. A real MongoDB/Sharp/private SeaweedFS pipeline test verifies permitted
legacy previews and cross-account denial. Preparation expectations now include
the additional index while preserving all prior definitions and assertions.

Merged #78 baseline: backend 724; frontend 457/25 suites; browser 70. Final counts,
CI links and any failed intermediate runs are recorded in the PR. The unchanged
React build and existing browser/axe tests demonstrate **legacy non-regression**,
not a new Item-first UI journey. All fixtures are disposable local replica sets
and verified private SeaweedFS; no real R2/Atlas, hosted testing, Windows Docker
Desktop, physical Safari/iOS or new screen-reader verification is claimed.

UX-2B3 needs the actual Item-first React editor/feed, safe uncertain-create UX
(canonical owner inspection before any explicit retry; this POST is not an
idempotency-key API), date-policy labels, validation focus/draft protection and
legacy-editor integration. UX-2C must implement versioned pickup/media/recovery
contracts, all mixed-model writer fences, full publication/withdrawal validation,
explicit request cancellation and media revocation, mixed regional queries/counts
and race tests before public v2 activation. These dependencies stay disabled.

## Deployment sequencing and rollback

No deployment/remote preparation is authorized by this PR. In a later approved
rollout: keep owner gate false, review target dry-run, approve exact index apply,
verify compatible index/topology without writes at startup, then explicitly enable
only the private owner API. Photo gates and public v2 stay disabled. An index-only
addition does not rewrite records; never drop it automatically on rollback.

Before v2 creation, rollback is ordinary compatible code rollback. After private
v2 drafts exist, disable owner API admission and retain B1-or-later discrimination
as a compatibility floor; do not return to a legacy binary that can reinterpret
independent rows. Retain records/IDs/counters/ledgers and future restore/revocation
boundaries. No schema-tag deletion, hidden-plan conversion, expiry rewrite,
tombstone erasure, unresolved-PUT refund or automatic data cleanup is a rollback.
