# Milestone 6.1 — UI/UX Refinement plan

Status: **proposed product-design scope; implementation has not started**.
Milestone 6.0 Engineering Hardening is code-complete; its
[deferred launch-readiness items](production-readiness.md#deferred-public-launch-readiness-items)
remain separate. This plan does not authorize launch or infrastructure work.

## Goal and priorities

Help a resident with a confirmed move-out deadline organize multiple giveaways
quickly, while helping a receiver find an item and understand the next pickup step.
Refine the existing Give Away / Find Free Items journeys and shared account.

| Priority | Design focus | Reviewable output |
| --- | --- | --- |
| 1 | Navigation and hierarchy: clear journey labels, return paths and primary actions | Current-flow friction review and proposed information hierarchy |
| 2 | Giver flow: create plan → organize inventory → review requests → record handoff | Mobile-first wireflow; distinguish plans from individual listings, show deadline/progress and the next action |
| 3 | Receiver flow: browse/filter → item details → sign in if needed → request pickup → check status | Wireflow preserving filter context and intended destination; clarify availability, reservation and time zone |
| 4 | Consistency and accessibility: typography, spacing, buttons, forms, status language and feedback | Small reusable visual-style proposal plus loading/empty/error/expired-session/conflict/timeout states |

## Design sequence and acceptance

1. Walk through existing routes with representative multi-item and empty-plan
   scenarios. Record friction and screenshots using synthetic local data only;
   distinguish product decisions from implementation bugs.
2. Produce focused desktop/mobile wireframes and a state/copy matrix for both
   journeys, including destructive-action confirmations and uncertain write
   outcomes. Preserve current pickup states, date rules and privacy boundaries.
3. Review the proposed flows with the owner before UI implementation. Acceptance:
   each screen has a clear next action, a plan is visibly a group of items, no
   extra onboarding is added, and filters/session return paths remain understandable.
4. After design review, implement selected refinements in small frontend PRs.
   Verify existing journeys with local tests/CI and keyboard, focus, screen-reader,
   zoom/reflow and real mobile date-control checks. Record gaps explicitly;
   remote E2E or deployment requires separate authorization.

## Boundaries

Retain React, existing API/data contracts, server authorization, sessions/CSRF,
City + Neighborhood labels and all staging/CI safeguards. Do not add residential
addresses, new product features, messaging, payments, uploads, mapping APIs,
backend/schema changes or a full application redesign. Do not alter Atlas,
hosting, production routing or Deployment Protection. Evaluate progress through
reviewed design artifacts and verified usability/behavior, without engineering-day estimates.
