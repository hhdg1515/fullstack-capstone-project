# Milestone 6.1 — Functional Minimalism implementation

The owner selected Functional Minimalism: task completion, truthful status,
short forms and recovery before visual consistency. The [original audit](milestone-6.1-design-audit.md)
remains historical evidence, not a description of every current screen.

This continuation starts at merged main `52b7d099501b74bf4b62c6747e234405704bc70c`
(PRs #30 and #31). PRs #32–#35 were subsequently **merged by the owner**. The closure audit at
`26e1722ec33700b916c776995a9938784416f1bb` found no new critical regression
in automated verification. The prioritized continuation is code-complete;
remaining noncritical audit findings below are explicitly deferred as the owner
transitions to Milestone 6.2. This is not a hosted or public-launch sign-off.

## Review units

| PR | Audit coverage | Behavior and limits |
| --- | --- | --- |
| [#32](https://github.com/hhdg1515/fullstack-capstone-project/pull/32) | A2, B3; part of A8 | Populated inventories show saved items/status before an optional add form. Empty inventories start with quick entry; repeated draft/publish creation remains open and focused. A known missing pickup timezone has a direct setup link which focuses the existing field; unknown metadata does not masquerade as an unset zone. The owner-scoped inventory response adds only the existing `pickupTimeZone` value. No zone inference or publication-rule change. |
| [#33](https://github.com/hhdg1515/fullstack-capstone-project/pull/33) | A3 | Meaningful plan/item/pickup/account/login/register edits warn before route changes, browser Back/Forward/reload, logout and replacing an item editor. Failed saves/logout retain drafts. Successful saves and forced session invalidation proceed. Drafts stay in component memory, never browser storage. Uses the installed React Router's public blocker API with unchanged URLs. Native close/reload warnings depend on the browser and user interaction; mobile process termination cannot guarantee recovery. |
| [#34](https://github.com/hhdg1515/fullstack-capstone-project/pull/34) | A4, A5, A6, C3 | Field errors describe their inputs; the first invalid control receives focus after busy state ends, including inside collapsed item details. Generic/conflict errors focus a summary. Corrections retain other fields and do not jump focus. Limited existing-color/44px-control fixes cover account contrast and full-width private note entry. Server rules remain authoritative, including DST and UTC cutoffs; legacy login remains compatible. |
| [#35](https://github.com/hhdg1515/fullstack-capstone-project/pull/35) | A12; review-card part of B4 | Cards show the linked item, applicant, proposed/appointment time and actual request status. Review opens the exact participant-only request. Notes and full request references are available in a disclosure for ambiguous or identically named applicants. Sent views identify the applicant as You and name the giver. Missing listings retain a review path. Empty status-filter results have a clear-filter action. No guessed identities/counts, global sorting of partial pages, messaging, negotiation or rescheduling. |

The four review units were stacked and are now merged into main. Normal CI on
merged main [40243481459](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/40243481459)
passed. The owner performed the merges; Codex did not merge or deploy them.

## Closure compatibility audit

A fresh run at merged main passed **195 backend tests**, **180 frontend tests**,
backend lint, strict production build and **16 local HTTPS browser tests**.
The request/inventory/plan state machine and participant checks were reviewed:

- Inventory's timezone is still an owner-scoped read projection. Missing-zone
  guidance does not infer a zone or prevent previously allowed publication.
- List-first inventory keeps empty-plan entry and repeated add/focus behavior.
- Navigation/reload/editor/logout guards protect meaningful edits without browser
  draft storage; successful saves and forced session invalidation still proceed.
- Field errors remain associated, actionable and focused after writes stop;
  existing UTC, DST, authorization and backend-validation rules are unchanged.
- Request cards use exact request IDs and backend status, keep same-item
  applicants distinct and preserve both participant journeys and confirmations.
- Existing transactions enforce request versions, acceptance exclusivity,
  cancellation, handoff/clearance and no-show constraints on the server.

No new critical regression was found in this tested scope. Browser-specific
warning suppression and manual accessibility/device gaps below remain limits;
this is not proof that every possible interaction is regression-free.

## Verification boundaries

- Node.js 22; production CRA build with `CI=true` includes frontend lint.
- Local automated checks use only verified disposable MongoDB replica-set
  containers. Existing gift browsing, registration/login, privacy/ownership,
  CSRF, secure cookies, reservations, handoff/no-show, desktop and mobile flows
  remain covered. New browser scenarios explicitly skip hosted runs, so remote
  synthetic-account budgets and cleanup bounds stay unchanged.
- The merged 6.1 revision has 195 backend tests, 180 frontend tests,
  56 deployment/E2E policy tests and 16 local HTTPS Chromium browser tests.
  Exact pass/failure results and normal CI links belong in the PR descriptions;
  these counts describe coverage, not evidence of a hosted deployment.
- Targeted axe WCAG A/AA checks cover invalid authenticated inventory and
  account forms as well as the existing public/account entry pages. This is
  automated coverage, not a full accessibility-compliance claim.
- No new live staging E2E, provider change, remote database administration,
  production verification or deployment is included. Production readiness and
  the deferred [launch gates](production-readiness.md#deferred-public-launch-readiness-items)
  are separate.
- CI #32 initially failed one mobile page-navigation assertion; the failed job
  passed on rerun without a code change. Local desktop/mobile scenarios passed.
  The transient failure's underlying cause has not been established.

## Deferred usability backlog

The following noncritical usability findings are deferred, not silently marked
resolved. They can be addressed in later focused UI work; Phase 1 of Milestone
6.2 is backend-only:

- A8: make draft/publication success provide a clearer next publication action.
  Repeated addition is preserved, but no default save/publication choice changed.
- A7, A11: useful unknown-route recovery and honest legacy-demo messaging/search
  semantics. Preserve the 16 original gift records and existing demo URLs.
- A9, A10: time-eligibility refresh/explanation and neutral terminal-outcome
  wording/next steps. Backend timing, ownership and confirmations stay in force.
- B1, B2 and the remaining B4: primary-navigation context for directly opened
  private requests; plan-card/post-create next action; task-oriented existing
  status-filter links. No frontend-invented counts or partial-page global sort.
- C2: tablet account form width. C1/C4: action hierarchy and shorter readable
  timing help where these reduce task friction. C5 decorative home-page polish
  is optional under Functional Minimalism.
- Manually check screen-reader announcements, keyboard/back/refresh behavior,
  zoom/reflow, Safari and actual mobile virtual keyboards. Chromium device
  emulation does not verify iOS behavior or browser process termination.

A1/D1's authoritative reservation state and B5's content-first discovery were
handled in merged PRs #30/#31. D2 (messaging, negotiation, rescheduling) belongs to
Milestone 6.2, not this batch. D3–D5 (new aggregate data, images, account recovery)
remain separate product/privacy scope. No launch or infrastructure decision is
implied by approving these UI changes.
