# Milestone 6.5C2 — Owner photo management

Base: merged main `15c6926af397368642b2ec3aa220a2ed02dca821`, including
C1 workflow corrections (#65) and Item Classification (#66). Dedicated branch:
`codex/m65c2-owner-photo-management`.

## Audit and implementation boundary

B2 already implements owner-only versioned `POST .../images/order` and
`POST .../images/:imageId/actions` (`action: delete`). B3 supplies authenticated
owner thumbnails; B4 owns durable deletion, fencing, verified object absence and
accounting settlement. C1 supplies one labeled item submit followed by bounded
sequential uploads, tab-only selections, partial recovery and owner-card images.

C2 connects these existing APIs to the existing item editor. No backend runtime,
collection, index, storage key, provider configuration, publication rule, quota or
classification change is needed. No public photo response or pickup integration
is introduced. Public discovery/gallery remains D1; pickup images remain D2.
All image feature gates remain default-disabled. No remote preparation or
production activation is part of this work.

## Owner workflow

Ready thumbnails appear inside Edit Item with Up, Down, Make cover and Delete
controls. The owner card continues to show real authenticated thumbnails, with a
Cover label on the first. Photos may be changed while item text and selected
files remain unsaved: photo management commits independently, without resetting
the form or saving unrelated text. No separate photo administration panel or page
exists. The Add/Edit Save/Publish with N photos action and its sequential upload
pipeline are unchanged; there is no second initial upload confirmation.

Up/Down and Make cover submit the **complete** current ready-ID sequence and its
`imageRevision`. They are immediate explicit actions, not an unsaved reorder
buffer. Only Ready photos participate. Reordering does not rename objects or
change item versions, publication, pickup requests or appointments.

Cover is derived from the first Ready photo in server order, not a new field.
Make cover moves the selected photo to index zero, preserving every other photo's
relative order. Deleting the cover promotes the first remaining photo; deleting
an ordinary photo preserves the remaining order. Deleting the last leaves no
cover. Successful future uploads append after existing Ready photos and do not
silently replace their cover. Reload reads the same authoritative order.

Delete uses an accessible native modal with Keep photo initially focused,
explicit Delete photo, Escape/cancel, a focus trap and focus restoration. Cover
confirmation names the fallback. Selection removal (`Remove selection`) remains
a separate local-only C1 action. Every control resolves to the immutable image ID,
not a filename or a stale UI position. Completion focuses the moved photo, the
nearest remaining photo after deletion, or Photos when none remain.

## Concurrency, ambiguity and recovery

The client serializes photo controls with file preparation, binary transfer and
item submission. Busy controls cannot launch a competing mutation. Staged but
unsent files are retained when changing Ready photos. A different tab/instance is
still protected by backend transaction ownership and image revisions; stale
commands cannot overwrite newer order or membership.

Management records an in-memory item-scoped intent before POST, retained in the
inventory parent across editor remount/close. A failed, stale, rate-limited,
malformed or ambiguous result keeps Check photo changes available and blocks
further photo mutation/admission until review. There is **no automatic replay**
of an order/delete POST or an uncertain binary PUT.

Canonical recovery reads the scoped operation for deletion and the full current
Ready list. The status and membership must agree; a race between those reads
requires another check rather than a false success/presence claim. An order check
shows the current server order and says to review it when it differs from the
requested order. A read establishes current state, not realtime notifications or
a guarantee that an in-flight request elsewhere has stopped; revision fences
continue protecting subsequent explicit commands.

The owner UI removes a thumbnail only after an authoritative list excludes it;
a lost response alone never hides it. A failed verification read preserves the
last confirmed photos and unrelated files. Initial reads on remount can refresh
visibility, but do not replay or approve the pending operation. After full page
reload only server state survives: unsent files/text remain in memory only and
retain the existing beforeunload warning. No private drafts, operation markers,
credentials or tokens are persisted in localStorage.

A successful photo change never marks unrelated text saved. Existing text/photo
navigation protections remain independent. Session expiry clears the scoped
private UI; a late response from an unmounted account cannot update another
account's state. After a photo error, saving otherwise valid item text remains
possible; staged-file transfer still needs its existing secure admission/recovery.

## Logical deletion is not physical cleanup

A confirmed `delete_pending` tombstone revokes delivery immediately and removes
the photo from the Ready list. The UI reports Photo deleted. Cleanup pending.
B4 still owns physical deletion. Retained bytes and daily/retained-record quota
charges do not disappear on a UI action. Receipt-verified cleanup must establish
object absence and settle charges; refreshing known settled history clears the
pending message. No client control runs maintenance, deletes a bucket/object,
refunds quotas or bypasses cleanup receipts.

The existing 20/minute metadata limit remains unchanged. Tests start fresh local
apps per C2 browser case to exercise that real bound rather than raising it or
spoofing client IPs. UI quotas and 429 errors use the existing server responses;
recovery is manual, with no background polling or automatic request retry.

## Actual local visual evidence

Screenshots come from real HTTPS, synthetic accounts/photos, an owned disposable
MongoDB replica set and verified private SeaweedFS. Before uses the merged-main
production frontend; after uses the C2 strict production build. Capture waits
for actual image pixels; no generated mockups, injected UI styles or real personal
data. A tall capture viewport avoids Chromium's stitched-image fixed-link artifact;
interaction, reflow and axe checks use normal 320px/375px/desktop viewports.

| State | Desktop | 320px |
| --- | --- | --- |
| Before C2 | [Before](verification/m65c2/desktop-before.png) | [Before](verification/m65c2/mobile-before.png) |
| Editing Ready photos | [Initial](verification/m65c2/desktop-initial.png) | [Initial](verification/m65c2/mobile-initial.png) |
| Cover and order changed | [Reordered](verification/m65c2/desktop-reordered.png) | [Reordered](verification/m65c2/mobile-reordered.png) |
| Ordinary photo deleted | [Deleted](verification/m65c2/desktop-ordinary-deleted.png) | [Deleted](verification/m65c2/mobile-ordinary-deleted.png) |
| Cover delete confirmation | [Confirmation](verification/m65c2/desktop-delete-confirmation.png) | [Confirmation](verification/m65c2/mobile-delete-confirmation.png) |
| Cover fallback after delete | [Fallback](verification/m65c2/desktop-cover-deleted.png) | [Fallback](verification/m65c2/mobile-cover-deleted.png) |
| Thumbnail load failure | [Unavailable](verification/m65c2/desktop-thumbnail-unavailable.png) | [Unavailable](verification/m65c2/mobile-thumbnail-unavailable.png) |
| Uncertain response with drafts | [Recovery](verification/m65c2/desktop-uncertain.png) | [Recovery](verification/m65c2/mobile-uncertain.png) |

## Verification and limits

The PR records exact backend/frontend/policy/build/local-browser/axe/CI results.
Tests cover ordinary/cover deletion, persistent Up/Down/cover order, cross-instance
stale updates, upload/deletion races, status-read races, uncertain responses,
remount recovery, independent drafts, session expiry, owner/item isolation,
keyboard focus, narrow layouts and receipt-verified physical cleanup/accounting.
The full existing C1, classification, inventory, discovery, pickup, chat and
rescheduling regressions remain in place, including all 49 storage tests and the
16 unchanged demo gifts.

No drag-and-drop, public gallery, pickup photo attachment, polling or remote E2E.
No real Safari/iOS keyboard or manual screen-reader certification is claimed.
Fresh reads can lag concurrent changes until the next explicit refresh; unknown
outcomes require review. Production storage and scheduled maintenance activation
still require a separate approved rollout. Merging C2 does not provide hosted
uploads or run cleanup automatically.
