# Milestone 6.5 — Implementation and acceptance roadmap

**Current implementation status:** B1–B4, C1 workflow corrections (#65), C2
(#67), D1 (#68), D2 (#69), and classification (#66) are merged. E1 adds
[integrated local acceptance, security/operational findings and evidence](milestone-6.5e1-photo-acceptance.md).
The complete photo path is verified for disposable local SeaweedFS. F1 adds
[a separate signed-target R2 transport/runtime factory and recovery path](milestone-6.5f1-r2-architecture.md),
tested only through isolated fixtures. **Hosted wiring, real-provider contracts
and production activation remain disabled/unverified**. F2 adds [dependency triage and ticket-scoped client capacity hardening](milestone-6.5f2-security-capacity.md),
without changing quotas or operation retention. Future production use must satisfy the separately approved
[production-readiness checklist](photo-production-readiness-checklist.md).
The historical architecture and proposed PR table below are design context,
not permission to activate a provider or migrate a database.

**6.5A delivers architecture only.** Base is main
`f9ac7cd4a13f889a5ab3e75b9e625e160f6d8300` (#58 merged).
[Architecture/API/schema/references](milestone-6.5-photo-architecture.md) and
[privacy/quota/cleanup rules](milestone-6.5-security-and-lifecycle.md) are the
implementation contract proposed for review, not shipped functionality. The
approved R2/SeaweedFS/five-photo/optional-publication/WebP/ordering decisions are not
reopened. No item photos are uploaded, stored or displayed in 6.5A.

## Verification boundary and prerequisites

Repository audit located the existing native-driver plan transaction, item and
public DTO boundaries, JSON-only CSRF middleware, hosted handler, quotas and local
test/cleanup guards. Official publisher sources at pinned commits validate the
4.5 MB Vercel server-upload constraint, Sharp orientation/metadata/timeout APIs,
R2 S3 limitations/consistency/presigning/pricing and the original MinIO maintenance blocker.
The architecture reference appendix distinguishes accessible official source from
unavailable live documentation sites. Exact host memory/duration/concurrency/
response limits and native processing performance are **not verified**.

In the original 6.5A design PR, no Sharp/S3 dependency was installed; no local
storage container was created; no R2
request, upload benchmark, decoded-image/EXIF test or cloud compatibility test is
claimed. Those are mandatory implementation acceptance gates below. Existing
application regression CI does not prove a future image implementation secure.

**Owner-approved B1 amendment:** replace MinIO with SeaweedFS only for
isolated local development/CI; private Cloudflare R2 remains the production
choice. MinIO's unresolved signature bypass is not accepted or patched silently.
B1 now has its own [official artifact/security/provenance review](milestone-6.5b1-seaweedfs-review.md)
and [implementation/evidence status](milestone-6.5b1-storage.md). The original
6.5A checks above describe that design-only PR; they do not certify later B1 code.
Future fixture/image upgrades must repeat the review and native S3 contracts.
No AIStor, vendor switch or real R2 access is implied.

## Small implementation PRs and merge order

These are **proposed PR labels**, not existing GitHub PR numbers. Each starts from
reviewed main after its predecessor merges, or explicitly stacks on that direct
predecessor if approved. Retarget/recheck CI after prerequisites merge. No automatic
merge, deploy or remote preparation follows from this plan.

**6.5A docs → B1 → B2 → B3 → B4 → C1 → C2 → D1 → D2 → E1**.
Backend photo routes remain disabled until B4's permission/quota/cleanup tests
pass; do not deploy an incomplete upload path. Photos stay optional throughout.

| PR | Focus / proposed new files | Existing files to modify | Review acceptance |
| --- | --- | --- | --- |
| B1 | Private S3 adapter + endpoint isolation; **new** `services/item-image-storage.js`, `test/helpers/isolated-seaweedfs.js`, storage contract tests | `config.js`, later `runtime.js`/`app-factory.js` dependency injection; package/lock only for reviewed modular SDK | SeaweedFS-only tests; private bucket; explicit credential resolution, no remote fallback, bounded I/O and one PUT/key; failure injection; no live upload route |
| B2 | Metadata/policy/account usage + reservations, versions, safe serializers; **new** `services/item-images.js`, `services/item-image-policy.js`, `routes/itemImageRoutes.js`, native-driver tests | `routes/itemRoutes.js` nested photo router under validated owner item scope, `services/inventory.js` plan boundary/additive imageRevision preservation, `services/identity.js` serializer regression, `services/database-indexes.js`, preparation tests | Atomic five-slot/account quotas across plans/instances on `users.itemImageQuota`; idempotent intent/status; strict references; registry dry-run/repeat/conflict tests; still no enabled binary route |
| B3 | Strict intake/decode/variants and authenticated binary reads; **new** `services/item-image-processing.js` and media validation tests | `middleware/identity.js` narrow content-type exception, `app-factory.js`, image routes, config, reviewed Sharp dependency/lock | Session/Origin/CSRF before parsing; strict raster corpus; orientation/GPS removal; bounded output/CPU; proxy permission matrix; no public keys/originals; feature still disabled until B4 |
| B4 | Durable delete/compensation/reconcile; **new** `util/reconcile-item-images.js`, crash/cleanup tests | Image service/storage tests, lint script's explicit util/test list, local setup docs | Guarded dry-run/apply and receipt/manifest controls; partial/unknown PUT and killed-worker races; no early accounting refund; verified object absence; operator recovery procedure |
| C1 | Owner selection/upload/progress; **new** `components/Inventory/ItemPhotos.js`, `api/itemImages.js` | `Inventory.js`, `ItemForm.js`, browser preparation, bounded owner inventory thumbnail summaries, design-token scoped CSS/component tests | Five-file bounded local preparation in Add/Edit; real ID before one labeled save/publish followed by sequential upload; owner-card thumbnails, independent drafts/recovery; no automatic upload/item creation |
| C2 | Owner reorder/cover/delete and independent draft recovery | ItemPhotos/transport tests, `forms/UnsavedChanges.js` **reuse**, no blanket rewrite | Up/down/Make cover/Delete native controls, stale revisions, explicit discard and lost-response status recovery; no item-form draft reset/localStorage |
| D1 | Public cover/gallery; **new** small `ItemImage`/`ItemGallery` components | `services/discovery.js` bounded enrichment after page/count, `PublicItemCard.js`, `PublicItems.js` + `validFeed`, scoped styles/tests | Exact counts/cursors/owner behavior unchanged; safe relative app URLs/dimensions; 400px covers only, gallery display on demand; distinguish none from unavailable |
| D2 | Request-detail thumbnail with independent photo access | `services/pickups.js` **serialize** only if a thumbnail DTO is needed; `Pickups.js` detail, image-policy tests | Closed conversation stays readable without inheriting private photos; no message attachments, archived copies, global inbox or state-machine changes |
| E1 | Integrated photo/security/product acceptance and rollout review | Local-only browser specs, synthetic fixtures, docs, CI only where needed for SeaweedFS prerequisites | Full two-account/native media + fault/cleanup suite; actual desktop/mobile/axe evidence; SeaweedFS resource cleanup; current hosting/package verification gate and separate remote-approval checklist |

B2/B3/B4 may be retuned into smaller backend PRs if actual diff size requires it;
do not ship quotas/cleanup “later” than the first usable upload path. There is no
new queue/worker/cron/service in these initial PRs. A future measured need for a
larger direct-quarantine pipeline is a separate design/approval, not silent B3
scope growth. Do not fix unrelated 6.4E registration/validation debt or dependency
advisories in the photo PRs.

## 6.5C interaction contract

Optional local selection/preview belongs inside Add/Edit item. The labeled
**Publish with N photos** / **Save draft with N photos** action authorizes both
parts of the workflow. Save the item first, validate its returned ID, then consume
a tab-only scoped intent exactly once to run sequential photo operations. There
is no second initial Upload action or per-photo visibility prompt. No invisible
autosave, automatic next blank form, cross-store transaction or required-photo
publication rule. Add item explicitly starts another form.

Save/publication success survives partial photo failure. Ready owner thumbnails
stay on the corresponding card; uncertain work and other files remain in context.
Canonical status checks and an explicit Upload remaining action recover only
eligible work. Refresh/remount never replays a consumed intent or uncertain PUT.
An ambiguous create requires owner inventory review before another submit.

The stable inventory session owns derivatives/object URLs independently of text.
Prepare supported sources locally (20 MiB/48 MP/10,000px edge) to at most 1280px
and the unchanged 3 MiB wire limit; never upload the original as fallback. Native
browser limits/HEIC export guidance are documented in [C1](milestone-6.5c1-owner-photo-upload.md).
Sharp and shared account limits remain authoritative.

Meaningful unsent files use an accessible in-app Stay and keep photos / Leave and
discard photos dialog; preserve native beforeunload for actual tab close/reload.
Remove the photo guard after confirmed Ready or explicit discard while retaining
unrelated text protection. No file/private draft persistence in localStorage.
Leaving can abort browser continuation but cannot undo backend work already
accepted; durable status/cleanup rules still govern that work.

The new API helper reuses urlConfig/session/error conventions but sends native
FormData, **without manually setting multipart Content-Type/boundary**, includes
credentials and the existing CSRF header, and uses a bounded upload timeout.
Send a generic multipart filename, not File.name. XHR progress may show bytes
transferred; 100% is followed by Processing, never a delivery/ready claim before
the server commits. An uncertain outcome requires explicit GET-status/review,
not automatic re-POST. Known rejected files require an explicit new reservation.
Input file/preview stays in memory on recoverable failure; browser termination
can lose it, while the durable server operation is discoverable after refresh.

**C2:** [Owner management implementation and verification](milestone-6.5c2-owner-photo-management.md). Up/down buttons or Make cover update the complete ready-ID order with its current
imageRevision. No drag-only interaction. Delete confirms removal, hides only
after acknowledged logical deletion, and says Cleanup pending until physical
settlement. Removing photos does not cancel requests, clear inventory, change an
appointment or discard an unrelated ItemForm/chat/time draft. A photo failure does
not prevent saving/publishing an otherwise valid text item without photos.

Use existing PageHeader/Surface/Feedback/tokens, 44px controls, labels, visible
focus, concise status/error announcements and predictable focus after reorder/
delete. No sticky overlay or decorative redesign. Keep the privacy and format guidance accessible in Photo tips, with contextual
errors when limits matter. Native `accept` is guidance, not validation;
HEIC/oversize files receive export/resize guidance, not an assumed automatic iOS
conversion. Local preview labels use Photo 1, not private filenames.

## 6.5D rendering contract

The approved C1 correction already renders up to five ready owner-card thumbnails.
D1 below concerns public discovery/detail; it does not defer those owner thumbnails.

Cards download only the first **400px thumbnail**, with real width/height and
nonessential lazy loading. No display/original download hidden in list markup.
A gallery loads the current 1280px image on demand with native Previous/Next,
position text and useful item/position alt text; card images may be decorative
when adjacent linked text already identifies the item. Do not generate labels
that claim visually detected contents. Empty media leaves the text-first layout.

Validate optional media fields in PublicItems' existing feed guard: exact app
image-path shape/IDs, variant and positive bounded dimensions; reject arbitrary
external/data/javascript URLs. Resolve app paths through existing backend URL
configuration and credentialed CORS for separate-port development; same-origin
HTTPS uses its current `/api` proxy. Never add R2 keys/secrets/URLs to the bundle.

Map `imageAvailability:none` only from a successful empty eligible media lookup.
On unavailable metadata/variant, show Photo unavailable, retain item information
and offer bounded explicit metadata refresh. No infinite onError loop, automatic
upload retry, fake zero listing count, stock photograph or public owner ID.
The initial proxy has no browser signed URL to expire; if a later approved signed
contract exists, refresh that capability once through reauthorization and stop
on withdrawal/session denial. Do not broaden read permission to repair a picture.

Current user/item/request keys must scope all metadata, File previews, image URLs
and responses; discard late former-account results. Session failure removes
private photo UI. Closed request text history still works when a photo becomes
unavailable; show no inaccessible thumbnail, keep canonical request navigation
and existing pickup/chat/rescheduling actions untouched.

## Mandatory local test plan

Use actual MongoDB transactions and the reviewed disposable SeaweedFS target, plus
small synthetic raster/metadata fixtures that cannot be mistaken for real offered
items. No private photographs, generated household-item mockups, real accounts,
R2 connection, provider credential, public bucket or hosted run. Two independent
browser sessions cover owner/requester; backend tests add an authenticated
outsider and anonymous access. Some cross-instance tests need two Express apps
sharing the same owned local DB/store, not two independent counters.

| Test group | Required cases / evidence |
| --- | --- |
| Target isolation | SeaweedFS driver + literal loopback only; reject R2/external/DNS/tunnel/default AWS credentials even with a local DB; wrong container/image/run/bucket/namespace/process receipt; mutated DB/storage binding; no network fallback or broad resource cleanup |
| Permission matrix | Anonymous/public/reserved detail; owner draft/hidden/expired/cleared; requester accepted/cancelled/declined/completed; invalid/expired sessions; nonexistent/deleted user/item/plan/request; image ownership/generation mismatch; generic denials and no private DTO data |
| Session/CSRF/parser | Anonymous, wrong/missing Origin/header; JSON still mandatory on every other write; multipart allowed only exact content route/method; malformed boundaries/extra file/field/huge headers; oversize Content-Length/chunked/truncated body; no parser before auth/quota/admission |
| Decode/content | Real JPEG/PNG/WebP vs fake MIME/extension; SVG/PDF/HTML/HEIF; JPEG/polyglot/trailing data; malformed PNG CRC/RIFF/chunks; APNG/animated WebP; zero/overflow dimensions, unsupported depth, pixel/decompression bombs and native timeout |
| Privacy/variants | All EXIF orientations incl. mirrors; synthetic GPS/EXIF/XMP/IPTC/ICC/comment absence in **both actual outputs**; preserved visible pixels/orientation, WebP MIME, width/height/byte ceilings, no original/filename in object/DTO/log/captured UI |
| Quotas/races | Five ready+reserved slots, cross-plan/account storage and concurrency, last-slot races across instances; 50 daily attempts/20 successes including held credits; deletion/reupload bypass; UTC rollover/expired reservations, transaction retries and exact-once charge settlement |
| Metadata capacity | Retained-operation cap counts failed/deleted rows, is not refunded by ordinary photo deletion, has actionable non-timed feedback, and cannot be bypassed by another item/session or a transaction retry |
| Idempotency | Same operation/intent, changed intent/bytes, two content POST/PUT attempts, duplicate clicks, client refresh, lost JSON reservation response, already-ready replay; no second completed row, processing execution or PUT for a key |
| Failure saga | No-write validation reject; first variant stored/second rejected or unknown; killed process after journal/before/after PUT; both PUTs + DB commit failure; response lost; a delayed PUT appearing after negative HEAD; no early refund or deletion claim |
| Delete/reconcile | Delete vs upload/finalize/reorder/clear/handoff; missing or externally modified objects; 403/NoSuchBucket not mistaken for absence; idempotent repeated delete; DB failure after object removal; stale cleanup leases; exact manifest/namespace/batch bounds, orphan and restore discrepancies |
| UX/a11y | Owner file selection/preview/format errors/progress, ready vs pending, order/cover, confirmation cancellation, quota feedback, retained independent drafts, session switch/late response, broken image recovery; keyboard/screen-reader semantics and axe |
| Product regression | Optional photos/no-photo publication; name-only drafts and legacy items; all 16 demo gifts; inventory status/provenance; exact regional filtering/count/cursor/sort; owner self-request guard; pickup/messages/rescheduling/closed history unchanged |
| Browser/layout | Actual production build/local HTTPS at 1440/768/390/375/320 CSS px plus text reflow; separate-port development image CORS; image dimensions/layout shift, long labels, loading/errors, gallery keyboard/focus, object URL release and upload refresh |
| Resource/packaging | Node 22 supported native Sharp build and Vercel artifact contents; peak RSS/cold-start/p95 processing at configured caps, compressed noise/PNG worst case, 1 native pipeline admission and bounded read concurrency; record measured limits, not theoretical SLA |

A delayed-PUT test must actually let the fake/local adapter commit after a 404,
not stub both into immediate final success. Physical deletion tests inspect both
real stored variants and quota/ledger state. Tests of GPS stripping inspect
encoded output bytes/metadata, not just a DTO omitting an EXIF field. All fixture
creation/deletion rechecks owned container/bucket/namespace identity first.

Extend `e2e/local.cjs` with an explicit injected local media fixture only for the
new local photo specs. Do not enable media for a remote fixture through inherited
env vars. Keep `e2e/fixtures.cjs` hosted gate and `policy.cjs`/`cleanup.cjs` budgets
unchanged; existing cleanup cannot erase media safely. Local fixture `finally`
closes app/SDK clients and removes only receipt-owned SeaweedFS/MongoDB resources,
never an existing bucket/volume. Bound setup/shutdown time and output.

Normal B1 CI runs its native pinned SeaweedFS contracts through recursive backend
tests, without cloud credentials or hosted environment access. Run backend lint/all
integration/preparation tests, frontend suites, strict build, policy tests, full
isolated HTTPS browser suite, axe, actionlint, whitespace and fixture integrity.
Keep old assertions; do not skip privacy/fault tests to obtain green CI. E1 records
real counts/immutable head/CI and actual screenshots, visually reviewed; no claim
of physical Safari/iOS/native picker or manual screen-reader verification unless
performed. Those remain human trial tasks.

## Rollout, operator decisions and approval gates

1. **6.5A review:** approve/adjust the proposed proxy, permission, byte/quota and
   lifecycle contract. Owner-approved storage/product choices remain fixed.
   Review the approved SeaweedFS artifact restrictions and source-backed Vercel unknowns.
   Proposed pilot quotas may constrain a large move-out; review expected items/
   photos per day before treating these starting thresholds as launch settings.
2. **Before local B fixture:** acceptable SeaweedFS artifact/license/provenance and
   security review; disposable target/SDK headers/conditional PUT contract tests.
   No real R2 needed for implementation or normal CI.
3. **Before enabling first upload:** B1–B4 pass, including account quotas, physical
   cleanup recovery, orphan/unknown outcomes and bounded operator tool. Verify
   resource envelope and deployment/native dependency advisories. Do not expose
   upload while cleanup is merely a TODO.
4. **Remote storage activation — separate explicit authorization:** owner verifies
   Cloudflare account, new/private staging bucket/namespace, runtime token scope,
   billing/quotas, no public domain/cache and secrets in the approved backend
   environment. No actual IDs/credentials are hardcoded here. A production bucket,
   credentials or data is never inferred from staging.
5. **Remote MongoDB indexes — separate authorization:** existing guarded preview
   verifies project/cluster/DB/topology/fingerprint/conflicts. Review the photo
   index plan, then approve apply with exact existing confirmations. Neither app
   startup nor a feature flag authorizes migration/DDL.
6. **Hosted compatibility — separate authorization:** verify current actual Vercel
   plan memory/duration/Fluid behavior, 4.5 MB request/response/proxy ceilings,
   Sharp packaging/cold starts, exact HTTPS origin/cookies/CSRF and backend bucket
   isolation. Approve a concrete staging deployment/rollback and bounded image
   verification/cleanup extension. Existing hosted E2E does not own these new
   objects; never silently point local photo tests at R2 or enlarge remote budgets.
7. **Cleanup scheduling / retention / destructive operations:** a bounded manual
   recovery tool is planned; any remote apply, recurring job, provider lifecycle,
   account erasure, object-version purge, restore or 30-day retention enforcement
   needs explicit scope/target approval. No schedule or retention is enabled here.
8. **Public launch:** previous [6.4E gates](milestone-6.4e-acceptance.md) still apply:
   Atlas network durability, tested encrypted backup/recovery, production mapping/
   protection, dependency triage, retention/moderation/abuse/support, monitoring and
   load evidence. Photo architecture or green local CI resolves none automatically.

Rollback after future implementation: disable new uploads without abandoning
cleanup/ledger/authorized owner deletion; roll back display/owner UX before backend
contracts. Retain additive metadata/indexes/usage while reconciling objects. An
older binary ignores quota/media records and cannot safely operate their cleanup;
never roll back by dropping collections, releasing credits or deleting buckets.
Coordinate compatible frontend/API artifacts and storage target config explicitly.
No rollback action or remote operation is executed by 6.5A.

## 6.5A checks and remaining limits

The original 6.5A PR changed **only the three design documents**. Its local checks were
backend lint, frontend regression/strict production build, deployment/E2E policy
tests, actionlint, Markdown target/diagram review, whitespace and unchanged
application/dependencies/workflows/16-gift integrity. Exact results and the normal
CI run at the immutable PR head are recorded in its description. Normal CI's
MongoDB/HTTPS regressions use disposable local resources; no hosted E2E or new
SeaweedFS/Sharp/R2 capability is certified by those pre-image tests.

The design is implementation-ready subject to the explicit artifact/hosting/
benchmark gates. Public docs sites were inaccessible; official GitHub publisher
source was available and pinned. No physical image sanitization, storage cleanup,
resource benchmark, hosted compatibility or new visual UI is claimed as tested
in 6.5A. There are no generated product photos, uploaded originals, new secrets,
provider changes, remote database/index changes, deployment or automatic merge.

### D1 public presentation

[The D1 implementation notes](milestone-6.5d1-public-photos.md) document bounded
public cover/detail DTOs, one selected-page metadata batch, strict client URL
validation, ordered accessible galleries and privacy/caching/rollback limits.
Existing delivery authorization is reused; D2 pickup integration remains deferred.
Hosted photo activation still requires a separately approved rollout.

### D2 pickup context

[D2 implementation and permission matrix](milestone-6.5d2-pickup-photos.md) add a
compact current-cover thumbnail to request creation/detail with independent
owner/public media permission. Historical text does not restore private photos.
Lists remain text-first with zero added media queries; no state-machine, gallery,
conversation attachment, hosted storage activation or new index is introduced.

### F3 operational preparation

[F3's operational readiness report](milestone-6.5f3-photo-operations.md) adds
offline diagnostics, strictly local read-only backlog summaries, signed-receipt
lifecycle/multi-instance drills and explicit runbook/trial/rollback decisions.
No hosted wiring, remote provider access, fleet-control implementation, retention
change or production photo activation is included. A separately approved real
trial still needs exact targets, operating authority and provider evidence.


### F4 distributed admission and authorization

[F4](milestone-6.5f4-distributed-photo-control.md) implements an opt-in signed
exact-target control record and transaction fence shared by runtime/recovery
workers, with local-only explicit preview/sign/apply. Actual independent OS
processes exercise stale snapshots, code112 conflicts, pause/resume, role rotation,
SIGKILL and exact-once cleanup. There is no startup migration or hosted activation.
Controlled contexts require replica sets. Older uncontrolled workers must be
quiesced before adoption. Permanent revocation across DB restore still lacks an
independent high-water authority; real-provider/host/remote-admin/root-key custody
and restore decisions remain separately approved follow-ups.


### F5 coordinated recovery acceptance

[F5](milestone-6.5f5-coordinated-recovery.md) adds bounded synthetic logical
DB/object snapshots and independent restore/app/recovery processes. Its safe
operating model is full photo outage, independent latest-checkpoint reconciliation,
session invalidation and explicit fresh-grant read-only reauthorization. The F4
old-trust rollback counterexample remains demonstrable, with no permanent
revocation claim. See the [operator runbook](photo-disaster-recovery-runbook.md).

The [dependency checkpoint](milestone-6.5f5-dependency-checkpoint.md) reproduces the
67/352 reporting difference without lock/advisory/source changes. No dependency
upgrade, production restore tooling, retention policy, deployment or activation is
added. Next work is concentrated human acceptance and separately approved real
provider/host/device validation; passing offline tests is not that approval.
