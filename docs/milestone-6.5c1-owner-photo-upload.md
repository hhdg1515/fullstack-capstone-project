# 6.5C1 — Owner photo selection, preview and upload

Base: merged main `dc50e5fac07518a3c0effb733c2b5c5c9c530422`, PR #63 merged.
Branch: `codex/m65c1-owner-photo-upload`.
The [architecture](milestone-6.5-photo-architecture.md),
[security/lifecycle policy](milestone-6.5-security-and-lifecycle.md),
[B1 storage](milestone-6.5b1-storage.md), [B2 metadata](milestone-6.5b2-photo-metadata.md),
[B3 processing](milestone-6.5b3-image-pipeline.md) and
[B4 recovery](milestone-6.5b4-photo-recovery.md) remain the backend contract.

## Owner interaction

Photos are optional **inside Add/Edit item**, next to the existing text fields.
An empty plan opens the first form; populated plans show existing cards first.
The explicit primary action names the selected prepared batch: **Publish with
3 photos**, **Save draft with 3 photos**, or **Save changes with 3 photos**.
Without photos, the existing simple save/publish controls remain. Every successful
save closes creation fields; **Add item** explicitly starts another item.

Selecting with **Add photos** prepares private previews in this tab. The labeled
submit authorizes the item save and its selected photos together. Internally the
item is saved first and its authoritative ID/plan/version is validated; only then
can the existing sequential pipeline reserve and upload the captured selection.
There is no second initial Upload button or per-photo visibility dialog. Existing
pickup-cancellation confirmations still apply when an edit affects requests.

A tab-only submit intent binds the exact selected UUIDs to the returned item ID.
The parent consumes it synchronously before async photo work. Status refreshes,
rerenders and component remounts cannot replay the intent. Initial metadata
failure also consumes it without uploading; after a successful manual read, the
owner explicitly chooses **Upload remaining N photos**. That action continues
only eligible files. Ambiguous PUTs still require canonical status checks and
cannot be automatically resent. Each file retains its own reservation, progress,
idempotency and recovery state; the batch stops on failure or uncertainty.

**Publication/save success is independent of photo success.** The item remains
saved/published if a photo fails, with accurate item status and per-photo feedback.
Ready thumbnails appear on the corresponding **owner inventory card**, even when
the editor is closed. Confirmed thumbnails and unrelated selections survive
recoverable failures. Status checks and Refresh photos operate in that item's
context. These actions do not recreate or republish the item. No cover, reorder,
saved-photo deletion or public gallery controls are included.

An ambiguous new-item save freezes repeat creation and starts no photo upload.
The owner refreshes inventory and explicitly selects the actual saved card,
confirming replacement of unsaved text while keeping files. A labeled submit then
saves that existing item and authorizes its photos. No guessed name match,
automatic second POST or invisible autosave is used. This is not server-side
item-create idempotency: after a full reload or when choosing a separate new
draft, owners must review inventory before creating again.

The compact Photos section uses a count, previews and short buttons. Progress
appears only during preparation/transfer/processing; Ready requires an actual
server result. Photo tips is an accessible collapsed disclosure. It reminds
owners to remove visible addresses, labels, documents and identifying people;
metadata removal is not visual redaction. No private filename, operation ID,
hash or storage key appears in the interface.

## Draft and navigation protection

The stable inventory session owns file entries/object URLs separately from item
text. Binding a saved ID or refreshing inventory does not discard files. Text
edits made later remain protected independently of completed photo work.

For in-app navigation, editor switching/closing and logout, meaningful unsent
photos use a native accessible dialog with **Stay and keep photos** (initial
focus) and **Leave and discard photos**. Escape stays; Tab/Shift+Tab remain inside;
focus returns to the initiating control. If text will also be lost, the dialog
says so. A generic OK/Cancel prompt never silently discards photos. Cancelling a
later business action or a failed logout leaves guards/files intact. Native
confirmation for unrelated text-only drafts remains unchanged.

Leaving during upload aborts this browser's transfer/continuation. Work already
accepted by the backend may still finish, and the dialog states this. Durable
status/quota/recovery rules remain authoritative; local discard does not delete
server objects or refund quota. When all photos are confirmed Ready or explicitly
discarded, the photo guard is removed. A decision dialog open when work completes
closes and stays on the item; unrelated text remains protected. Session/account
changes clear private state and dismiss decisions without holding logout/expiry
open. Old async responses cannot affect the new identity.

No files/private drafts/upload IDs are persisted in localStorage/IndexedDB.
**Reloading/closing the tab loses unsent files**; visible guidance and the native
beforeunload prompt warn about this. Browsers control that prompt's wording and
may not show it in every shutdown scenario. Object URLs are revoked on confirmed
completion, explicit discard or scope teardown. No claim is made that files
survive a full reload.

## Local browser preparation

[photoPreparation.js](../giftlink-frontend/src/api/photoPreparation.js) performs
local bandwidth reduction before hashing/reserving. The server receives **only
the new derivative**, never the original as a fallback, even for small inputs.

| Boundary | Limit / behavior |
| --- | --- |
| Source file | JPEG, PNG or static WebP; 1 byte–20 MiB; up to 48 megapixels and 10,000 pixels per edge |
| Pre-decode check | At most 512 KiB of header; reject unsupported/unreadable dimensions and detected animation before native decoding |
| Derivative | Orientation-aware Canvas re-encode; at most 1280px longest edge, at most 3 MiB (3,145,728 bytes) |
| Compression | At most three size/quality attempts, one file being prepared at a time; bounded read/decode/encode deadlines |
| Formats | JPEG stays JPEG; PNG/WebP use WebP with alpha; bounded PNG encoder fallback allowed |
| Failure | Preserve other selections; show conversion/resize guidance; never reserve or send the original |

HEIC/HEIF is unsupported and must be exported as JPEG. No conversion dependency
is added. `accept`, MIME and header checks are preliminary client guidance;
**Sharp remains authoritative** for content validation, pixel/depth/animation
checks, orientation, metadata removal and both ready variants. The 3 MiB streamed
backend cap and all multipart, native resource, privacy and security limits stay
unchanged. Browser-selected compression cannot bypass them.

Canvas output quality/format and orientation/color handling vary across browsers;
older browsers without createImageBitmap fail closed. Preparation needs a current
browser, and WebCrypto needs HTTPS/localhost. Deadlines stop client continuation
and dispose late decoded bitmaps; JavaScript cannot forcibly stop native decoder
work or guarantee a fixed device-memory ceiling. Source caps reduce exposure but
large files may still fail on low-memory devices. The browser-generated preview
is the prepared derivative, not a promise that server validation will succeed.
Physical Safari/iOS/Android pickers, device memory and mobile keyboards have not
been manually certified; Chromium emulation is documented below.

## Capabilities and production isolation

There are four separate facts: UI is rendered; metadata is available; binary
upload/read routes are available; an operation is ready. None implies another.

- Owner GET inventory and GET metadata report `capabilities: {metadata, binaryUpload,
  imageRead}`. Binary/read are true **only** when the existing sealed, verified
  local pipeline is actually injected and those routes exist.
- The historical `binaryUploadsEnabled:false` deployed-product gate remains
  unchanged. C1 uses the structured, route-specific local capabilities; it does
  not reinterpret that legacy product flag or enable deployment configuration.
- Metadata off returns the existing API 404: the UI explains uploads are not
  enabled and disables selection/upload. It does not invent an empty collection.
- Metadata on + binary unavailable still permits truthful owner metadata/history,
  with file selection/upload disabled and no working button aimed at a missing
  endpoint. Image reads are independently gated.
- `ITEM_IMAGE_PIPELINE_ENABLED` must still be unset/exactly false. Existing
  metadata/index preparation, default-disabled startup and B1 fixture branding
  remain. No frontend/environment override enables deployed binary routes.

No R2 provider, credentials, remote MongoDB/index preparation, public gallery,
hosting change, worker, retention or deployment is included. Production photo
activation still needs separately approved storage/hosting/rollout verification.
The B3 upstream-body-buffering/native resource gates remain unresolved by C1.

## Minimal owner API additions

Existing routes/response fields remain. These additions are authenticated,
owner-scoped and no-store; public item/user/gift DTOs do not gain quota fields.

| Addition | Meaning and boundary |
| --- | --- |
| GET inventory `photoCapabilities` / image-list `capabilities` | Actual metadata/binary/read route capabilities, as above |
| GET inventory item `photoPreview` | Bounded ready-only owner thumbnail summaries in the existing snapshot query; validate all ownership, binding, ordering and revisions; distinguish none/disabled/unavailable; no per-card metadata requests or storage I/O |
| GET image-list `allowance` | Available item spaces, daily attempts/uploads, bytes, concurrency and operation-record capacity; `newUploadsAllowed` uses current server plan/item/deadline rules |
| GET `…/images/uploads/:clientUploadId` | Read-only canonical operation lookup for the same authenticated owner, plan/item and normalized random UUID; recovers a lost reservation response without another POST |

Allowance is an admission snapshot, not a capacity guarantee or raw account
quota document. MongoDB server time drives UTC-day calculation. It projects only
the same at-most-two expired **never-claimed** reservations that B2 can safely
reap in an actual reservation transaction; GET does **not** persist reaping,
release a charge, initialize a quota or perform storage/index I/O. Processing/
unknown/partial holds remain charged. Missing/corrupt accounting fails closed.
The versioned reservation rechecks all limits and performs any safe reaping
atomically. No quota threshold, accounting or index registry changes.

UUID lookup reuses the existing unique item/upload index, validates native
references/ownership/storage binding, and returns the same safe operation DTO as
ID lookup. No hashes, keys, target fingerprints, account IDs, filenames or raw
provider diagnostics are returned. A UUID is not an authorization capability.

## Transport and recovery

The dedicated [photo helper](../giftlink-frontend/src/api/itemImages.js) uses the
existing backend URL, credentialed JSON/session conventions and CSRF header.
SHA-256 uses secure browser WebCrypto; client UUIDs use `crypto.randomUUID`.
Unsupported crypto requires a current browser over HTTPS/localhost; there is no
weak random/hash fallback. JSON reservation contains only current photo revision,
stable upload UUID, byte length and hash. File bytes use one FormData/XHR PUT,
generic `photo.bin` filename, native multipart boundary and credentialed cookies.
Its 45-second upload timeout does not replace B3's byte/native/lease/storage caps.

JSON reads retain the existing 15-second bound. A last authoritative metadata
snapshot supplies the versioned reservation; completion refreshes it. Avoiding
an extra pre-reservation GET lets repeated uploads stay within the unchanged
20/minute control rate. Stale revisions produce explicit refresh feedback.
No background polling, automatic reservation retry or automatic binary retry.
Untrusted error bodies are mapped to bounded, actionable messages, not displayed
verbatim. Quota/history errors distinguish UTC-day limits from operator-review
limits that waiting cannot fix.

| Outcome | User recovery |
| --- | --- |
| Reservation response lost, UUID known | Check status by UUID; recover its canonical ID and continue only if still unused/eligible |
| Explicit UUID lookup finds no operation | User may retry **the same** reservation UUID/intent; no automatic replacement or new ID. This browser has not sent content yet |
| PUT timeout/network/503/malformed result | Retain local file and operation. Check canonical status; never resend that possibly accepted content |
| Definitely rejected pre-claim 429 busy/control limit | Check status successfully first; only a still-reserved operation permits an explicit manual same-reservation retry |
| Server processing/202 | Show current processing, manual status/refresh and possible operator recovery; no invented completion |
| Failed / cleanup pending | Preserve the selected file and history; state capacity may remain held. Removing a local selection does not delete server data or refund anything |
| Server ready + failed metadata refresh | Keep a validated ready thumbnail and other selections; stop admission until an explicit metadata refresh succeeds. If the ready response lacks safe dimensions, keep the local preview pending that read |
| Expired session / scope change | Clear private previews, stop follow-on steps, abort the in-flight XHR and let the durable server ledger govern any already accepted work |

Chromium was observed to transparently replay an idempotent HTTP PUT after an
abrupt socket close. C1 schedules no such retry, but cannot prohibit a browser's
HTTP transport behavior. The unchanged B3 durable claim/generation/one-PUT-per-key
boundary prevents a second decode/storage write or quota charge. Deterministic
browser uncertainty tests discard the *real* successful upstream reply after
DB/S3 completion and return a sanitized gateway 503. This exercises application
recovery without confusing a browser transport retry with application retry.
No successful response, capability or stored object is fabricated by that harness.

## Verification and visual evidence

Frontend transport/component tests cover selection, hashing, safe multipart,
pre-save selection, derivative-only upload, one labeled save/publish, partial
success, lost item-save review, custom navigation focus/choices, real progress vs ready, all quota classes, stale revisions, duplicate clicks,
ambiguous PUT and reservation recovery, same-UUID explicit retry, definitive
busy rejection, session/account/item changes, URL cleanup and independent guards.
Native backend tests cover safe allowances (including read-only expiry preview),
UUID ownership/privacy/recovery, truthful sealed-pipeline capability and owner-card
thumbnail association/corruption denial. Disabled mode never queries itemImages.

The isolated production-build HTTPS browser spec uses actual sessions, MongoDB,
Sharp and private SeaweedFS. It verifies real pixels, exact reservation/PUT and
quota counts, lost-result recovery, large-source compression, local invalid raster feedback, private access,
text-draft retention, desktop/mobile, and scoped teardown. Default-off controls
are also tested against the real app with no injected binary pipeline. Existing
B1/B2/B3/B4, pickup/chat/rescheduling, policy and all **111 existing axe checkpoints**
remain; new photo checks cover 320/375/390/768/1440 CSS pixels. No hosted E2E.

Actual local synthetic UI captures, reviewed visually (PNG files, not mockups):

| State | Desktop | 320px mobile |
| --- | --- | --- |
| Empty panel | [Desktop](verification/m65c1-unified/desktop-empty.png) | [Mobile](verification/m65c1-unified/mobile-empty.png) |
| Selection before item save | [Desktop](verification/m65c1-unified/desktop-selected.png) | [Mobile](verification/m65c1-unified/mobile-selected.png) |
| Bytes sent / awaiting confirmation | [Desktop](verification/m65c1-unified/desktop-processing.png) | [Mobile](verification/m65c1-unified/mobile-processing.png) |
| Confirmed ready thumbnail | [Desktop](verification/m65c1-unified/desktop-ready.png) | [Mobile](verification/m65c1-unified/mobile-ready.png) |
| Lost success / explicit recovery | [Desktop](verification/m65c1-unified/desktop-uncertain.png) | [Mobile](verification/m65c1-unified/mobile-uncertain.png) |
| Local invalid image rejection | [Desktop](verification/m65c1-unified/desktop-failed.png) | [Mobile](verification/m65c1-unified/mobile-failed.png) |
| Lost item-save recovery | [Desktop](verification/m65c1-unified/desktop-save-recovery.png) | [Mobile](verification/m65c1-unified/mobile-save-recovery.png) |
| Leave/discard decision | [Desktop](verification/m65c1-unified/desktop-leave-dialog.png) | [Mobile](verification/m65c1-unified/mobile-leave-dialog.png) |
| Published item / partial batch | [Desktop](verification/m65c1-unified/desktop-published-partial.png) | [Mobile](verification/m65c1-unified/mobile-published-partial.png) |
| Default-disabled backend | [Desktop](verification/m65c1-unified/desktop-disabled.png) | [Mobile](verification/m65c1-unified/mobile-disabled.png) |

All account/listing/image content is synthetic; solid-color inputs prove real
processing and are not presented as photographs of real offered goods. No
credentials, cookies, tokens, filenames or private provider details are captured.
The refreshed captures show the real Add/Edit form or saved inventory card,
without injected screenshot styles. Tall forms use a taller capture viewport
to avoid Chromium painting an offscreen fixed skip link into element captures;
layout/axe checks still run at the normal test viewport. Photos are in context with the item; the
submit action clearly includes the selected photos; saved-item processing/recovery
is immediately visible. Ready card thumbnails remain after the
editor closes. Two selections fit at 320px; controls retain accessible labels and
44px targets. Selected-file Remove affects only in-memory files, not server data.

Comparison with the prior two-step workflow (immutable commit):
[Desktop selection](https://github.com/hhdg1515/fullstack-capstone-project/blob/4a4376501b769115010d8c9ea4bbf4971ccd6e8d/docs/verification/m65c1-workflow/desktop-selected.png),
[320px saved-item Upload step](https://github.com/hhdg1515/fullstack-capstone-project/blob/4a4376501b769115010d8c9ea4bbf4971ccd6e8d/docs/verification/m65c1-workflow/mobile-saved-pending.png).
Earlier evidence remains under `verification/m65c1/` and
`verification/m65c1-workflow/` for comparison.

The Docker-dependent normal CI jobs use Ubuntu 24.04, the runtime verified by
the prior successful CI (Docker 28/overlay2). During this correction,
ubuntu-latest moved to Ubuntu 26.04/Docker 29/containerd; the unchanged fixture
rejected its image identity at `image_assertion_193` before creating storage
resources. Pinning the verified runner retains every digest, image/receipt and
cleanup assertion. Future Docker/containerd support requires a separate fixture
compatibility review; the check is not bypassed.

Exact test totals, immutable commit and GitHub CI evidence are recorded in the
PR. Physical Windows/macOS/Safari/iOS picker, screen reader and mobile keyboard
behavior are not certified by Chromium emulation or axe.

From repository root, Node 22 + existing local Linux/amd64 Docker:

```sh
npm --prefix giftlink-backend run lint
npm --prefix giftlink-backend test
CI=true TZ=America/Los_Angeles npm --prefix giftlink-frontend test -- --watchAll=false --runInBand
CI=true REACT_APP_BACKEND_URL= npm --prefix giftlink-frontend run build
npm --prefix e2e run test:policy
npm --prefix e2e test
```

Optional screenshot regeneration from repository root during the isolated photo
spec only (the absolute path is required because npm runs the spec in `e2e/`):

```sh
PHOTO_UI_EVIDENCE_DIR="$PWD/docs/verification/m65c1-unified" npm --prefix e2e test -- owner-photo-upload.spec.cjs
```

Use the existing Chromium setup/Playwright commands. No `.env`, R2 or Atlas
credential is needed. Never set hosted E2E variables for these local photo tests.
Fixtures close only their receipt-owned resources; no Docker prune/remote cleanup.

## Deferred work and rollback

C2 owns reordering, cover changes and owner deletion controls. C1 adds none.
Public cover/gallery, pickup thumbnails, hosted/R2
activation, remote index preparation and recurring cleanup/retention remain later
approved work. Unknown B4 writes can retain capacity permanently; C1 does not
hide or refund those holds. All 16 legacy demo gifts remain byte-identical.

Rollback the UI before the additive API fields/lookup; keep B4-compatible ledger,
quotas and maintenance capabilities. Old metadata servers missing the new
structured capability/allowance fail closed in the new UI. Do not enable deployed
uploads, drop metadata/indexes or alter storage bindings to repair the interface.
