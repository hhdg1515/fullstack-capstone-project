# Closed listing details and deliberate relisting

Owners can open a cleared or expired independent listing from **My Listings**
using its title or **View listing**. This is a private, read-only view of the
saved item, pickup details and permitted owner thumbnails. Legacy v1 items
continue through the existing authorized plan editor.

For a cleared v2 item, **Relist as draft** asks for explicit confirmation. It
restores the same item ID as a private editable draft; it does **not** undo a
handoff. Old completed/cancelled requests, appointments, messages and audit
references remain unchanged and closed. The editor offers **Save Draft** and
**Publish** separately. Publishing again is an additional explicit action.
Existing confirmed pickup timezones are preserved when saving the draft.

## Authorization and consistency

`POST /api/items/:id/actions` accepts:

```json
{"action":"reopen","version":3,"confirmRelist":true}
```

The existing owner session, CSRF, independent-publication gate, exact version
and item transaction fence are required. Only `cleared` v2 items qualify.
Open/active pickup records block restoration. A recorded handoff reference must
resolve to the same item's valid original participants, owner and completed
history; missing, foreign or damaged references fail closed without repair.
Concurrent attempts cannot restore twice. An uncertain response blocks another
POST until **Check listing** obtains current authoritative state.

The draft has `publishedAt: null`; `firstPublishedAt` retains the original
publication timestamp, if present, and `relistedAt` records the new draft
transition. A later explicit publication obtains a fresh publication timestamp.
No schema/index creation or data conversion is needed.

The existing `clearedByPickupRequestId` is retained. A later genuine handoff in
a new publication cycle can update it to a new request while preserving every
old request. There remains only one winner per publication cycle; multiple
completed historical requests across deliberate cycles are legitimate. Old
request item labels follow current item data, as in the existing data model;
this change does not introduce immutable historical item snapshots.

No image operations, tombstones, storage objects or quota counters are modified
by restoration. Existing Ready photos remain available to their owner. While
the item is a draft, public/requester image delivery remains denied. After
explicit publication, current public-media policy can allow those photos again;
closed conversation participation never grants independent photo authority.
Current upload gates, quotas and admission requirements still apply.

## Verification

- Backend: eight additional real isolated-MongoDB tests cover ownership, CSRF,
  confirmation, stale/concurrent restoration, separate publication and a second
  genuine handoff cycle, exact preserved requests/messages/held metadata,
  corrupted references, disabled publication and expired deadlines.
- Frontend: private details, thumbnail association, confirmation, duplicate and
  uncertain submissions, canonical reconciliation, closed-card links and
  draft-only save. Six AuthProvider/API-client race cases resolve a previous
  account's GET/POST with 200, 401 or 503 after account switching.
- Actual HTTPS Chromium: synthetic owner, two applicants and outsider, disposable
  MongoDB replica set, verified private SeaweedFS and Sharp. Desktop and 320px
  journeys cover private details, denied foreign access, confirmed restoration,
  preserved stored history/quota counters, Save Draft, explicit republication,
  current-media revocation and independent unsent conversation text. Existing
  account-isolation and item-publication journeys also run.

Screenshots from the actual local application:

| State | Desktop | 320px mobile |
| --- | --- | --- |
| Completed item entry | [Inventory](evidence/completed-listing-details/desktop-completed-inventory.png) | [Inventory](evidence/completed-listing-details/mobile-completed-inventory.png) |
| Private closed details | [Details](evidence/completed-listing-details/desktop-private-completed-detail.png) | [Details](evidence/completed-listing-details/mobile-private-completed-detail.png) |
| Restored private draft | [Editor](evidence/completed-listing-details/desktop-restored-draft.png) | [Editor](evidence/completed-listing-details/mobile-restored-draft.png) |

Exact final test totals and CI results are recorded in the PR. Chromium mobile
emulation is not physical Safari/iOS verification. No hosted E2E, remote Atlas,
R2, provider configuration, manual deployment or production photo activation
is part of this change. Ordinary expired items have a private read view but
this change only adds relisting for cleared items.

## Release and rollback

Release the additive backend capability before or with the frontend. A backend
without `reopenDraft` capability leaves the private view read-only. Previous
clients understand the restored draft status. Keep existing production gates
unchanged; no remote index preparation is required.

Rollback the frontend first and retain the additive backend action until cached
clients age out. Do not reverse recorded handoffs, reopen conversations, restore
public visibility, remove historical references or refund photo holds as part
of rollback. A restored draft remains private until deliberately published.
