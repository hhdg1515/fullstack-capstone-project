# UX-2C3 — Item-first local MVP acceptance

## Prerequisites and implementation plan

Base: `5a49b4983914138b600385ddac47ff8c50dcd58e` (main). PR #80
(B3), #81 (C1) and #82 (C2) are merged. Their final-head CI runs
41265476436, 41280192559 and 41283947431 each passed all three jobs.
The earlier uncommitted C1 attempt remains in its original worktree and is
not part of this branch.

Repository audit: C1 supplies schema-2 private photos and the item fence;
C2 supplies version-2 pickup references, conversations and scheduling, but
publication is refused and regional discovery is plan-rooted. No migration
or new persistent entity is necessary.

Implementation sequence:

1. Default-off publication gate; validated versioned publication under the
   existing item transaction and database clock. Name-only drafts remain valid.
2. Explicit versioned withdrawal. Pending requests require cancellation
   confirmation. Accepted future appointments require confirmation; accepted
   appointments already reached must be resolved through request actions first.
   Preserve all history and invalidate formal proposals in the same transaction.
3. Union eligible v2 items with the existing v1 regional query before its
   reservation exclusion, exact-count facet and cursor page. Bound media
   enrichment after pagination; recheck delivery authorization before bytes.
4. Reuse the owner editor, photos and existing public/requester components.
5. Isolated integration/browser acceptance and a Windows-friendly local launcher
   using the existing verified MongoDB/SeaweedFS fixture factories.

No remote provider/database operations, deployment or production activation.

## Verification status

Application implementation is complete; verified local results are recorded in
the ledger below. All mandatory local suites passed. PR-head CI remains a separate gate.
Native Windows Docker Desktop acceptance remains an owner task.

## Final architecture and API

The existing `items` collection holds explicit schema-2 independent listings.
The legacy discriminator still means *all* v2-only fields are absent; an explicit
unknown/mixed shape is rejected, not interpreted as legacy. No hidden plan,
conversion, reference replacement, collection migration or new index is created.

- `POST /api/items`: name-only private draft, or `publish: true` with complete
  publication fields and the new gate enabled. Owner and timestamps are derived
  by the server. An uncertain create is not automatically replayed.
- `PATCH /api/items/:id`: versioned draft/withdrawn editing. Existing published
  listings must be explicitly withdrawn before changing their text/location;
  this makes cancellation consequences visible rather than implicitly moving an
  accepted appointment. Draft saves never publish implicitly.
- `POST /api/items/:id/actions`: `publish`, `withdraw` (or canonical `unlist`),
  exact `version`, optional explicit `confirmCancelRequests: true`. Unauthorized
  ownership is 404, stale version is 409. Unsupported clear/reopen remain refused;
  legitimate completion uses the existing pickup request handoff action.
- New publication stores `publicationRequirementsVersion: 2`. Only C3-authorized
  published records enter mixed discovery/public media; an earlier constructed
  C2 fixture does not become public merely because a switch changed. Republish
  keeps the first `publishedAt`, as v1 does, and never reopens closed requests.

`listingTransaction` uses snapshot/majority transactions and the existing
`coordinationRevision` compare-and-increment. Publication, withdrawal, C1 photos,
C2 acceptance/message/scheduling/handoff operations therefore share the same
item fence. Failed validation/cancellation confirmation rolls back the entire
transaction. Stale retries cannot add a second cancellation/history event.
All previous legacy plan → item lock ordering and request references remain. A confirmed read-path inconsistency was also corrected: v2 pickup detail/list serialization now refuses damaged original-participant or item bindings before returning private notes/history, matching its conversation policy. Healthy closed v2 histories remain readable. The explicit v1 historical-text contract after removed parents remains unchanged; v1 media/conversations still perform their independent stricter checks. Strengthening that legacy text contract requires a separate compatibility/policy decision.

## Publication, withdrawal and expiration

| State / operation | Result |
| --- | --- |
| Name-only draft | Private, editable; no public/request/media authority. |
| Publish draft or withdrawn item | Requires name, description, valid category/type, state/metro, confirmed IANA zone, reproducible policy-2 tuple and future exclusive expiry. City, neighborhood, condition and photos remain optional. |
| Published, unreserved | Public eligible result/detail; requests allowed through C2 rules. |
| Accepted reservation | Excluded from available results/counts; public detail can show reserved state; self-request still denied. |
| Withdraw with no active requests | Versioned transition to `unlisted`; new public access/request admission stops. |
| Withdraw with pending requests | 409 confirmation required, then atomic cancellation; retain original participant history. |
| Withdraw with accepted future appointment | Explicit confirmation required; cancel appointment authority and invalidate any pending formal proposal, retaining appointment/proposal snapshots in history. |
| Accepted appointment already reached | `PICKUP_RESOLUTION_REQUIRED`; resolve through existing cancel/handoff/no-show request actions first. No automatic decision about an ongoing handoff. |
| Completed legitimate handoff | Existing C2 action clears the item and competing active requests. It is never inferred from a manual inventory status. |
| Deadline reached | Read/query eligibility expires at equality; no GET writes, hidden migration, cleanup/refund or automatic request-history erasure. Existing participants can resolve active requests through authorized actions. Closed text history stays governed by original-participant checks. |

The giver's inclusive local date is stored with policy 2, IANA zone confirmation,
recorded rules version and exclusive BSON UTC `expiresAt`. Existing Temporal
boundary/DST and gap/fold rejection rules remain. New/changed region/zone context
invalidates confirmation. No historical appointment is shifted or relabeled.
V1 retains its UTC-calendar cutoff.

Mixed discovery uses an authoritative DB clock for its operation; v2 start/end
filters use each listing's local calendar. The API's optional `dateMinimum`
allows the previous UTC date to remain selectable when it can still be today in
a giver's zone. V1 rows never match an already-past UTC exact-date filter.
Deadline sorting uses actual exclusive instants: v2 `expiresAt`, v1 midnight UTC
after its inclusive end date. It does not compare unlike local-date strings.

## Discovery, pagination and performance

The existing plan-rooted regional pipeline is retained, with an explicit
`$unionWith` of eligible schema-2 items. The schema-2 branch checks canonical region/type relationships,
publication marker, confirmed expiry, public text shape and live owner
before reservation exclusion and the exact-count/page `$facet`. The temporary `plan` projection on v2 is only a read-shape compatibility adapter for existing label filters, never a stored plan. Public `moveOutDeadline`/`effectiveAvailableUntil` aliases contain the item deadline for older readers; `listingModel: 2` and `datePolicy: pickup-local` distinguish its semantics. Search synonyms,
normalized city/neighborhood, condition, category/type and availability filters
remain server-side. No global fallback or candidate download for client filtering.

- Page bound remains 1–50, default 12; deterministic primary key + ObjectId tie.
- Mixed-mode cursors use version 2, including ISO instants for deadline order.
  Old single-model cursors return `STALE_CURSOR` after a mode switch, requiring
  the existing explicit refresh rather than silently changing continuation order.
  Gate-off v1 cursor semantics remain unchanged. Lifetime remains 15 minutes.
- A single bounded metadata enrichment query follows counting/pagination, with
  at most six candidate photo rows per item (six fails the five-photo invariant).
  No per-card metadata request and no storage reads during browse enrichment.
- Pickup photo enrichment remains **detail-only**, not an N+1 list operation.
- Existing publication/start/region/owner indexes are reused. Query time remains
  bounded by `maxTimeMS`, no disk spill; this is not a measured production-scale
  capacity guarantee. A targeted independent-region index may be justified by
  later explain/load evidence and must use separate guarded preparation.

## Photo access matrix

All delivery is through `/api/item-images/:id/{thumbnail,display}`, with verified
bytes, bounded storage requests and a fresh authorization check after fetching.
No provider URL, public bucket, original filename, EXIF/GPS, storage key, receipt,
owner ID or conversation text is added to public listing DTOs.

| Current item state | Live owner | Anonymous / other account / pickup requester |
| --- | --- | --- |
| Draft | Private Ready photos only when owner photo/read gates permit. | Denied. |
| Eligible published (including reserved detail) | Authorized owner photos. | Ready variants under current C3 public eligibility only. |
| Withdrawn, expired or cleared/completed | Existing owner access where the independent photo gate permits. | Fresh media denied; past/current pickup participation grants no extra rights. |
| Deleted item/photo, invalid ownership or compromised reference | Denied. | Denied. |
| Photo read/authority outage or disabled independent-photo gate | Fail closed. | Fail closed. |

Withdrawal is logical visibility revocation, **not physical deletion or quota
refund**. Photo deletion still produces the existing durable tombstone/cleanup
work. Unknown PUTs, holds, leases and settlement receipts are untouched. Closed
conversation access never resurrects media. R2 and signed control/restore
limitations from F1–F5 are unchanged.

Responses use no-store delivery. There are no issued direct provider URLs in
this implementation, so there is no signed-provider-URL revocation window to
claim. Already delivered bytes cannot be recalled; a hostile client can retain
copies regardless of cache headers. In-flight authorization is rechecked before
sending but this is not a guarantee of retracting bytes already sent.

## User experience and recovery

My Listings → Create/Edit Listing → private detail → Publish → public listing
uses the existing UX-1 design system. A single explicit **Publish with N photos**
authorizes saving/publishing first and sequential photo intake afterward. A
published item stays published if photos fail; item-scoped status recovery keeps
remaining local files and never automatically retries an uncertain PUT or create.
Independent photo controls reuse the existing revisioned order API, canonical
read recovery and compact Make cover/Up/Down buttons, inside Edit Listing.
Owner cards retain actual thumbnails. A mutation-response defect found in screenshot review was corrected: publish/withdraw now enrich the owner response inside the item fence, so saved thumbnails do not disappear until refresh. The bounded join is never persisted onto the item.

The request workflow is the same canonical pickup ID/conversation/scheduling
system as C2. A discovered acceptance issue was fixed: a future accepted
appointment's handoff button now wakes at its local display-time boundary
without polling or recording any action. Backend time/identity/version checks
remain authoritative. The browser acceptance waits for confirmed reschedule
commit and the actual database appointment time before recording handoff.

F1 session-generation fencing, stale-success/stale-401 rejection, account-keyed
private components, native beforeunload/in-app draft guards, explicit timezone
confirmation and uncertain-create locks remain. Private drafts are not persisted
in browser localStorage. Unsent local files do not survive reload; warnings and
independent text/photo protection remain. No realtime/unread claims were added.

## Genuine local browser evidence

All images below are captures from the running HTTPS application with disposable
synthetic accounts and real sanitized synthetic image files, not design mockups.
The colored photos are the actual test uploads, not fake product placeholders.
Desktop/mobile screenshots were visually inspected. Narrow forms/actions wrap,
cover/gallery order matches the authoritative rows, item/request context remains
visible and confirmations retain explicit destructive-action labels.

| Journey | Evidence |
| --- | --- |
| Create with optional staged photos | [desktop](evidence/ux2c3/1440-create-photos.png), [375px](evidence/ux2c3/375-create-photos.png) |
| One-click publication with a staged photo | [desktop](evidence/ux2c3/1440-publish-with-photo.png), [375px](evidence/ux2c3/375-publish-with-photo.png) |
| Owner cover selection | [desktop](evidence/ux2c3/1440-cover-order.png), [375px](evidence/ux2c3/375-cover-order.png) |
| Published owner detail | [desktop](evidence/ux2c3/1440-published-owner.png), [375px](evidence/ux2c3/375-published-owner.png) |
| Anonymous discovery and gallery | [desktop feed](evidence/ux2c3/1440-discovery.png), [375px gallery](evidence/ux2c3/375-public-gallery.png) |
| Request, conversation and formal proposal | [pending](evidence/ux2c3/375-request-pending.png), [conversation](evidence/ux2c3/375-conversation.png), [proposal](evidence/ux2c3/375-proposal.png) |
| Completed read-only history | [desktop](evidence/ux2c3/1440-completed-history.png), [375px](evidence/ux2c3/375-completed-history.png) |
| Explicit withdrawal cancellation | [375px confirmation](evidence/ux2c3/375-withdrawal-confirmation.png), [withdrawn](evidence/ux2c3/375-withdrawn.png) |
| Responsive form/history | [320px form](evidence/ux2c3/320-form-reflow.png), [320px history](evidence/ux2c3/320-closed-reflow.png), [tablet](evidence/ux2c3/768-form-reflow.png) |
| Native browser 200% zoom | [actual Chromium viewport](evidence/ux2c3/native-200-percent-form.png) |

Native zoom uses Chromium's own default partition zoom preference, with an
unchanged 1280px outer window, 640px CSS viewport, devicePixelRatio 2 and matching
CSS media query. It uses neither CSS zoom nor viewport resizing to simulate zoom.
The native screenshot uses browser CDP viewport capture because Playwright's
fullPage capture temporarily changes viewport metrics. This verifies Chromium,
not physical Safari/iOS, a manual screen reader or a real mobile keyboard.

## Local Windows handoff and operating limits

Follow [the native PowerShell/Docker Desktop guide](windows-local-mvp-acceptance.md).
`local/manual-mvp.cjs --approve-disposable-local` creates only receipt-verified
local resources, performs the real guarded dry-run/apply fingerprint protocol,
and runs CRA, Express, a MongoDB replica set, private SeaweedFS and Sharp behind
same-origin self-signed HTTPS. It rejects inherited database/remote endpoints and
forces the local Docker socket. Ctrl+C stops its own child/app and receipt-owned
fixtures; restart is the explicit disposable reset. Forced termination can
interrupt cleanup; never substitute Docker prune for receipt verification.

Linux execution verified this actual **development-server** path (not just the
production build): React deep link, secure browser context and JSON health 200,
followed by normal shutdown. Windows syntax/refusal smoke is included in CI;
Windows Docker Desktop, certificate trust and actual owner manual acceptance
remain pending and are not represented as executed here. No WSL commands are
required. Standard Windows Git OpenSSL or an equivalent PATH command is needed.

## Rollback and separately approved production readiness

1. Turn off `OWNER_LISTING_PUBLICATION_ENABLED` to stop new v2 publication,
   withdrawal controls and mixed browse/public photo authority. This is an
   operator procedure, not an action performed by this PR.
2. C2's separately gated v2 detail/request creation stays available while
   `OWNER_LISTING_PICKUPS_ENABLED` stays on. Disable that too if all new v2
   requester entry must stop. Existing participant request decisions/history
   remain supported for safe resolution. Do not erase or repoint requests.
3. Disable independent photo admission/delivery through its existing gates for
   a full photo outage, retaining B4/F1–F5 status/cleanup/unknown-write controls
   in a capable binary. Do not refund holds or delete recovery records.
4. Keep dual-model validators, schema-2 photo cleanup and version-2 request
   support deployed. Do not downgrade to a v1-only binary, remove records/indexes,
   convert plans or rewrite dates to reverse the UI change.
5. There is no migration or remote index application to undo. All environment
   samples stay false; no production provider/security setting was changed.

Production remains a separate approval, not this milestone's acceptance result.
Remaining release blockers include real R2/Vercel/Atlas integration and target
approval, sustainable Atlas network access, backup/restore/revocation authority,
dependency audit debt, hosting/resource budgets, monitoring and operational
cleanup approval. F4 database-and-old-trust rollback cannot guarantee permanent
revocation; unsafe restores still require F5 full-photo-outage and fresh approval.
SeaweedFS evidence does not establish real R2 behavior.

Existing photo picker/pipeline intermittent-readiness limitations from prior
milestones remain documented; no broad retry, larger timeout or weaker security
assertion was introduced to hide them. Browser preparation still cannot decode
HEIC on unsupported platforms. Window close/reload protection is limited by
browser behavior; files remain in memory only. Full immutable item edit audit
history is not a new feature here; existing versions, timestamps, request history
and photo operation ledgers are preserved.

## Verification ledger

| Check | Executed local result |
| --- | --- |
| Complete backend, real replica sets/SeaweedFS/Sharp/recovery/process races | **819 passing**, zero failures in the final serialized run. |
| Complete frontend | **33 suites, 534 passing**. |
| Focused pickup/communication/scheduling/publication regressions | **131 passing** before the final legacy compatibility correction; that correction is included in the 819-case full run. |
| Focused owner API/publication/private-to-public photo previews | **80 passing**. |
| Strict CRA production build (`CI=true`) | Compiled successfully. |
| Backend JSHint / frontend runtime ESLint | Passed; no rule suppression. |
| Security/deployment policy suite | **59 passing**, including local browser lifecycle guards. |
| Committed dependency compatibility checks | **6 passing**. |
| Local launcher refusal guards | **5 passing** on Linux; Windows execution is a separate CI smoke job. |
| actionlint / staged whitespace checks | Passed. |
| Complete isolated HTTPS Chromium | **98/98 passing**, zero failures, serialized disposable local HTTPS Chromium; embedded axe checks passed. |
| Demo fixture integrity | **16 records**, SHA-256 `23f3868a6c90695b112c453f7d642354970f632a337d3b432f16ed5cef78cc04`, unchanged. |

Commands: `npm --prefix giftlink-backend test`, `npm --prefix giftlink-backend
run lint`, `CI=true TZ=America/Los_Angeles npm --prefix giftlink-frontend test --
--watchAll=false --runInBand`, `CI=true npm --prefix giftlink-frontend run build`,
`npm --prefix giftlink-frontend run test:dependencies`, `npm --prefix e2e run
test:policy`, `node --test local/manual-mvp.test.cjs`, and `npm --prefix e2e test`
with the documented isolated Chromium executable override when needed.

Run Docker-backed backend/browser suites **serially on one local daemon**.
GitHub runs them on separate job machines. Superseded development runs and
focused reruns are not added together as unique coverage or counted as full
passes. No hosted E2E, production deployment, remote provider validation or
Windows Docker Desktop execution is claimed.

Final-head CI is a separate required gate: Backend, Frontend, full Chromium and
Windows launcher smoke. Verify the exact PR head SHA and pinned run link in the
PR description/checks; do not infer remote CI success from local results.
[Branch CI runs](https://github.com/hhdg1515/fullstack-capstone-project/actions/workflows/main.yml?query=branch%3Acodex%2Fm66-ux2c3-item-first-launch-acceptance).

Standalone all-source frontend ESLint was reproduced against the immutable base
and final working source: **both 224 errors and 3 warnings**, in inherited test
code. Runtime source lint is clean; strict CRA build excludes test files as in
existing CI. This PR does not suppress rules or rewrite unrelated test styles.

## Readiness assessment

| Priority | Finding / decision |
| --- | --- |
| P0 before production | Real R2/Atlas/Vercel admission, delivery, revocation, backups and recovery have not been approved or validated here. All hosted photo/production feature activation stays off. |
| P1 acceptance | Native Windows 11 PowerShell + Docker Desktop and certificate/browser trust still need the owner's manual run. CI syntax/refusal smoke is not that acceptance. |
| P1 operations | Free-tier capacity, dependency advisory debt, practical backup/restore and independent rollback-resistant trust remain separate launch decisions. No extra authority or paid resources were introduced. |
| P1 compatibility | V1 request text deliberately retains the existing D2 historical-read contract after missing/damaged parents. V2 notes/history now fail closed on damaged original participants/item binding. Unifying the legacy text contract requires explicit compatibility review; its media and conversations retain their stricter independent checks. |
| P2 usability/platform | HEIC support, real mobile keyboards, physical Safari/iOS and manual assistive-technology testing are unverified. Browser-only unsent files are not reload-persistent. |

Development-run failures are not counted as successful acceptance. A near-minute
proposal fixture could expire during screenshotting; it now selects a real
appointment 30–90 seconds ahead and waits for canonical proposal/acceptance
commit. No assertion timeout, POST replay or broad retry was added. A later
`ERR_NETWORK_CHANGED` also reproduced in a serialized run. Local app tests now
start a fresh browser only after their own disposable deployment is ready and
close it before teardown. Hosted tests retain the existing stock browser and
authorization path. No assertion or retry policy was weakened. The
reproduced v1 text compatibility regression was fixed in code, not by changing
the existing D2 assertions.

The browser CI job budget is 30 minutes instead of 25: prerequisite C2's actual
final-head job was 21m33s, and C3 adds two genuine appointment-wait journeys plus
native zoom. Per-test/expect bounds and zero retries are unchanged. Backend,
frontend, policy and all existing browser coverage remain; a separate Windows
syntax/refusal job adds no remote environment or credentials.

## Changed-file inventory

Source, tests, configuration and documentation (application changes below;
existing browser spec fixture parameters also use the local lifecycle helper):

- `e2e/local-browser.cjs`
- `e2e/local-browser.test.cjs`
- `e2e/fixtures.cjs`
- `e2e/package.json`

- `.github/workflows/main.yml`
- `README.md`
- `docs/milestone-6.6-ux2c3-item-first-mvp-acceptance.md`
- `docs/windows-local-mvp-acceptance.md`
- `e2e/listing-launch-c3.spec.cjs`
- `e2e/listing-native-zoom-c3.spec.cjs`
- `e2e/local.cjs`
- `e2e/playwright.config.cjs`
- `giftlink-backend/.env.remote.sample`
- `giftlink-backend/.env.sample`
- `giftlink-backend/app-factory.js`
- `giftlink-backend/config.js`
- `giftlink-backend/routes/itemRoutes.js`
- `giftlink-backend/routes/ownerListingRoutes.js`
- `giftlink-backend/routes/pickupRoutes.js`
- `giftlink-backend/runtime.js`
- `giftlink-backend/services/discovery.js`
- `giftlink-backend/services/independent-visibility.js`
- `giftlink-backend/services/item-image-delivery.js`
- `giftlink-backend/services/item-image-pipeline.js`
- `giftlink-backend/services/listing-context.js`
- `giftlink-backend/services/listing-draft.js`
- `giftlink-backend/services/listing-publication.js`
- `giftlink-backend/services/owner-listings.js`
- `giftlink-backend/services/pickup-item-media.js`
- `giftlink-backend/services/pickups.js`
- `giftlink-backend/services/public-item-media.js`
- `giftlink-backend/test/independent-listing-photos.test.js`
- `giftlink-backend/test/independent-listing-pickups.test.js`
- `giftlink-backend/test/independent-listing-publication.test.js`
- `giftlink-backend/test/server.test.js`
- `giftlink-frontend/src/api/ownerListings.js`
- `giftlink-frontend/src/components/Inventory/ItemPhotos.css`
- `giftlink-frontend/src/components/Inventory/ItemPhotos.js`
- `giftlink-frontend/src/components/Inventory/PublicItemCard.js`
- `giftlink-frontend/src/components/Inventory/PublicItems.js`
- `giftlink-frontend/src/components/Inventory/PublicItems.test.js`
- `giftlink-frontend/src/components/Journeys/Journeys.css`
- `giftlink-frontend/src/components/Listings/ListingForm.js`
- `giftlink-frontend/src/components/Listings/ListingForm.test.js`
- `giftlink-frontend/src/components/Listings/ListingPhotos.test.js`
- `giftlink-frontend/src/components/Listings/ListingPublication.test.js`
- `giftlink-frontend/src/components/Listings/Listings.js`
- `giftlink-frontend/src/components/Pickups/Pickups.js`
- `giftlink-frontend/src/components/Pickups/Pickups.test.js`
- `local/manual-mvp.cjs`
- `local/manual-mvp.test.cjs`

Actual screenshot artifacts: 31 PNG files in `docs/evidence/ux2c3/`; key views are linked above.

## Owner handoff

1. Review the PR diff, CI head/run and real screenshot evidence; no merge is automatic.
2. After separately approving/merging, use the Windows guide with two synthetic browser sessions. Record the actual Windows/Docker Desktop and certificate-trust result.
3. Keep all hosted gates disabled. Decide on any future v1 historical-text policy changes explicitly; no legacy conversion is bundled here.
4. Approve real-provider/production preparation separately, including target fingerprints, credentials, networking, backup/recovery, resource budgets and rollback. This PR performs none of those operations.
