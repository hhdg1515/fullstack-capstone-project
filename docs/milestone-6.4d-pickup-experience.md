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


## Conversation implementation

The existing single panel now uses Surface/Feedback, token-based sent/received
bubbles, explicit sender roles and a normal-flow composer. Same-year timestamps
are concise; full device-local dates remain on `time` accessible labels/title and
ISO attributes. The panel explicitly separates device display time from giver
pickup time. No HTML interpretation, new storage or scheduling mutation exists.

The cursor/range merge, gap handling, synchronous send guard, reading-position
anchor and bounded manual refresh/load-earlier behavior are unchanged. Existing
23-message browser tests still verify prepending/refresh reading position within
three pixels, multiline Enter, Unicode limits, duplicate posts, closure and
quota feedback. The extra recovery scenario actually commits one message before
simulating a failed response: the draft is kept, send stays blocked until a
successful explicit refresh, and there is no automatic duplicate or false success.
It also verifies independent closure drafts and desktop/tablet/375/390/320px and
200% text reflow with keyboard/focus/axe checks.

The API client now retains only a validated integer 1–3,600 second suggested wait
from existing 429 JSON. Shared quota feedback rounds that server delay up to a
readable unit; absent/invalid values keep the existing fallback. It creates no
retry timer or automatic POST. Shared quota values/limits and backend responses
are unchanged. Nine client cases cover accepted/rejected delay metadata.

Conversation verification: 313 frontend tests/17 suites, strict build and four
focused local browser scenarios pass. The 14 screenshot/axe samples have zero
A/AA findings, overflow or server errors. Six conversation/closed/quota images are
retained; cropped panels use a taller real viewport so Chromium does not paint
an offscreen fixed skip-link into a beyond-viewport capture. No masking or image
editing is used. Navigation PR #55 passes all three CI jobs. Conversation branch
CI and immutable heads are recorded in the PRs.


## Scheduling integration and final acceptance

Arrangement uses compact pickup-zone timestamps with full accessible date labels,
refusing missing/invalid zones rather than falling back to device time,
explicit confirmed/proposed separation and token-based proposal/feedback groups.
Unknown/expired proposal metadata never promises an unauthorized response.
Cancelling time entry restores focus; discarding a closed time draft returns to
arrangement. Pending creation history says Request submitted while current status
says Pending. Retained details after a failed read are labeled last loaded rather
than presented as fresh. Conversation entry repeats the actual item name and
links a known formal proposal back to arrangement without losing either draft.

An additional strictly local two-role scenario covers stale proposal versions,
confirmed time surviving discussion/decline, an actually committed proposal with
a lost response, one POST/no automatic replacement, proposer self-approval denial,
expired-proposal decline, then a legitimate handoff after advancing only the local
fixture clock. Both unsent drafts remain copyable/read-only at closure; discarding
one still protects the other. Completed inventory provenance is checked through
the existing private API. Existing backend transactional/race/ownership/DST tests
and all prior browser journeys remain unchanged in scope.

## Actual UI evidence

All images show synthetic local accounts/listings/messages in the actual production
build over the owned local HTTPS/replica-set harness. No credentials, cookies,
tokens, real personal data, generated concepts or edited images are included.
Twenty final whole-page samples (22 images including cropped conversation panels)
had zero axe A/AA findings, horizontal overflow or server errors. Visually reviewed
request lists, proposed/confirmed arrangement, messages, quota/closed history,
long text, 320/375/390px, tablet 768px and 640px with 200% root text sizing.
The latter is reflow stress, not a claim of physical browser zoom/keyboard testing.

| View | Before desktop | After desktop | Before 320px | After 320px |
| --- | --- | --- | --- | --- |
| Giver requests | [Before](assets/milestone-6.4d/before-giver-list-desktop.png) | [After](assets/milestone-6.4d/after-giver-list-desktop.png) | [Before](assets/milestone-6.4d/before-giver-list-mobile.png) | [After](assets/milestone-6.4d/after-giver-list-mobile.png) |
| Requester requests | [Before](assets/milestone-6.4d/before-requester-list-desktop.png) | [After](assets/milestone-6.4d/after-requester-list-desktop.png) | [Before](assets/milestone-6.4d/before-requester-list-mobile.png) | [After](assets/milestone-6.4d/after-requester-list-mobile.png) |
| Pending detail | [Before](assets/milestone-6.4d/before-pending-desktop.png) | [After](assets/milestone-6.4d/after-pending-desktop.png) | [Before](assets/milestone-6.4d/before-pending-mobile.png) | [After](assets/milestone-6.4d/after-pending-mobile.png) |
| Accepted detail | [Before](assets/milestone-6.4d/before-accepted-desktop.png) | [After](assets/milestone-6.4d/after-accepted-desktop.png) | [Before](assets/milestone-6.4d/before-accepted-mobile.png) | [After](assets/milestone-6.4d/after-accepted-mobile.png) |
| Conversation | [Before](assets/milestone-6.4d/before-conversation-desktop.png) | [After](assets/milestone-6.4d/after-conversation-desktop.png) | [Before](assets/milestone-6.4d/before-conversation-mobile.png) | [After](assets/milestone-6.4d/after-conversation-mobile.png) |
| Time proposal | [Before](assets/milestone-6.4d/before-proposal-desktop.png) | [After](assets/milestone-6.4d/after-proposal-desktop.png) | [Before](assets/milestone-6.4d/before-proposal-mobile.png) | [After](assets/milestone-6.4d/after-proposal-mobile.png) |
| Cancelled history | [Before](assets/milestone-6.4d/before-closed-desktop.png) | [After](assets/milestone-6.4d/after-closed-desktop.png) | [Before](assets/milestone-6.4d/before-closed-mobile.png) | [After](assets/milestone-6.4d/after-closed-mobile.png) |
| Quota feedback | [Before](assets/milestone-6.4d/before-quota-desktop.png) | [After](assets/milestone-6.4d/after-quota-desktop.png) | [Before](assets/milestone-6.4d/before-quota-mobile.png) | [After](assets/milestone-6.4d/after-quota-mobile.png) |

Extra evidence: [completed handoff desktop](assets/milestone-6.4d/after-completed-desktop.png),
[completed 320px](assets/milestone-6.4d/after-completed-mobile.png),
[375px](assets/milestone-6.4d/after-reflow-mobile375.png),
[390px](assets/milestone-6.4d/after-reflow-mobile390.png),
[tablet](assets/milestone-6.4d/after-reflow-tablet.png),
[200% text](assets/milestone-6.4d/after-reflow-zoom200.png).
Completed captures use a second actual request and the local clock to record the
handoff through the existing transaction; no request was reopened or manually
relabeled. Intermediate navigation/conversation evidence remains in their PRs.

## Verification, limits and rollback

Backend **303 tests**, frontend **322 tests / 17 suites**, backend lint, strict
production build and **56 policy tests** pass. Full browser and immutable-head CI
results are recorded in the PRs; the final suite includes all original 28 and six
additional local desktop/mobile scenarios. actionlint/whitespace and relative
document links are checked. No backend service/router/DTO, index definition,
identity/CSRF, geography/taxonomy, inventory transaction, hosted policy/cleanup,
provider or workflow configuration changed. All 16 gifts are byte-identical.

Remaining limits: manual Refresh is intentional; there are no read markers,
unread counts or realtime receipts. There is no POST idempotency key: after
uncertainty, refresh/review precedes an explicit manual retry. Names can match;
roles, appointment and canonical request reference distinguish records without
publishing private account IDs. List/history paging retains existing bounds, not
unlimited search. Physical Safari/iOS/virtual keyboards and manual screen readers
were not verified; local/CI success is not live staging or production readiness.
The existing operational/retention/abuse launch decisions remain outside 6.4D.

Revert scheduling/integration, then conversation, then navigation if needed.
No DDL, migration, data cleanup or deployment rollback is required for these UI
changes. Preserve all predecessor branches and coordinate subsequent deployment
separately; a merge does not authorize provider changes or remote testing.
