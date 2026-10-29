# Milestone 6.5D1 — Public covers and detail gallery

Base: merged main `74a17b938243e9325c3dcd44fe632e5c68e04fde`, including
C1 corrections (#65), classification (#66), and owner photo management (#67).
Dedicated branch: `codex/m65d1-public-photo-gallery`.

## Boundary and compatibility

D1 adds optional public media summaries and presentation to the existing discovery
and item-detail routes. B3 already authorizes anonymous/requester reads of currently
public items; its delivery route is reused unchanged. C1/C2 uploads, cover/order,
delete, recovery, drafts, quotas and B4 cleanup remain unchanged. No new collection,
index, migration, public bucket, provider URL or pickup-photo integration. D2 is
separate. All 16 demo gifts remain unchanged.

Summaries require both existing metadata and binary/read pipeline configuration.
Default-disabled deployments execute no photo query and retain existing text-only
DTOs/UI. Merging D1 does not activate hosted storage or require remote schema changes.
The first Ready photo in C2 order is the cover. Deleting it promotes the next;
deleting the last leaves none. Future uploads append. Legacy data is not migrated.

## Contracts and privacy

Existing listing fields, exact totals, filters, cursors and sorting are unchanged.
Enabled list rows add `imageAvailability` (`ready`, `none`, `unavailable`) and
`coverImage` (null or `{id, thumbnail: {url, width, height}}`). Detail adds the same
availability and `images`, at most five `{id, thumbnail, display}` objects in server
order. Variants contain only app-relative `/api/item-images/:id/thumbnail` or
`/display` paths and bounded dimensions. IDs identify application delivery, never
storage keys. No owner ID, filename, EXIF/GPS, quota/revision, hash, internal key,
signed URL or provider metadata is added.

A fresh snapshot batch rechecks current publication, plan status, availability,
deadlines, owner existence, scalar ownership bindings, storage target, operation
validity and contiguous Ready order before disclosing image IDs. Corruption or
query failure yields unavailable; zero Ready rows yields none. Reads never repair
data or probe storage. Reserved items remain excluded from discovery but retain
existing public-detail/image access; pickup eligibility is unchanged.

Delivery independently authorizes each request before and after fetching verified
bytes, including session/access changes. Stale URLs for unlisted, hidden, expired,
deleted or invalidly bound public items are denied. Owners retain private access.
Tombstones revoke delivery before physical cleanup. Missing/corrupt variants retain
the existing generic 503; unauthorized targets retain generic 404. No raw storage
error is exposed.

The frontend validates optional media separately from core listing data: only
exact ID-bound application paths, bounded dimensions, unique IDs and max-five
arrays reach img elements. Malformed media degrades to unavailable without hiding
real text/counts. Older APIs without photo fields remain text-first. No external
image URL or photograph fallback is accepted.

## Performance, caching and freshness

The original count/page aggregation runs first. One additional aggregation enriches
only the selected maximum 50 rows, using item-ID lookups and at most six Ready rows
per item (the sixth detects invalid over-cap state), a five-second deadline, simple
collation and no disk spill. No per-card metadata HTTP request, per-item database
command, S3 HEAD/GET or new index is needed. Empty pages skip enrichment. The media
batch is a separate snapshot: concurrent revocation can leave text/counts from the
first snapshot while withholding image IDs. Explicit refresh gets current state.

Cards lazy-load thumbnails only (maximum 400px / 256 KiB each), never display
variants. Default pages contain 12 items, hard maximum 50. Detail requests at most
five thumbnails plus one selected display (maximum 1280px / 1 MiB); other displays
load only on navigation. No original, full-gallery prefetch, polling or unlimited
history. Existing concurrency/rate limits remain unchanged. These are bounds, not
a throughput benchmark. Optional image failures retain listing information.

Delivery retains `Cache-Control: private, no-store`, WebP, nosniff, no-referrer and
same-site resource policy. No CDN or public bucket is introduced. This favors
current authorization over caching and costs application/storage work on each
read. Previously downloaded pixels cannot be erased from an open page or device;
no realtime revocation is claimed. Refresh and subsequent requests enforce current
state. Cover/order changes appear on authoritative refresh, not a timer.

## Interaction

Cards use one image/title link, fixed 4:3 neutral frames and contained images
without stretching or layout shifts. No-photo cards retain useful text and a
neutral No photo frame. Failed covers retain metadata and navigation.

Detail has one primary image, Previous/Next, position and up to five native
thumbnail buttons. Arrow keys/Home/End navigate the thumbnail group, with visible
focus, accessible names and pressed state. Single photos omit redundant controls.
No modal, overlay or dependency. Alt text names the item/position without inventing
image content. Loading/failure states retain item information and pickup entry
points. Another photo or the existing Refresh listings action provides recovery;
render loops do not retry broken images. Refreshed revoked items remove gallery
and request actions. Existing session-scope changes invalidate old response state.

## Actual local screenshots

Real strict production UI over isolated local HTTPS, disposable MongoDB replica
set, verified private SeaweedFS and real Sharp variants. Colored synthetic fixtures
show order; they do not claim to depict real listed products. Captures wait for
actual pixels except intentional failures. Tall capture viewports avoid Chromium
stitching artifacts; interactions/reflow/axe use normal desktop/320px/375px widths
and desktop zoom-style reflow.

| State | Desktop | 320px |
| --- | --- | --- |
| Discovery: five/one/no-photo items | [Cards](verification/m65d1/desktop-discovery-covers.png) | [Cards](verification/m65d1/mobile-discovery-covers.png) |
| Five photos | [Gallery](verification/m65d1/desktop-gallery-five.png) | [Gallery](verification/m65d1/mobile-gallery-five.png) |
| One photo | [Single](verification/m65d1/desktop-gallery-one.png) | [Single](verification/m65d1/mobile-gallery-one.png) |
| No photos | [None](verification/m65d1/desktop-gallery-none.png) | [None](verification/m65d1/mobile-gallery-none.png) |
| Cover failure | [Unavailable](verification/m65d1/desktop-cover-unavailable.png) | [Unavailable](verification/m65d1/mobile-cover-unavailable.png) |
| Primary variant failure | [Unavailable](verification/m65d1/desktop-gallery-unavailable.png) | [Unavailable](verification/m65d1/mobile-gallery-unavailable.png) |

## Verification, rollout and rollback

Exact local and CI results are recorded in the PR. Backend contracts exercise real
missing/corrupt SeaweedFS bytes, order/deletion, anonymous/requester/owner access,
disabled gates, binding corruption, failed queries, publication races, disappeared
owners and revoked URLs. Frontend tests reject unsafe DTOs and cover keyboard,
image failure and authoritative refresh. Local HTTPS verifies counts/pagination,
filters, thumbnail-only cards, gallery navigation, cover changes and unlisting.
Existing upload/quota/cleanup, classification, inventory, pickup/chat/scheduling
regressions and the 16 legacy gifts remain in the complete suite.

No new live staging, real Safari/iOS, manual screen-reader, R2 or production-readiness
claim. Production photo gates remain disabled. A future approved hosted rollout
must satisfy existing B1–B4 storage, index, security, recovery and operational
prerequisites. Deploy compatible backend summaries before frontend if separate;
old clients ignore additive fields and new clients tolerate absent fields.

Rollback reverts the D1 frontend/backend commits without a migration. C2 order,
tombstones and private storage remain authoritative. Disabling the existing read
pipeline omits summaries, subject to existing configuration/startup prerequisites.
A UI rollback alone does not revoke already authorized B3 delivery: publication,
ownership and existing gates still govern access. Never make the bucket public or
remove authorization/cache safeguards to work around failed images.
