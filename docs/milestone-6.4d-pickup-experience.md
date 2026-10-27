# Milestone 6.4D — Pickup coordination experience

## Verified base and review order

Start: open PR #54, `codex/m64c-discovery-cards`, at
`224fde327828793998a9b5e9c65b660037e73635`, fetched and verified before coding.
Its history includes #49 publication → #50 timezone → #51 inventory → #52
coverage → #53 discovery → #54 public cards. Do not start from main or edit those
PRs. New branches stack navigation/status → conversation → scheduling/regressions,
each targeting its direct predecessor. Retarget to main only after prerequisites
merge; no merge or deployment is authorized by this work.

## Architecture and running-app audit (before implementation)

Read design-system, 6.4 audit/roadmap, communication and rescheduling contracts,
and the actual React components and native-driver services. Audited both roles
using the existing production build, local HTTPS harness, verified disposable
replica set, two synthetic accounts, real pickup requests and 23 alternating
messages. Captured 16 before images at desktop/320px; the 14 whole-page axe samples
had no WCAG A/AA findings, horizontal overflow or server errors. Passing axe did
not make the old hierarchy usable: a pending mobile detail spans several screens
before the composer. Visually inspected list/detail/conversation/proposal views.

Findings:

- Lists identify item/applicant/status/time, but every entry ends in a generic
  Review request action. There is no conversation shortcut. Full-date text and
  secondary plan/reference links compete with the decision.
- Detail is one long card: description, plan, coordination note and reference
  precede lifecycle actions, then scheduling, then conversation and full history.
  Equally outlined actions obscure the giver's next decision. Accepted is not a
  completed handoff, but the distinction needs repeated paragraphs.
- Conversation already has chronological bounded pages, role-derived attribution,
  manual refresh, a reading-position anchor, literal text and independent memory
  drafts. Blue/gray bubbles and Bootstrap controls differ from the shared system;
  long timestamp/sender lines consume narrow message widths.
- Formal confirmed/proposed appointments are correctly separate, but proposals
  nest more cards and repeat long warnings. Invalid/elapsed proposals, conflicts
  and independent draft retention already have tests and must remain intact.
- Inventory has only `isReserved` and a received-request-list link, not a verified
  canonical request ID. Do not invent a direct chat or add a new private DTO for
  convenience. Its existing request-list entry leads to the new shortcuts.
- No authoritative per-participant message read marker/sequence exists. An unread
  badge cannot be derived honestly from current browser state.

## Proposed small changes

1. **Navigation/status PR:** use PageHeader/Surface/Feedback and scoped tokens on
   request lists/detail/form. Keep canonical backend status values; use short
   Pending/Accepted/Completed/No-show labels with clear proposed vs confirmed time.
   Preserve the whole-item, no-automatic-address and handoff distinctions. Cards
   retain item/applicant/reference and exact request links; add Open conversation
   to the existing request route's `#conversation` section. Focus that section
   after asynchronous detail load, without creating another chat or inbox.
   Place participant summary and decisions first; group appointment/scheduling;
   keep conversation before collapsible secondary details/history. Confirm all
   consequential actions. Block duplicate/stale/uncertain lifecycle actions until
   explicit canonical revalidation; ignore results from a previous account/request.
2. **Conversation PR:** adopt shared surfaces, readable role labels and compact
   device-local timestamps, token-based sent/received bubbles and a normal-flow
   composer. Keep the exact history merge/cursor/scroll model, explicit multiline
   Send, Unicode/plain-text rules, 2,000-character limit, synchronous guard, quota
   feedback and uncertain-send refresh gate. Do not auto-retry or persist drafts.
3. **Scheduling/regression PR:** improve confirmed/proposed arrangement hierarchy,
   proposer/response clarity, short timezone explanation and secondary history.
   Preserve server permissions, exact version/proposal IDs, DST/future/window
   rules, confirmation and independent chat/time drafts. Expand local cross-role
   browser coverage for links, failures, closure, focus, narrow layouts and axe.

No backend state machine, identity/CSRF, message storage/quota, geography, inventory,
index/DDL, dependency, provider or hosted-test change is proposed. The 16 demo
gifts remain byte-identical. Final screenshots and immutable-head CI evidence
will distinguish local/CI verification from unperformed live staging/Safari/iOS
or manual screen-reader verification.

## Unread assessment — explicitly deferred

A trustworthy follow-up needs new persistent state/API behavior and is outside
6.4D. The smallest candidate is a request-local monotonic message sequence updated
in the existing send transaction, plus two private participant read-through
markers. A timestamp/last-rendered ID alone is insufficient: ties, clock skew and
late commits across instances can mark unseen messages as read. Use the server
sequence and monotonic conditional acknowledgments; never let another device move
its participant's marker backwards.

Define acknowledgment as an explicit "caught up through this message" action or
a separately approved visibility rule after a successful latest-page load, not a
GET side effect or a claim that a human understood the text. An authenticated,
CSRF-protected acknowledgment must reuse canonical original-participant/reference
checks, verify the message belongs to the request and reject future/foreign
sequence values. Closed-history access may acknowledge reading, never reopen or
permit sends. Return only the caller's new-message state; do not expose the other
participant's marker, read time, presence or read receipts.

One sequence increment per successful send and at most one coalesced marker write
per meaningful catch-up add contention to the shared request/plan transaction;
measure it before rollout. For the bounded 25-request list page, prefer a boolean
"new messages" query for messages from the counterpart after the caller's marker,
not unbounded count/history downloads. Evaluate an indexed `{ requestId, sequence }`
lookup, uniqueness for sequenced messages and a partial legacy-compatible index
with explain/scale tests; any definition requires guarded preparation and separate
remote approval. No index is created here.

Legacy messages lack sequences/markers. Keep them readable and label initial
state unknown/check conversation until an explicit reviewed catch-up policy; do
not silently mark all history read or rewrite it. Specify feature-start semantics,
concurrent legacy/new sends, pagination gaps, acknowledgment races and account
switches before migration. Stored server markers provide cross-device/multi-
instance consistency; localStorage, loaded counts and timestamps do not. No
websockets, polling, external notifications or paid infrastructure are needed for
this proposal, and none is introduced now.


## Navigation/status implementation and compatibility

Lists now offer View request and Open conversation with item/counterpart-specific
accessible names. The hash targets the same canonical request detail; its heading
receives focus after asynchronous loading and same-page jumps keep drafts intact.
Status/cursor filters use URLs so Back/Forward and the role-derived return link
retain list context. Only public filter/reference values enter navigation state;
no notes or message drafts enter URLs/storage. Inventory still links to the
received-request list because its DTO has no canonical accepted-request ID.

Pending, Accepted, Declined, Cancelled, Completed and No-show are display labels
for the unchanged six server statuses. Proposed/confirmed pickup labels remain
separate. Pending givers see Accept first; future accepted requests lead with Open
conversation, while legitimate handoff/no-show still waits for appointment time.
Secondary description/note/reference/history is collapsible after conversation.
The request form adopts existing tokens without changing inputs or submission.

Lifecycle writes now have a synchronous duplicate guard, exact response ID/version
validation and explicit reload after conflict/uncertainty. A request/account key
prevents old action results affecting the next detail. A regression demonstrated
that the shared loader previously dispatched an old 401 before checking whether
its request was still active. Its notification now follows active/current-key
checks; current 401 behavior is unchanged. Full frontend regression includes all
other existing consumers of this small shared-hook correction.

Navigation verification: 303 backend tests, 302 frontend tests (17 suites), lint,
strict build, 56 policy tests, actionlint and whitespace checks pass. Four focused
local browser scenarios cover both roles, canonical hash/focus, return filters,
unchanged chat draft through acceptance, actual nonparticipant 404s, closed history
and same-item request review. The 14 navigation screenshot/axe samples have zero
A/AA findings, overflow or server errors; eight relevant whole-page images are
retained for this PR. Full immutable-head CI results are linked in its PR.
