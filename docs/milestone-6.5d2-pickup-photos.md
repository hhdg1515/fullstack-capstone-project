# Milestone 6.5D2 — Pickup request item thumbnails

Base: merged main `2deefd215518de48d14a176daf3fb593506b385d`, including D1 #68.
Dedicated branch: `codex/m65d2-pickup-photo-context`.

## Audit and scope

Request detail/list access already requires a current authenticated participant.
The existing communication service additionally checks original participants,
ownership, account existence and lifecycle before allowing historical text reads;
closed conversations remain read-only. Existing image delivery independently
permits the current item owner, or readers of a currently public item. It never
uses pickup participation as a private-photo grant. Accepted reservations are
excluded from discovery but remain publicly viewable on detail/delivery routes.

D2 preserves those policies and reuses D1's bounded Ready-order validator and
thumbnail DTO. It adds a compact current-cover image inside the existing item
context on Request pickup and Pickup request detail. The latter adds media only
to authenticated GET detail, after normal text serialization. Creation, acceptance,
cancellation and rescheduling transaction responses do not perform photo reads.
No state-machine, conversation, C1/C2, classification or public gallery workflow
changes. No conversation attachments, photo snapshots, extra confirmation or new
navigation. All 16 demo gifts remain unchanged.

Request lists stay text-first. They gain **zero** photo metadata queries or HTTP
requests; their existing 25-row bound, text serialization, order and continuation
remain unchanged. This intentionally avoids photo N+1 behavior without rewriting
the existing per-row text/participant lookups. A list thumbnail/batched text-read
redesign is outside this focused detail integration.

## Exact authorization matrix

A request media summary requires all of the following in one fresh snapshot:

- The request still exists, matches the originally loaded item/plan/giver/requester
  references and has an authenticated original participant as viewer.
- Both original participant accounts exist; the creation event still identifies
  the original requester. IDs must be scalar ObjectIds, giver/requester distinct.
- Status is one of the six existing canonical states, with active true only for
  pending/accepted. Unknown or inconsistent states return no photo summary.
- The item and plan still exist with valid, matching owner/item/plan references.
- Ready operations, generation/storage binding, revision and contiguous C2 order
  validate; more than five Ready rows or corrupt references fail closed.

The summary then applies the **existing item-media permission**, independently
of request status:

| Request / current item state | Original giver, still valid item owner | Original requester |
| --- | --- | --- |
| Pending, item currently public | Ready cover permitted | Ready cover permitted |
| Accepted/reserved, item currently public | Ready cover permitted | Ready cover permitted (existing public detail policy) |
| Declined, item currently public | Ready cover permitted | Ready cover permitted |
| Cancelled, item currently public | Ready cover permitted | Ready cover permitted |
| No-show, item currently public | Ready cover permitted | Ready cover permitted |
| Completed, normally cleared after real handoff | Ready cover permitted | No media |
| Any canonical state, item draft/unlisted/expired/cleared, unpublished, deadline passed or plan inactive | Ready cover permitted under existing owner policy | No media |
| Closed request whose item is legitimately public again | Ready cover permitted | Only current public media; no historical/private grant |
| Missing item/plan, invalid ownership/storage references or missing participant | No request media | No request media |
| Deleted request / nonparticipant / invalid session | Existing 404 / 404 / 401 | Existing 404 / 404 / 401 |

A currently public item is independently visible to anonymous visitors, including
someone whose request was declined or deleted. Deleting a request does not make
that public item private. The unchanged application image URL is **not** a
request-scoped capability: each byte request rechecks current owner/public access.
Conversely, knowledge of an old URL or a readable conversation never restores
access after unlisting, expiration, deletion or invalid ownership. Giver ownership,
not giver participation, explains retained access to private Ready photos.

Permitted historical request text and closed message history retain their existing
rules. Missing/compromised references can make conversation history unavailable
under its existing stricter policy; D2 does not relax that or reopen requests.
There is no immutable historical photo archive or promise that the current cover
matches what was shown when a request was originally submitted.

## DTO, query and delivery bounds

Enabled GET detail adds D1-compatible `item.imageAvailability` (`ready`, `none`,
`unavailable`) and `item.coverImage` (null or `{id, thumbnail: {url, width, height}}`).
Only the first Ready photo is selected. No display variant, album, owner/private
storage metadata, signed provider URL, original filename, EXIF/GPS, quota or hash
is exposed. An absent item remains null. Disabled metadata/read gates omit media
fields entirely and perform no photo query, preserving existing deployments.
No new schema/index, migration, startup DDL, object or account write is introduced.

One additional aggregation matches the exact request/reference tuple, checks up
to two accounts, joins its one item/plan, and reads at most six Ready rows (the
sixth detects corrupt over-cap state). It uses snapshot reads, simple collation,
a five-second deadline and no disk spill. The extracted D1 validator keeps the
same dimension/order/binding checks for both public and pickup summaries.
Enrichment performs no S3 HEAD/GET or repairs. A query failure returns unavailable
media while preserving permitted request text; no raw error/provider body is logged.

Text serialization and media inspection are separate reads: concurrent reference
or visibility changes can leave a text snapshot while withholding media. Actual
byte delivery still authorizes before and after verified storage reads. It retains
private buckets, generic 404 denials, generic 503 for missing/corrupt bytes, WebP,
private/no-store, nosniff, no-referrer and same-site resource policy. No permission,
quota, cleanup, CSRF, image-control limit or uncertain-mutation rule changes.

Only one existing maximum-400px / 256 KiB thumbnail is requested per displayed
context; it is rendered at 96x72px with a fixed aspect ratio. No full display,
preload, gallery, polling or separate metadata HTTP request. Reloading costs a fresh
summary and thumbnail read because authorization freshness takes priority over
cache reuse; existing shared concurrency/rate limits remain unchanged. These are
resource bounds, not a throughput benchmark or production capacity claim.

## UX and recovery

The thumbnail sits beside the item name/status, with meaningful current-cover alt
text. Item name, appointment, controls and history remain usable with no photo or
failed pixels. Neutral No photo and Photo unavailable states make no fake product
claims. No metadata gate means the existing text-only layout. D1 URL/dimension
validation rejects malformed or external image URLs before rendering.

Image failure does not disable pickup actions. Failed request refresh retains
marked historical text and independently protected chat/scheduling drafts, while
hiding old photo pixels and preserving existing action lockout until refresh.
Loading also hides a previous cover. A successful Reload request obtains current
order/visibility and permits an explicit image retry; render loops do not retry
mutations or failed images. Session/account/request changes clear or re-scope the
private view. No extra dialogs or detached Photos panel.

Cover reordering/deletion uses current C2 state after refresh. Tombstones revoke
delivery before physical cleanup, and the next Ready photo becomes the cover.
D2 never performs cleanup, refunds quotas or writes read markers. Already
downloaded pixels cannot be erased from an open page/device; no realtime revocation
or cross-device notification is claimed.

## Actual local screenshots

The real strict production UI runs over isolated HTTPS with synthetic accounts,
an owned disposable MongoDB replica set, verified SeaweedFS and actual Sharp
variants. Colored synthetic fixtures demonstrate association/order and do not
pretend to depict real household items. Successful captures wait for decoded
pixels; intentional failures do not. Tall capture viewports avoid Chromium stitching
artifacts, while interactions/axe/reflow use normal desktop, 320px and 375px widths.

| State | Desktop | 320px |
| --- | --- | --- |
| Submit request context | [Form](verification/m65d2/desktop-request-form.png) | [Form](verification/m65d2/mobile-request-form.png) |
| Requester pending | [Pending](verification/m65d2/desktop-requester-pending.png) | [Pending](verification/m65d2/mobile-requester-pending.png) |
| Giver pending/actions | [Giver](verification/m65d2/desktop-giver-pending.png) | [Giver](verification/m65d2/mobile-giver-pending.png) |
| Accepted with formal proposal | [Accepted](verification/m65d2/desktop-accepted-proposal.png) | [Accepted](verification/m65d2/mobile-accepted-proposal.png) |
| Closed text with photo revoked | [History](verification/m65d2/desktop-closed-history.png) | [History](verification/m65d2/mobile-closed-history.png) |
| Item without photos | [None](verification/m65d2/desktop-no-photo.png) | [None](verification/m65d2/mobile-no-photo.png) |
| Broken thumbnail, available actions | [Error](verification/m65d2/desktop-thumbnail-error.png) | [Error](verification/m65d2/mobile-thumbnail-error.png) |

## Verification and remaining limits

The PR records exact complete backend/frontend/policy/build/local-HTTPS/axe/CI
results. Backend integration uses real stored variants for missing/corrupt-byte
cases and real pickup acceptance/cancellation/completion transitions, plus a
synthetic state matrix for every canonical state. It verifies history remains
read-only, expired sessions/nonparticipants, corrupt scopes, reference races,
disabled gates, no-photo data, optional query failure, one detail aggregation,
zero new list media queries and no S3 metadata reads. Existing D1 contracts exercise
the shared validator; all C1/C2/B1–B4 regressions remain in the complete suite.
Browser cases cover both participant roles, pending/accepted/closed/no-photo,
actual scheduling/message integration, authoritative reorder/deletion/unlisting,
HTTP failure, independent drafts, logout, keyboard and mobile reflow. Browser
network faults are not claimed as real storage corruption; backend contracts cover
actual missing/corrupt SeaweedFS variants.

No hosted E2E, remote Atlas/R2, production configuration, provider operation or
photo activation. No real Safari/iOS device or manual screen-reader certification.
Production photo gates remain disabled, with the same separately approved hosted
storage/index/recovery prerequisites. No additional rollout is needed for a
photo-disabled existing site. Rollback reverts D2 presentation/enrichment without
rewriting data; D1 delivery, C2 order and B4 tombstones remain authoritative. A UI
rollback alone does not revoke current public image access. Do not weaken delivery
or cache protections to work around missing thumbnails.
