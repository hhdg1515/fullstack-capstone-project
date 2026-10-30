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

- [ ] Review a production R2 transport/runtime implementation: current code accepts
  only an opaque verified local SeaweedFS receipt; changing an endpoint or removing
  that verification is not a production adapter.
- [ ] Preserve exact target/prefix/key binding, explicit credentials, bounded
  requests, conditional immutable writes, no credential/endpoint fallback, one PUT
  permit, no SDK retry of uncertain mutations, integrity verification and private
  application-mediated delivery. Review HTTPS/account/region/checksum/error behavior
  on R2 rather than copying local path-style/us-east-1 settings.
- [ ] Review a production-compatible cleanup/recovery implementation and operator
  execution identity. Existing `images:reconcile` is local-receipt-only; never forge
  receipts, point it at Atlas/R2 or remove the target guards.
- [ ] Provide a reviewed way to stop new upload admission independently from safe
  status/read/delete/maintenance behavior, or a documented total-photo shutdown.
  Such hosted operational gates do not exist merely because this checklist names
  them. Test disabled startup and required-index compatibility.
- [ ] Triage dependency advisories by actual runtime/browser/build reachability;
  remediate in focused PRs with complete regression CI. No force upgrade or framework
  migration is implied. Reassess the pinned local image before any artifact upgrade.
- [ ] Clarify stale runtime gate text without changing its fail-closed behavior.

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
  to B2/B3 photo code, drop metadata/indexes, change namespace/provider binding,
  recreate deleted rows as Ready or replay an unknown PUT.
- [ ] Verify text-only browsing/auth/inventory/pickup remains usable, private photos
  remain private, tombstones survive and no prior-account drafts/media reappear.
- [ ] Freshly inspect authoritative state and approve each subsequent recovery batch;
  no broad namespace/bucket sweep or automatic retry loop.

Record each checked gate with an evidence link, immutable target/commit and named
owner approval. Until these gates are separately satisfied, the decision remains:
**local photo system accepted within its tested profile; production photos disabled**.
