# 6.5B4 — Physical photo deletion and durable local recovery

Base: main `715ab42eef47afea4a53416c1d0b3cfa2fd0de8a`, after merged PR #62.
Branch: `codex/m65b4-photo-cleanup-recovery`.
The [architecture](milestone-6.5-photo-architecture.md),
[security/lifecycle contract](milestone-6.5-security-and-lifecycle.md),
[B1 artifact review](milestone-6.5b1-seaweedfs-review.md),
[B2 accounting](milestone-6.5b2-photo-metadata.md) and
[B3 processing/delivery](milestone-6.5b3-image-pipeline.md) remain in effect.

## Activation and authority

**Uploads and binary image delivery remain disabled in deployed applications.**
`ITEM_IMAGE_PIPELINE_ENABLED` must still be unset or exactly `false`. B4 does not
change that gate, import a cleanup client into runtime, or activate metadata.
There is no photo UI, R2 implementation/credential, Atlas preparation, scheduled
worker, bucket lifecycle, automatic retention or hosted photo E2E.

The new tool operates only on receipt-owned disposable local MongoDB and
SeaweedFS fixtures. It explicitly refuses staging/production environments, R2,
remote endpoints, remote Docker contexts, inherited MongoDB URLs and default AWS
credentials. A local MongoDB connection alone grants no object-store authority.
Cloudflare R2 remains the approved future production provider; SeaweedFS remains
the reviewed synthetic local/CI fixture, with its unchanged pinned artifact.

Owner JSON deletion continues to use B2 authorization, plan transactions and
imageRevision checks. It immediately removes the photo from ready order and
authorized delivery. Logical deletion **does not refund retained bytes** or imply
physical absence. B4's separate, explicitly approved local apply removes eligible
private thumbnail/display objects and then settles accounting. There is no
best-effort work after an HTTP response and no automatic same-request S3 deletion.

## State and evidence

The six image states remain `reserved`, `processing`, `ready`, `failed`,
`delete_pending`, `deleted`. No recovery path returns an operation to ready.
Recovery can claim expired reserved/processing work, failed compensation and
owner-deleted work. Ready photos are not a cleanup target. Live processing leases
and backoff prevent a maintenance claim; elapsed time alone never settles a PUT.

B4 preserves schema version 1 and accepts legacy three-field `cleanup` documents.
When cleanup is claimed, it adds a strictly validated `cleanup.recovery` record:
fence token, server claim/expiry times, status/category, approved manifest digest,
the names of originally unknown variants, and independent verified-absence flags.
This is additive, without DDL/backfill. An older B2/B3 binary does not understand
these new cleanup fields/outcomes; do not operate photo metadata/cleanup with an
older binary after B4 records exist. Ordinary disabled text functionality is
unaffected. Keep the B4-compatible maintenance tool available during rollback.
B1–B3 application code never produced physically completed `deleted` rows; B4
requires its completion evidence before accepting such a tombstone.

| Journal evidence | Permitted recovery |
| --- | --- |
| `not_started` | No PUT permit exists. Fence the producer, then settle without object I/O |
| `prepared` / definitive `rejected` | No possible issued PUT. Confirm absence using a bounded GET; an unexpected object blocks cleanup |
| `unknown` + missing object | Keep the operation, bytes, concurrency, success credit and item slot held; report `unknown_write` |
| `unknown` + actual matching bytes/hash | The one permitted write is positively observed. Persist settled-writer evidence before deletion; retain its original unknown-write history |
| `stored` | B3 already verified the one permitted write. Missing or matching objects are eligible; altered bytes block cleanup |
| `delete_unknown` | Settled-writer evidence was persisted before DELETE; the DELETE response may have been lost. Repeat exact-key deletion/absence verification safely |
| `delete_acknowledged` | DELETE acknowledgment recorded, but no refund until independently verified absence |
| `deleted` | Exact-key absence was verified. Preserve the key, generation, intent and tombstone; never reuse the key |

The tool conservatively waits for **both** variant write outcomes to be settled
before deleting either object. A known thumbnail with an unknown-and-absent
display therefore remains charged, rather than giving an incomplete cleanup
success. No PUT is replayed, regardless of age or lease expiration.

### Why a negative HEAD cannot settle an unknown write

A writer may have obtained a durable PUT permit and stopped before issuing it,
or the provider may still be committing a timed-out request. A negative HEAD/GET
describes the current instant. It does not prove that a later PUT cannot appear.
The regression test holds a real PUT until after genuine negative HEAD and GET,
confirms that cleanup does not delete/refund, then allows the actual SeaweedFS
commit and reconciles from positive byte evidence. It does not mock a late object
into existence without a provider write.

No elapsed-time threshold, quota reset, negative read, lease takeover, SDK abort
or process exit manufactures write-settlement evidence. If an unknown object
never appears, this tool cannot resolve it automatically. Preserve the ledger
and holds. Inspect the local producer/provider state and retain the receipt for
review. Do not edit the journal into `stored`, replay PUT, drop the record, delete
and refund, or assume a provider lifetime. Disposing of an entire owned synthetic
fixture is a separate fixture teardown, not proof about a live durable operation.
Future R2 unresolved-write handling needs an approved provider-specific evidence
and operational policy; B4 deliberately has no force-refund command.

## Cleanup transactions and failures

Claim changes the operation to `delete_pending`, advances its version and upload
fence, and persists a new 60-second cleanup lease. Old upload workers cannot mark
stored/finalize; stale cleanup workers cannot overwrite a successor's journal or
charge settlement. A permit issued just before the claim remains `unknown`.
Each subsequent update uses version/fence/lease CAS and MongoDB `$$NOW`.

The application and cleanup tool never put Sharp or S3 I/O inside retriable
MongoDB transaction callbacks. Metadata transactions use snapshot reads,
majority writes, bounded operations and at most three callback executions.
Each destructive S3 call independently rechecks B1's live daemon, container,
pinned image, dedicated volume/network, credentials hash, loopback endpoint,
bucket/namespace and exact derived key. No listing, arbitrary key, bucket-wide
deletion, proxy, remote fallback, collection deletion or index write is exposed.

Before each DELETE, persist `delete_unknown`; on acknowledgment persist
`delete_acknowledged`; then use an exact-key bounded GET to verify `NoSuchKey`.
Only the adapter's confirmed missing-key error counts. Bare HEAD 404, 403,
NoSuchBucket, timeouts, hash/size mismatches and target errors do not count.
The ready ledger is already invisible throughout. A crash after physical removal
leaves enough evidence to repeat deletion and settle in a fresh approved run.
An object that unexpectedly remains/reappears prevents settlement.

Failures preserve leases/journals and charges. An observed failure records only
an allowlisted category and bounded exponential backoff (30 seconds to five
minutes); a hard process kill may leave the active cleanup lease instead.
At most **five** explicitly approved cleanup claims are allowed per operation.
After that, preview reports `retry_budget_exhausted`; there is no loop or silent
attempt reset. A new preview/approval is required for each retry. Unknown-write
previews can remain unresolved without consuming a destructive claim.

## Accounting

Before claiming or settling, validate the existing account aggregate against its
entire bounded operation ledger (maximum 1,000 retained rows). Validate every row,
native reference and counter. Missing/corrupt accounting, missing accounts,
inconsistent live ownership or an oversized ledger fail closed. A genuinely
missing item/plan may be cleaned as an orphan from its verified immutable ledger;
no parent/account is recreated and no read permission is restored.

Final settlement is one native MongoDB transaction: release the operation's
remaining reserved/retained bytes, concurrency, held success credit for the same
UTC allocation day, and item slot; mark deleted and record confirmed absence.
Daily attempts, completed successes and retained operation counts are never
refunded. Global byte/concurrency holds survive midnight; old-day credits never
reduce a new day's credits. Tombstones and generation identities remain counted.

A lost commit response is recovered through canonical state/driver commit retry,
not another S3 call inside a transaction. If settlement rolls back after DELETE,
charges stay held and the next fresh manifest verifies absence again. Two workers
cannot settle a charge twice. After a completed tombstone, a repeated fresh
preview has no cleanup work; reuse of the previous manifest is rejected as stale.

## Local operator procedure

Requires Node 22, the local Linux/amd64 Docker engine and the existing verified
fixtures. It is **not a production maintenance command**. It does not start an
application, seed demo data, prepare indexes or adopt existing development data.
Run from `giftlink-backend` using existing fixture receipts while their owning
process is alive, or preserved receipts after a killed fixture process. Do not
post receipts/manifests or credentials in chat/PR comments.

For a disposable operator exercise, a Node REPL can keep fixtures alive:

```js
const mongo = await require('./test/helpers/isolated-mongo').createIsolatedMongo();
const seaweed = await require('./test/helpers/isolated-seaweedfs').createIsolatedSeaweedFS();
console.log(JSON.stringify({ mongoReceipt: mongo.receiptPath,
  storageReceipt: seaweed.receiptPath, database: mongo.dbName,
  bucket: seaweed.receipt.bucket, namespace: seaweed.receipt.namespace }, null, 2));
```

This creates new, verified, empty local fixtures only. Never point a testing app
at Atlas. Existing [guarded index preparation](../README.md#prepare-database-indexes-explicitly)
remains separate, with its own dry-run/confirmations, if an application fixture
needs indexes. The regression suite manages indexes and synthetic image lifecycle
itself; no special setup is necessary for `npm run test:images:recovery`.

In a second shell, substitute only the printed **local** identities and private
paths (PowerShell accepts the same arguments on one line):

```sh
npm run images:reconcile -- --dry-run \
  --mongo-receipt '<private Mongo receipt path>' \
  --storage-receipt '<private SeaweedFS receipt path>' \
  --database '<giftdb_test_run>' --environment development \
  --provider seaweedfs-local --bucket '<moveout-test-run>' \
  --namespace '<item-images-test-run>' --manifest '<new private manifest path>'
```

Dry-run reads database/quotas and at most two objects per selected image. It never
writes image/account documents, indexes or objects. It writes only a **new** local
mode-0600 manifest; existing files, symlinks, broad permissions and foreign file
owners are refused on Linux. Windows uses the owning account's directory ACLs;
physical Windows/ACL behavior has not been verified. Store manifests in a private
directory. No URI, password, SDK response, original hash, key, account ID, message
or image bytes are printed. Summary output contains nonsecret target identities,
fingerprints, manifest digest, counts/check categories and an opaque cursor.

Review the manifest's exact operation IDs, current versions/states, immutable-row
digests and object observations. The manifest binds both independently verified
targets, receipt identities, environment, namespace and a ten-minute MongoDB-time
validity window. Confirm the planned operations before apply:

```sh
npm run images:reconcile -- --apply \
  --mongo-receipt '<same private Mongo receipt path>' \
  --storage-receipt '<same private SeaweedFS receipt path>' \
  --database '<giftdb_test_run>' --environment development \
  --provider seaweedfs-local --bucket '<moveout-test-run>' \
  --namespace '<item-images-test-run>' --manifest '<reviewed manifest path>' \
  --confirm-database '<exact database>' --confirm-environment development \
  --confirm-database-target '<full preview database fingerprint>' \
  --confirm-storage-target '<full preview storage fingerprint>' \
  --confirm-provider seaweedfs-local --confirm-bucket '<exact bucket>' \
  --confirm-namespace '<exact namespace>' --confirm-manifest '<full reviewed digest>'
```

Apply validates the entire database manifest before its first mutation. A lost,
modified, expired, wrong-target or stale record manifest requires a **new dry-run**.
Actual object changes discovered after claim stop cleanup with durable evidence.
Use a new manifest filename each time. `--limit` accepts 1–25 only in dry-run;
`--after '<nextCursor>'` pages the bounded due-operation query. No sweep/auto-loop.
Every query has a limit and server deadline. Apply processes at most **25** image
operations / **100** object inspections (four GETs per full two-variant cleanup),
sequentially. Provider calls retain the B1 five-second/one-attempt limits. The
CLI has a hard 120-second lifetime; an interruption may leave a partial batch,
leases or uncertain MongoDB commit, so inspect fresh state before further action.

Exit codes: **0** preview/success, **2** any explicitly unresolved apply entry,
**1** refusal/configuration/deadline. No automatic mutation retry occurs at CLI
level. Cleanup success concerns current primary objects only; there is no claim
about provider replicas, backups, logs or a user's downloaded copy.

Safe fixture shutdown, in the owning REPL:

```js
await seaweed.close();
await mongo.close();
```

These receipt-checked helpers stop/remove only their own local resources. The
maintenance CLI's close only closes clients; it never destroys containers,
volumes or buckets. Preserve receipts for review after a kill. Do not use Docker
prune or delete resources by a prefix/name guess.

## Verification and remaining decisions

### CI MongoDB kernel compatibility

The first CI runs stopped in existing MongoDB fixture setup, before B4 or browser
assertions. Sanitized diagnostics established: the **same pinned image** exited
with code 1, no OOM, MongoDB event **12257600**. The runner reported Ubuntu's
7.0.0-1017-azure kernel. The image is MongoDB **8.0.34**, whose default
`GLIBC_TUNABLES=glibc.pthread.rseq=0` enables TCMalloc's incompatible per-CPU path.
This was a startup safety refusal, not an application assertion or Atlas issue.

MongoDB's [8.0.34 startup compatibility check](https://github.com/mongodb/mongo/blob/a1cb58fa746233febef0da3e8034533ed4320c22/src/mongo/db/startup_check_rseq.cpp)
and [same-release regression](https://github.com/mongodb/mongo/blob/a1cb58fa746233febef0da3e8034533ed4320c22/jstests/noPassthrough/rseq_linux_compatibility/rseq_kernel_compatibility_check.js)
demonstrate `GLIBC_TUNABLES=glibc.pthread.rseq=1` as the compatible allocator
selection. The **disposable MongoDB container only** now sets that exact value:
glibc owns rseq and TCMalloc uses its fallback. The original image digest,
MongoDB startup guard, process/loopback/empty-database verification, replica-set
transactions, storage fixture and all test assertions remain. No host sysctl,
privilege, seccomp exception, runner/CI workflow, Atlas or application environment
is changed. This is an allocator profile, not a production MongoDB recommendation
or a bypass of MongoDB's kernel safety check.

The local ownership receipt and reattachment verifier also bind/check this exact
profile. Old fixture receipts without it are refused; use fresh owned fixtures,
never alter an existing database or forge a receipt to adopt it. Failure diagnostics
expose only bounded category/state, pinned-image match and numeric startup event
IDs/allowlisted signatures; raw MongoDB logs, configuration and credentials are
never forwarded. A regression verifies that private sentinels cannot escape.

### Regression evidence

`npm run test:images:recovery` uses a genuine disposable MongoDB replica set and
the unchanged approved SeaweedFS image, actual Sharp outputs and real stored
objects. Deterministic tests kill child processes before PUT/after permit/after
DELETE; inject failed writes, missing/changed objects, ambiguous DELETE, lost DB
commit response, concurrent cleanup and lifecycle fences. They inspect actual
objects and persisted journals/quotas, exercise the real CLI, full 25-operation/
100-inspection bounds, UTC rollover, strict receipts/manifests and non-republication.
Injected provider/DB errors are distinguished from actual physical deletion;
no fault-injection result is represented as a real cloud outage test.

Normal recursive backend CI includes B4 and all unchanged B1/B2/B3 suites.
Frontend tests/strict build, policy tests, complete local HTTPS browser/axe suite,
actionlint, links, whitespace and the 16 byte-identical gifts remain gates.
The two existing desktop/mobile photo browser cases now run the guarded local
reconciliation after logical deletion, verify the durable deleted/quota result,
and confirm the image URL remains inaccessible. No operator HTTP route is added.
Exact totals, immutable head and CI URL belong in the B4 PR. No hosted run,
physical Windows/macOS/ARM/Safari/iOS test or production recovery is certified.

Before any future R2 activation the owner must approve target/bucket/token scope,
remote photo-index preparation, actual Vercel buffering/memory/duration/native
packaging, provider absence/write-settlement behavior, operational staffing and
unresolved holds, audit/retention/erasure policy and backup/restore reconciliation.
No 30-day retention, scheduled cleanup, account erasure or provider lifecycle is
authorized here. Disabling uploads must leave compatible owner deletion, ledger,
quota and approved maintenance capability available; do not drop metadata,
change its binding, refund uncertain holds or roll back to an incompatible photo
binary. This PR supplies local backend lifecycle evidence, not launch approval.
