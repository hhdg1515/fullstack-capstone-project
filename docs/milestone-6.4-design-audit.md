# Milestone 6.4A: experience audit

Baseline: merged main `4f083fd17dc3a2e224b26d1d890c2793f5ee9483`
(Milestone 6.3 PRs #42–#46 merged). Scope: a reusable foundation and two
representative screens, with [later phases planned separately](milestone-6.4-roadmap.md).
Functional Minimalism remains the product principle.

## Tools and official workflow assessment

The session skill catalog (both pages, plus executor skills) contains cloud
runtime/onboarding, security, HyperFrames and Firebase skills. No frontend design,
Figma or Browser/IAB skill/plugin is installed or callable. HyperFrames is for
video composition and Firebase would change the stack; neither fits this task.
The cloud runtime skill was used for environment/network/Docker checks.

Reviewed OpenAI's [Frontend App Builder source](https://github.com/openai/plugins/blob/main/plugins/build-web-apps/skills/frontend-app-builder/SKILL.md)
and [official manifest](https://github.com/openai/plugins/blob/main/plugins/build-web-apps/.codex-plugin/plugin.json),
version 0.1.2 at inspection. Its useful sequence is concept → tokens/components →
real browser comparison. Its from-scratch defaults, asset-heavy suggestions and
agency/pixel-fidelity target are not a reason to migrate this React application
or enlarge 6.4A. This was a source assessment, **not use of an installed skill**.
No package/plugin was installed. Available Image Gen produced a reviewable
[direction concept](assets/milestone-6.4/concept.png); this is a proposal, not an
owner-approved pixel specification. Existing Playwright/Chromium and axe provide
the browser fallback because Browser/IAB is unavailable.

Optional official installation, on an owner's Codex installation with plugin
support (syntax verified with this CLI's help, commands **not executed**):

```sh
codex plugin marketplace add openai/plugins --ref main
codex plugin add build-web-apps@openai-curated
```

The official marketplace declares `openai-curated` and the `build-web-apps`
entry. Review its manifest/source and requested access before approving install;
this writes the user's plugin configuration/cache. The manifest advertises
Interactive/Read/Write capabilities. Companion services may request connection
authorization on use; no Figma connection, payment, database, hosting or API-key
authorization is needed for this CSS/React task. Installation is optional, not a
prerequisite, and no credentials should be pasted into chat. A host that does not
expose this CLI/plugin installation needs its supported plugin-management UI.

## Architecture and running-app audit

React 18/CRA, React Router and Bootstrap 5 already exist. `App.css` imports after
Bootstrap and overrides bare `.container`, `.row`, `.btn-primary`, card and text
selectors. For example, 15% container padding plus Bootstrap columns narrows
desktop Login/Register to approximately 280px. A global primary button is full
width unless a page overrides it. Newer journey/navigation CSS uses green;
plan/inventory pages use blue; profile and chat add separate conventions.

These are cascade/ownership problems, not a need for a new UI framework.
Foundation tokens have no global visual effects; `.ui-page` adoption is explicit.
Existing styles, routes, Bootstrap and unsaved-draft/validation hooks remain.
No backend, catalog, region, lifecycle, session or database change is required.

The actual strict production build was served through the existing disposable
local HTTPS frontend/API/MongoDB replica-set harness. Two clearly synthetic local
accounts created a plan, categorized item, accepted request and private message.
24 settled snapshots covered the following surfaces at desktop 1440px and
mobile 320px (Login/empty plans additionally at 390px). All 24 had no horizontal
document overflow or axe WCAG A/AA violations. This is a sampled automated result,
not full accessibility certification. Screenshots contain only synthetic local
data; no typed credentials, headers, cookies or provider data are captured.

| Surface | Observed issue / preserved behavior | Priority and phase |
| --- | --- | --- |
| Landing/navigation | Green journey identity is useful; global blue controls differ. Mobile Menu works, with Escape/focus return. Long anonymous account explanation consumes desktop header width. | Keep navigation/landing behavior; consolidate tokens now, simplify shell only in a later focused review. |
| Login/registration | ~280px desktop forms; repeated shadow/color declarations; long introductory text competes with task. Labels, autocomplete, error focus, session recovery and draft guards already work. | High: Login proof in A; Register/Profile adoption later. |
| Plan creation/edit | Region → city/neighborhood → timezone form is long. Needed timezone is explicit, blank-only metro suggestions preserve existing values, date validation and reservation confirmation work. | High: reduce repetition in B without changing timezone/DST rules. |
| My Plans | Duplicate create destinations when empty; multi-clause introduction; status detached from card title; inventory link is visually weak. | High: representative dashboard in A. |
| Inventory/item form | Existing items correctly precede creation. Draft/publish emphasis is ambiguous; date overrides are hidden but may permit selecting a past start date. Published/reserved are separate authoritative statuses. | High: B; do not reinterpret cleared as picked up or physically delete history. |
| Public discovery | Backend region filtering and exact counts work. Long Census metro names dominate a 320px heading; advanced filters are collapsed; unsupported states and API errors are honest. | Medium/high: C; preserve query/cursor/count semantics. |
| Item cards/details | Taxonomy/condition fallback is truthful; owner sees Your listing. Public availability and reservation have distinct meanings. Cards repeat location/date text and use generic gray status pills. | Medium: B/C, with explicit state vocabulary. |
| Pickup requests | Item/applicant/appointment/status are present, but all lifecycle actions share an outline treatment; confirmation and request refresh are separate from chat refresh. | High: D; retain confirmations and legal actions from backend. |
| Conversation | Same request-bound chat, chronological history, sender text and different bubble alignment; manual refresh and draft protection exist. Conversation is far down a long request page. Closed history is readable, composer disabled/absent. | High: D entry link/anchor, chronology and mobile composer; no parallel chat. |
| Scheduling | Formal proposal sits separately above conversation. Giver timezone, UTC cutoff and DST explanation is accurate but verbose. Stale proposals and uncertain saves block unsafe retries. | High: D; clearer summary, no negotiation or implicit rescheduling. |
| Loading/empty/error | Some plain paragraphs, some Bootstrap alerts, several retry labels. Failed discovery never becomes zero results; private data clears on auth/account changes. | A demonstrates shared Feedback; later adoption must preserve these distinctions. |
| Confirmations | Browser confirms protect published edits, reservation cancellations, unsaved drafts and state transitions. | Preserve; any future custom confirmation needs keyboard/focus and cancellation tests. |

## Chosen 6.4A proof

1. Login: useful 432px form surface inside a 480px page, left-aligned task heading,
   short introduction, consistent green primary action, 44px controls, shared
   feedback. Keep requested destination, cookie/CSRF client, password clearing,
   form error associations/focus and draft guard.
2. My Plans: one primary creation action in the empty state; compact introduction;
   title/status grouped on populated plan cards; easy-to-find inventory action.
   Keep title fallback, backend status, dates and every existing destination.

The concept is directional. Intentional implementation differences: keep the
existing global header, mobile Menu and journey navigation; keep the explicit
empty-state sentence about having no plans; retain backend-driven populated,
loading, error and session states not illustrated in the concept. No fake data,
mobile-device frame, gradients, new icons, marketing sections or animation ships.

## Before evidence

| Screen | Desktop | Mobile |
| --- | --- | --- |
| Login | [Before](assets/milestone-6.4/before-login-desktop.png) | [Before, 390px](assets/milestone-6.4/before-login-mobile.png) |
| Empty plans | [Before](assets/milestone-6.4/before-plans-empty-desktop.png) | [Before, 390px](assets/milestone-6.4/before-plans-empty-mobile.png) |
| Populated plans | [Before](assets/milestone-6.4/before-plans-populated-desktop.png) | [Before, 320px](assets/milestone-6.4/before-plans-populated-mobile.png) |

See the [design specification](design-system.md) for tokens, accessibility and
adoption boundaries. PRs record immutable heads, CI and final verification.
No hosted E2E, manual deployment, remote database/index or provider configuration
operation is part of this audit. Existing Git-linked previews can be triggered by
an authorized PR push; they are not live staging verification.

Foundation verification: backend **292 tests** and lint, frontend **264 tests**
(including three native-semantics component tests), strict production build and
**56 policy tests** passed. An initial baseline frontend run concurrent with the
build had one region-selector wait timeout (260 passed); its focused five-test
rerun and the complete 264-test run passed without modifying the existing test
or application logic. This is recorded as a transient baseline observation, not
silently omitted or fixed by extending timeouts. PR CI is recorded separately.

The dependent screen-adoption PR adds [after evidence and verification](milestone-6.4a-verification.md).
