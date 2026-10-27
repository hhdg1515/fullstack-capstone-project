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

Both original participants may read existing context and paginated history after
completion, cancellation, decline or no-show. These terminal requests are
**read-only**: neither participant can send another message or reopen the request.
The API recognizes the existing canonical states (`pending`, `accepted`,
`declined`, `cancelled`, `completed`, `no_show`); unknown states or inconsistent
`active` flags fail closed rather than being treated as archived conversations.

Every read and send verifies, in one consistent snapshot:

- The caller is the canonical giver or receiver, derived from the session.
- Participant IDs are distinct existing users. The receiver reference must agree
  with the original request-creation event, preventing a substituted participant
  from inheriting another requester's history.
- The request, item and plan exist and the item/plan still belong to the original
  giver. Missing/deleted documents, broken references and changed ownership deny
  access even for a closed request. Reads never repair these records.

Open requests retain the existing eligibility rules for both reads and sends:
`active: true`, an active plan, a published/unexpired item and the existing pickup
window/timezone checks; pending appointment times must still be future. Sending
additionally requires a pending or accepted request and is always forbidden after
closure. Closed history does not require the item to remain published, the plan
to remain active, or the old pickup window/timezone to remain current. This keeps
history readable after a legitimate withdrawal, handoff or plan change without
bypassing ownership or participant verification.

Invalid IDs, foreign participants and invalid/deleted/compromised references return
**404 CONVERSATION_UNAVAILABLE**. Sending to closed requests also returns that 404;
anonymous/expired sessions remain 401. Nonparticipants receive no conversation
metadata or message content. Successful closed-history reads use the existing context/message DTOs
and `Cache-Control: no-store`; they create no documents or lifecycle changes.

Messages remain associated only with their original request. A later request for
the same item has a separate, initially empty history; republishing an item does
not restore sending on an older closed request. There is no deletion, moderation,
retention TTL or export policy yet. Retention/deletion still needs an owner
policy before hosted communication rollout/public launch; read-only access is not erasure.
See the [Phase 4 retention proposal and decision list](milestone-6.2-security-readiness.md#proposed-message-lifecycle--owner-approval-required);
no proposed deletion is enabled by this documentation.

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
message-write limiter bound requests per warm process; they are not distributed
Vercel request quotas. Phase 4 adds the shared successful-send quota below. Stored messages are application-readable plaintext, not end-to-end
encrypted; no automated contact-detail redaction or moderation is included.
Repeated POSTs can create repeated messages: automatic retries,
idempotency keys and realtime delivery are not included. Phase 1 introduced no chat UI, attachments, notifications, scheduling changes or
external infrastructure. The frontend panel added in Phase 2 is described below.

## Phase 4 — Shared message bounds

In addition to the unchanged per-process 30-message/minute limiter, successful
sends reserve two account-scoped MongoDB counters: **30 per 60 seconds and 300
per 3,600 seconds**, shared across conversations, sessions and warm instances.
Each window starts with the first send after expiry; these are anchored windows,
not sliding windows, so bursts can straddle a boundary. MongoDB `$$NOW` determines
expiry independently of function or browser clocks. Two constant-size counters
live in `users.pickupMessageQuota`; no message text, new collection/index, TTL,
upsert, migration or startup write is added. Existing accounts initialize lazily
on their next authorized send. Account/profile/public DTOs and logs exclude them.

Canonical participant/eligibility checks run before quota reservation, inside the
existing plan transaction. Reservation and message insertion commit together;
failed authorization, rejected sends, aborts and callback retries do not consume
extra quota or leave partial messages. Quota exhaustion returns **429
MESSAGE_QUOTA_EXCEEDED** with a bounded `Retry-After` header and
`error.retryAfterSeconds` (1–3,600). No message is inserted. The UI keeps the draft,
says to try later and never retries POST automatically. The counters use the
existing user `_id` index. They add one user-document update to a successful send;
they are not a global storage cap, anti-Sybil control or shared GET limiter.

The pickup router's existing 120-request/minute per-process IP limiter now runs
before session lookup, including invalid-session traffic. The authenticated
per-process send limiter remains before validation. Proxy/IP attribution and
multi-instance request amplification still need operational review; no forwarded
header is newly trusted. Ordinary 401/404 behavior applies until this outer limit
is reached. Rejected/invalid attempts can consume local attempt limits, never
the database successful-send allowance.

Message history still defaults to 20 and caps at 50 results with one lookahead;
the indexed page query now has `maxTimeMS: 5000` and an explicit projection.
MongoDB code 50 returns sanitized 503 `CONVERSATION_BUSY`. This bounds that query,
not the entire authorization/transaction/network lifetime. No callback retry of
an HTTP POST is added; the driver's existing transaction retries remain atomic.
Explicit duplicate POSTs still produce distinct messages; uncertain outcomes
require refresh/review before any manual resend. There is no idempotency key.

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
read-only closed history, deleted/compromised references, deterministic cursor history, input/rate bounds,
read-only context retrieval, guarded index preparation and send/closure races.
CI evidence and final counts are recorded in the PR.

Closed-request history access now follows the owner-approved read-only policy
above. Before a communication UI/public rollout, decide history retention/deletion,
moderation/reporting and support/abuse handling.
Measure shared-plan write contention and choose a sustainable rate/storage policy;
the current limiter is per warm process. Future hosted message tests need a
separately reviewed extension of synthetic-message cleanup; existing hosted E2E
creates no messages and its scope/cleanup safeguards are unchanged. No Phase 1
hosted messaging, Safari/real mobile keyboard or screen-reader verification is
claimed, and existing production launch-readiness gates remain separate.

## Phase 2 — Embedded pickup conversation UI

The participant-only pickup detail now contains a compact conversation panel.
No global inbox, new route or backend communication contract is introduced.
The context endpoint supplies the counterpart's first name and the current user's
sender role. Message attribution compares that role, never display names. Plain
React text nodes render content with preserved line breaks and wrapping; neither
HTML nor Markdown is interpreted. Message timestamps use the device timezone for
display only and do not configure pickup timezones.

The panel initially loads the latest 20 messages and offers manual Refresh and
Load earlier messages. Bounded cursor ranges preserve already loaded history,
deduplicate IDs and explicitly show a gap if a refresh skips more than a page of
new messages. Loading older pages fills that gap and resumes the older cursor.
It never automatically drains an entire history. A visible message anchor keeps
reading position when pages are inserted; refresh/send only scroll the history
to its end if the user was already there. History is not an ARIA live log: a short
status announcement reports loading, sending and completion without rereading all
private messages.

The composer validates 1–2,000 trimmed Unicode code points and the backend's
plain-text restrictions. A synchronous in-flight guard prevents rapid duplicate
POSTs. No POST is automatically retried. Network/timeout/5xx uncertainty and 409
conflicts retain the draft and require a successful manual refresh before another
send; users must inspect recent messages before choosing to resend. There is
still no server idempotency key. Validation/rate-limit errors are actionable and
retain text; authentication/permission denials hide loaded private history.
Closed requests show the backend-derived read-only state and cannot send. A draft
already typed at closure stays copyable and can be discarded with confirmation.

Request/account keys reset all chat state on a scope change. Mounted/generation
checks discard late GET/POST results, including stale 401s, before they can affect
a newer request/session. Current 401s use the existing unauthorized event/session
flow. Parent request reloads retain the current chat draft/history while lifecycle
controls wait for revalidation; definitive parent 403/404 responses remove it.
All drafts/history stay in component memory. Existing unsaved-form protection
warns before leaving; accepted discard, logout, session invalidation, reload or
browser termination can lose drafts. Nothing is persisted to browser storage.

[Local desktop/narrow-mobile evidence](assets/milestone-6.2/README.md) uses only
synthetic data. New UI/browser tests stay local and do not enlarge hosted E2E
account budgets or change remote cleanup. Normal CI discovers them automatically;
no workflow/provider/Atlas setting changes are required. The Phase 1 remote index
has **not** been prepared here: any future hosted deployment still needs separate
approval and guarded index preparation. No realtime updates, notifications, read
receipts, typing indicators, attachments or scheduling changes are included.


## Milestone 6.4D presentation and navigation

The [6.4D experience audit/evidence](milestone-6.4d-pickup-experience.md) modernizes
this same panel with shared surfaces/feedback, request-level conversation anchors,
item/counterpart context, literal message bubbles and full accessible timestamp
labels. Message display remains device-local; pickup authority remains the stored
request timezone. The existing quota error's bounded 1–3,600 second suggestion is
shown without a timer or automatic retry. Chronology/range gaps, three-pixel
reading-position checks, Unicode limits and memory-only draft/uncertainty guards
remain covered. A new browser case proves that an actual committed send followed
by a failed response does not cause an automatic duplicate or false success.

Closed history is still participant-only/read-only under the policy above. The
modernization does not add storage, deletion, retention, attachments, read receipts,
polling or a global inbox. [Authoritative unread status](milestone-6.4d-pickup-experience.md#unread-assessment--explicitly-deferred)
is an explicit future proposal requiring persistence/API/index review; no
browser-derived unread indicator exists. Tests are local/CI, not a new hosted run.
