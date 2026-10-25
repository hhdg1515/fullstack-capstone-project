# Milestone 6.2 Phase 1 — Private pickup communication

## Architecture decision (before implementation)

Baseline: merged main `26e1722ec33700b916c776995a9938784416f1bb` (PRs #32–#35).
The application uses Express, MongoDB **native driver** (not Mongoose), bcrypt
and server-validated, expiring HttpOnly cookie sessions. Global JSON/Origin/CSRF
checks protect writes. Existing authenticated pickup routes use bounded rate
limiting. Item/plan ownership and pickup mutations share the existing
`planTransaction` serialization boundary.

Use each canonical `pickupRequests._id` as the conversation ID. A request already
binds the giver, requester, item and plan and has a database-unique `_id`; a
separate conversation document would duplicate participants and introduce an
unnecessary creation race. GET retrieves a derived context without creating a
record. Repeated/concurrent retrieval cannot create duplicate conversations.
Legacy demo gifts have no canonical pickup request and gain no communication API.

Add only `pickupMessages`: `_id`, `requestId`, `senderId`, `text`, `createdAt`.
The server derives sender from the authenticated session. Do not store a second
participant list. Serialize sender as `giver` or `receiver`, not private emails,
session tokens or another member's account ID. Retrieve history by request and
`(createdAt, _id)` with bounded cursor pagination and a compound index. Timestamps
are server-derived UTC instants; `_id` breaks equal-time ties deterministically.

## Eligibility and closure policy

Both original participants may retrieve context/history and send while the
request is `pending` or `accepted` and `active: true`. Every operation verifies:

- The canonical request participant IDs are distinct existing users.
- The requested item and plan exist and still belong to the request's giver.
- The plan is active and item is published/unexpired under the existing pickup
  eligibility/window/timezone rules; pending appointment time is still future.
- The caller is the canonical giver or receiver, derived from the session.

Invalid IDs, foreign participants, missing/deleted references, changed ownership,
ineligible listings and all terminal states (`declined`, `cancelled`, `completed`,
`no_show`, or any unknown state) return the same **404 CONVERSATION_UNAVAILABLE**.
Anonymous/expired sessions remain 401. No response reveals whether another
member's request has messages. No read normalizes or repairs data.

For Phase 1, **all closed requests lock both reads and sends**, including completed
handoffs; historical messages remain stored but inaccessible through this API.
They do not become accessible through a later request for the same item. Reopening
an item cannot revive the old request's conversation. There is no deletion,
moderation, retention TTL or export policy yet; the owner must decide these before
launching a communication UI. This deliberately conservative policy is not a
claim that inaccessible history has been erased.

Sends reuse the existing plan transaction, rechecking canonical references and
state inside it. They serialize with cancellation, withdrawal, handoff and other
pickup/inventory writes: a send either commits while eligible or is rejected
without a message. Reads use a read-only snapshot transaction for consistent
request/item/plan authorization. No parallel authorization or lifecycle is added.

## API contract

All paths are beneath `/api/pickup-requests/:requestId/conversation`:

- `GET /`: returns `{ conversation: { id, requestId, status, role, counterpart } }`;
  `counterpart` contains only `firstName`. No creation or index writes.
- `GET /messages?limit=20&before=<cursor>`: default 20, maximum 50; newest page
  first, messages within each page in chronological order. `nextCursor` loads
  older messages; clients prepend those older pages. The cursor binds request,
  timestamp and ID and never substitutes for authorization. Unknown query keys,
  malformed/foreign cursors and invalid limits return 400.
- `POST /messages` with `{ "text": "..." }`: 201 with a public-to-participants
  message DTO (`id`, `sender`, `text`, `createdAt`). Only trimmed plain text of
  1–2000 Unicode characters is accepted; markup delimiters and disallowed control
  characters follow the existing private-note convention. Extra fields, including
  sender, owner, request and participant identifiers, are rejected. No input is
  echoed in errors.

Messages are plain text, not HTML. A future UI must render text without HTML
interpretation. The existing request-wide limiter and a per-authenticated-user
message-write limiter bound requests per warm process; they are not a distributed
Vercel quota. Stored messages are application-readable plaintext, not end-to-end
encrypted; no automated contact-detail redaction or moderation is included.
Repeated POSTs can create repeated messages: automatic retries,
idempotency keys and realtime delivery are not included. No chat UI, attachments,
notifications, scheduling changes or external infrastructure are introduced.

## Index preparation and rollout boundary

`pickup_messages_request_time` on `{ requestId: 1, createdAt: -1, _id: -1 }` joins
the existing application-defined index registry. The same guarded `db:prepare`
dry-run, target environment/fingerprint confirmation and explicit approval apply.
Startup only checks indexes; it never creates them or seeds data. No existing
messages/accounts are rewritten or deleted, and no remote preparation is performed
by this task. A deployment of this revision needs the new required index prepared
on its separately approved target first, or readiness will fail closed.

Backend CI's existing recursive test command automatically discovers the new
integration suite. Local/CI tests must use verified disposable replica sets. No
remote E2E, deployment, provider or Atlas settings changes are authorized here.

## Verification and remaining decisions

The merged 6.1 baseline passed 195 backend tests, 180 frontend tests, strict
production build and 16 local HTTPS browser scenarios; no new critical regression
was found. See the [closure audit and deferred usability backlog](milestone-6.1-progress.md).
The Phase 1 branch additionally tests message isolation, sender impersonation,
closed/deleted references, deterministic cursor history, input/rate bounds,
read-only context retrieval, guarded index preparation and send/closure races.
CI evidence and final counts are recorded in the PR.

Before a communication UI/public rollout, decide history retention/deletion,
closed-request history access, moderation/reporting and support/abuse handling.
Measure shared-plan write contention and choose a sustainable rate/storage policy;
the current limiter is per warm process. Future hosted message tests need a
separately reviewed extension of synthetic-message cleanup; existing hosted E2E
creates no messages and its scope/cleanup safeguards are unchanged. No Phase 1
hosted messaging, Safari/real mobile keyboard or screen-reader verification is
claimed, and existing production launch-readiness gates remain separate.
