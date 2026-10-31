# Milestone 6.5F5 — Coordinated photo disaster recovery acceptance

Base: merged #74/main `e5b6bb0d34e52ddd88ad59a4d1706e217c06cc6e`.
Branch: `codex/m65f5-coordinated-photo-restore`. Evidence date: 2026-10-30 UTC.

## Decision and scope

Use a **full photo outage during unsafe recovery**, followed by independently
reviewed reconciliation and fresh signed grants. An old database or valid old
signature is never sufficient recovery approval. No independent rollback-resistant
trust authority is introduced or claimed. No production application behavior,
feature gate, index registry, quota, retention or workflow is changed by F5.

F5 adds a bounded **test-only** local disaster harness, independent restore and
application OS processes, 14 disaster drills, three dependency-evidence regressions,
three real subprocess lifecycle regressions, and an [operator restore runbook](photo-disaster-recovery-runbook.md). The harness
uses the original live Docker/MongoDB/SeaweedFS ownership receipts. It cannot take
an arbitrary URI, provider, bucket or Docker context. All data and cryptographic
identities are synthetic. No R2/Atlas/Vercel API, hosted E2E, deployment, paid
resource, real data restore or production activation is involved.

## Contracts reviewed

| Foundation | Preserved contract / recovery implication |
| --- | --- |
| B1/B3 | Private exact target, loopback-only local fixture, pinned image/volume/network, sanitized immutable variants, bounded conditional `If-None-Match: *`, no original filename/EXIF/GPS/provider URL. A restore requires these original receipt checks too. |
| B2/B4 | Five-photo/account/daily/lifetime bounds, durable one-time PUT permits, reserved/retained charges, leases, generation/key digests, delete journals and permanent tombstones. Restore code never settles quota or marks unknown writes absent. |
| F1 | Separate signed runtime/recovery receipts with full identity and credential binding, worker-clock expiry, no SDK replay of uncertain PUT. Synthetic R2 re-signing bridge is not real R2 evidence. |
| F2 | Ticket-scoped clients preserve durable anti-replay state; closing/creating a client does not prove absence or justify a refund. No retention/erasure policy changes. |
| F3 | Offline diagnostics are not target/IAM/host readiness; operator preview/apply stays bounded and explicitly approved. |
| F4 | Signed exact-target shared policy, independent owner trust, monotonic authorized changes and same-row transaction fences. Committed pauses order new claims; late issued I/O may still arrive. Rollback of DB and old trust can resurrect authorization. |
| C1/C2/D1/D2 | Owner management, authoritative cover order, public eligibility, participant checks and historical text remain distinct from photo permission. Restoring pending/closed history must not silently reopen an interaction. |

## Local backup and restore model

The harness records **two independent logical snapshots**, not a filesystem or
provider backup. The database snapshot uses a real snapshot-read transaction over
an explicit eight-collection allowlist: users, sessions, moveOutPlans, items,
pickupRequests, pickupMessages, itemImages and photoControls. It retains BSON types.
Unknown collections refuse the exercise instead of being silently omitted.
Snapshots have a full verified local target, kind, schema version, timestamp and
canonical digest. Private files are exclusive-create, mode 0600 in a private
fixture directory; they contain synthetic sensitive records and are never logged
or committed. A host timestamp is not an oplog/PITR timestamp.

Object snapshots independently GET **only exact variant keys derived from the
bounded known ledger**, verify bytes/length/metadata/hash through the original
private adapter, and record presence or a confirmed `NoSuchKey`. No bucket/global
listing or namespace sweep exists. Unknown keys and orphans outside this inventory
are **not certified absent**. Missing bucket, authorization failure, corruption or
unavailable storage aborts capture/checking; they do not produce an empty success.

Limits: 500 total documents, 25 photo-operation rows, 50 variant keys and 16 MiB
per snapshot. These limits deliberately fit synthetic fixtures; they are not a
production backup capacity claim. A reviewed complete production inventory would
need bounded pagination and separately approved provider backup/orphan evidence.

The coordinator owns a registry of real OS workers. Quarantine closes its photo
launch gate **before** stopping every registered application/recovery/text worker.
Restoration refuses live managed workers. A separate child process independently
reopens both local receipts and checks the exact target, snapshot/plan digests,
source preimage and ten-minute DB-time approval window. Database replacement uses
one majority transaction and preserves existing indexes; **all sessions are deleted
and none reinserted**. No DDL or account normalization occurs. Object reconstruction
is separately approved, limited to the exact known key manifest and pre-observed
bytes, validates every backed-up payload before destructive work, and uses the
unchanged conditional private adapter. It is administrative **synthetic backup
reconstruction**, never application retry of an uncertain PUT. It never changes
the database, operation ledger or quota. Partial/ambiguous reconstruction keeps
quarantine closed and requires fresh inspection, not automatic replay.

The worker registry/approval files are **test coordinator controls**, not a new
hosted distributed restore service or independent permanent trust anchor. They
cannot stop an unregistered process or an operator restoring those files too.
Ordinary production startup already refuses pipeline/R2/F4 activation; an eventual
hosted procedure must independently keep those gates off and inventory/quiesce
**all** workers. Do not present this harness as deployed restore protection.

## Consistency checks and reauthorization

A separately retained, owner-reviewed latest safety checkpoint is compared with
the restored DB and current object observations. The checker reports categories,
counts and digests, never user IDs, messages, keys, hashes of image content or
credentials. Checks include:

- Every known durable operation remains represented; tombstones and generations
  are not silently replaced by older Ready rows. Extra/unreviewed operations fail.
- Every Ready variant is present with matching authoritative bytes; deleted-row
  bytes that reappear are flagged even if the restored DB calls that row Ready.
- Owner/account/plan/item references match, with unchanged visibility, deadlines,
  request state and private message history relative to the safety checkpoint.
  Photo-only item/plan revision counters do not unnecessarily stop text service.
- User quota schema, retained operation count, reserved/retained sums and active
  holds reconcile against the bounded ledger, and quota checkpoint drift is
  reported. Any unresolved reservation/processing/DELETE holds block photo release.
- Control signature/target/control ID, known minimum revision and same-revision
  digest remain consistent. Higher independently signed grants are permitted;
  their full F1 proofs are still checked by the actual F4 context at startup/I/O.
- Restored sessions are absent. Account security differences block authentication;
  account/visibility/ownership/history conflicts require wider maintenance.

A clean report means **consistent within the reviewed inventory**, not global
absence, trusted backup freshness, production readiness or permanent revocation.
The coordinator rechecks its report/preimage before release and requires exact
report/target approval plus newly issued F1 runtime and recovery receipts,
separately installed through signed F4 grant changes. Shared admission must still
be paused. Reopening is **read-only** with a local upload ceiling of false; it
never resumes uploads automatically. A later upload resumption is a separate
owner decision and is not performed by F5.

## Actual drills

Fourteen scenarios run against actual disposable MongoDB replica sets, Sharp and
verified private SeaweedFS, with independent Node processes and no retries:

1. Independently captured Ready DB/object snapshots restore correctly; old cookie
   fails, new login works; fresh paused grants allow reads, not uploads; unlisting
   again revokes requester/public media while the owner retains legitimate access.
2. Old DB plus old object backup loses a later tombstone, quota and revoked control.
   The report flags all three plus reappeared bytes; approved recovery stays closed.
3. Tombstone DB plus old bytes keeps the media private. Explicit exact-key empty
   snapshot reconstruction plus fresh GET checks removes the synthetic resurrection
   without another quota refund or dropping the tombstone.
4. Old Ready DB plus newer empty storage reports missing Ready bytes. A synthetic
   GET timeout is treated as failure, with all charges intact.
5. SIGKILL after durable unknown permit but before PUT leaves no object; restoring
   that ledger plus negative GET still retains reserved quota and never replays.
6. SIGKILL after actual PUT commits but before response; after DB restore, two
   fresh-authorized recovery OS processes compete and settle exactly once.
7. SIGKILL after actual DELETE leaves `delete_unknown` and charges. Restoring that
   journal plus older bytes requires a new grant/manifest and verified B4 settlement.
8. Old DB would resurrect an old password/security state; old sessions are discarded
   and login remains blocked pending independent account reconciliation.
9. Old pending request/public listing would undo cancellation/unlisting. Private
   flows remain in maintenance; restoring the approved newer checkpoint preserves
   closed read-only conversation text without exposing photos or reopening sending.
10. Compromised restored item ownership grants neither participant media access;
    reauthorization refuses instead of silently transferring accounts/photos.
11. Corrupt/oversized/foreign-target/foreign-storage-binding snapshots refuse.
12. Wrong target/digest, live workers and a changed preimage refuse before mutation.
13. SIGKILL of the restore process **after real MongoDB commit** loses its response;
    inspection confirms the outcome, rejects a stale preimage and keeps photos off.
14. Deliberate **unmanaged** old-trust worker boots after an old signed DB restore
    and reads the synthetic old image. The approved coordinator refuses startup.
    This counterexample is asserted, then that worker is stopped. No permanent
    revocation guarantee is invented.

An initial CI run exposed a test-fixture IPC shutdown race: the one-shot restore
executor could close its channel after returning a result while the parent sent
an unnecessary close message. That uncaught EPIPE caused secondary test teardown
errors. The parent now joins one-shot executors, uses callback-based IPC sends and
bounded shutdown, and refuses nonzero exits. Three additional real-process tests
cover repeated completion/join, sends on a closed channel and nonzero exit after
acknowledgment. No application, storage or authorization rule was weakened.

Existing F4 stale-snapshot code112 races, admitted drain, full role revocation and
all prior application/storage/cleanup/browser suites remain unchanged. This is not
Mongo replica-set failover, an in-progress filesystem snapshot restore, actual R2
or a coordinated provider backup certification. No new UI or screenshot claim is
made; existing actual local HTTPS desktop/mobile/axe coverage is preserved.

## RPO/RTO and evidence boundaries

No production RPO/RTO is established. Independent snapshots can omit later PUTs,
deletions, revocations, password changes or session invalidations. If latest safety
evidence is missing, the safe photo-outage duration is **unbounded**, not zero.
Human approval/custody, provider restore time, data size, network transfer and
unknown-write escalation are outside synthetic apply timings.

Tests emit allowlisted `localRestoreMeasurements` for actual child-process logical
DB/object apply only. Final observed ranges, exact suite totals, final-head CI and
teardown are recorded on the PR and in the local evidence packet. Timings for tiny
96×64 synthetic input are not a throughput target or an operational recovery SLO.
See [the dependency checkpoint](milestone-6.5f5-dependency-checkpoint.md) for the
67/352 cache-dependent audit reproduction.

## Final readiness assessment

| Priority | Remaining boundary / owner decision |
| --- | --- |
| P0 for permanent revocation | No independent rollback-resistant high-water authority. Old DB plus old trust can reauthorize an unmanaged worker; DB writers can replay old signed state. Stop every photo worker and retain an independent deployment/configuration outage during restore. |
| P0 before hosted photos | Real R2 IAM/conditional writes/late I/O, Atlas backups/network/restore and Vercel wiring/load are unverified. Production gates stay off. No remote restore/admin integration or automatic orchestration is installed. |
| P0 during unsafe restore | Missing latest deletion/revocation/account evidence or inconsistent ledgers means no photo release. Wider authentication/private-data outage may be necessary. Do not guess a safe newer state. |
| P1 | Freshness/custody of backups and independent safety checkpoints, root signing-key compromise/rotation and actual provider token revocation require named ownership and separate approval. A hashed file is not a rollback-resistant authority. |
| P1 | Restored bytes behind already-settled tombstones are private but require explicitly reviewed exact-key reconciliation; ordinary B4 must not be forced to reopen deleted operations. Unknown writes remain held indefinitely absent adequate positive evidence. |
| P1 | No production RPO/RTO, encrypted backup retention/erasure policy, full orphan inventory, Windows Docker/ACL, physical Safari/iOS or cloud/failover/partition evidence. No paid backup feature is assumed available. |
| P1 | Frontend dependency audit remains nonzero. Cache-independent evidence reproduces F2's 67; default-cache report is 352. Same direct advisories remain and require focused follow-up; no force upgrade/migration occurs here. |
| P2 | A separately reviewed operational checklist/checkpoint custody and monitoring cadence may be developed after human acceptance. No broad recovery service, cleanup schedule, retention pruning or auto-release is justified by these fixtures. |

## Rollback

F5 changes tests/evidence/documentation only. With production gates off, rolling
back F5 does not alter application data or require schema rollback. After any
future F4 adoption, keep F4-aware photo binaries or retain a full photo outage;
never use F3/uncontrolled workers as an active-photo rollback. Preserve exact
binding, signed control/checkpoints, every durable permit, hold and tombstone.
Do not restore sessions, replay an unknown PUT, reset quota/fences or delete
recovery records. Do not automatically resume from a passing offline report.
