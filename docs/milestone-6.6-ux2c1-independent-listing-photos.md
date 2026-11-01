# Milestone 6.6 UX-2C1 — Private photos for independent (Item-first) drafts

Branch: `claude/m66-ux2c1-independent-listing-photos`, from main `8e50116`
(PR #80 merged). This branch is new work. An earlier, unpushed C1 attempt
by another agent was never available to this branch.

## Scope

Owners of independent v2 drafts (`listingSchemaVersion: 2`) can add, view and
delete private photos. The work reuses the existing photo pipeline unchanged:
browser preparation, quotas, leases, immutable conditional PUTs, Sharp
sanitization, private storage, logical deletion and verified cleanup.

Not in scope, and still unavailable:

- public v2 photos (public card/detail delivery);
- requester/pickup thumbnails for v2;
- v2 publication;
- production activation of any of the above.

No hidden plan is created, no record is migrated, and no index changes.

## Data contract

| Format | Parent | Fields |
| --- | --- | --- |
| `itemImages.schemaVersion: 1` (unchanged) | legacy plan item | Exact existing field set, including `planId`. |
| `itemImages.schemaVersion: 2` (new) | independent v2 item | The same field set **without** `planId`. Same storage key layout (`namespace/id/generation/variant.webp`), charges, lease and cleanup fields. |

- `item-image-policy.validOperation` accepts exactly these two shapes and
  nothing else.
- Plan-scoped consumers (public card/detail media, pickup thumbnails, plan
  inventory previews) use `assertLegacyOperation`, so a schema 2 row is
  rejected as damaged there and never interpreted as a plan row.
- Rows are never rewritten from one schema to the other.

## Transactions and admission

- **Item fence.** V2 photo writes run in a snapshot/majority transaction that
  compare-and-increments the item's own `coordinationRevision`. This is the
  same fence UX-2B2 draft edits use. A concurrent draft PATCH and photo
  reservation therefore serialize (write conflict, then the driver's bounded
  retry); neither is lost. The F4 photo-control fence still runs inside that
  transaction.
- **Admission.** Binary intake (reserve and content PUT) requires that:
  - the item is not `cleared`;
  - the item resolves through `resolveListingContext`: `ownerDraft` for
    drafts, `strict` otherwise;
  - it has an explicitly confirmed IANA zone and a pickup deadline (policy 2
    tuple);
  - the database transaction time is before `expiresAt`.

  Otherwise `409 IMAGE_LISTING_DEADLINE_REQUIRED` is returned before any
  charge.
- **Context changes.** If the zone or location changes after a reservation,
  the confirmation is cleared and the content PUT is refused
  (`IMAGE_UPLOAD_UNAVAILABLE`) before any claim. The reservation stays held
  until it is reaped; there is no refund on refusal.
- **Unchanged quota rules.** Account/day/lifetime quota, the five-photo slot
  limit, the eight-call storage budget and exact-once settlement are shared
  with v1 and unchanged.

## API and gates

| Route | Behavior |
| --- | --- |
| `GET/POST /api/items/:itemId/images[...]` | Same handlers as `/api/move-out-plans/:planId/items/:itemId/images`, mounted with `independent: true`: list, status, lookup, reserve, order, delete and content PUT. Only the authenticated owner's v2 item and its schema 2 rows match. Everything else returns the same `404 IMAGE_UNAVAILABLE`. |
| `GET /api/item-images/:id/:variant` | Schema 2 rows are delivered only to their live owner, and only while the independent photo gate is on. Anonymous users, other accounts and a disabled gate all get `404`. |
| `GET /api/me/items[/:id]` | Adds `photoCapabilities` (server-decided). A v2 `photoPreview` lists the item's own schema 2 rows. `capabilities.photos` is true only for drafts with the gate on. |

**Gate:** `OWNER_LISTING_PHOTOS_ENABLED`, default **false**.

- It requires `OWNER_LISTINGS_ENABLED=true` and `ITEM_IMAGE_METADATA_ENABLED=true`;
  startup refuses otherwise.
- With the gate off, routes return `503 OWNER_LISTING_PHOTOS_DISABLED`, and
  existing v2 photos are not delivered, even to their owner.
- Legacy plan photos are unaffected by this gate.
- `localEnvironment({ photos: true, ownerListings: true, ownerListingPhotos: true })`
  enables it locally.

## Cleanup, recovery and restore

- **Recovery** (`item-image-recovery`) verifies a schema 2 operation against
  its owner and, if the item still exists, requires a same-owner v2 item with
  no `planId`. A schema 2 row whose item became another owner's or a legacy
  item blocks with `integrity`. Ticket transitions also compare
  `schemaVersion`.
- **F5 restore analysis** (`test/helpers/local-photo-restore.js`) now
  validates the schema 2 reference graph (owner, then v2 item, no plan)
  instead of reporting every schema 2 row as an ownership conflict.

## Frontend

- **Create/Edit Listing** (`ListingForm`) embeds the existing `ItemPhotos`
  session with `planId={null}`. The API client then targets
  `/api/items/:itemId/images`.
- **One explicit submit.**
  - The button reads **Save draft with N photos**.
  - Text is saved first, by POST or versioned PATCH.
  - Only then are the staged, browser-prepared files reserved and uploaded,
    sequentially, to the saved item ID.
- **Validation before any save or upload.** If photos are staged but the
  deadline or timezone confirmation is missing, field errors appear first
  ("Add a pickup deadline to save photos.", "Confirm the pickup timezone to
  save photos."). Files stay staged.
- **Partial failure.**
  - The saved text is locked: no second create.
  - The page shows "Draft saved. Some photos still need attention."
  - Recovery uses the existing explicit controls: Check status, Upload
    remaining N, Refresh. A lost response is resolved by status read and
    never by replay.
  - When the last photo settles, the page navigates to the canonical detail.
- Leaving with unsent photos uses the existing accessible photo dialog.
  Account changes discard previews; late responses cannot navigate the new
  account.
- The private detail shows owner thumbnails. My Listings shows the cover.
  Without the server capability, no photo controls render and the original
  "Save Draft" UI is unchanged.

## Related fix

`listing-deadline.resolveDeadline` previously required the stored
`timeZoneRulesVersion` to equal the current runtime's
`temporal-…/tz-<process.versions.tz>`.

- **Problem.** `engines` is `22.x`, so a Node patch release with newer tz data
  made every confirmed v2 draft unreadable (`409 LISTING_CONTEXT_INVALID`).
  This affected the owner feed, detail, PATCH and photo admission.
- **Fix.** A well-formed recorded label from another tz build is now accepted
  only when the current rules reproduce exactly the stored exclusive
  `expiresAt`. A real rules change for that zone/date, a malformed label or
  a tampered instant still fails closed.

## Verification (local Windows, Docker Desktop containerd store)

| Suite | Result |
| --- | --- |
| New backend `test/independent-listing-photos.test.js` (real MongoDB + SeaweedFS + Sharp) | 8 passing |
| New recovery cases in `test/item-image-recovery.test.js` (physical cleanup and integrity refusal for schema 2) | 2 passing, plus legacy regressions run alongside |
| Frontend unit (`CI=true TZ=America/Los_Angeles`) | 31 suites, 517 passing (adds `ListingPhotos.test.js`, 6 cases) |
| Strict production build (`CI=true`) | compiled successfully |
| Browser (local HTTPS Chromium, desktop 1440 and Pixel 7 375): `listing-photos-c1`, `owner-photo-upload`, `listing-acceptance-f4` | 14 passing, 0 failing |
| Full backend (`mocha --recursive test`) | Summarized in the PR description. Windows-only environment failures (symlink EPERM, `npm.cmd` spawn, SIGKILL signal reporting) are listed separately from code results. |

Screenshots: [docs/evidence/ux2c1](evidence/ux2c1). Each was captured after
the axe WCAG 2.1 AA check passed.

- deadline-required
- staged
- saved-detail
- my-listings
- edit-after-delete

## Limitations and rollback

- **Not exposed yet.** V2 photos are owner-only. Public, pickup and requester
  media for v2 is a UX-2C3 decision. Reordering via the API works for v2,
  but there is no reorder UI (UX-1 removed it).
- **Expired reservations.** A reservation refused after a context change
  stays charged until the existing reaper settles it. Cleanup of `delete_pending` schema 2
  rows uses the existing operator tooling.
- **Rollback.**
  - Turn `OWNER_LISTING_PHOTOS_ENABLED` off. This stops intake and owner
    delivery immediately.
  - Keep the schema 2 validator and recovery support deployed as long as any
    schema 2 row exists. Never delete or convert those rows to roll back.
  - An older build without schema 2 support treats such rows as damaged.
    That means the owner's photo quota accounting reports
    `IMAGE_METADATA_INVALID` instead of mis-settling, so do not downgrade
    below this release once rows exist.

## Handoff

- **Key modules:**
  - `services/item-images.js`: `planId === null` selects the v2 model, with
    `itemTransaction`, `independentContext` and `independentAdmission`.
  - `services/item-image-policy.js`: `operationSchemas`,
    `assertLegacyOperation`.
  - `routes/itemImageRoutes.js` (`independent` option) and
    `routes/ownerListingRoutes.js` (mount, gate, `photoCapabilities`).
  - `services/item-image-delivery.js` (owner-only schema 2 branch) and
    `services/item-image-recovery.js`.
  - Frontend: `components/Listings/ListingForm.js`,
    `components/Listings/Listings.js`, `api/itemImages.js` (`planId` null
    root).
- **Run:**
  - backend: `npm --prefix giftlink-backend test`;
  - frontend: `cd giftlink-frontend && CI=true TZ=America/Los_Angeles npm test -- --watchAll=false`;
  - browser: `cd e2e && npx playwright test listing-photos-c1.spec.cjs`.
- **Next (UX-2C2/C3):**
  - pickups on v2 use their own reference version and must not grant photo
    rights;
  - C3 decides public v2 media eligibility and must update
    `assertLegacyOperation` consumers if public media should include
    schema 2 rows.
