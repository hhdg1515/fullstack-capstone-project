# Milestone 6.5F3 — Photo operations and deployment readiness

Base: merged #72/main `5806f5c1863bc2dd3f1469bc1eeb979670248057`.
Branch: `codex/m65f3-photo-operations`. Evidence date: 2026-10-30 (America/Los_Angeles).

## Outcome and scope

F3 adds an **offline configuration/receipt diagnostic**, a **strictly local,
bounded read-only maintenance summary**, lifecycle/recovery regression tests,
an [operator runbook and failure matrix](photo-operations-runbook.md), and a
[separate first-hosted-trial approval packet](photo-hosted-trial-approval.md).
There is no general admin console, hosted wiring, fleet-control implementation,
schema/index/retention change, new dependency, cleanup schedule or activation.
No real R2, remote Atlas, provider setting, deployment command or hosted E2E is used.

All production photo gates remain false in committed templates. `config.js` still
refuses R2/pipeline enablement; `runtime.js` never constructs an R2/photo pipeline
or creates indexes. Disabled-feature startup retains legacy required-index checks.
The B1 local verifier, B4 recovery decisions, F1 signing/target validation and F2
ticket-client lifecycle/capacity fixes are unchanged. All 16 gifts remain intact.
Existing Git hooks may automatically report Vercel PR previews; those are not
manual deployments or hosted photo acceptance evidence.

## Audit: implementation versus evidence

| Control | Implemented guarantee | Evidence / remaining boundary |
| --- | --- | --- |
| Owner approval | Exact schema, Ed25519 signature, target/role/credential binding, default 1h/max 24h, nonfuture/unexpired worker-clock validity | Offline synthetic keys and real local bridge contexts. Not a provider IAM attestation. Runtime never needs the private signer. |
| Target fencing | Separate opaque local receipt and signed R2 config; every photo DB/S3 operation rechecks authority/target | Actual local daemon/image/volume/network/loopback and Mongo topology/index identity; synthetic R2 bridge. Cloudflare account/bucket/TLS/IAM and Atlas project ownership still unverified. |
| Receipt renewal | Existing context pins original signature; replacement refuses old work; new context/manifest required | New renewal/restart/stale-manifest tests plus existing tamper/expiry/wrong-role/target tests. No automatic renewal. |
| Key rotation/revocation | A newly configured worker refuses old signatures; replaced/removed file affects workers observing that file | New test explicitly proves restoring a still-valid old receipt can reauthorize an old-trust worker. No global/permanent revocation/high-water mark. |
| Upload pause | Per-process new reservation/claim gate, configured ceiling, bounded existing work may drain | Two simultaneous local pipelines prove one pause leaves the other active; reads/status remain independently authorized. No fleet kill switch/admin endpoint. |
| Short-lived clients | New client only after durable ticket claim; two conditional PUTs, verification, close; aggregate eight-I/O budget | F2's 260-key synthetic-wire stress and actual local upload contracts retained. TLS churn/fleet costs on R2 unmeasured. |
| Unknown PUT | Durable one-time permit/unknown outcome, no SDK/app replay; negative read/time/abort/death cannot refund | B4 late actual local write, SIGKILL, F1 lost responses and F3 clock-boundary expiry drill. Permanently absent unknowns still require escalation/provider-specific evidence. |
| Deletion/recovery | Logical access revoked first; exact-key physical cleanup, leases/fences/row digests, verified absence, transactional exact-once settlement | Existing actual SeaweedFS interrupted DELETE, quota/ownership/object disagreement, stale/concurrent worker tests retained. Not cross-provider backup/restore certification. |
| Tombstones/capacity | Five photos, daily 50 attempts/20 successes, 100 MiB, two active uploads, 1,000 lifetime rows remain | F2 boundary/rollover/concurrent settlement stress preserved; F3 never prunes/archive/refunds/increases limits. |
| Private media | Application-mediated bounded variants, authoritative owner/public access; closed pickup text does not restore private photos | Full C1/C2/D1/D2 local browser/backend regressions retained; no bucket/public URL/attachment/EXIF change. |

## New diagnostic contracts

`images:preflight -- --offline` checks local Node/Sharp loading and reuses the
existing authoritative config/signature validators. It emits only fixed check
names/categories, versions, fingerprints and verified receipt timing/role/tier.
Missing/unsafe receipt, bad verification key, target/credential mismatch, signature
failure, trusted expiry and future issue time get sanitized feedback. It refuses
private signing-key presence in a runtime/candidate environment. Disabled R2 does
not load credential/receipt files. A child-process test blocks socket/DNS calls
and S3 SDK imports for both disabled and configured candidates.

It **does not parse/connect MONGO_URL or inspect live IAM/buckets/topology/indexes**.
The supplied DB fingerprint is not reverified. `configurationValid` is strictly
offline; `hostedTrialReady: false` and ordinary startup blocking remain explicit.
Sharp module loading on this machine is not Vercel native artifact verification.

`images:operations -- --local ...` reuses the two independent local ownership
receipts and live verifier. It checks required indexes without DDL, then reads
1–25 oldest maintenance records plus a single lookahead on the existing partial
index, with query and CLI deadlines. It validates selected operation schemas and
storage bindings; no object I/O, account scan, repair or mutation exists. Tests
check DB command allowlists, unchanged documents/quota, and **zero S3 sends**.
Output is page counts/fingerprints, not operation/account IDs, keys, hashes, names,
URI, credentials, manifest contents or provider bodies. `hasMore` is not a global
total; overlapping status counts do not certify ownership/accounting/absence or
authorize a refund. Existing guarded recovery preview supplies that evidence.
Both new commands reject apply/remote flags rather than consulting ambient URIs.

## Receipt lifecycle and multi-instance decision

Receipts are reusable authorization during their exact identity/lifetime, **not
single-use upload tokens**. Durable metadata prevents a valid signature or new
client/context from replaying an upload. Renewed receipts invalidate manifests by
their receipt digest, in addition to row version/fence/expiry checks.

Current trust is local to the worker's configured verification key and private
file. Updating a new file or another instance's key does not revoke old processes.
Even a replaced file can be rolled back to a still-valid earlier receipt for a
worker retaining the old key/signature. Tests document this limitation; they do
not invent a denylist or distributed guarantee. Expiration uses the worker clock;
MongoDB time independently governs reservation/recovery leases and manifests.
Clock accuracy, secure distribution, instance inventory and restart verification
must be owner-approved before any host activation.

### Concrete coordination proposal — not implemented or authorized

A future focused review may choose a shared MongoDB control record bound to exact
DB/storage/environment and a monotonic revision/trust epoch, upload-admission flag
and explicit trusted signer IDs. It requires a reviewed schema/index/signature
compatibility change, not an extra boolean in this PR:

1. Read control at context creation and every new reservation/claim/PUT permit;
   participate in a transactional CAS/fence so stale check-then-write workers
   cannot authorize a new claim after a committed pause/revocation. Missing,
   malformed, stale/unreachable or mismatched control must refuse new admission.
2. Keep upload admission distinct from separately authorized reads/status/cleanup.
   Key revocation is a stronger authority change and may intentionally deny all
   photo I/O; the operator must distinguish it from a pause. Auth/text should
   retain the pinned separate application connection.
3. Bind receipts/manifests/worker transitions to reviewed trust/control versions.
   Define renewal, compromised signer replacement, old-process fencing, cache
   lifetime and startup refusal. Do not cache positive admission indefinitely.
4. Already issued PUTs cannot be recalled. Keep durable holds and observe/settle
   their exact outcomes under B4; a new epoch cannot refund or recreate them.
   Previously delivered pixels cannot be revoked retroactively.
5. Address DB/control rollback and coordinated restore; a restored lower epoch is
   not a valid revocation guarantee. Decide an owner-controlled recovery trust
   anchor/high-water policy and test late old workers, failover, partitions and
   restore before calling it permanent/fleet-wide.

No record, collection, index, cache/poller, keyring, scheduler or migration is added
by F3. Alternatively a reviewed full-photo shutdown/restricted-trial operating
model may be proposed, with its read outage and propagation limits explicit.
No real multi-instance Vercel trial/activation is approved until the owner chooses
and verifies an adequate stop/revocation procedure; per-process flags alone do not
satisfy that gate.

## Actual local recovery drills

New tests add these observations to the existing B4/F1/F2 fixture evidence:

- Same-target renewal rejects an existing binding; fresh configuration accepts
  the new signature. A rotated public key refuses the old signer. A restored old
  unexpired receipt is deliberately accepted by old independent trust, demonstrating
  the missing global revocation guarantee. Expiry/future checks use explicit clock
  boundaries, not a claim of a day-long real-time/provider test.
- Two independent Express/pipeline instances **in one test process** share actual
  disposable MongoDB/SeaweedFS; this is not two deployed/OS processes or a host fleet.
  Pausing one leaves the other active; pausing each stops new claims while keeping
  authorized thumbnails/status usable. Resuming one does not resume the other.
- Approval expires at a simulated worker-clock boundary **after an actual local
  PUT commits**. No second PUT/finalization occurs; the charge/unknown journal
  survives, duplicate status does not retry, and a fresh approved recovery preview
  can compensate matching bytes. Only `Date.now` is stubbed; Mongo server time,
  Sharp, private local storage and transactions remain real.
- Renewed recovery authority rejects the old worker context and old manifest before
  DELETE. Restarted context plus a fresh preview settles once; reusing that manifest
  is stale and cannot settle again.
- A local summary of an issued-but-unsent synthetic PUT permit reports due unknown
  work without mutation/refund. This is a **ledger-only** summary drill, not an
  actual lost object write. Actual lost/late-write and process-kill evidence comes
  from the retained storage/recovery integration suites.

No successful cross-store restore, Windows ACL/physical Safari, R2 IAM/conditional
write, Vercel packaging/cold-start, remote Atlas or hosted E2E is claimed.

## Remaining P0 / P1 / P2 findings

Priorities mean **readiness gates**, not counts of confirmed security exploits.

| Priority | Finding | Next decision / safe state |
| --- | --- | --- |
| P0-01 | Real-provider transport/IAM/bucket/absence and hosted Node/Sharp/body/memory/same-origin behavior are unverified; hosted wiring is intentionally absent. | Separate exact-resource approval and focused hosted integration/trial. Keep activation refusal. |
| P0-02 | Per-process pause/file trust has no fleet-wide or rollback-resistant revocation guarantee. | Owner chooses reviewed coordination or explicit full-outage/restricted operating procedure, then validates stale instances and restore. No distributed claim/activation here. |
| P0-03 | Coordinated DB/object/deletion-authority backup/restore and operational custody are not proven. | Define RPO/RTO, private backup/retention/signing custody, reconcile holds/tombstones before reads and run an approved isolated restore drill. No production-data operation here. |
| P1-01 | Permanently unresolved writes/exhausted cleanup need staffed escalation; time cannot prove absence. | Name operator/cadence/stop thresholds and provider-specific evidence policy. Preserve holds; no force-refund. |
| P1-02 | 1,000 lifetime rows and retention/account erasure policy remain unresolved. | Review F2's retention packet; no purge/counter reset or silent tier change. |
| P1-03 | F2 dependency debt remains (frontend 67 affected entries: 27 high/18 moderate/22 low; backend audits zero in F2 snapshot). Counts are not distinct confirmed vulnerabilities. | Separate Router/toolchain consumer review before launch; F3 changes no versions/locks. |
| P1-04 | Runtime/recovery token granularity, signer distribution/renewal and Windows ACLs need real operational evidence. | Owner-approved least privilege/custody; no live secrets requested/created. |
| P1-05 | Atlas durability/backup, Hobby eligibility/limits, per-photo TLS churn/fleet DB load and actual-device/browser behavior remain unverified. | Revalidate current approved targets/account terms and bound trial workload; no paid infrastructure/provider change. |
| P2-01 | New summary is one local bounded page, not monitoring/history/global backlog accounting. | Approve privacy-safe observability/cadence later; no automatic scan/job/dashboard. |
| P2-02 | Existing narrow-screen owner forms and physical keyboard/screen-reader journeys need human acceptance. | Preserve current UX; run device checklist separately instead of broad UI work here. |

## Verification

[Sanitized local results](verification/m65f3/local-results.json) record actual
counts, fixture digest, unchanged lock/gift hashes and cleanup boundaries.
[Offline snapshots](verification/m65f3/) contain only sanitized disabled/synthetic
configuration and trusted receipt clock-boundary diagnostics, not reusable approvals.

| Local check | Result |
| --- | --- |
| Backend lint / complete suite | Passed / **643 passed**, including all actual storage/R2 bridge, crash/recovery/race/capacity cases |
| New regression cases | **17**, included above (11 diagnostic/local summary, 3 lifecycle, 3 operational bridge drills) |
| Frontend Jest / dependency compatibility | **444 passed / 23 suites** / **6 passed** |
| Backend dependency compatibility | **3 passed**, included in 643 |
| Strict build / deployment policies | Passed / **56 passed** |
| Complete isolated HTTPS Chromium | **68 passed**, **214 axe checkpoints**, zero violations, no retries |
| actionlint / whitespace / document links / JSON | Passed |
| Legacy gifts / fixture cleanup | **16 unchanged**; owned Docker fixtures removed, original stopped container/two volumes/baseline networks preserved |

The first targeted run correctly refused three incorrectly typed test owners;
fixtures were corrected to native ObjectId, without changing authorization. The
final complete run includes the subsequent secret/fingerprint-output regression.
No original test was removed. All three npm ci installations used committed locks
and an explicit writable cache. No dependency version or lockfile changed.

The PR records final immutable GitHub CI run/head and exact job results, separately
from local observations. See the [runbook](photo-operations-runbook.md) for commands
and failure decisions. The unchanged browser suite uses actual local HTTPS,
synthetic users, MongoDB replicas and verified SeaweedFS; axe is automated Chromium
coverage, not manual assistive-technology certification. No hosted run is used.

## Rollback and approval boundary

F3 adds only standalone diagnostic entries, package scripts, tests and documents.
Revert them to return to F2; preserve B4/F1/F2 binaries/records and disabled flags.
There is no DDL/data migration to undo. Never roll back with a counter reset,
receipt forgery, unknown PUT replay, deletion sweep or downgrade to B2/B3 photo
processing. No real-provider rollout is authorized by this report or its CI.
The [trial packet](photo-hosted-trial-approval.md) names the separate approvals,
executable preflight commands, workload and rollback gates for owner review.
