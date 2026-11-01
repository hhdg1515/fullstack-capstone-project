# Milestone 6.6 UX-2C2 — Independent listing pickup, messaging and scheduling

Branch: `codex/m66-ux2c2-item-first-pickup-integration`. It is stacked on the
UX-2C1 branch `claude/m66-ux2c1-independent-listing-photos` (PR #81).

> **Prerequisite status (step 0).**
> - Merged into `main` `8e50116`: UX-2B1 (#78), UX-2B2 (#79) and UX-2B3 (#80).
> - Not merged yet: UX-2C1. Its earlier, unpushed attempt never reached
>   GitHub, so C1 was re-implemented as PR #81.
>
> The product owner asked for C1 and C2 together. This branch therefore builds
> on #81 rather than stopping. **Merge #81 first.** This PR's diff against
> `main` includes C1 until then.

## Scope

This milestone extends the existing pickup-request, private-conversation,
scheduling and lifecycle code to independent (`listingSchemaVersion: 2`)
listings. It is an integration of existing code, not a rewrite.

- v1 plan workflows, request IDs, conversations, appointments and histories
  are unchanged.
- No plan is invented and no record is migrated.
- `planId` is not made optional anywhere.

**V2 publication and discovery remain UX-2C3.** Publishing a v2 item still
returns `V2_PUBLICATION_DISABLED`. That means:

- In production, no v2 item can be eligible for requests yet.
- Tests construct the exact published state, `status: 'available'` and
  `publishedAt`, as an explicit local fixture.
- The new gate is off by default.

## Request reference formats

| Format | Marker | Binding | Validation |
| --- | --- | --- | --- |
| v1 (unchanged) | no `referenceVersion` field, `planId` ObjectId | item, plan, giver, receiver | Original four-ID and first-event checks. |
| v2 (new) | `referenceVersion: 2`, **no `planId` field** | item, giver (= item owner), receiver | The same first-event `originalParticipants` checks. The item must be the giver's v2 item. |

- `pickup-policy.referenceVersion(row)` returns 1, 2 or `null`. Mixed shapes
  (v2 with a `planId`) and unknown versions are `null`, which fails closed
  everywhere: detail, actions, scheduling, conversation and media.
- The giver is always the item's owner at creation. The request stores no plan
  and is never re-pointed to another item.

## Lifecycle (existing state machine, unchanged)

`pending` → `accepted` | `declined` | `cancelled`;
`accepted` → `completed` | `no_show` | `cancelled`.
Only `pending` and `accepted` are active. No new states were added.

| Actor | Allowed | Notes |
| --- | --- | --- |
| Requester (receiver) | create (eligible v2 item only, never their own); cancel own pending/accepted; propose/accept/decline a time change on an accepted request; read and send messages while open | `OWN_ITEM`, `DUPLICATE_PICKUP`, `ITEM_RESERVED` and `LISTING_UNAVAILABLE` as in v1. |
| Owner (giver) | accept or decline pending; cancel; propose/accept/decline a time change; record handoff (`complete`) or `no_show` after the appointment | Accept requires current v2 eligibility and that the appointment fits the window. One accepted request per item (unique index). |
| Anyone else | nothing | Detail, actions and scheduling return `404 PICKUP_NOT_FOUND`; conversation returns `404 CONVERSATION_UNAVAILABLE`. Lists never contain other people's requests. |

`complete` on a v2 item:

- sets it to `cleared` with `clearedByPickupRequestId`;
- increments its version;
- cancels the item's other active requests (`item_handed_over`) in the same
  transaction.

The item stays v2 with no `planId`. Closed requests keep read-only
conversation history for both original participants; sending is refused.

## Eligibility, deadlines and timezones

`eligible(item, null, now)` and `fitsWindow(request, item, null, now)` use the
shared `resolveListingContext`. A listing is eligible only if all of these hold:

- the strict v2 context resolves (complete classification, region and text);
- `status: 'available'` and `publishedAt <= now`;
- the IANA zone has been explicitly confirmed;
- the stored policy-2 tuple is reproducible;
- `now < expiresAt`.

An appointment fits when:

- its zone equals the item's confirmed zone;
- `proposedAt < expiresAt`, the exclusive end of the local deadline day;
- if `availableFrom` is set, `proposedAt >= startsAt`, the start of that local
  day.

The last local minute of the deadline day is accepted, even when it falls on
the next UTC day. Midnight after it is rejected.

Appointments still use the existing parser:

- nonexistent or repeated DST wall times are rejected
  (`INVALID_APPOINTMENT`), never shifted;
- past times are rejected (`APPOINTMENT_PAST`).

Historical v1 appointments and the v1 UTC rules are untouched.

**Clock source.** V2 operations evaluate time with the **database clock**:

- `databaseNow` reads `$$NOW` in the operation's session;
- the requester detail evaluates in-pipeline `$$NOW`;
- server-side v2 message timestamps also use it.

UX-2A requires one authoritative database time per operation. Browser
acceptance also showed why: comparing database-written v2 timestamps
(`timeZoneConfirmedAt`, `publishedAt`) with the app server clock wrongly
refused a request created right after confirmation. v1 keeps its existing
(injectable) server clock.

## Transactions and concurrency

- **Fences.**
  - v1 requests keep `planTransaction` (plan fence, then item, as before).
  - v2 requests, decisions, scheduling and message sends use
    `independentItemTransaction` (`services/item-fence.js`). It runs a
    snapshot/majority transaction that compare-and-increments the item's
    `coordinationRevision`.
  - This is the same fence UX-2B2 draft edits and UX-2C1 photo operations use,
    so every write to one v2 item is serialized. Conflicts use the driver's
    bounded `withTransaction` retry and re-read current state.
  - No v2 transaction touches any plan.
- **Inside the fence:**
  - the request row is re-read with participant scope;
  - the row's reference version, giver and item must match the pre-read;
  - stale `version` returns `409 PICKUP_CHANGED`;
  - duplicate-active and accepted-reservation checks run;
  - the existing unique indexes act as a backstop (`11000` maps to
    `PICKUP_CONFLICT` or `ITEM_RESERVED`).
- **Retries.** A retried create after commit hits `DUPLICATE_PICKUP`. A
  retried action with the old version gets `PICKUP_CHANGED`. Committed
  outcomes are never duplicated.

## Conversations

The existing `pickupMessages` collection, cursor pagination, ordering and
shared per-account quota are reused unchanged (30/minute, 300/hour on the
user document, reserved in the same transaction as the insert).

- Authorization accepts a v2 request only with valid original participants
  and the giver's v2 item.
- Open requests also need current eligibility and window.
- Closed requests keep read-only history.
- Message text never appears in listing DTOs.

## Requester-facing listing detail (gated)

`GET /api/items/:id` adds a v2 branch, used only when the gate is on and the
listing-v1 lookup finds nothing. The branch:

- reads the single item by ID with a snapshot reservation lookup;
- re-checks eligibility at database time;
- returns a public DTO with `listingModel: 2`, `datePolicy: 'pickup-local'`,
  its own general location and region labels, the confirmed zone,
  `isOwner` / `isReserved`, and no images.

It is **not** part of browse, totals, cursors or location options; those stay
v1-only until UX-2C3. Ineligible or private items return the usual `404`.

## API and frontend changes

- **Pickup routes** are unchanged. `POST /api/pickup-requests` accepts a v2
  `itemId` when the gate is on.
- **v2 request detail.** `item` carries `listingModel`, `datePolicy` and
  `metroLabel`. The v1 DTO is unchanged.
- **Owner feed.** `pickupSummary` for v2 becomes
  `{ supported: true, reserved }` when the gate is on.
- **v2 pickup media.** The request-detail photo summary is `unavailable` for
  v2. Request participation grants no media rights; C3 decides.
- **Frontend:**
  - Request form, request detail and scheduling help use local-date wording
    in the confirmed zone for v2 ("The listing ends at the end of that local
    date", "(local dates in Z)").
  - The giver's "View item" opens `/app/listings/:id`; the requester's opens
    `/app/items/:id`.
  - An owner on a v2 listing gets "Manage listing" and is pointed to My
    Listings.
  - Location falls back to the metro label instead of an empty ", ".
  - Controls are still driven by the existing server state (`role`,
    `status`, `rescheduling` capabilities).

## Feature gate

`OWNER_LISTING_PICKUPS_ENABLED`, default **false**.

- It requires `OWNER_LISTINGS_ENABLED=true`; startup refuses otherwise.
- When off:
  - v2 requests return `409 LISTING_UNAVAILABLE`;
  - the v2 requester detail returns `404`;
  - the owner feed shows `supported: false`.
- Existing v2 requests stay readable and actionable, so participants can
  cancel during a rollback.
- Local setup: `localEnvironment({ ownerListings: true, ownerListingPickups: true })`.

**Activation dependency:** an eligible v2 listing needs UX-2C3 publication.
Until then, only local fixtures can exercise this path.

## Verification (local Windows 11, Docker Desktop)

| Suite | Result |
| --- | --- |
| New backend `test/independent-listing-pickups.test.js` (real replica set) | **10 passing** |
| v1 pickups, communication, rescheduling, discovery, items, plans, owner listings, foundation, server, C1 photos, item images | **352 passing** before the database-time change; pickup/chat/scheduling/discovery re-run afterwards: **140 passing** |
| Frontend (`--runInBand`, as in CI) | **32 suites, 522 passing** |
| Strict production build | compiled successfully |
| Browser `listing-pickups-c2.spec.cjs` (HTTPS Chromium, desktop 1440 and Pixel 7 375, plus 320 reflow) | **2/2 passing**, axe WCAG 2.1 AA clean on every captured state |
| Browser regressions with C2 (desktop + mobile): `workflow`, `pickup-chat`, `pickup-rescheduling`, `pickup-experience`, `pickup-scheduling-ux`, `request-clarity`, `listing-session-f1`, `listing-acceptance-f4`, `listing-photos-c1` | **24/24 passing** |
| Full backend (`mocha --recursive test`) | **791 passing, 12 failing.** All 12 are local Windows/Docker environment cases, none in changed code: symlink EPERM (3), `npm.cmd` spawn EINVAL (2), crash tests expecting a SIGKILL signal Windows does not report (3), the 25-image batch timing out (1), two intermittent image-pipeline 404s that also fail on unmodified main (2), and an R2 bridge race (1) that passes when its file is run alone. Linux CI is authoritative. |

The spec's 25 adversarial cases are covered as follows.

**Backend (`independent-listing-pickups.test.js`):**

| Case(s) | Coverage |
| --- | --- |
| 1, 11, 15, 20, 24 | Full lifecycle: request, inboxes, accept, chat both ways, propose/accept, completion gate, handoff, sibling cancellation, read-only closed chat and history |
| 2, 3, 12 | Self-request; requester accept/complete; third-party detail/action/scheduling/conversation |
| 4, 5, 10, 25 | Duplicate and concurrent requests and accepts; stale versions; retries; separate item ledgers |
| 6–9 | Draft, withdrawn, expired, cleared, unconfirmed, tampered expiry, future publication, incomplete |
| 14 | Shared message quota |
| 16, 17 | Past, before-start, beyond-deadline, last local minute vs UTC, next-midnight, wrong zone, DST gap and fold |
| 18, 19 | Own, pending, racing and cancelled proposals |
| 22, 23 | Forged and mixed reference formats; v1 request on the plan path |
| Gate | Default-off behaviour and startup validation |
| Detail | Direct-ID v2 detail never in browse, counts or locations |

**Frontend (`IndependentPickups.test.js`):**

- local-zone request wording and payload;
- owner redirect;
- role-specific links;
- account switch during a delayed detail (case 21).

**Browser (`listing-pickups-c2.spec.cjs`):**

- private-draft refusal, then fixture eligibility;
- request, inbox, accept, two-way chat, propose/accept;
- outsider denial and public reservation flag;
- cancellation with read-only history;
- no plan created.

Screenshots: [docs/evidence/ux2c2](evidence/ux2c2). Captured states:

- listing
- request-form
- requester-pending
- owner-accepted
- conversation
- proposal
- cancelled
- 320 detail and request form

## Security and recovery findings

- **Fixed in this branch.** v2 eligibility originally used the app server
  clock against database-written timestamps. A request right after timezone
  confirmation failed in the browser run. All v2 pickup paths now use database
  time.
- **No escalation through participation.** A v2 request grants no photo access,
  and v2 request DTOs never expose owner/receiver IDs, coordination counters or
  deadline tuples.
- **Recovery.** Uncertain responses are resolved by reading. Version and
  duplicate guards make replays safe. There is no automatic POST replay.

## Known limitations

- Production v2 requests are impossible until C3 publication; the gate is off.
- v2 listings do not appear in browse, search, counts or location options.
- v2 pickup and request thumbnails are withheld.
- The owner's private detail still lacks request/withdraw controls. Incoming
  requests are reached through the existing inbox.
- Withdrawing a v2 listing (`unlist`) and its cancellation semantics are C3.
  Owner-listings mutation still refuses non-draft lifecycle actions.
- A cleared v2 item shows "Cleared". The legacy "Picked up" verification
  (`completedHandoff`) is v1-only.

## Rollback

- Turn `OWNER_LISTING_PICKUPS_ENABLED` off. This stops new v2 requests and
  hides the requester detail.
- Keep the dual-format readers (`referenceVersion`, `item-fence`, v2 branches)
  deployed as long as any `referenceVersion: 2` request or message exists.
  Never delete, convert or attach plans to them.
- Never downgrade below a release that understands v2 requests while such rows
  exist. Older code treats them as invalid references (`404`), so participants
  would lose access to their own history.

## Handoff for UX-2C3

| Area | Details |
| --- | --- |
| Final implementation commit | See PR description (branch head). |
| Key modules | `services/item-fence.js` (`independentItemTransaction`, `databaseNow`); `services/pickup-policy.js` (`referenceVersion`, `independentWindow`, v2 branches of `eligible` / `fitsWindow` / `proposalProblem`); `services/pickups.js` (`transaction`, `itemFor`, `createIndependent`); `services/pickup-communication.js`; `services/discovery.js` (`independentPublicItem`); `services/pickup-item-media.js`. Frontend: `components/Pickups/Pickups.js`, `PickupScheduling.js`, `placeLabel.js`, `components/Inventory/PublicItems.js`. |
| Flags | `OWNER_LISTINGS_ENABLED`, `OWNER_LISTING_PHOTOS_ENABLED` (C1), `OWNER_LISTING_PICKUPS_ENABLED` (C2). All default false. |
| Verify | Backend `npm --prefix giftlink-backend test`. Frontend `cd giftlink-frontend && CI=true TZ=America/Los_Angeles npm test -- --watchAll=false --runInBand`. Browser: `npm --prefix e2e test`, or the single files `listing-pickups-c2.spec.cjs` and `listing-photos-c1.spec.cjs`. |
| Fully implemented | v2 request create/list/detail; accept, decline, cancel, complete and no-show; rescheduling; conversations; quotas; gating; requester detail by ID. |
| Intentionally disabled | v2 publish, withdraw, reopen; v2 browse, search, counts and locations; v2 public, pickup and requester media; production activation. |

**C3 must:**

1. Implement v2 publish, withdraw and reopen with the existing
   confirmation-to-cancel protocol (`invalidateRequests` equivalent on the item
   fence). Write `publishedAt` from the database clock.
2. Add v2 to browse, counts, cursors and locations with mixed-policy (v1 UTC,
   v2 local) evaluation per listing.
3. Decide v2 public and requester media (the `assertLegacyOperation`
   consumers, and the pickup media early return).
4. Replace the local publication fixture in `listing-pickups-c2.spec.cjs` with
   the real publish action.
5. Add a reproducible Windows local manual-test path.
