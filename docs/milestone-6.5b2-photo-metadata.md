# 6.5B2 — Private image metadata, reservations and quotas

Base: merged PR #60, main `a97a18d408836f4b131711fd6e33b040adfd77c4`.
Branch: `codex/m65b2-photo-metadata-quotas`. The
[6.5A architecture](milestone-6.5-photo-architecture.md),
[privacy/lifecycle contract](milestone-6.5-security-and-lifecycle.md) and
[B1 private adapter](milestone-6.5b1-storage.md) remain authoritative.

## Shipped boundary

B2 provides durable, owner-only JSON control operations. There is no multipart
intake, Sharp, object PUT/GET/HEAD/DELETE, binary delivery, upload UI, worker,
retention sweep or hosted fixture. No production code transitions an operation
to `processing`, `ready` or physically `deleted`. Test-only controlled fixtures
model those states to test accounting and mutations. Cloudflare R2 remains the
future production provider; SeaweedFS remains isolated local/CI only.

Metadata routes default off. Enabling them allows allocation of synthetic or
future upload reservations, **not usable image uploading**. Existing public and
private inventory DTOs and behavior remain unchanged when disabled. No backfill
or legacy location/item migration is performed.

## Data and transaction boundary

`itemImages` is separate from items. Each strict schema-version-1 row contains
native image/item/plan/owner ObjectIds, normalized random v4 `clientUploadId`,
bound intent (declared bytes/SHA-256), state, order, immutable generation,
private target binding, preregistered thumbnail/display keys and bounded variant
metadata, processing lease/fence, row version, charge/settlement flags, cleanup
reason/retry scheduling and MongoDB-derived timestamps. No original bytes,
filename, EXIF, external URL or credentials are stored.

States: `reserved`, `processing`, `ready`, `failed`, `delete_pending`, `deleted`.
Every operation rechecks the live account and owner → plan → item relationship.
An inconsistent image reference or changed storage binding fails closed instead
of hiding older rows from slot accounting. Storage-target moves require a
separate reviewed migration; do not change the binding to evade existing holds.

Writes reuse native-driver `planTransaction` (snapshot/majority/primary),
serializing item operations with existing inventory/pickup changes. Cross-plan
admissions also update the **existing** `users.itemImageQuota` document in the
same transaction. There is no quota collection, user upsert or missing-account
recreation. Retry callbacks perform MongoDB metadata work only. Operation and
generation identities are allocated before the callback; expiry fencing tokens
are retained across callback retries. Driver retries cannot double-charge or
create a second operation.

Missing `items.imageRevision` means zero. Reservations check it but do not
increment it because they do not change ready-photo order. Changed ready order
and first logical deletion increment it atomically; text/status `version` is
independent. Reorder requires the exact complete ready-ID set, at most five,
with no duplicates or foreign/pending IDs. A no-op order leaves the revision
unchanged. Malformed ready positions fail closed rather than being repaired by
a read. Deliberate deletion renumbers remaining ready photos without renaming
objects or overwriting unrelated item fields.

## Provisional account limits

| Limit | Default / hard ceiling | Accounting |
| --- | --- | --- |
| Active item photos | 5 | Ready, reserved, processing and uncertain held slots |
| Declared compressed input | 3 MiB | Intent only; B3 must enforce actual intake |
| Reservation bytes | 1.25 MiB | 256 KiB thumbnail + 1 MiB display worst case |
| Daily attempts | 50 | New admitted operations per MongoDB UTC day |
| Daily successful + held success | 20 | New reservation holds a success credit |
| Retained + reserved account bytes | 100 MiB | Across all plans and retained/uncertain media |
| Concurrent account uploads | 2 | Across plans, tabs, sessions and app instances |
| Retained operation rows | 1,000 | Includes failed/deleted tombstones; no timed refund |

These are provisional engineering defaults, **not production launch approval**.
Caps may be lowered, never raised above these ceilings. Byte cap must permit
at least one full reservation. Lowering below existing usage prevents admission
without cancelling or discarding existing operations.

Quota fields: `schemaVersion`, `utcDay`, `attempts`, `successful`, `heldSuccess`,
`reservedBytes`, `retainedBytes`, `activeUploads`, `operationCount`, `updatedAt`.
Strict safe-integer counters and settlement checks prevent underflow. Missing
accounting with existing account media is a conflict, not an invitation to reset
usage. Profile updates preserve both photo and messaging quotas. Neither quota
family is returned by user/profile/public DTOs.

Time comes from MongoDB `$$NOW` inside each transaction, not client time or the
Node clock. Leases end at the earlier of 120 seconds or the next UTC midnight.
The quota day is the server allocation instant; B3 must reject any expired ticket
even if its transaction completed around midnight. New-day admission resets only
daily counters; global byte, concurrency and record holds survive. Settling an
old-day unused ticket cannot decrement the new day's held-success counter.

Only a fully validated, **never-claimed** reserved operation with both variants
`not_started` can release its byte/success/concurrency/slot holds without storage
inspection. Admission examines at most two expired owned reservations, rechecks
their original parent/item relationship and settles them transactionally. Orphan
references are skipped conservatively. Reads never reap or write. If the new
admission fails, all its transaction work rolls back. Explicit logical deletion
can also settle a proven unused reservation. Attempts and operation rows are
never refunded; successes and retained bytes are not refunded by logical delete.

Processing/failed/unknown writes retain holds after timeout or deletion. A fence
and `delete_pending` prevent stale finalization; they do not prove an object PUT
failed. Future B4 cleanup must verify physical outcomes before releasing bytes
and uncertain concurrency. `holdsSettled` describes reservation settlement;
`storageReleasedAt` separately proves storage accounting release. Ready photos
can have settled reservation holds and still consume retained bytes.

## Owner JSON API

Let `P = /api/move-out-plans/:planId/items/:itemId/images`.

| Operation | Result |
| --- | --- |
| `GET P` | Revision, up to five ready images, active status plus at most 20 recent other operations |
| `POST P/uploads` `{imageRevision,clientUploadId,byteLength,sha256}` | 201 new reserved operation; 200 identical-intent replay |
| `GET P/:imageId` | Bounded safe status for a specific retained operation |
| `POST P/order` `{imageRevision,imageIds}` | 200 exact ready order/revision |
| `POST P/:imageId/actions` `{imageRevision,action:"delete"}` | 202 durable logical deletion; replay remains 202, already physically deleted is 200 |

Existing authenticated sessions, exact Origin, CSRF header, JSON-only writes,
32 KiB body cap, strict field allowlists and no-store responses apply. IDs and
intent types are validated. Controls have an additional per-process/IP 20/minute
limit; this is a lightweight resource guard, not distributed abuse protection.
MongoDB account quotas remain authoritative across instances.

Identical upload ID/intent recovers the original result even with a stale image
revision or later closed plan. Changed hash/length returns `409
IMAGE_INTENT_CHANGED`. New stale operations return `409 IMAGE_CHANGED`. Wrong
account, missing account, parent/item/image ownership mismatch or unavailable
operation does not reveal another owner's row. New reservations require an
active plan and an uncleared item; draft/available/unlisted/expired items and
reserved pickup listings do not gain different pickup privileges. Existing owned
metadata can be read, reordered or logically deleted after closure/clearance.

DTOs expose state, timestamps, safe expiry/cleanup-pending flags, revision and
limits; ready metadata includes only order, dimensions, sizes and WebP MIME type.
No owner ID, hash, key, target, fence, cleanup reason/error, quota document or
credentials are serialized. `binaryUploadsEnabled` is always false. There are no
query parameters and no automatic retry/processing replay.

Admission errors are actionable 429 codes: `IMAGE_DAILY_ATTEMPTS`,
`IMAGE_DAILY_UPLOADS`, `IMAGE_RECORD_LIMIT`, `IMAGE_UPLOAD_CAPACITY`,
`IMAGE_STORAGE_CAPACITY`. Only daily limits carry bounded `retryAfterSeconds`;
record exhaustion/uncertain holds must not promise an expiry refund. Five-slot
exhaustion is `409 IMAGE_ITEM_LIMIT`; corrupt accounting is `409
IMAGE_METADATA_INVALID` with no silent repair.

## Configuration and guarded preparation

Keep `ITEM_IMAGE_METADATA_ENABLED=false` (default). A future approved activation
requires exact `true`, `ITEM_IMAGE_STORAGE_TARGET` (verified 64-character lowercase
SHA-256 target fingerprint) and `ITEM_IMAGE_NAMESPACE`
(`item-images-<test|development|staging|production>-<32 lowercase hex>`). The
binding names the future private target, not a URL or access credential. Never
invent a production fingerprint or copy real R2 credentials into local tests.

Optional downward-only settings: `ITEM_IMAGE_QUOTA_DAILY_ATTEMPTS`,
`ITEM_IMAGE_QUOTA_DAILY_SUCCESSES`, `ITEM_IMAGE_QUOTA_ACCOUNT_BYTES`,
`ITEM_IMAGE_QUOTA_CONCURRENT`, `ITEM_IMAGE_QUOTA_RECORDS`. Invalid enabled
configuration fails startup. B2 does not load storage credentials or call the
B1 adapter. `ITEM_IMAGES_ENABLED` is not an upload feature switch.

The explicit preparation registry includes these simple-collation indexes:

| Name | Key / options |
| --- | --- |
| `images_item_state_order` | `{itemId:1,ownerId:1,state:1,sortPosition:1,_id:1}` |
| `images_item_upload_unique` | `{itemId:1,clientUploadId:1}`, unique |
| `images_due_work` | `{maintenanceDueAt:1,_id:1}`, partial `{needsMaintenance:true}` |
| `images_owner_state` | `{ownerId:1,state:1,_id:1}` |

**Disabled rollout needs no photo schema change.** When
`ITEM_IMAGE_METADATA_ENABLED` is unset or exactly `false`, both normal Express
startup and Vercel cold-start readiness verify all 12 pre-B2 application indexes,
without inspecting `itemImages` indexes or constructing metadata routes. Existing
session, inventory, pickup, messaging and discovery checks stay mandatory. No
storage calls are made, and no indexes or documents are created or changed.

**Before enabling metadata, all four compatible photo indexes are required.**
Only explicit `ITEM_IMAGE_METADATA_ENABLED=true` plus valid binding/quota
configuration enables metadata. Enabled startup fails closed on any missing or
incompatible photo index, as well as every previously required application index.
Both modes check topology/index metadata read-only; neither mode runs migrations
or DDL. Disabling the flag again requires no rollback DDL and does not erase any
existing photo metadata, accounting or indexes.

Explicit `db:prepare` inspection/apply continues to cover the **complete**
16-index registry regardless of the runtime flag; its target validation,
dry-run/conflict detection and exact confirmations are unchanged. It can therefore
preview photo preparation before activation without enabling routes. There is no
media TTL, demo seeding or automatic data migration. Preparation reports malformed
rows/quotas and duplicate upload groups as counts only, blocks incompatible indexes
and never repairs documents.

On your independently verified disposable local target, use existing commands
from `giftlink-backend`, with its explicit local database/environment settings:

```sh
npm run db:prepare -- --dry-run
npm run db:prepare -- --apply --confirm-db '<verified local database>' \
  --confirm-environment development --confirm-target '<full dry-run fingerprint>'
```

The [existing preparation instructions](../README.md#prepare-database-indexes-explicitly)
describe target checks and remote TLS/confirmation requirements. **No remote
preparation is authorized by this implementation.** Keep metadata disabled on
existing remote databases. Before any later activation, obtain separate owner
approval, verify the Atlas target and review its guarded dry-run, approve apply
using the exact database/environment/fingerprint, and verify all indexes before
changing the flag. No existing remote indexes/data were touched. These steps
prepare owner JSON metadata only, never binary uploads/storage or B3/B4 behavior.

## Verification and remaining gates

`npm --prefix giftlink-backend run test:images` uses a verified owned disposable
MongoDB replica set. Tests include two app instances, cross-plan first-use quota
races, last item slot, retry rollback, lost responses, UTC rollover, exact-once
safe expiry settlement, uncertain holds, independent text/image revisions,
strict ownership/DTOs and index conflicts/repeated preparation. Native startup
regressions use actual MongoDB indexes and monitored commands to cover disabled
pre-B2 databases, every missing legacy index, each missing photo index, incompatible
indexes, enabled readiness, disabled routes/no storage calls and absence of startup
DDL/document writes. Both ordinary Express and Vercel cold-start paths are tested
in [the startup regression suite](../giftlink-backend/test/image-startup.test.js).
The normal CI recursive backend suite already includes these tests and unchanged B1 real
SeaweedFS contracts; no workflow needs new secrets or remote access.

Exact local and immutable-commit CI results are recorded in the B2 PR. Local
tests/CI do not establish R2 behavior, real file safety or production readiness.
B3 must implement bounded binary intake, native processing, claim/fence checks,
verified finalization and authorized binary reads. B4 must implement bounded
physical cleanup/reconciliation. Public launch limits, distributed abuse controls,
operational recovery and approved remote preparation remain separate gates.
