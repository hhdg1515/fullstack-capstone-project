# 6.5C1 — Owner photo selection, preview and upload

Base: merged main `dc50e5fac07518a3c0effb733c2b5c5c9c530422`, PR #63 merged.
Branch: `codex/m65c1-owner-photo-upload`.
The [architecture](milestone-6.5-photo-architecture.md),
[security/lifecycle policy](milestone-6.5-security-and-lifecycle.md),
[B1 storage](milestone-6.5b1-storage.md), [B2 metadata](milestone-6.5b2-photo-metadata.md),
[B3 processing](milestone-6.5b3-image-pipeline.md) and
[B4 recovery](milestone-6.5b4-photo-recovery.md) remain the backend contract.

## Owner interaction

Choose **Photos** on an existing saved inventory item. Unsaved items explicitly
require saving first. Opening photos does not save text, create an item, change
publication or require a photo for publication. The existing repeated-add form
still resets/focuses the next name after an explicit save.

The small photo panel uses existing design tokens, Surface/Feedback, native file
input and buttons. Select up to five photos including saved/held spaces; each
file is 1–3,145,728 bytes. JPEG, PNG and static WebP only; HEIC/HEIF needs export
as JPEG. Picker MIME/extension and a successful preview are guidance, never image
safety evidence. B3 still validates actual content, pixels/depth/animation, strips
metadata, orients and verifies both sanitized outputs before ready.

The visible privacy reminder names addresses, labels, documents and people:
removing metadata does not hide visible details or replace permission. Local
previews use temporary object URLs and browser orientation where supported. No
filename appears in a preview label; no stock photo, upload URL or provider key
is rendered. Local preview failure is distinct from server validation failure.

**Selection never uploads automatically.** Choose Upload photo for each queued
file; one active upload per panel, no hidden upload queue. Posted-item changes
retain an explicit visibility confirmation. Real transfer progress describes
multipart bytes; 100% changes to waiting/processing, not upload success. Ready
requires a valid server operation result. Saved thumbnails use only the fixed
application image path, credentialed reads and current B3 authorization.

Text and file drafts remain independent. Text editor switches/refreshes use
their own guard; closing/switching a photo panel uses only its file guard. Global
navigation/reload/logout retains the existing combined unsaved protection.
Completion/removal/close/unmount revokes object URLs; account/item changes clear
private selections and suppress old async results before another request or UI
update. Late 401 responses from an old scope cannot log out the new account.
There is no localStorage/IndexedDB binary, private draft or upload-ID persistence.
Selected files can be lost on reload; canonical server history remains visible.

## Capabilities and production isolation

There are four separate facts: UI is rendered; metadata is available; binary
upload/read routes are available; an operation is ready. None implies another.

- Owner GET metadata now reports `capabilities: {metadata, binaryUpload,
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
| GET image-list `capabilities` | Actual metadata/binary/read route capabilities, as above |
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
| Server ready + failed metadata refresh | Ready was confirmed, but the collection is unavailable. Do not show a fake empty photo collection; explicitly refresh |
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
real progress vs ready, all quota classes, stale revisions, duplicate clicks,
ambiguous PUT and reservation recovery, same-UUID explicit retry, definitive
busy rejection, session/account/item changes, URL cleanup and independent guards.
Native backend tests cover safe allowances (including read-only expiry preview),
UUID ownership/privacy/recovery and truthful sealed-pipeline capability.

The isolated production-build HTTPS browser spec uses actual sessions, MongoDB,
Sharp and private SeaweedFS. It verifies real pixels, exact reservation/PUT and
quota counts, lost-result recovery, invalid raster feedback, private access,
text-draft retention, desktop/mobile, and scoped teardown. Default-off controls
are also tested against the real app with no injected binary pipeline. Existing
B1/B2/B3/B4, pickup/chat/rescheduling, policy and all **111 existing axe checkpoints**
remain; new photo checks cover 320/375/390/768/1440 CSS pixels. No hosted E2E.

Actual local synthetic UI captures, reviewed visually (PNG files, not mockups):

| State | Desktop | 320px mobile |
| --- | --- | --- |
| Selection / local preview | [Desktop](verification/m65c1/desktop-selected.png) | [Mobile](verification/m65c1/mobile-selected.png) |
| Bytes sent / awaiting confirmation | [Desktop](verification/m65c1/desktop-processing.png) | [Mobile](verification/m65c1/mobile-processing.png) |
| Confirmed ready thumbnail | [Desktop](verification/m65c1/desktop-ready.png) | [Mobile](verification/m65c1/mobile-ready.png) |
| Lost success / explicit recovery | [Desktop](verification/m65c1/desktop-uncertain.png) | [Mobile](verification/m65c1/mobile-uncertain.png) |
| Real server image rejection | [Desktop](verification/m65c1/desktop-failed.png) | [Mobile](verification/m65c1/mobile-failed.png) |
| Default-disabled backend | [Desktop](verification/m65c1/desktop-disabled.png) | [Mobile](verification/m65c1/mobile-disabled.png) |

All account/listing/image content is synthetic; solid-color inputs prove real
processing and are not presented as photographs of real offered goods. No
credentials, cookies, tokens, filenames or private provider details are captured.
Some long Chromium captures composite the existing fixed skip link inside the
page. Read-only capture diagnostics confirmed it was unfocused and its DOM
rectangle was above the viewport (`top: -80px`); it did not cover the live UI.
The captures retain this browser artifact rather than hiding an accessibility
control or changing application styles for evidence.
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
PHOTO_UI_EVIDENCE_DIR="$PWD/docs/verification/m65c1" npm --prefix e2e test -- owner-photo-upload.spec.cjs
```

Use the existing Chromium setup/Playwright commands. No `.env`, R2 or Atlas
credential is needed. Never set hosted E2E variables for these local photo tests.
Fixtures close only their receipt-owned resources; no Docker prune/remote cleanup.

## Deferred work and rollback

C2 owns reordering, cover changes and owner deletion controls. C1 adds none.
Public cover/gallery/inventory-card enrichment, pickup thumbnails, hosted/R2
activation, remote index preparation and recurring cleanup/retention remain later
approved work. Unknown B4 writes can retain capacity permanently; C1 does not
hide or refund those holds. All 16 legacy demo gifts remain byte-identical.

Rollback the UI before the additive API fields/lookup; keep B4-compatible ledger,
quotas and maintenance capabilities. Old metadata servers missing the new
structured capability/allowance fail closed in the new UI. Do not enable deployed
uploads, drop metadata/indexes or alter storage bindings to repair the interface.
