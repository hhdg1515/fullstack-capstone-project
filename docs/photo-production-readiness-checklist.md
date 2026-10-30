# Photo production-readiness checklist — separate approval required

This is a review checklist, **not authorization to provision, migrate, deploy,
run remote E2E or enable uploads**. E1's Linux/local acceptance does not satisfy
these unchecked remote/device gates. Keep all production photo gates disabled.
No secrets, URIs, receipts, manifests, private images or provider response bodies
belong in chat, PR comments or screenshots.

## 1. Owner decisions and exact targets

- [ ] Owner approves the next scope: read-only provider inspection, isolated test
  resource provisioning, schema preparation, remote E2E and production activation
  are separate actions, not one blanket approval.
- [ ] Record the exact existing Vercel team/projects, frontend/API environments,
  approved HTTPS origins and protected aliases; production routing/protection must
  remain unchanged unless separately authorized.
- [ ] Record approved isolated Atlas project/cluster/database and exact DB target
  fingerprint; do not assume an existing database is safe for tests.
- [ ] Define a private R2 test bucket/account/namespace, least-privilege runtime
  token and separate administration credential. Never infer the production target
  from a variable name. Credentials go to approved secret storage, not source.
- [ ] Confirm Hobby non-commercial/personal-use eligibility, actual usage limits
  and whether the expected product use needs an approved paid plan. No automatic
  infrastructure purchase or provider switch.
- [ ] Revalidate Atlas network-access durability, least privilege, quotas, encrypted
  backup custody, restore targets and support/incident ownership. Old M0/access-list
  observations are not evidence of current configuration. Do not broaden firewall
  rules or grant database-admin permissions as a workaround.

## 2. Focused implementation PRs before any activation

- [x] F1 implements a separate signed-target R2 transport/runtime factory and
  operator recovery entry, tested only against synthetic/verified local fixtures.
  See [the F1 architecture and evidence boundary](milestone-6.5f1-r2-architecture.md).
  Local SeaweedFS still requires its original opaque/live Docker receipt.
- [ ] Review and approve actual hosted wiring/activation. Ordinary startup still
  refuses pipeline/R2 enablement, even with otherwise valid target configuration.
  An endpoint replacement or a flag flip is not an approved deployment.
- [ ] Preserve exact target/prefix/key binding, explicit credentials, bounded
  requests, conditional immutable writes, no credential/endpoint fallback, one PUT
  permit, no SDK retry of uncertain mutations, integrity verification and private
  application-mediated delivery. Review HTTPS/account/region/checksum/error behavior
  on R2 rather than copying local us-east-1 settings. F1 supports only the standard
  account HTTPS endpoint with auto-region path-style requests; jurisdiction aliases
  require a separate review. The test bridge re-signs/maps to local storage and is
  not evidence of Cloudflare TLS, IAM, prefix or signing acceptance. Establish the
  native token granularity; do not assume provider IAM enforces the exact method/
  prefix split. Any broader credential permissions need owner risk approval.
- [x] F1 provides `images:r2:reconcile`, using signed recovery approval, exact DB/
  storage fencing and B4 bounded manifests/leases/journals. It has only local
  fixture evidence. Existing `images:reconcile` remains local-receipt-only.
- [ ] Approve the real operator identity, scoped R2 read/delete credential, DB role,
  secure Ed25519 signing-key custody and public-key/receipt distribution. Runtime
  must never receive the private signing key. Rehearse expiry (default one hour,
  maximum 24 hours), renewal, revocation and fresh preview after renewal. No scheduler
  or automatic renewal is installed; do not forge local receipts or remove guards.
- [ ] Provide a reviewed way to stop new upload admission independently from safe
  status/read/delete/maintenance behavior, or a documented total-photo shutdown.
  F1 supplies a per-process admission ceiling/stop and read-only transport; it
  deliberately does not supply a fleet-wide switch or hosted activation. Validate
  multi-instance propagation, bounded in-flight drain, receipt expiry, text-service
  availability, disabled startup and required-index compatibility on the real host.
- [x] F2 records [dependency triage and scoped fixes](milestone-6.5f2-security-capacity.md)
  with before/after locks/audits, consumer tests and production source-map evidence.
  F2/F3 recorded backend zero and frontend 67 affected package entries. The
  unchanged-lock F4 audit now reports backend zero/frontend 352 (0 critical,
  71 high, 165 moderate, 116 low); these are package entries, not confirmed exploits.
  See [current audit evidence](verification/m65f4/dependency-summary.json).
- [ ] Review remaining browser Router v6 advisories and older build/dev/test chains
  before public launch; plan a separate maintained-toolchain/router evaluation.
  No forced framework migration is implied. Reassess the pinned local image before
  any artifact upgrade.
- [x] F1 clarifies stale runtime gate text; deployed enablement remains refused.

## F3 operations evidence and remaining activation gates

- [x] [F3 operational audit](milestone-6.5f3-photo-operations.md),
  [local operator runbook/failure matrix](photo-operations-runbook.md) and
  [first hosted-trial approval packet](photo-hosted-trial-approval.md) separate
  existing guarantees, actual local drills and unverified provider behavior.
- [x] Offline sanitized Node/Sharp/config/receipt diagnostics and independently
  receipt-verified local bounded maintenance summaries. Neither tool has remote
  or apply mode; a valid offline configuration never means hosted-ready.
- [x] Local lifecycle tests cover renewal, rotation, old trust/receipt rollback,
  stale worker/manifest replay, mid-PUT approval expiry and two-instance pause
  boundaries. The existing actual storage/crash/race/recovery suites are retained.
- [ ] Approve and verify a fleet stop/revocation/restore operating model. Existing
  per-process pause/file replacement is not permanent distributed revocation; an
  old still-valid receipt can reauthorize a worker retaining old trust. The shared
  epoch/CAS design was a proposal in F3; see F4 below for local implementation.
  No control has been deployed or initialized remotely.
- [ ] Satisfy every separate real R2/Atlas/Vercel/device/restore approval gate in
  the trial packet. No new startup integration or activation is granted by F3.

## F4 live coordination evidence and remaining gates

- [x] [F4 shared policy and transaction protocol](milestone-6.5f4-distributed-photo-control.md)
  and [local operator runbook](photo-distributed-control-runbook.md): independent
  owner signature, exact target/full role-approval binding, monotonic policy and
  grant revisions, primary linearizable authority reads and transactional fences.
- [x] Independent Node OS-process tests cover actual stale-snapshot write conflicts,
  committed pause ordering, admitted drain, late writes after revoke, SIGKILL,
  concurrent cleanup, signer renewal/rotation and honest signed-row rollback limits.
- [x] Only explicitly signed local initialization creates the collection/native
  unique `_id_` index; no registry/startup migration or retention/index job added.
  All existing application/photo index checks and preparation guards remain.
- [ ] Quiesce and inventory every uncontrolled/old photo worker before adopting
  F4; pin the owner public key, control ID and minimum revision everywhere.
  Never disable the shared gate or downgrade to uncontrolled photo code to fix
  a refusal. Controlled topology is replica-set only, not sharded.
- [ ] Approve a future remote operator boundary and hosted injection. The current
  admin tool cannot operate on Atlas/R2; local fixtures use synthetic R2 identities.
- [ ] Resolve/explicitly bound the **P0 permanent-revocation-after-restore gap**:
  no independent high-water authority exists. Restore keeps gates off/workers stopped
  until an out-of-band trust/checkpoint and ledger/object reconciliation is approved.
- [ ] Approve independent control-owner key custody/rotation/compromise response,
  provider token revocation, clock policy, single-row contention budget and actual
  host failover/partition/load behavior. Late authorized I/O cannot be recalled.

## 3. Explicit database preparation (not startup migration)

- [ ] Inspect authorized target/topology and run the existing guarded `db:prepare`
  dry-run. Record only sanitized fingerprints, index operations and conflicts.
- [ ] Resolve invalid/duplicate/conflicting data through a separately reviewed plan;
  do not normalize, merge, delete or repair accounts silently.
- [ ] Owner approves exact target/environment/fingerprint and compatible index
  operations before apply. Test and production targets need separate approval.
- [ ] Verify legacy and all required image indexes are compatible before metadata
  activation; normal startup must never create them. Preserve existing records,
  assignments, pickup states and all 16 demo gifts.

## 4. Isolated real-provider and hosted verification

Only after the relevant resource/write approvals above, with synthetic accounts,
photos and bounded namespaces:

- [ ] Real R2 PUT/GET/HEAD/DELETE, user metadata, Content-MD5/checksum configuration,
  `If-None-Match: *`, concurrent writers and actual error/absence semantics.
- [ ] Missing key vs missing bucket/authorization failure, corrupted bytes, timeouts,
  late write appearance, lost responses and ambiguous DELETE. Negative reads/elapsed
  time must not manufacture write-settlement proof or release unknown holds.
- [ ] Vercel Node 22 native Sharp packaging, cold starts, request buffering, multipart
  overhead, body cap, response headers, memory/CPU/deadlines and concurrent load.
  A local 16 MP benchmark and a Ready deployment do not verify these.
- [ ] Same-origin frontend proxy, exact APP_ORIGIN, HTTPS Secure HttpOnly cookies,
  CSRF, deployment protection/automation bypass confinement, server identity and
  database fingerprint fences. No secret in an image URL, bundle, trace or log.
- [ ] Two-account C1/C2/D1/D2 lifecycle and all public/private/closed-history boundaries,
  cover updates, session/account switch, backend revocation and image failure recovery.
- [ ] Actual Windows 11 Docker Desktop and filesystem/receipt ACL behavior, if this
  remains a supported local workflow; no Linux evidence substituted for it.
- [ ] Physical Safari/iOS and current Edge/Chrome: camera/export formats, HEIC refusal,
  orientation/colour, mobile decode memory, native keyboard, tab reload/loss warning,
  focus, screen-reader journey and 320px/375px reflow.
- [ ] Preserve all original local/CI checks. Any remote E2E has its own exact reviewed
  commit, approved origin/fingerprint, bounded synthetic records and scoped cleanup.
  Do not reuse a general remote run to bypass new storage target approvals.

## 5. Operations, cost and recovery sign-off

- [ ] Name who reviews oldest unknown holds, failed/deleting operations, image GET
  failures, native busy/timeout rates, quota failures and cleanup retry exhaustion.
  Logs/metrics may contain allowlisted categories/counts/correlation IDs, never
  private images, account emails, original names, keys, hashes or credentials.
- [ ] Set an approved monitoring cadence and escalation/stop-admission threshold;
  no automatic cron, background deletion or paid observability is installed by E1.
- [ ] Approve record retention/account erasure and the 1,000 lifetime operation cap's
  support path. Deletion does not refund daily attempts/successes or retained rows.
  Do not reset counters/drop tombstones to unblock a customer.
- [ ] Define durable evidence for provider writes whose outcomes remain unknown;
  preserve charges and operation identity until resolved. No force-refund command.
- [ ] Rehearse bounded preview/approval/apply, interruption, stale manifests, repeated
  cleanup, lease fencing, orphan handling and exact-once quota settlement on an
  isolated real-provider target. Verify both surviving Ready and deleted photos.
- [ ] Rehearse coordinated database/object/ledger restore without public reappearance
  of deleted media, session resurrection, ownership drift or phantom quota release.
  Define and measure RPO/RTO; database export alone is not cross-store recovery.
- [x] F2 implements ticket-scoped upload clients; the preserved 256-key adapter
  guard no longer imposes a warm-pipeline ceiling. New clients cannot replay old
  durable permits. Real MongoDB/Sharp protocol stress crosses 260 keys with no
  quota increase; actual SeaweedFS/cleanup/race suites remain intact.
- [ ] Measure per-photo connection/TLS churn on approved R2, the ten-socket DB pool,
  aggregate storage/native/read limits and fleet multiplication. No live-provider
  throughput or cost guarantee is inferred from synthetic stress. Keep unknown
  holds and rows intact; no client close or rotation proves write absence.
- [ ] Approve the [retention/archival/erasure decision packet](photo-operation-retention-proposal.md)
  before changing the lifetime record constraint or schema. No TTL/pruning/archive
  job/counter reset is installed by F2.
- [ ] Model R2 storage/operations, Vercel CPU/memory/function/transfer work, Atlas
  authorization/query load and backup cost with current allowances/rounding. Review
  the actual account's billing eligibility and alerts; do not promise a free service
  solely from object-storage price or R2 egress terms.

## 6. Controlled release and rollback approval

- [ ] Review the exact release SHA, all CI/isolated-hosted evidence, unresolved
  P0/P1 findings, rollback binary and named operator. Owner explicitly approves
  rollout resources/settings and timing; merging E1 is not that approval.
- [ ] Maintain production/frontend isolation and deployment protection. Do not enable
  public registration or photo storage as part of this checklist's publication.
- [ ] On failure, stop admissions through the approved gate. Preserve ledger, keys,
  generation, binding and compatible read/delete/maintenance where safe. If a full
  photo outage is necessary, communicate it without claiming cleanup success.
- [ ] Roll back only to a B4-compatible binary after B4 records exist. Never roll back
  to B2/B3 photo code (or F3/uncontrolled photo workers after F4 adoption), drop
  metadata/indexes/control, change namespace/provider binding,
  recreate deleted rows as Ready or replay an unknown PUT.
- [ ] Verify text-only browsing/auth/inventory/pickup remains usable, private photos
  remain private, tombstones survive and no prior-account drafts/media reappear.
- [ ] Freshly inspect authoritative state and approve each subsequent recovery batch;
  no broad namespace/bucket sweep or automatic retry loop.

Record each checked gate with an evidence link, immutable target/commit and named
owner approval. Until these gates are separately satisfied, the decision remains:
**local photo system accepted within its tested profile; production photos disabled**.
