# Milestone 6.4E — Integrated MVP acceptance

## Decision and evidence boundary

The integrated application is suitable for a **controlled local human MVP trial**
with the usability debt below visible to the owner. No new P0/P1 functional or
authorization regression was demonstrated by this acceptance review. This is
**not public-launch approval, production readiness, a penetration test, manual
screen-reader certification, or a new live staging E2E result**. The P1 operational
launch gates remain unresolved.

Tested main: **`58a8306afb413f5a980eccbff4346f876995e4a7`**. Fetched remote main,
confirmed #55, #56 and #57 merged into main, and verified the complete 6.4B–6.4D
history before creating `codex/m64e-mvp-acceptance`. The merged application tree is
identical to reviewed #57. Earlier stacked branches are historical, not the base
for this milestone. This PR adds acceptance tests, evidence and documentation;
there is no application, dependency, schema, lifecycle or provider change.

Reviewed the [design system](design-system.md), [6.4 audit](milestone-6.4-design-audit.md),
[roadmap](milestone-6.4-roadmap.md), [A verification](milestone-6.4a-verification.md),
[B](milestone-6.4b-listing-inventory.md), [C](milestone-6.4c-discovery.md),
[D](milestone-6.4d-pickup-experience.md), [geographic provenance](geographic-directory.md),
[communication](milestone-6.2-communication.md), [rescheduling](milestone-6.2-rescheduling.md),
[security readiness](milestone-6.2-security-readiness.md),
[production readiness](production-readiness.md) and [operations](operations-runbook.md).
Old milestone counts and provider observations are historical; the results below
are new local measurements. No provider configuration was refreshed or probed.

## Environment and isolation

Node **22.23.4**, npm 10.9.9, Linux Chromium **154.0.8037.57**, Docker **28.4.0**,
the existing pinned MongoDB 8.0 image/replica-set helper, CRA production build and
the actual hosted-runtime Express handler behind loopback HTTPS. The helper
checks container ID/name/run label/image, disposable mounts, loopback port,
database name, actual MongoDB process identity and empty database before fixture
writes. Required indexes are prepared only inside that owned disposable target.
Cleanup rechecks container identity and removes only its resources.

The new `e2e/mvp-acceptance.spec.cjs` refuses hosted configuration, uses two
independent browser contexts and two randomly credentialed synthetic accounts per
desktop/mobile run, and blocks browser requests to every other origin. Anonymous
browsing occurs in the requester context before registration. Existing tests,
remote budgets, owner/main/SHA/fingerprint confirmations and cleanup are intact.
The test verifies local JSON readiness/fingerprint before account creation.

There are three items: a name-only draft completed/published atomically, another
published item and a separate incomplete saved draft. Two initial pickup requests
target different items. A later request on the declined item is a new, independently
cancelled request, never a reopened terminal record. Two real messages, proposals,
approval/decline and completion go through the existing application APIs/UI.
Only the injected fixture clock and browser Date display advance for handoff;
neither the OS clock nor stored lifecycle events are fabricated.

Screenshots are from the running production build, not generated concepts. Empty
login/register forms are captured before entering credentials. No passwords,
cookies, tokens, request headers, traces, real accounts or residential addresses
are recorded. Other displayed names/text/IDs are disposable synthetic fixtures.

## Acceptance matrix

PASS means exercised locally; the evidence column distinguishes the new integrated
journey from retained browser and backend/component regression coverage. It does
not mean every combination/device was manually tested.

| Area / expected behavior | Result | Evidence |
| --- | --- | --- |
| Landing explains free local giving; navigation separates finding/giving | PASS | New acceptance landing, anonymous area selection; existing readiness/menu/skip-link test |
| Anonymous state → canonical metro, selected region, truthful empty/populated results | PASS | New acceptance; `discovery-ux` and `location-discovery` browser cases |
| Valid URL beats saved area; invalid preferences/unsupported states never trigger global browse | PASS | Retained discovery browser cases, PublicItems/regions component and API tests |
| Region/cursor/filter reset, Back/Forward, reload and direct links retain valid context | PASS | New listing Back/Forward/refresh; retained discovery and pickup navigation cases |
| Independent A/B registration, server-validated login/logout/session expiry, intended destination | PASS | New registration returns A to plans and B to the intended request form; retained two-account workflow and identity tests |
| Plan create/edit, required-field focus, region/zone suggestion and explicit correction | PASS with P2 UX-03 | New create/edit and declined-discard check; retained listing/form/plan tests; validation summary can remain after field correction |
| New past dates, historical dates, UTC cutoff, DST gaps/folds and future eligibility | PASS | Backend plan/item/pickup/rescheduling tests; browser native input/validation tests. Not physical native date-picker certification |
| Name-only draft, required publication details, dependent type/category, repeat creation | PASS | New three-item flow and double-click; retained listing-inventory tests |
| Availability inherits deadline; advanced overrides, stale item versions and legacy compatibility | PASS | Retained inventory/listing browser cases and backend item tests; no migrations |
| Draft/Posted/Reserved/Hidden/Expired/Cleared/Picked Up remain distinct | PASS | New reservation → real completion; retained inventory/browser and provenance integration tests |
| Item search, synonyms, category/type/condition/date/place filters, sorting, exact totals | PASS | New category/type/condition/pickup/sort combination; retained workflow/discovery browser and regional API tests |
| Optional filters clear without losing region; no private draft in public results | PASS | New Clear filters and two-result count with three owned items |
| Owner sees Your listing and cannot request own item; public DTO excludes private identities | PASS | New owner UI plus real backend 409; private IDs/emails checked without logging them; retained public serializer tests |
| Two request submissions, rapid-click duplicate prevention, giver accept/decline | PASS | New separate-item requests and exactly two sent records; giver list and decisions |
| Acceptance reserves, does not hand off; regional count excludes accepted reservation | PASS | New count 2 → 1 and Reserved without Picked Up; unique-index/transaction tests |
| Conversation entry/deep link, correct item/role, actual two-way text/manual Refresh | PASS | New canonical hash focus and two real messages; retained request-entry cases |
| Chronology, bounded cursor/gaps, Load earlier, reading position, multiline/2,000-character bounds | PASS | Retained `pickup-chat`, conversation history/component and API tests; unchanged three-pixel reading-position assertion |
| Recoverable drafts, duplicate guard, 429 server wait guidance and uncertain POST recovery | PASS | Retained chat/recovery tests actually commit before simulating a lost response; no automatic retry |
| Formal proposal approval and decline preserve confirmed time until acceptance | PASS | New both-role proposals; pending appointment unchanged; accepted time changes; declined time does not |
| Chat text is not an appointment update | PASS | New literal “Let's meet at 3 PM” send followed by a read proving unchanged confirmed time |
| Self-approval, stale versions, expiry, uncertain proposal result, independent drafts | PASS | Retained scheduling UX/browser/component and transactional integration tests |
| Legitimate completion, declined/cancelled/no-show history and manual-clearance distinction | PASS | New completion and separate decline/cancel; retained workflow no-show and inventory provenance/reopen tests |
| Closed original participants read history; terminal sends fail | PASS | New completed history with two messages and real POST 404; declined history; retained terminal-state API tests |
| Anonymous/expired sessions, cross-account plan/inventory/request/conversation isolation | PASS | New anonymous 401/cross-owner 404; retained identity/workflow/request-entry and message tests |
| Deleted/corrupt ownership/participant references deny access, including closed history | PASS | Backend integration fixtures and component denial paths; no public delete endpoint or data-repair feature invented |
| Late responses/account switches hide old private state and cannot invalidate a new session | PASS | Retained loader/auth/conversation/discovery component tests; cross-role browser coverage |
| HTML/503, failed catalog, stale cursors and loading differ from successful empty results | PASS | New injected HTML 503/error/no-count/retry; retained offline/discovery/recovery tests |
| Unsaved navigation/reload/editor cancellation and confirmation cancellation | PASS | New declined plan navigation; retained draft/form/listing/pickup/scheduling browser cases |
| 1440/768/390/375/320px and 200% text reflow | PASS, sampled | New capture audits plus retained layout/keyboard/chat/history tests; no document overflow in sampled views |
| Physical Safari/iOS keyboard/date controls; manual assistive technology; actual browser zoom | NOT VERIFIED | Required human follow-up; no physical device or screen reader used |
| Hosted deployment, remote index readiness, production exposure and performance at scale | NOT VERIFIED | Separately approved operator validation required; no live request or provider operation performed |

## Visual and accessibility review

The new acceptance captures **38 views**: 17 desktop and 17 at 320px, plus
768px tablet, 390px, 375px and 640px with 200% root text sizing. Each capture checks
horizontal overflow and axe WCAG 2 A/AA + 2.1 AA rules. The JSON manifests contain
browser version, view/width and rule IDs, never credentials.
CSS viewport widths are reported; emulated mobile device scaling makes some PNG
bitmap widths larger than their CSS viewport. Existing tests add
keyboard menu/Escape, skip link, field associations/focus, native disclosure and
conversation scroll checks. A zero axe result is not full WCAG certification.
200% root text is a reflow stress test, not physical browser zoom certification.

Visual inspection finds clear location-first discovery and item cards; plan and
inventory controls use concise primary actions; status, confirmed appointment,
formal proposal and conversation remain distinct. Long messages wrap; the composer
stays in normal flow. Registration and public-detail surfaces still visibly use
older form/button vocabulary. These findings are recorded below, not hidden by
passing automated checks or expanded into a cosmetic redesign.

| Journey / state | Desktop | 320px |
| --- | --- | --- |
| Anonymous landing | [View](assets/milestone-6.4e/desktop-landing.png) | [View](assets/milestone-6.4e/mobile-landing.png) |
| Region selection | [View](assets/milestone-6.4e/desktop-region-selection.png) | [View](assets/milestone-6.4e/mobile-region-selection.png) |
| Successful empty metro | [View](assets/milestone-6.4e/desktop-empty-region.png) | [View](assets/milestone-6.4e/mobile-empty-region.png) |
| Login | [View](assets/milestone-6.4e/desktop-login.png) | [View](assets/milestone-6.4e/mobile-login.png) |
| Registration before credentials | [View](assets/milestone-6.4e/desktop-registration.png) | [View](assets/milestone-6.4e/mobile-registration.png) |
| Giver plan setup | [View](assets/milestone-6.4e/desktop-plan-setup.png) | [View](assets/milestone-6.4e/mobile-plan-setup.png) |
| Publication validation | [View](assets/milestone-6.4e/desktop-publication-validation.png) | [View](assets/milestone-6.4e/mobile-publication-validation.png) |
| Two posted items and incomplete draft | [View](assets/milestone-6.4e/desktop-inventory.png) | [View](assets/milestone-6.4e/mobile-inventory.png) |
| Regional discovery | [View](assets/milestone-6.4e/desktop-discovery.png) | [View](assets/milestone-6.4e/mobile-discovery.png) |
| Combined filters | [View](assets/milestone-6.4e/desktop-filtered-discovery.png) | [View](assets/milestone-6.4e/mobile-filtered-discovery.png) |
| Listing detail | [View](assets/milestone-6.4e/desktop-listing-detail.png) | [View](assets/milestone-6.4e/mobile-listing-detail.png) |
| Pending request | [View](assets/milestone-6.4e/desktop-pending-request.png) | [View](assets/milestone-6.4e/mobile-pending-request.png) |
| Accepted request | [View](assets/milestone-6.4e/desktop-accepted-request.png) | [View](assets/milestone-6.4e/mobile-accepted-request.png) |
| Real two-way conversation | [View](assets/milestone-6.4e/desktop-conversation.png) | [View](assets/milestone-6.4e/mobile-conversation.png) |
| Formal time proposal | [View](assets/milestone-6.4e/desktop-time-proposal.png) | [View](assets/milestone-6.4e/mobile-time-proposal.png) |
| Completed handoff/read-only history | [View](assets/milestone-6.4e/desktop-closed-history.png) | [View](assets/milestone-6.4e/mobile-closed-history.png) |
| Recoverable HTML/503 response | [View](assets/milestone-6.4e/desktop-recoverable-error.png) | [View](assets/milestone-6.4e/mobile-recoverable-error.png) |

Additional actual views: [768px](assets/milestone-6.4e/desktop-reflow-tablet.png),
[390px](assets/milestone-6.4e/desktop-reflow-mobile390.png),
[375px](assets/milestone-6.4e/desktop-reflow-mobile375.png),
[200% text](assets/milestone-6.4e/desktop-reflow-text200.png).
[Desktop audit](assets/milestone-6.4e/desktop-audit.json) and
[320px audit](assets/milestone-6.4e/mobile-audit.json) are machine-readable summaries.

## Triage: confirmed UX debt and follow-up investigations

No new confirmed P0/P1 application defect requires a code-fix PR. No application
fix is included or claimed. P1 launch gates are separately listed below. The
following are retained honestly rather than downgraded to obtain acceptance.

- **UX-01 — P2, confirmed pre-existing design-system adoption gap.** Route
  `/app/register`, anonymous/new member. Reproduce at 1440px and 320px, compare
  the form with Login. Expected: similarly usable form width and 44px controls.
  Actual measured registration widths are ~280/224px, inputs 38px and submit
  40px high; Login is 432/288px with 44px inputs/buttons. See registration/login
  screenshots and `visual-metrics.json`. Root cause: old Bootstrap column/global
  container cascade and `RegisterPage.css`, already identified in the A audit.
  Registration/validation/redirect work at 320px and axe reports no finding; this
  is not a demonstrated serious accessibility/core-flow blocker. Recommend a
  focused future shared-form adoption retaining all auth/draft/error behavior.
  Existing debt, not a new localized regression; deferred for human feedback.
- **UX-02 — P3, confirmed copy/visual inconsistency.** `/app/items/:id`, anonymous
  or requester. Open a listing and compare it with discovery. Expected: one
  clear request action and singular refresh wording. Actual: the request works,
  but old blue controls remain and “Refresh listings” refreshes only this item.
  Evidence: listing-detail screenshots and `PublicItemDetail` in `PublicItems.js`.
  Root cause is partial design-system adoption. Recommend a later small wording/
  token adoption; no launch-blocking behavior demonstrated, no cosmetic PR here.
- **UX-03 — P2, confirmed recoverable validation-feedback defect.** Route
  `/app/plans/new`, giver. Submit the empty form, then correct every highlighted
  field without submitting again. Expected: the summary no longer directs the
  user to nonexistent highlighted fields. Actual: field errors clear, but the red
  “Check the highlighted fields.” summary remains until the next submit; the
  corrected form then saves successfully. Evidence: plan-setup screenshots and
  `useFormErrors.clear`, which removes only field errors. The shared hook predates
  this milestone; this is not a failed save or new lifecycle regression.
  Recommend a focused feedback follow-up distinguishing client field summaries
  from still-relevant server/global errors, with regression coverage across forms.
  Do not simply clear every server error on typing. Deferred P2, not a local-trial
  blocker; human checklist explicitly includes this known inconsistency.
- **INV-01 — P2 investigation, not a confirmed defect.** All forms/conversation,
  mobile and assistive-technology users. Reproduce the human checklist using a
  physical Safari/iOS keyboard, screen reader and real 200%/400% zoom. Expected:
  usable focus, native date entry, announcements and unobscured composer. Actual:
  Linux Chromium/reflow/axe pass; these environments are unavailable/unverified.
  Evidence: sampled audits, not a simulated physical-device pass. Root cause
  unknown until tested. Require human acceptance before broad public exposure.

Intentional limitations are **not defects**: manual conversation refresh/no unread
markers; memory-only drafts lost after accepted discard/session loss/termination;
no automatic POST retry or idempotency key; UTC item calendar bounds vs IANA pickup
appointments; a plan deadline rather than a separate plan pickup-window model;
curated 2021 geography rather than nationwide cities/GPS; conservative timezone
suggestions; no attachments, image uploads, messaging notifications or global inbox.
Larger enhancements need a new product decision, not silent scope expansion.

## Public-launch gates — still deferred, not resolved by acceptance

These are operator/product findings, with route “deployment/operations” and role
“owner/operator”. Reproduction is documentation/configuration review only; no
remote probe was run. Provider observations remain the historical owner reports.

| ID / severity | Expected vs documented actual; evidence/root cause | Required resolution / disposition |
| --- | --- | --- |
| OP-01 / P1 launch gate | Durable, reviewed Atlas access vs historical temporary broad rule with unverified expiration; dynamic Vercel/GitHub egress. [Operations](operations-runbook.md#atlas-access-and-least-privilege) | Owner chooses sustainable runtime/runner/backup access and verifies expiration/least privilege. No automatic firewall extension, user change or paid tier |
| OP-02 / P1 launch gate | Verified encrypted backup and tested restore vs no confirmed recovery drill; M0 has no managed backups. [Recovery proposal](operations-runbook.md#low-cost-backup-and-isolated-restore-proposal) | Approve owner/storage/keys/retention/no-writes export and isolated restore; measure RPO/RTO. Replica set is not backup |
| OP-03 / P1 launch gate | Approved production DB/origin/routes/credentials/protection vs staging-only evidence. [Readiness](production-readiness.md) | Independently verify frontend AND direct API protection, production inventory and same-origin HTTPS/Secure HttpOnly/CSRF configuration. Do not open registration or route production to staging |
| OP-04 / P1 launch gate | Required indexes on an approved remote target vs remote state unverified. Registry requires `pickup_messages_request_time` and `plan_metro_discovery` | Separately authorize guarded dry-run, inspect physical target/topology/fingerprint/conflicts, then explicitly approve apply if needed. Startup must fail closed; do not assume old warm health proves indexes |
| OP-05 / P1 launch gate | Disposition of relevant dependency advisories vs fresh frontend audit reporting 386 full-tree findings (112 low, 170 moderate, 93 high, 11 critical); backend production audit 0 | These are package-tree advisory counts, not 386 verified browser exploits. CRA includes build/test tools. Historical 99 count is not current clearance. Triage runtime/build/CI reachability and compatible remedies separately; no force upgrades/dependency changes here |
| OP-06 / P1 launch decision | Defined retention/erasure, abuse/reporting/moderation and support vs plaintext indefinite messages, orphan retention, no deletion/reporting/account recovery workflow; [communication security](milestone-6.2-security-readiness.md) | Owner approves policies/operator response before broader exposure. Proposed 90 days is not implemented or owner-approved retention. No TTL, deletion, repair or migration here |
| OP-07 / P2 operational gap | Measured capacity, alerts and shared abuse controls vs unbenchmarked queries, per-instance request limits, no verified hosted client-IP policy or incident ownership. [Runbook](operations-runbook.md) | Approve load/connection/storage budgets, monitor/incident owner and rate-control design before scale. Shared successful-message quotas do not solve multi-account abuse or global GET limits |
| OP-08 / P1 rollout validation gate | Current hosted chat/rescheduling verification and scoped cleanup vs historical 5.7 E2E that creates no messages/proposals | Existing remote test/cleanup scope must not be enlarged silently. Separately review bounded hosted communication fixtures and message cleanup, then authorize remote preparation/deploy/preview/run/cleanup on approved main. No hosted run occurred here |

No operational gate prevents an isolated local synthetic trial; none is accepted
as a public-launch risk by this report. The dependency snapshot is reproducible
read-only `npm audit`, time/service-sensitive, not a completed security scan.

## Final verification and next human step

Final local checks: backend lint and **303 tests**, frontend **322 tests / 17
suites**, strict production build, **56 policy tests** and **36/36 isolated HTTPS
browser scenarios** pass, including the final create/edit/discard acceptance
steps. All original 34 browser scenarios and assertions remain. Census source
verification redownloaded the immutable source, checked its full pinned SHA-256
and all **50** reviewed metro properties without database access. All **16 bundled
demo gifts** remain byte-identical. actionlint 1.7.12 and whitespace/document-link
checks pass; immutable final PR CI evidence is recorded in the PR description.
No old test count is used as a completion assertion.

Normal main CI [40437034615](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/40437034615)
already passes at the tested main SHA; final PR CI is linked in its description
at its immutable reviewed head. Normal CI uses disposable local resources, not
the protected hosted E2E environment. A successful local/CI result is not a new
live staging result. Git-linked provider previews may follow an authorized push;
they are not approved staging or production acceptance.

Follow the [human acceptance checklist](milestone-6.4e-human-checklist.md) with two
independent sessions. Record confusing steps, keyboard/mobile behavior and any
failures before deciding further UX work. Then resolve the operator gates and
authorize any hosted validation separately. No merge, manual deployment, remote
database/index/migration, provider setting, secret/DNS change or production test
traffic is performed by this milestone.

Rollback removes the acceptance test/docs/evidence only. There is no application
or database change to roll back, and no data cleanup or remote operation follows
from closing or merging this documentation/testing PR.
