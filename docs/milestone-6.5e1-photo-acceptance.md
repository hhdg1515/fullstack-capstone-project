# Milestone 6.5E1 — Integrated photo acceptance

Baseline: merged main `5f79faf9c2a7b0e35138f3b36371f2856ccf4a15` (#69),
including B1–B4, C1/#65, C2/#67, D1/#68 and classification/#66.
Verification branch: `codex/m65e1-photo-acceptance`. Evidence collected on
2026-10-30 UTC; dependency advisories and provider documentation are point-in-time.

## Decision and evidence boundary

**Local engineering acceptance: PASS within the tested profile below.
Production photo activation: NOT APPROVED / NOT READY.**
Passing this milestone does not create a production provider, implement a hosted
transport, prepare Atlas indexes, grant launch approval or remove existing gates.
The final PR records its immutable head, exact test results and successful CI run.
This report, screenshots and measurements describe the reviewed source/local test
profile; they are not evidence about a live deployment or production data.

This PR changes acceptance tests, the CI browser time budget and documentation
only. It does not change application behavior, feature gates, storage/authorization,
quotas, taxonomy, indexes, provider settings or any of the 16 original demo gifts.
Defects/gaps below have focused follow-up proposals, not silent implementations.

## Complete lifecycle audit

| Boundary | Source reviewed | Evidence / result |
| --- | --- | --- |
| Local target and private storage | `item-image-storage-config.js`, `item-image-storage.js`, isolated Mongo/SeaweedFS helpers | Literal loopback, private per-run namespace/credentials, pinned official image, live Docker ownership verification before storage I/O; wrong target/credentials/receipts and environment fallback refused. Actual conditional/concurrent PUT, GET, HEAD, DELETE and failure contracts retained. |
| Admission / browser preparation | `photoPreparation.js`, `itemImages.js`, `ItemPhotos.js`, inventory photo-session state | Optional selection never sends bytes; JPEG/PNG/WebP sources <=20 MiB/48 MP/10,000px edge become a new <=1280px, <=3 MiB derivative. HEIC, animation, extreme headers and failed preparation fail safely; original is never a fallback. Only in-memory drafts, explicit one-click Save/Publish authorization and independent text protection. |
| HTTP intake / sanitization | `app-factory.js`, `middleware/identity.js`, image routes, `item-image-intake.js`, `item-image-format.js`, `item-image-processing.js` | Session/owner/CSRF and quota admission precede bounded multipart reading; exact binary route exception; <=3.25 MiB complete request, <=3 MiB file, 10s intake. Strict raster validation, <=16 MP native decode, Sharp auto-orientation/sRGB and metadata removal, <=400px thumbnail / <=1280px display. No original is stored. |
| Atomic ledger / quotas | `item-images.js`, `item-image-policy.js`, inventory plan transaction | Native MongoDB snapshot/majority transactions; independent image revision; idempotent intent; server-derived owner/item/plan; shared quota/slot reservations; durable PUT permit before provider I/O; no Sharp/S3 inside retryable transactions. Failure/unknown outcome never replays an uncertain PUT. |
| C1 save / partial recovery | Inventory form/session, `ItemPhotos.js`, client transport | Item ID first; one labeled submit, sequential independently tracked files. Item publication survives a lost upload response. Check status establishes Ready, then explicit Upload remaining continues only unsent files; no duplicate item or automatic next blank form. |
| C2 management | Owner controls, delete/discard dialogs, metadata order/delete service | Ready-only Up/Down/Make cover/Delete; full authoritative order and imageRevision; per-item intents, no lost-response replay; correct cover fallback, keyboard focus and independent text/file drafts. Logical deletion leaves byte charges pending verification. |
| D1 public discovery / detail | `discovery.js`, `public-item-media.js`, `PublicItems.js`, public photo DTO guard/components | Original region/filter/count/cursor/sort logic retained; only returned <=50 rows enriched in one batch, max six Ready rows detects over-cap state. No N+1 metadata HTTP/database commands or S3 probes. Cards use thumbnails; gallery loads only selected display. Unsafe URLs/bindings fail closed without invented counts. |
| D2 pickup context / history | `pickup-item-media.js`, `pickups.js`, communication policy, pickup components | Authenticated exact reference tuple and original participants; owner permission or current public-item permission only. One GET-detail aggregation; lists add zero photo queries. Closed text never grants private photos, and no attachments/state-machine change. |
| Delivery / revocation | `item-image-delivery.js`, pipeline delivery and identity middleware | Ready/generation/storage binding and scalar ownership verified; authorization before and after verified bytes, current session rechecked; generic 404/503, WebP/nosniff/private-no-store/no-referrer/same-site. Missing or changed bytes never trigger repair or public fallback. |
| B4 physical cleanup | `item-image-recovery.js`, local maintenance/CLI, recovery integration tests | Tombstones, fenced leases, exact-key absence, bounded manifests, attempts/backoff and exact-once charge settlement. Genuine SIGKILL/lost-response/late-PUT/concurrent-worker tests remain. An unknown absent write remains held; negative HEAD/GET is not settlement proof. |

Paths above are relative to backend services or frontend `src` as appropriate;
[the immutable baseline](https://github.com/hhdg1515/fullstack-capstone-project/tree/5f79faf9c2a7b0e35138f3b36371f2856ccf4a15)
and linked milestone implementation notes provide complete source/contract detail.

### Permission matrix retained

| Current target / viewer | Owner with valid surviving references | Requester or anonymous reader |
| --- | --- | --- |
| Published, available, unexpired, active plan | Ready photos | Ready photos |
| Reserved/accepted item still public on detail | Ready photos | Ready photos on detail/pickup; excluded from discovery |
| Draft, unlisted, expired, cleared/completed or inactive plan | Existing private owner access | No photos |
| Declined/cancelled/no-show request, item still public | Existing owner access | Only independently public photos |
| Closed history, private item | Existing owner access | Permitted text history only, no inherited photo access |
| Deleted item/plan/photo-owner account or compromised ownership/binding | No applicable image access | No applicable image access |
| Invalid/expired session | Private request API 401; no private media authority | Only genuinely anonymous public access, never owner authority |

[D2's exact request-context matrix](milestone-6.5d2-pickup-photos.md#exact-authorization-matrix)
also requires both participants and valid creation/status/reference data for request
summaries. Deleting a request does not make an otherwise public item private.
Readable historical text is not an archived photo copy. Current cover/order can
change; downloaded pixels cannot be erased from an already open page or device.

## New two-account integrated acceptance

`e2e/photo-acceptance.spec.cjs` uses the actual strict frontend over isolated HTTPS,
a disposable MongoDB replica set, verified SeaweedFS and real Sharp bytes. It runs
once per desktop/mobile project, with only two synthetic registered accounts.

1. Select three files, including an actual >3 MiB PNG. Confirm no item/reservation/
   content request precedes submission; preview locally.
2. Publish with three photos. Lose the second committed content response at the
   HTTPS proxy, retain the published item/previews, verify no third PUT or second
   item creation, read canonical status, explicitly upload only the remaining file.
3. Verify the derivative differs from the large source hash, both actual served
   outputs are WebP without EXIF/XMP/IPTC/ICC, and source names/drafts are not stored
   in localStorage. The existing adversarial raster suite covers the full metadata
   corpus; this synthetic case is not a physical mobile camera test.
4. Use keyboard Make cover, Up and confirmed cover Delete. Preserve unsaved text,
   observe deterministic fallback, retained quota and tombstone.
5. Follow the exact surviving photo IDs through discovery, gallery keyboard
   navigation and request creation/detail, with no full display hidden on cards.
6. Inject expiration only in the owned local DB: requester bytes/detail denied,
   owner allowed. Restore that isolated fixture, submit a real pickup, send text,
   unlist through the real API, and verify cancelled read-only text with no photos.
7. Republish, create/accept a new request, formally propose/accept a new time, then
   advance only the test harness pickup/browser clocks to record a legitimate
   handoff. This is simulated time, not evidence of elapsed days or a scheduler.
   Completed requester photos are revoked, owner access remains valid.
8. Run receipt-guarded local preview/apply cleanup. Verify the deleted photo's
   tombstone and byte release, while daily attempts/successes and retained record
   count remain consumed. Two surviving Ready photos are not cleaned. Logout clears
   the request view. Teardown verifies and removes only owned local resources.

Stale revisions, quota exhaustion, malicious inputs, missing/corrupt objects,
account switches, uploads racing deletion, unknown writes and crashed cleanup
remain separate targeted regressions in the complete suite. The E1 scenario does
not replace them or weaken a bound to fit the longer journey.

## Verification and reproducibility

Use Node **22.23.4**, Linux/x64, Docker **28.4.0**, local Chromium
**154.0.8037.57**. No `.env`/Atlas
fallback or real photographs. Run from the repository root:

```sh
npm --prefix giftlink-backend ci
npm --prefix giftlink-frontend ci
npm --prefix e2e ci
npm --prefix giftlink-backend run lint
npm --prefix giftlink-backend test
CI=true TZ=America/Los_Angeles npm --prefix giftlink-frontend test -- --watchAll=false --runInBand
CI=true REACT_APP_BACKEND_URL='' npm --prefix giftlink-frontend run build
npm --prefix e2e run test:policy
npm --prefix e2e test
# Optional actual E1 screenshots; a current strict build must exist first:
PHOTO_ACCEPTANCE_EVIDENCE=1 npm --prefix e2e test -- photo-acceptance.spec.cjs
node giftlink-backend/util/benchmark-item-images.js
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` only when using an already installed
Chromium; otherwise use Playwright's supported browser installation. On Windows,
use PowerShell environment assignment syntax, not these POSIX assignments. The
container/image/receipt fixture requirements still apply; these commands are not
a certification that Windows Docker Desktop works.

| Gate | Observed local evidence / final-record location |
| --- | --- |
| Backend lint + complete native/API/storage/recovery/preparation suite | **564 passed**; all 49 B1 storage tests preserved |
| Frontend | **444 passed / 23 suites** |
| Strict production build | Passed; existing Browserslist age notice, no dependency updates |
| Deployment/E2E policy | **56 passed** |
| New E1 desktop/mobile scenario | **2 passed**, **17 axe checks**, zero violations |
| Complete isolated browser suite | **68 passed**, **214 axe checkpoints**, zero violations; final immutable CI run recorded in the PR |
| actionlint / whitespace / original gifts | Passed; **16 gift records unchanged**, SHA-256 in the results artifact |

[Structured local results](verification/m65e1/local-results.json) record actual
counts, exit codes and resource cleanup.

Normal GitHub CI runs backend, frontend/build and isolated Chromium jobs with no
remote E2E environment/secrets. E1 retains all previous cases and increases only the
browser job budget from 20 to 25 minutes: D2's recorded job took 17 minutes, and two
new full-lifecycle cases add bounded work. No per-request/fixture/quota limit was
raised. The PR must also have green CI at its exact head before review sign-off;
the immutable run URL and job results are recorded in the PR rather than inferred
from local success.

The source review is manual and scope-bound; it is not an independent penetration
or exhaustive security certification. The Codex Security skill's required reference
resources and scan executor were unavailable in this environment, so **no completed
formal plugin scan is claimed**. Dependency audit and real authorization/fault
regressions are separately evidenced.

## P0 / P1 / P2 findings and proposed follow-ups

Here P0 means **blocks production photo activation**, not automatically a confirmed
exploitable vulnerability. No new reproducible application permission bypass or
unsafe replay was established by this review/tests; that is not proof of absence.

| Priority / ID | Finding and evidence | Focused remediation / owner decision |
| --- | --- | --- |
| **P0-01** | Hosted photo transport/maintenance is intentionally absent. `config.js:12–14` refuses deployed pipeline enablement; `runtime.js` supplies metadata only; storage/pipeline configuration requires an opaque live local SeaweedFS receipt. | Separate R2 runtime/maintenance implementation and review. Never remove a guard or set flags as a workaround; keep production photos off. |
| **P0-02** | No real Vercel+R2+Atlas photo-path contract, hosted cold-start/native/buffering verification, or cross-store restore/cleanup recovery drill. Local S3 compatibility is not provider compatibility. | Owner-approved isolated hosted compatibility milestone before activation: private bucket/least-privilege identity, exact provider behavior, guarded indexes, cleanup/unknown-write policy, rollback and restore evidence. No such operation was performed here. |
| **P1-01** | Dependency debt remains. Runtime backend audit: **0**; full backend: **5** (4 high/1 moderate, dev-tool chains); frontend full tree: **387** (11 critical/92 high/170 moderate/114 low). CRA mixes build/test packages with browser dependencies; counts are not distinct CVEs or demonstrated browser exploits. | Separate dependency/reachability triage and reviewed remediation PRs, including direct browser libraries and isolated build tooling. Do not run force fixes or change framework in E1. |
| **P1-02** | Unresolved writes intentionally retain bytes/slots; no provider-backed production settlement or staffed alerting exists. B4 has 25-op/100-inspection/120s batches, five claims, strict manifests, no force refund. | Approve a production operator/incident policy and metrics before uploads: oldest hold, blocked reason, retry exhaustion, cleanup backlog, quota failures and GET failures; test recovery, never infer absence from timeout/age. |
| **P1-03** | Account operation records are capped at **1,000 for the account lifetime**, not reset by deletion/day rollover. Attempts/success limits are 50/20 daily; no approved retention/archive/erasure process exists. | Separate bounded retention/capacity/privacy design and support policy. A legitimate active account can reach the record cap; never reset counters or delete tombstones to bypass it. |
| **P1-04** | Windows Docker Desktop/ACLs, physical Safari/iOS/HEIC export and real low-memory mobile decoding are unverified. Current tests are Linux Chromium and emulation; browser sources may decode up to 48 MP. | Actual-device/platform checklist and evidence; unsupported HEIC must keep concise export guidance. No claim that viewport emulation proves native keyboard, decoder or memory behavior. |
| **P1-05** | Durable Atlas network access, backups/restore, production settings/protection and operational ownership remain launch gates from 6.0. No current provider-state inspection is authorized here. | Revalidate non-sensitive owner-approved settings and rehearse recovery in isolated targets. Historical M0/network observations are not current evidence; no firewall/tier/credential change here. |
| **P1-06** | Hobby usage/fair-use suitability and photo workload are not established. No-store proxy delivery consumes functions, bandwidth and DB work even if R2 egress is free. | Owner reviews permitted use, actual account limits/usage, alerts and a measured low-volume launch envelope. Paid infrastructure requires approval; no billing/resource change here. |
| **P2-01** | Runtime rejection text still says “until B4 acceptance” although B4 is merged; the implementation is still local-only. Aggregate roadmap prose also lagged the merged milestones. | E1 corrects aggregate documentation; propose a tiny separately reviewed runtime-message clarification, with gates unchanged. |
| **P2-02** | Photo-query result bounds are verified, not representative production query plans/load. Unknown holds/retained rows and repeated private reads can be expensive. | Separate indexed explain/load and operator-capacity exercise after a safe target is approved; do not add caching that defeats revocation or remove ledger checks for speed. |
| **P2-03** | The 320px owner edit screenshot remains a long full-item form, with repeated item context above it. Controls fit and remain reachable, but repeated edits can require substantial vertical travel. | A focused usability follow-up may shorten the existing form/context after owner testing; do not introduce a detached photo panel, lose independent drafts or add another save confirmation. |

No application fix is hidden in this verification PR. Existing UX limitations are
intentional: no original/zoom overlay, no photo attachments, manual refresh, no
persistent local private drafts, no fake unread/realtime status. Thumbnails, errors,
cover controls and independent drafts remain coherent in the inspected desktop/320px
screenshots; 375px reflow/axe checks also passed. This does not establish manual
screen-reader or physical-device acceptance. Windows/physical devices need human
acceptance, not a CSS claim.

## Operational assessment

[Resource measurements](verification/m65e1/resource-results.json) are fresh-child
Linux Node/Sharp probes, **not Vercel benchmarks**. The 16 MP RGBA PNG, noisy JPEG
and wide JPEG measured 268/115/162 MiB max RSS and 454/354/120 ms first processing
(599/514/264 ms child wall time). Sharp 0.35.5 / libvips 8.18.7. This excludes the
full Express/Mongo/SDK process, browser decode, concurrent requests, Vercel buffering
and any fleet. One local native operation and eight reads per process are not a
fleet-wide limit or a memory guarantee.

Vercel's accessible current Functions reference reports a **4.5 MB** request/response
payload ceiling and Hobby Fluid compute **2 GB / 1 vCPU**, **300s default/max**.
Our 3,407,872-byte complete multipart limit is below 4,500,000 bytes, but source
compatibility does not establish actual hosted streaming, native packaging or
concurrency behavior. Hobby documentation lists 4 active CPU-hours, 360 provisioned
GB-hours and 1M function invocations per period, and non-commercial personal-use
restrictions. Account settings/usage and suitability were not queried.

Maximum stored variants total **1.25 MiB/photo**, **6.25 MiB/five-photo item**;
metadata/tombstones, pending holds, replicas and backups are additional. Default
12-card discovery can transfer up to 3 MiB of thumbnails if all load; a 50-card
page up to 12.5 MiB. Gallery initially needs at most five thumbnails and one chosen
display (2.25 MiB at ceilings). Pickup context uses one thumbnail, not a display.
Lazy loading reduces work for unseen cards; it is not a total-transfer promise.

Delivery performs **two authorization transactions plus one verified object GET**
per ordinary image response, not a CDN cache hit. Summary reads do no storage I/O.
Upload success uses two conditional PUTs plus two verification GETs; fully observed
cleanup can require up to four inspections and two deletes. Provider errors or
unknown outcomes can add review/inspection work without a successful photo.

The official R2 source at pinned commit `ad31342ce27ff6d2627903e9e176958ba262cbb8`
documents PUT conditional headers including If-None-Match, Content-MD5, private
system metadata and basic object operations. It lists Standard storage
**$0.015/GB-month**, Class A **$4.50/million**, Class B **$0.36/million**, Standard
allowances **10 GB-month / 1M A / 10M B**, and no direct R2 egress fee. Round-up rules,
other connected services and non-Standard storage alter billing. Approximate
planning formula, not an invoice:

`storage GB-month × rate + billed Class A × rate + billed Class B × rate + Vercel/DB/backup costs`.

A thousand capped photos occupy about 1.31 decimal GB before overhead; low storage
price alone does not establish an affordable or reliable end-to-end service. No R2
account, bucket, billing eligibility or live behavior was inspected. SeaweedFS uses
local path-style/us-east-1 and fixture verification; future R2 uses provider HTTPS,
region/account/bucket policy, credentials and provider-specific error/consistency
semantics. A configurable endpoint swap is expressly not an approved adapter.

[Dependency summary](verification/m65e1/dependency-audit-summary.json) includes
representative package/advisory links (for example backend JSHint/Mocha chains and
frontend form-data/launch-editor/jsdom). These are registry reports, not validated
application attack paths; build/development tools still need triage. The summary and
[official source provenance](verification/m65e1/official-source-provenance.json)
record commands/counts and document hashes. Vercel docs were accessible; direct R2
docs returned HTTP errors, so the official publisher repository was pinned/read.
These are documentation checks, not live-provider E2E or a new image vulnerability
scan. The [B1 pinned-artifact review](milestone-6.5b1-seaweedfs-review.md) remains
limited to its synthetic local profile, including its recorded high/unknown image
advisories; E1 does not claim a fresh Trivy/Cosign scan or zero vulnerabilities.

## Rollout, rollback and operator checklist

Use the [separate approval checklist](photo-production-readiness-checklist.md).
There is no executable production activation procedure in E1. B4's existing
[local operator runbook](milestone-6.5b4-photo-recovery.md#local-operator-procedure)
is for verified disposable local receipts, not Atlas/R2 administration.

For a photo incident in a future approved deployment: stop new admissions through
a reviewed compatible gate, preserve read/delete/status and compatible maintenance
where safe, verify DB/storage identity, retain journals/holds and use a fresh bounded
preview. Never replay an unknown PUT, force refund, reset records, change namespace,
run broad object deletion, restore data with --drop, or remove authorization to
make pictures load. A safer total outage can require taking all photo operations
offline; it must not be represented as successful cleanup or permit text-service
startup against incompatible photo indexes.

Current E1 rollback is simply reverting its test/docs/CI-budget commit; no data
migration exists. Any future operational rollback must stay **B4-compatible** after
B4 recovery fields/tombstones exist. Preserve target binding, identities and cross-
store evidence. Do not restore deleted media to Ready, roll back to B2/B3 binaries,
drop indexes/ledgers, or assume DB-only backup restores object/account consistency.
A UI rollback alone does not revoke already-authorized B3/D1 media access.

## Actual visual evidence

All 16 captures were visually inspected: photo-to-item association and cover order
are consistent; no clipped controls, horizontal overflow or concealed pickup actions
were observed. Partial success exposes a per-file status check; closed views retain
text and explicitly unavailable photo context. The long mobile edit form is recorded
as P2-03 rather than redesigned in this acceptance PR.

All captures are from the new integrated local journey, not earlier milestone
screens or generated concepts. Synthetic noise/colored fixtures demonstrate byte
preparation/order, never real marketplace photography. Capture waits for actual
pixels and uses tall viewports only to avoid Chromium stitching artifacts; normal
viewport interactions, keyboard and axe checks occur separately. Expiration and
future handoff time are explicitly injected local test controls.

| State | Desktop | 320px |
| --- | --- | --- |
| Selection before sending | [Selected](verification/m65e1/desktop-selected.png) | [Selected](verification/m65e1/mobile-selected.png) |
| Published, second response lost | [Partial](verification/m65e1/desktop-partial.png) | [Partial](verification/m65e1/mobile-partial.png) |
| Cover/order/delete with independent draft | [Managed](verification/m65e1/desktop-managed.png) | [Managed](verification/m65e1/mobile-managed.png) |
| Authoritative discovery cover | [Discovery](verification/m65e1/desktop-discovery.png) | [Discovery](verification/m65e1/mobile-discovery.png) |
| Ordered gallery | [Gallery](verification/m65e1/desktop-gallery.png) | [Gallery](verification/m65e1/mobile-gallery.png) |
| Closed text, private photo denied | [Closed](verification/m65e1/desktop-closed.png) | [Closed](verification/m65e1/mobile-closed.png) |
| Accepted/rescheduled pickup | [Pickup](verification/m65e1/desktop-pickup.png) | [Pickup](verification/m65e1/mobile-pickup.png) |
| Completed requester view | [Completed](verification/m65e1/desktop-completed.png) | [Completed](verification/m65e1/mobile-completed.png) |

[Prior D1](milestone-6.5d1-public-photos.md#actual-local-screenshots) and
[D2 evidence](milestone-6.5d2-pickup-photos.md#actual-local-screenshots) retain
actual no-photo/missing-image examples; the complete suite reruns their behaviors.
No new production/staging, Windows Docker, physical Safari/iOS, manual screen-reader,
real R2, remote Atlas, backup/restore or public-launch acceptance is claimed.
