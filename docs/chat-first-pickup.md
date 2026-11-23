# Chat-first pickup and confirmed handoff

The normal request UI offers private conversation rather than Accept/Decline.
A new request remains `pending`, does not reserve the item, and can coexist with
other applicants. Suggested pickup times remain suggestions; discussing a time
in chat does not create a formal appointment or verify a physical handoff.
The requester can still cancel their own request.

## Mark as picked up

Only the giver can use **Mark as picked up**, on the actual recipient's pending
or accepted request. The confirmation explicitly states that the item has
already been physically handed over and that other open requests will close.
Completed requests display the server-recorded actual handoff timestamp, not a
future suggestion. It records the giver's assertion; it is not independent proof of delivery.

`POST /api/pickup-requests/:id/actions` accepts:

```json
{"action":"picked_up","version":1,"confirmHandedOver":true}
```

A session, CSRF protection, exact current request version, original participant
binding and current item ownership are required. The item must remain available
or expired with a valid parent/context. Draft, withdrawn, cleared, deleted or
foreign items cannot be completed. Terminal requests cannot be reopened or
completed again. The giver may record an actual early handoff without waiting
for a future suggested/legacy appointment time.

Under the existing plan/item or independent-item transaction fence, the action:

1. Records only this recipient's request as canonical `completed` (UI: **Picked
   up**), with server timestamp, giver history event and incremented version.
2. Sets the item to `cleared`, increments its version and binds
   `clearedByPickupRequestId` to this request.
3. Cancels competing active pending/accepted requests for this same owner/item
   and reference format with reason `item_handed_over`. They are not recorded as
   successful pickups. Pending formal proposal snapshots are retained in history
   before invalidation.

Concurrent completions, cancellation, creation and withdrawal share the same
fence. Exactly one recipient can win per publication cycle; stale requests fail closed. The UI prevents
in-flight duplicate submissions and requires an authoritative read after an
uncertain outcome rather than automatically replaying the POST.

Public queries and image delivery already reject cleared items. No public
photo URLs, storage ACLs, physical cleanup state, quotas, tombstones or unresolved
write holds are changed by recording a handoff. Existing participants retain
permitted closed text history; sending is disabled. Photo access is evaluated
separately under the existing current-media policy. Unsent chat drafts remain
independent and become read-only rather than being silently discarded.

## Existing accepted requests and old clients

No records, appointments, dates or references are migrated or silently reopened.
Historical accepted reservations still reserve their item until cancelled or
completed. Their giver retains **Cancel request** to release an obsolete
reservation, and can mark an actual handoff directly. Completing another existing
pending applicant's handoff atomically closes the competing accepted reservation.

For backward compatibility, the old owner-authorized `accept`, `decline`,
`complete` and `no_show` API actions remain. They are not controls in the normal
new UI. Old cached clients can still create reservations; this PR does not claim
to remove reservation semantics globally. Old `complete`/`no_show` appointment
boundaries and formal rescheduling rules are unchanged. Browser regressions
that exercise historical states prepare those states explicitly through the
legacy API; a separate real browser journey covers the new no-acceptance UI.

## Deployment and rollback

No schema/index preparation, database conversion or feature-flag change is
required. Deploy the additive backend action before or with the new frontend;
an old backend rejects `picked_up`. Keep all production photo gates unchanged.
This work performs no manual deployment, hosted E2E or remote database/provider
operation.

For UI rollback, retain the additive backend action until cached new clients
have aged out. The persisted states (`completed`, `cancelled`, `cleared`) and
handoff reference/history are already understood by previous readers. Do not
undo recorded handoffs, reopen conversations, restore public media or refund
photo holds as a rollback operation.

## Evidence

- `test/chat-handoff.test.js`: real isolated MongoDB, v1/v2 pending handoffs,
  permission/confirmation/version checks, two competing completions,
  cancellation and creation races, old accepted proposal closure, damaged
  references and unchanged storage/quota metadata.
- Existing backend pickup, communication, rescheduling and photo suites retain
  their legacy assertions.
- Frontend tests cover owner/requester controls, explicit confirmation,
  duplicate/uncertain submission, session isolation and independent chat drafts.
- `e2e/chat-first-handoff.spec.cjs`: real isolated HTTPS, synthetic giver/two
  applicants/outsider, private SeaweedFS and Sharp photo, pending chats, cancelled
  confirmation, keyboard completion, public/media revocation and read-only history.

Local verification: backend **833 passing** (including 9 new real-MongoDB
handoff cases), frontend **528 passing / 34 suites**, dependency compatibility
**6 passing**, deployment policies **60 passing**, backend/runtime lint and
strict production build passed. The new HTTPS journey passed independently on
desktop and mobile, with zero tested WCAG A/AA violations at 1440/320/375px.
The full 96-case browser run and final-head CI results are recorded in the PR.

Actual synthetic local screenshots (visually inspected):

| State | Desktop | Mobile |
| --- | --- | --- |
| Open conversation and handoff action | [1440px](evidence/chat-first-handoff/desktop-open.png) | [320px](evidence/chat-first-handoff/mobile-open.png), [375px](evidence/chat-first-handoff/mobile-open-375.png) |
| Confirmed handoff and retained unsent draft | [1440px](evidence/chat-first-handoff/desktop-picked-up.png) | [320px](evidence/chat-first-handoff/mobile-picked-up.png) |
 Local Chromium evidence does not verify physical Safari/iOS
or real R2/Atlas/Vercel behavior.

## Request interface cleanup

Request detail uses one Back to requests link, with giver actions aligned to
item context at the upper right (wrapping on narrow screens). Message labels
show the other person's name or You; the server-derived roles still determine
ownership and sending. The composer has no enclosing border; keyboard focus
uses an inset underline. Request loading is announced to assistive technology
without a visible feedback card. Errors, retry, uncertain-send recovery and
loading-time action guards remain.

The requester's history shows all statuses with server cursor pagination,
without a status selector or repeated task navigation. Old filtered URLs restart
the complete list at page one, so a filtered cursor is never reused. Returning
window focus revalidates the history without polling or automatic mutations.
The heading remains available to screen readers; empty-state Find items has
explicit spacing. No backend, authorization or lifecycle contract changed.

Current local screenshots: [desktop detail](evidence/pickup-thread-layout/desktop-open.png),
[320px detail](evidence/pickup-thread-layout/mobile-open.png),
[375px detail](evidence/pickup-thread-layout/mobile-open-375.png),
[320px requester history](evidence/pickup-thread-layout/mobile-requester-list.png),
[320px empty history](evidence/pickup-thread-layout/mobile-empty-requester.png).
Rollback requires only the frontend; it does not undo or change recorded handoffs.

## Deliberate relisting

[Closed listing details and deliberate relisting](completed-listing-relist.md)
adds an owner-confirmed private-draft transition for cleared v2 items. It never
reopens old requests or conversations. A separately published new cycle may
have its own new recipient without rewriting the original handoff.
