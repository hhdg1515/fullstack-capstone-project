# Milestone 6.5F4 — Distributed photo admission and revocation

Base: merged #73/main `ec592be7241f77f37a4884876a5ea502bcfd62a9`.
Branch: `codex/m65f4-distributed-photo-control`. Evidence date: 2026-10-30 UTC.

## Scope and audit

F1's exact signed role/credential/database/storage receipts, B4's durable permits,
unknown-write holds, transactional leases and recovery settlement remain the
foundations. F2's ticket-scoped upload clients and quotas are unchanged. F3 proved
that a process-local pause or replacing one worker's approval file cannot stop
another independently configured worker. F4 adds an opt-in, authoritative shared
protocol to address that **live participating-instance** gap. It does not activate
photos, connect a provider or claim permanent revocation after database restore.

Ordinary startup refuses the new gate as well as R2/pipeline activation. No DDL is
performed on startup. Local Docker ownership receipts, signing, CSRF, participant
and owner authorization, image privacy, sanitization, five-photo/daily/account
limits, the lifetime record cap and the 16 demo gifts remain intact. No new
packages, index registry changes, workflows, retention jobs or public APIs are added.

## Authoritative record and trust

`photoControls` contains one signed record per complete target: database name,
DB environment/fingerprint, `r2-private` provider, storage fingerprint (including
account/endpoint), exact bucket and namespace. `_id` is a domain-separated digest
of that identity. The collection requires **only MongoDB's native unique `_id_`
index**; extra/incompatible indexes are refused without repair. Explicit reviewed
initialization creates the collection/native index if absent; runtime merely
checks them. No TTL or pruning is introduced.

The policy carries an immutable random `controlId`, monotonic revision, predecessor
policy digest, upload-admission boolean and independent runtime/recovery grants.
Each grant pins the canonical digest of the **entire existing F1 signed approval**,
its verification-key hash, issue time and monotonic role epoch. F1's receipt schema,
credential binding and maximum 24-hour lifetime do not change.

An independently pinned Ed25519 **control-owner public key** verifies the policy.
Its private key is offline-only and must differ from both role approval keys;
the API/context refuses private signing-key variables. Trust is never obtained
from a public key stored in the database. Signing domain:
`moveout-photo-control-v1:` plus the canonical state digest. All state except
`signature` and the transactional `fence` counter is signed. The counter is an
ordering lock, not an authorization grant. Safe-integer exhaustion refuses work.

Operator changes require an exact target digest, predecessor digest (or `absent`),
new policy digest and next revision. Apply uses MongoDB time and refuses future or
over-ten-minute approvals. Persistent accepted policy does not expire at that
apply deadline; worker F1 receipts still expire and are checked on every I/O.
Concurrent updates from one predecessor cannot both win. Initialization is paused.
Renewal/rotation requires a different valid full F1 approval with a strictly later
issue time, advances that role's epoch and requires fresh worker contexts and
recovery manifests. Runtime rotation leaves admission paused.

## Linearization and stale-instance refusal

Every controlled new reservation and durable upload claim performs these steps in
**the same majority-write, snapshot-read transaction** as its ledger/quota writes:

1. Reverify the original F1 receipt, exact target and signed current policy.
2. Require runtime authority, the local admission ceiling and shared admission.
3. Compare and increment that policy row's fence before making metadata changes.

Pause/resume/revoke/rotate CAS-replaces **that same row**, preserving/incrementing
the observed fence. A transaction that read an older admitted snapshot must either
commit before the pause, or lose the write conflict and retry against paused state.
It cannot commit a new claim after an already committed pause. There is no positive
admission cache. Processing permits, finalization and photo metadata mutations also
fence this row, but already claimed work can drain during an admission-only pause.
Recovery claim/transition/settlement transactions fence under the independent
recovery grant; preview checks authority without mutating the control record.

Outside a transaction, authority reads use bounded two-second **primary
linearizable** queries; inside, snapshot reads plus the actual fence write provide
ordering. Controlled F4 contexts therefore accept **replica sets only**, refusing
sharded topology rather than weakening read semantics. Existing legacy F1 contexts
are unchanged. A process tracks its observed revision/digest, and configuration
pins a control ID/minimum revision. Missing, corrupt, mismatched, stale, unavailable
or untrusted control refuses photo authority. Text/auth uses its separate pinned
application connection; photo failure does not require an auth outage.

| Owner operation | New reservations/claims | Previously committed work | Authorized reads/status | Cleanup |
| --- | --- | --- | --- | --- |
| Pause admission | Refused | May safely drain under valid runtime authority | Allowed | Separately authorized recovery remains available |
| Resume | Allowed only within local ceiling and all existing limits | Normal existing rules | Allowed | Independently authorized |
| Revoke runtime | Refused | Further app authorization/transition refused; already dispatched I/O can arrive | Runtime photo authority refused; text/auth remains | Recovery remains available if separately valid |
| Revoke recovery | Runtime admission unchanged | Runtime rules unchanged | Runtime rules unchanged | Refused; already issued I/O cannot be recalled |
| Revoke all | Refused | Subsequent photo authority refused | Photo authority refused; text/auth remains | Refused until independently approved fresh grant |

A pause does not cancel a request or prove a PUT absent. Revocation never refunds
unknown writes, erases a tombstone, resets an operation ID, replays a PUT or settles
quota. Neither client shutdown nor a negative GET proves absence of a late write.
An SDK request that has already passed the authority check can dispatch/commit
after a revoke; its durable unknown permit and charge remain for fresh authorized
B4 recovery. Previously delivered image bytes cannot be recalled.

## Adoption and administration boundary

See the [local control runbook](photo-distributed-control-runbook.md). The supplied
administration CLI accepts **only independently receipt-verified disposable local
MongoDB/SeaweedFS fixtures**, using a synthetic R2 bridge identity. It cannot take
`--allow-remote`, substitute a URL, create a real R2 context or bypass local receipts.
Offline signing has no database/network access. Dry-run reports intended native
schema and digests; private snapshot/change files remain private. The generic
transaction/signature core is production-compatible code, but a remote control
administration boundary and actual hosted wiring remain **unimplemented and
unapproved**. Existing guarded `db:prepare` and recovery apply protections remain.

Adoption requires quiescing **all older/uncontrolled photo workers** first. New
binaries refuse exact-target legacy R2 fallback once the control exists; a
metadata-only service also refuses a matching adopted storage binding. These
checks do not retroactively fence old binaries or establish an independent
adoption marker. Future controlled instances must all use the explicit gate,
owner public key, control ID and approved minimum revision. Missing/corrupt state
must never be worked around by disabling that gate or deleting the record.

## Actual concurrency, crash and rollback evidence

`npm --prefix giftlink-backend run test:images:distributed` uses the existing
pinned private SeaweedFS fixture and disposable real MongoDB replica set. Child
workers have separate **Node OS PIDs**, HTTP servers, Mongo clients, receipt files
and role trust. A local-only signed-request bridge maps synthetic R2 transport to
the verified private service; nonloopback HTTP/provider HTTPS is blocked in these
workers. This is not an R2 or deployed Vercel test.

Seventeen new cases cover exact signed initialization, startup without DDL/S3,
read-only/incompatible index checks, independent-instance pause/resume,
owner/nonparticipant access, missing guard wiring, stale reservation/claim
transactions, admitted drain, late I/O after revoke, SIGKILL before/after actual
PUT and after DELETE, two-process cleanup, fresh signer grants, malformed control,
competing owner changes, five concurrent pause/resume rounds, full revocation and
the actual preview/offline-sign/apply commands. Forced old-snapshot reservation
and claim races each assert an **actual MongoDB code 112 write conflict**, unchanged
quota/ledger, and refusal on retry. A pause happens after the worker's stale read,
not merely before the HTTP request. Cleanup workers settle once; unknown writes
retain holds. Existing E1/F1/F2/F3 and owner/public/pickup tests are retained.

The rollback drill restores an earlier **signed control row**: an observing
process refuses it, a new process with a higher pinned minimum refuses it, but a
fresh process with old trust/minimum can accept the still-valid older policy.
That acceptance is deliberately asserted. This is **not** a coordinated restore
of MongoDB plus objects and is not permanent revocation evidence. A database
writer capable of replaying an older signed row has the same freshness limit;
a valid signature alone is not an independent high-water authority. See the
[verification record](verification/m65f4/local-results.json) and PR for exact
full-suite totals, immutable CI head and job links.

## Remaining readiness risks

| Priority | Finding / required decision |
| --- | --- |
| P0 before claiming permanent revocation | Restoring database/control plus stale worker trust can resurrect old authority. No genuinely independent high-water authority exists. Quiesce all workers and keep all photo gates off during restore; approve a fresh out-of-band checkpoint/trust inventory before any trial. |
| P0 before hosted use | No real R2/Atlas/host wiring, remote control admin boundary, provider IAM validation or hosted multi-instance evidence. Ordinary production startup remains blocked. |
| P1 | Root control-owner key custody/rotation and compromised-key recovery are out-of-band operations. Application revocation cannot revoke a stolen provider IAM credential. Independent provider/token response requires separate approval. |
| P1 | Clock skew can cause safe refusal or extend an F1 worker-clock receipt window. Operator apply uses DB time; clocks still require management. Already-authorized provider I/O cannot be synchronously recalled. |
| P1 | Single-row write contention, repeated signature/target/linearizable checks and per-process pools add cost/latency. Local race tests do not establish throughput, failover/partition behavior, host deadlines or free-tier capacity. F4 does not support sharded topology. |
| P1 | Prior dependency debt, physical Safari/iOS, Windows Docker/ACL, coordinated backup/restore, R2 late-write/conditional-write behavior and Vercel resource limits remain unverified. No package upgrade is bundled into F4. |
| P2 | Current policy and predecessor hash are not an append-only history. Owner custody/retention of private signed changes, monitoring cadence and automatic scheduling remain unimplemented decisions. |

## Rollback compatibility

With all production photo gates disabled, ordinary text-only deployment rollback
retains prior functionality and requires no new index. After any future adoption,
keep an F4-aware compatible binary for photo reads/processing/recovery and preserve
the signed control, exact target, quotas, unknown holds, leases and tombstones.
Do not roll active photos back to an F3/uncontrolled worker, reset the fence/revision,
drop the collection, restore old receipts to reauthorize work or replay mutations.
If controlled service cannot be restored safely, maintain a full photo outage and
leave text/auth/inventory/pickup running. Reinspect and explicitly approve each
fresh recovery manifest; no automated cleanup, refund, migration or production
activation is included.


## Dependency audit snapshot

No dependency or lockfile changed. Current official/default npm registry audits
agree: backend full/runtime **0 affected package entries**; frontend **352**
(0 critical, 71 high, 165 moderate, 116 low), with 122 directly listed advisory
source IDs. These are package/advisory classifications, not 352 confirmed distinct
exploits. F3's historical snapshot reported 67; audit datasets/reverse-dependency
classifications can change without a lockfile change. F2's detailed browser/build/
test reachability triage remains historical, not a fresh F4 exploitability claim.
See the [current sanitized evidence](verification/m65f4/dependency-summary.json).
Scoped dependency compatibility tests and strict build remain required, but do
not make the outstanding frontend audit green. A separate dependency review is
still needed before public launch; no forced upgrade or framework migration is
included in this concurrency milestone.
