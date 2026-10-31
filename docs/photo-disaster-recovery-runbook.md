# Photo disaster recovery — operator restore runbook

This runbook does **not authorize** provider access, resource changes, real-data
restore, deployment, photo activation or cleanup. F5 executes only synthetic,
receipt-owned local exercises. Real Atlas/R2/Vercel recovery requires a separate
owner-approved target inventory, maintenance window, permissions and procedure.
Never request or publish credentials, private keys, snapshots, message bodies,
session hashes, manifests, object keys, EXIF, original filenames or image bytes.

## 1. Reproduce the local acceptance drill

From the reviewed repository root with Node 22 and the existing local Docker daemon:

```sh
npm --prefix giftlink-backend ci
npm --prefix giftlink-backend run test:images:restore
```

The command creates its own disposable MongoDB replica set, guarded application
indexes, private pinned SeaweedFS fixture and synthetic signed F4 policies. It
opens separate application/recovery/restore OS processes and cleans up only its
ownership-receipt resources. It does not consult a Mongo URI or use real R2
credentials. Do not substitute a development DB, Atlas URI, remote Docker context
or existing bucket; do not Docker-prune. Fixtures are not provider backup tools.

The harness source is `test/helpers/photo-restore-exercise.js`; snapshots/plans and
bytes stay in private temporary files. Test code explicitly approves its known
synthetic plans to exercise mutations. There is **no general remote restore CLI**
and no HTTP administrative endpoint. Do not extract its collection replacement
code into a hosted job or claim that its in-memory worker registry fences a fleet.

## 2. Declare and independently enforce the outage

For a future separately approved incident procedure:

1. Name the operator, exact release and target DB/storage fingerprints, account,
   bucket, namespace, incident time and evidence custody. Verify both database and
   object identities independently; variable names are not ownership proof.
2. Stop new admission with the signed F4 pause if trusted/current authority exists.
   Inventory **every** old/new API instance, in-flight upload, recovery process and
   scheduler. A committed pause permits admitted work to drain and cannot recall
   issued I/O. Record unresolved permits and preserve their holds.
3. Stop/quiesce all photo-capable workers and keep an **outside-the-restored-DB**
   deployment/configuration outage. Existing ordinary startup refuses photo pipeline,
   R2 and F4 activation; do not remove that refusal. During unsafe recovery, do not
   start an explicit photo context simply because an old signature validates.
4. Independently decide whether text/auth/private pickup data is safe to serve.
   Account security/password/deletion or ownership/history/visibility regression
   requires wider maintenance. Do not expose rolled-back private records or reuse
   old sessions in order to preserve apparent availability.
5. Preserve independent latest revocation/deletion/account evidence and trust
   inventory before restoring anything. If it is unavailable, remain stopped.
   A checkpoint file copied alongside the same rollback is not an independent
   high-water service or a permanent revocation guarantee.

Local harness profiles model these decisions: `text-quarantine` has no photo
routes; account differences use anonymous maintenance; ownership/visibility/history
conflicts use locked maintenance. They are **test profiles**, not new production
maintenance routing or provider configuration.

## 3. Inspect backups and create an exact bounded preview

Record each DB and object snapshot separately: actual capture semantics, schema,
full target, checksum, known operation/generation list, object metadata and bytes,
control ID/revision/signature, account security and session cutoff. Verify integrity,
encryption/custody and independently trusted latest safety evidence. Do not assume
M0 has a tested backup, PITR, object versioning or immutable backup retention.

The local exercise's explicit call shape is:

```js
await exercise.quarantine(); // closes photo gate, then stops all registered workers
const preview = await exercise.plan(reviewedSnapshot, reviewedDatabaseInventories);
// Privately review target, snapshot digest, source-data/object preimage and deadline.
await exercise.execute(reviewedSnapshot, preview, {
  target: '<independently reviewed full target fingerprint>',
  plan: '<reviewed full restore-plan digest>'
}, reviewedDatabaseInventories);
```

`exercise` is an already receipt-owned **synthetic** test exercise, not a remotely
configurable client. Exact confirmation strings are mandatory; no URI or fallback
exists. A missing/malformed/conflicting backup or plan stops before approval.
A changed source preimage needs a new preview and approval. Snapshot bounds are
500 documents, 25 operations, 50 exact keys, 16 MiB, with ten-minute DB-time approval.
No bucket/global listing, unknown-key sweep, account merge, normalization or index
repair is part of preview or restore. Indexes stay in place; separately approve
existing guarded `db:prepare` if a future target actually needs schema preparation.

## 4. Apply under quarantine; inspect uncertain outcomes

Database and object restoration are distinct actions requiring distinct previews.
The database restore is a majority transaction over only the known fixture
collections, preserving BSON types and indexes. It **invalidates every session**;
no old session row is inserted. Restoring password/profile/account data still needs
independent security review before login is served.

Object reconstruction replaces only its explicitly observed exact-key inventory,
using existing private conditional writes and verified bytes. It is not retry of
an application's uncertain PUT. Unknown application permits and charges remain
unchanged. Object reconstruction is not atomic; any interruption or unexpected
object requires fresh status checks and explicit reconciliation. Never switch to
unconditional overwrite, broad deletion, a public bucket or another target.

A killed/timed-out process may have committed. Keep the outage and inspect the
actual DB digest/rows, object bytes, journal and control state. Do not replay a
restore or unknown upload blindly. Do not equate DELETE acknowledgement, empty
HEAD/GET, elapsed lease time or an unreachable bucket with release/settlement proof.
The F5 drill kills a real restore process after MongoDB commit to verify this path.

## 5. Reconcile using the decision matrix

| Observation | Required action | Forbidden shortcut |
| --- | --- | --- |
| Ready row + correct bytes + surviving owner + trusted checkpoint | Retain outage until account/control review and exact fresh authorization | Starting workers from a matching old signature alone |
| Ready row + missing/corrupt/unavailable variant | Keep outage; investigate snapshot gap/positive reconstruction evidence | Calling restore successful, hiding it as an empty marketplace or refunding |
| Tombstone missing or older Ready row replaces it | Restore/reconcile an independently approved newer ledger; remain stopped | Silently resurrecting the photo or merging records automatically |
| Deleted tombstone + restored bytes | Keep access denied; separately approve exact-key reconciliation and verify outcome | Reopening deleted operations or refunding the same quota twice |
| Unknown PUT + negative GET | Retain permit, identity and quota; escalate independently | Inferring absence from time, process death, HEAD, GET or empty backup |
| Unknown PUT + matching actual bytes | Fresh bounded B4 preview, separate recovery grant and approved apply | Upload retry or direct ledger settlement |
| `delete_unknown`, interrupted cleanup or stale lease | Preserve charge/journal; fresh grant/context/manifest; use B4 fences | Reusing an old manifest, lease reset or forced tombstone removal |
| Old/revoked signed control | Full outage; independent known checkpoint and fresh trust review | Replacing a file/boolean and claiming permanent revocation |
| Account password/deletion/security mismatch or restored sessions | Invalidate sessions; block login until approved security reconciliation | Serving resurrected credentials to maintain availability |
| Ownership, publication or request/history mismatch | Protect affected private/text flows; review canonical newer state | Transferring ownership, republishing or reopening a request automatically |
| Missing independent latest evidence / incomplete unknown-key inventory | Remain stopped; scope further approved inspection | Treating a clean bounded page as full provider consistency |

## 6. Reestablish trust and selectively restore service

A clean bounded report is necessary but insufficient. The owner independently
approves backup freshness and current deletion/revocation/account state, exact
control ID/minimum revision, owner public-key custody and credential trust. After
any suspected compromise, actual provider-token/root-key response needs separate
provider/host approval; application policy cannot revoke stolen IAM credentials.

1. Confirm no old/uncontrolled worker can restart. Reconcile DB, objects, ledger,
   tombstones, quotas, sessions and request history against independently retained
   evidence. Do not silently normalize/delete/merge accounts or operations.
2. Keep shared admission paused. Issue fresh F1 runtime/recovery receipts and
   separately signed F4 grant changes, with strict target/credential binding.
   Do not reuse old contexts/manifests after renewal. Confirm Mongo replica-set
   topology, required indexes and read-only health; F4 refuses sharded fallback.
3. Obtain explicit approval of the exact consistency report/target and fresh
   grants. The local harness rechecks the report and grants and opens only a
   **read-only** photo context with its local upload ceiling false.
4. Verify owner/public eligibility, stale URLs, unlisting, deletion, expired items,
   closed pickup history and nonparticipants with synthetic accounts. Reauthenticate
   through new sessions. Never make private photos public to simplify recovery.
5. Any future upload resume, real-provider test or hosted change requires separate
   owner approval. F5 never performs it. A restored database alone must not trigger
   activation or an automatic cleanup/resumption job.

F4's known limitation remains: an unmanaged worker with old configuration can
accept an old signed control row from a restored DB. The local test explicitly
shows that access, then stops the worker. There is no independent rollback-resistant
trust/high-water system. Do not rename a private file or minimum revision into
such a guarantee; loss of trusted freshness can require indefinite photo outage.

## 7. Rollback, measurement and handover

Keep photo gates disabled and an F4-aware compatible binary available. F5 itself
adds only offline test/evidence/documentation; no schema rollback is necessary.
Never downgrade active photos to F3, change provider/namespace binding, reset
operation counts/fences, drop tombstones, erase unknown permits or restore sessions.
If safe photo service cannot be established, retain the outage and serve only the
independently safe text/auth/private workflows.

Record actual snapshot completeness/capture lag (RPO), quarantine-to-approved-read
elapsed time (RTO), human approval time, per-step timings, missing evidence and
unresolved holds. F5's printed local milliseconds measure tiny logical apply steps,
not human/host/provider recovery. No production RPO/RTO commitment exists.
Do not assume paid backups, legal retention or a zero-loss restore. Handover includes
exact commit/CI links, report/backup custody, the unresolved P0/P1/P2 assessment and
an explicitly approved next human/real-provider acceptance scope.
