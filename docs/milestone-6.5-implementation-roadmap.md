# Milestone 6.5 — Implementation and acceptance roadmap

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
| C1 | Owner selection/upload/progress; **new** `components/Inventory/ItemPhotos.js`, `api/itemImages.js` | `Inventory.js`, `ItemForm.js` only for real-item entry, design-token scoped CSS/component tests | Five-file bounded client selection; explicit upload, private previews, progress vs ready, safe service errors; no new framework/automatic item creation |
| C2 | Owner reorder/cover/delete and independent draft recovery | ItemPhotos/transport tests, `forms/UnsavedChanges.js` **reuse**, no blanket rewrite | Up/down/Make cover/Delete native controls, stale revisions, explicit discard and lost-response status recovery; no item-form draft reset/localStorage |
| D1 | Public cover/gallery and inventory thumbnail; **new** small `ItemImage`/`ItemGallery` components | `services/discovery.js` bounded enrichment after page/count, `services/inventory.js` optional cover serialization, `PublicItemCard.js`, `PublicItems.js` + `validFeed`, `Inventory.js`, scoped styles/tests | Exact counts/cursors/owner behavior unchanged; safe relative app URLs/dimensions; 400px covers only, gallery display on demand; distinguish none from unavailable |
| D2 | Request-detail thumbnail with independent photo access | `services/pickups.js` **serialize** only if a thumbnail DTO is needed; `Pickups.js` detail, image-policy tests | Closed conversation stays readable without inheriting private photos; no message attachments, archived copies, global inbox or state-machine changes |
| E1 | Integrated photo/security/product acceptance and rollout review | Local-only browser specs, synthetic fixtures, docs, CI only where needed for SeaweedFS prerequisites | Full two-account/native media + fault/cleanup suite; actual desktop/mobile/axe evidence; SeaweedFS resource cleanup; current hosting/package verification gate and separate remote-approval checklist |

B2/B3/B4 may be retuned into smaller backend PRs if actual diff size requires it;
do not ship quotas/cleanup “later” than the first usable upload path. There is no
new queue/worker/cron/service in these initial PRs. A future measured need for a
larger direct-quarantine pipeline is a separate design/approval, not silent B3
scope growth. Do not fix unrelated 6.4E registration/validation debt or dependency
advisories in the photo PRs.

## 6.5C interaction contract

The photo manager belongs to the **existing saved item ID**. A new name-only draft
or published item is created through the current explicit ItemForm save first;
then the owner opens Photos on that item's inventory card/editor. No invisible
autosave, duplicate item, combined cross-store form transaction or photo-required
publication rule. Existing fast repeated item creation remains unchanged.

The small component owns selected File/object-URL previews and upload operation
IDs independently of item text fields. At most five selected/active images and a
bounded total file size; one explicit upload at a time initially is sufficient.
Account's shared two-upload allowance still protects another tab/device. Do not
create an unbounded browser or server work queue. Revoke object URLs on removal/
scope change/unmount, never persist files/private drafts in localStorage.

The new API helper reuses urlConfig/session/error conventions but sends native
FormData, **without manually setting multipart Content-Type/boundary**, includes
credentials and the existing CSRF header, and uses a bounded upload timeout.
Send a generic multipart filename, not File.name. XHR progress may show bytes
transferred; 100% is followed by Processing, never a delivery/ready claim before
the server commits. An uncertain outcome requires explicit GET-status/review,
not automatic re-POST. Known rejected files require an explicit new reservation.
Input file/preview stays in memory on recoverable failure; browser termination
can lose it, while the durable server operation is discoverable after refresh.

Up/down buttons or Make cover update the complete ready-ID order with its current
imageRevision. No drag-only interaction. Delete confirms removal, hides only
after acknowledged logical deletion, and says Cleanup pending until physical
settlement. Removing photos does not cancel requests, clear inventory, change an
appointment or discard an unrelated ItemForm/chat/time draft. A photo failure does
not prevent saving/publishing an otherwise valid text item without photos.

Use existing PageHeader/Surface/Feedback/tokens, 44px controls, labels, visible
focus, concise status/error announcements and predictable focus after reorder/
delete. No sticky overlay or decorative redesign. Show the privacy warning and
format/byte limits before selection. Native `accept` is guidance, not validation;
HEIC/oversize files receive export/resize guidance, not an assumed automatic iOS
conversion. Local preview labels use Photo 1, not private filenames.

## 6.5D rendering contract

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
