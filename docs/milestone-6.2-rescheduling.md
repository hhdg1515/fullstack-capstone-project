# Milestone 6.2 Phase 3 — Pickup rescheduling

## Architecture decision (recorded before implementation)

Baseline: merged main `cdbdaa98f69fda490c9687209b49e16d5295ceeb` (PR #37).
Existing confirmed appointments live in `pickupRequests.proposedAt` (UTC instant),
`localDateTime` (giver-location wall time) and `timeZone` (explicit IANA zone).
Pending acceptance, reservation exclusivity, handoff/clearance and cancellation
already use request versions, unique accepted-item/active-request indexes and the
shared plan snapshot/majority transaction. Communication stays bound to this
request and is never authoritative appointment state.

Extend that canonical document with one optional `rescheduleProposal`: server ID,
server-derived proposer ID, UTC instant/local date-time/IANA zone and creation time.
Presence means pending. No separate scheduling entity/service, new collection,
index, dependency or infrastructure is needed. Existing appointment fields remain
confirmed until the other participant accepts. Each proposal/response increments
the request version and appends a structured history event with previous/proposed
appointment snapshots and actor role. Public DTOs expose roles, not account IDs.

## Rules and lifecycle

- Only original participants of an active accepted request may propose. The
  current confirmed appointment must still be future, valid for the current
  item/plan/window/timezone and exclusive to this request. Both participants and
  the item/plan ownership chain must still exist and match.
- Validate a new time with the existing IANA/DST interpretation, future-time,
  inclusive local window and UTC expiration/deadline rules. A proposal cannot
  silently change a timezone or overwrite another pending proposal.
- Only the other participant may accept or decline. Acceptance rechecks the
  current and proposed appointments inside the existing plan transaction before
  atomically replacing the canonical appointment. Proposal ID and request version
  identify the exact decision; stale/conflicting actions fail without changes.
- The confirmed appointment stays authoritative while a proposal is pending.
  Once it has elapsed, new proposals and acceptance are blocked. The other party
  may still decline an outstanding proposal on an otherwise valid accepted
  request. Existing cancellation/handoff/no-show rules remain available; no
  retrospective rescheduling or no-show policy change is introduced.
- Cancellation, completion, no-show, confirmed item withdrawal/clearance and plan
  closure clear an outstanding proposal and record its invalidation in the same
  transaction. They retain existing confirmation and cancellation behavior.
- If a window/deadline edit only invalidates the proposed time, clear the proposal
  and record the reason/version change; retain the still-valid confirmed pickup.
  If it invalidates the confirmed pickup, the existing explicit cancellation
  confirmation still applies. Timezone/location changes keep their existing
  confirmed cancellation requirement.
- No read mutates expired proposals or requests. Acceptance rejects an elapsed
  proposal; the other participant can decline it. Deleted or compromised
  references cannot authorize proposals/responses. Missing items/plans make the
  scheduling UI unavailable. No endpoint deletes items/plans in the current app;
  external database deletion is not repaired or migrated here.
- No proposer withdrawal/replacement, calendar, notification or automatic
  acceptance is included. Ask the other participant to decline before proposing
  a different time. Terminal requests never permit proposal/response writes.

## API and compatibility

The existing authenticated/rate-limited pickup router adds:

- `POST /api/pickup-requests/:requestId/reschedule-proposals` with
  `{ version, localDateTime, timeZone }`.
- `POST /api/pickup-requests/:requestId/reschedule-proposals/:proposalId/actions`
  with `{ version, action: "accept" | "decline" }`.

Both reuse session/Origin/CSRF/JSON validation and reject unexpected fields. The
existing participant-scoped request representation gains `rescheduling` with
pending proposal, `canPropose`, `canAccept`, `canDecline` and an availability
reason. Permissions describe the observed state; writes always revalidate. The
existing confirmed-appointment fields and six request lifecycle states are stable.
History gains `reschedule_proposed`, `reschedule_accepted`,
`reschedule_declined` and `reschedule_invalidated` entries. These appear in request
history, never as user-authored chat messages. Old records need no migration.

Implement/review backend 3A first, then a small frontend 3B branch based on it.
Retarget 3B to main after 3A merges. Neither PR is merged or deployed by Codex.
Normal CI is unchanged; manually dispatch its existing workflow for the stacked
branch because its pull-request trigger targets main. No hosted/remote E2E or
remote database preparation is part of this work. The Phase 1 message index still
needs separately approved guarded preparation before any future deployment.
