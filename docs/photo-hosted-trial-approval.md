# First isolated hosted photo trial — separate owner approval checklist

This plan is **not authorization**. F3 runs only offline/local/CI fixtures. No live
credential, account, bucket, database, deployment or index is created or inspected.
Ordinary startup refuses R2/pipeline enablement, so this plan intentionally stops
before hosted execution until a focused integration/operations review is approved.
Passing an offline check, merging code or a Vercel automatic preview is not approval.

## A. Freeze the executable local evidence

On the exact reviewed SHA, using committed lockfiles and Node 22:

```sh
npm --prefix giftlink-backend ci
npm --prefix giftlink-frontend ci
npm --prefix e2e ci
npm --prefix giftlink-backend run images:preflight -- --offline
npm --prefix giftlink-backend run lint
npm --prefix giftlink-backend test
npm --prefix giftlink-frontend run test:dependencies
CI=true TZ=America/Los_Angeles npm --prefix giftlink-frontend test -- --watchAll=false --runInBand
CI=true REACT_APP_BACKEND_URL='' npm --prefix giftlink-frontend run build
npm --prefix e2e run test:policy
env -u E2E_APP_ORIGIN npm --prefix e2e test
```

POSIX variable syntax above is not PowerShell syntax. Browser runs must have
`E2E_APP_ORIGIN` unset: the existing harness then owns only disposable loopback
HTTPS/MongoDB/SeaweedFS fixtures. No `remote:*` or deployment workflow is part of
F3. If local Chromium needs an explicit binary, set only its documented executable
path; do not disable TLS, fixture validation or browser security.

Record exact head, three CI job links/results, actual fixture artifact digest,
test/axe totals, 16-gift hash, teardown evidence and remaining advisories. No new
frontend UI is added by F3; the full existing desktop/mobile journeys remain.

## B. Owner decision packet — before *any* real-provider call

- [ ] Name operator, reviewed SHA, bounded trial duration/workload and stop authority.
- [ ] Approve read-only inspection of exact Vercel team/projects/environments and
  isolated HTTPS origins, Atlas project/cluster/database and R2 account/bucket/
  prefix. No existing database is assumed disposable. Production aliases/routing,
  registration and Deployment Protection remain unchanged.
- [ ] Resource creation, Atlas network/user changes, index apply, hosted deployment,
  synthetic writes, recovery DELETE and hosted E2E each get explicit scoped
  approval. Existing workflows do not confer permission for a new photo target.
- [ ] Provide credentials only through approved secure secret storage. No live
  private key, R2 token or database URI is requested in chat/PRs.
- [ ] Approve signing custody, receipt distribution/renewal, key trust/revocation
  policy, clock management, instance inventory and a stop/continue mechanism.
  F4 adds a locally tested participating-worker protocol, not hosted or permanent
  revocation evidence. Review its independent owner key, exact role grants,
  quiesced adoption, replica-set topology and local-only administration boundary.
  Permanent revocation across restored DBs still lacks an independent trust anchor.
- [ ] Review current provider documentation/account limits and Hobby eligibility
  without authorizing a purchase. Values in E1 are a dated baseline, not current
  account evidence. No paid fallback or provider switch is implied.

## C. Read-only target and configuration preflight — future approval only

Use a securely populated candidate environment, never a shell-history URI. Run
`images:preflight -- --offline` first; reject every failed check. Its fingerprints
must equal independently approved identities. It cannot validate MongoDB topology,
R2 IAM or a real bucket. Review credentials privately for exact account/bucket,
provider method/prefix granularity and separate runtime/recovery scope; do not
assume native R2 IAM can express the application's finer method/prefix roles.

Only after explicit remote-inspection approval:

```sh
npm --prefix giftlink-backend run db:prepare -- --dry-run --allow-remote
```

Verify exact database, configured endpoints and observed topology, full DB
fingerprint, all legacy/photo indexes and conflict counts. F4 controlled contexts
require a replica set; sharded topology is refused. A future separately approved
control preparation must inspect/sign/apply its exact collection/native index
and initially paused policy, never initialize it through ordinary startup.
This path performs reads, not account normalization, seeding or index creation.
Require an independently approved target inventory; an endpoint/topology hash is
not evidence of Atlas project ownership. Any conflict stops the trial. If new
indexes are required, obtain separate approval for the existing exact guarded
apply and its full dry-run fingerprint. Never create indexes on startup.

## D. Hosted wiring and transport acceptance — still blocked

- [ ] Review a dedicated implementation that injects the existing sealed runtime
  context into the pinned application connection and enforces approved admission.
  Do not remove startup refusal by editing an endpoint/boolean as a shortcut.
- [ ] Review a remote control administration boundary; F4 currently permits only
  local receipt-owned simulation. Inventory/quiesce all uncontrolled workers,
  distribute independent owner trust/control ID/minimum revision, and retain
  an F4-compatible rollback binary. Never bypass the gate on failure.
- [ ] Record the actual Vercel Node **22.x patch**, OS/architecture, Express framework
  packaging and traced Sharp **0.35.5** native/libvips dependencies. Local Node
  22.23.4/Sharp loading does not prove the final serverless artifact/cold start.
- [ ] Validate current host body limits before sending data: backend file cap
  **3 MiB**, complete multipart cap **3.25 MiB (3,407,872 bytes)**, one file only,
  bounded headers, server pixels <=16 MP, output thumbnail <=256 KiB and display
  <=1 MiB. Browser preparation <=20 MiB/48 MP is not a server/body-limit increase.
  Do not transmit an original as fallback when derivative preparation fails.
- [ ] Measure cold/warm RSS, input copies, Sharp buffers/timeouts, one native
  processor per process, eight read/storage operations per pipeline, per-photo
  client/TLS churn and ten-socket context DB pools. Multi-instance multiplication
  needs an explicit workload cap; no local benchmark proves host OOM safety.
- [ ] Run bounded synthetic real R2 PUT/GET/HEAD/DELETE, metadata/checksum,
  `If-None-Match: *`, concurrent-writer, missing/bucket/auth/error/corrupt-byte,
  late-write and ambiguous-response contracts. No public ACL, signed provider URL,
  bulk listing/sweep or uncertain PUT retry. Record evidence that differs from
  the local re-signing bridge (Cloudflare TLS/IAM/region/signature/absence behavior).
- [ ] Verify same-origin proxy, approved exact `APP_ORIGIN`, HTTPS, Secure HttpOnly
  sessions, CSRF, participant/owner/privacy boundaries and automation-bypass cookie
  host scoping. Anonymous/public/closed pickup-history cases must not reveal
  private images, keys, EXIF/GPS, filenames, credentials or another account's draft.
- [ ] Verify ready/health JSON, request/body rejection, session expiry and production
  isolation using the existing reviewed HTTPS preflight/E2E infrastructure, after
  explicit photo-aware target/write/data-limit approval. Do not reuse a prior
  staging fingerprint as permission for new storage. No hosted command runs in F3.

## E. Operator recovery preflight — future approval only

With independently approved **recovery-role** credentials and signed receipt:

```sh
npm --prefix giftlink-backend run images:r2:reconcile -- --dry-run --allow-remote \
  --approval-receipt '<approved private recovery receipt>' \
  --database '<approved isolated database>' --environment staging --provider r2-private \
  --bucket '<approved isolated bucket>' --namespace '<approved isolated namespace>' \
  --limit 25 --manifest '<new private manifest path>'
```

This is a real DB/S3 read path and is **not run by F3**. Confirm both fingerprints,
receipt validity, manifest digest/row versions/observations and bounds. Apply needs
all existing `--confirm-database`, `--confirm-environment`, `--confirm-database-target`,
`--confirm-storage-target`, `--confirm-provider`, `--confirm-bucket`,
`--confirm-namespace`, `--confirm-manifest` arguments **and separate owner approval**.
No automatic apply/cron, force refund or broad namespace cleanup is permitted.

- [ ] Rehearse interrupted claims/DELETE/commit, stale versions, concurrent workers,
  receipt expiration/renewal/restart and unknown writes. Negative reads never
  settle unknown PUTs. Fresh receipt/context requires a fresh preview.
- [ ] Approve escalation for permanently unresolved holds, exhausted cleanup,
  one-time settlement, 1,000 lifetime rows and record/account-erasure policy.
  No pruning, counter reset or quota increase is authorized.
- [ ] Prove cross-store backup/restore: recover DB, independently backed-up object
  bytes/generations and deletion/replay authority into isolated targets; do not
  assume bucket versioning or provider backups exist. Keep access/admission blocked, validate
  ownership/generations/holds/tombstones, then approve compatible reads. A DB-only
  restore must not resurrect deleted media or capacity. Name RPO/RTO, encryption,
  custody, retention, restore reconciliation and responsible operator.

## F. Cost, device, rollback and final go/no-go

- [ ] Bound trial accounts/items/photos/bytes and request count before execution.
  Model R2 object/operation/storage charges, no-store proxy GET/DB/egress overhead,
  Vercel compute/transfer/limits and Atlas load/backups. R2 egress pricing does not
  make the whole service free; stop before unapproved paid usage.
- [ ] Physical Windows 11 Docker Desktop/receipt ACL/shutdown, Edge/Chrome and
  Safari/iOS camera/export/HEIC/memory/keyboard/screen-reader acceptance are recorded
  separately from Linux Chromium viewport/axe results.
- [ ] Approve rollback binary and operations: preserve B4/F1/F2 ledger compatibility,
  exact target/namespace, tombstones, charges and safe recovery; keep photo gates
  disabled on rollback. No B2/B3 processing downgrade, counter reset, unknown PUT
  replay or record/object sweep. After F4 adoption, no F3/uncontrolled active-photo
  rollback. Preserve the signed control/revisions and validate text/auth/inventory/pickup independently.
- [ ] Close or explicitly accept every P0/P1 item with named owner, evidence and
  exact resources/commit. A trial approval is not production-photo activation,
  public launch, broad firewall change, unlimited maintenance or a merge approval.

Until these separate gates are satisfied: **no real-provider access, deployment,
remote index apply, hosted E2E or production photos**.
