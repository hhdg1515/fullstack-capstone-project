# Milestone 6.4A: screen adoption and evidence

Review foundation PR #47 first, then its dependent Login/My Plans PR. Retarget
the dependent PR to main after #47 merges; do not merge either automatically.
Only these two product screens adopt the new design vocabulary. Shell, Register,
Profile, plan forms, inventory, discovery, requests, chat and scheduling remain
functionally and visually in their previous design, apart from navigation links
inside the opted-in My Plans scope using the shared text/link colors.

## Visual evidence

Actual Chromium screenshots of the strict production build, served with the
existing isolated local HTTPS/API/MongoDB replica-set harness. All accounts,
plans, items and conversations in this evidence are synthetic local fixtures.
Login fields are blank, and no network headers, credentials or cookies are
captured. Browser traces/video/automatic screenshots remain disabled.

| Screen | Before desktop | After desktop | Before mobile | After mobile |
| --- | --- | --- | --- | --- |
| Login | [Before](assets/milestone-6.4/before-login-desktop.png) | [After](assets/milestone-6.4/after-login-desktop.png) | [390px before](assets/milestone-6.4/before-login-mobile.png) | [390px after](assets/milestone-6.4/after-login-mobile.png) |
| Empty plans | [Before](assets/milestone-6.4/before-plans-empty-desktop.png) | [After](assets/milestone-6.4/after-plans-empty-desktop.png) | [390px before](assets/milestone-6.4/before-plans-empty-mobile.png) | [390px after](assets/milestone-6.4/after-plans-empty-mobile.png) |
| Populated plans | [Before](assets/milestone-6.4/before-plans-populated-desktop.png) | [After](assets/milestone-6.4/after-plans-populated-desktop.png) | [320px before](assets/milestone-6.4/before-plans-populated-mobile.png) | [320px after](assets/milestone-6.4/after-plans-populated-mobile.png) |

Generated [concept](assets/milestone-6.4/concept.png) and latest rendered screenshots
were visually inspected with `view_image`; the official Browser/IAB plugin is
unavailable, so repository Playwright was the fallback. Desktop evidence uses
1440×1000 and mobile uses 390×1000/320×1000. The generated board shows scaled
panels, not a native single-page viewport; no pixel-identical match is claimed.
This is an implemented, reviewable proposal, not an assertion of owner sign-off.

## Comparison ledger

| Inspected point | Concept vs actual / decision |
| --- | --- |
| Copy and task | Login and My move-out plans headings retained; short introductions match direction. Empty state deliberately preserves “You have no move-out plans yet” in addition to actionable copy. No metrics, testimonials or new product claims. |
| Width/container | Login expands from ~280px to 432px at desktop; 480px page includes 24px gutters. The concept's nominal 448px target is approximate; implementation uses the documented 30rem token. No narrow Bootstrap grid remains on Login. |
| Typography | Left-aligned 28–32px task titles, 16px explicitly sized controls, 20px card headings, 14px status. Shared system font; no new download or browser-default button type. |
| Palette/geometry | Forest primary, dark text, white surface, subtle borders and 6/8px radii match the restrained direction. No gradient, decorative asset, mobile-device frame or new icon ships. |
| Hierarchy | Empty plan has one Create your first plan action. Populated header has Create a plan; each card groups real title/status then location/deadline and inventory destination. No invented inventory totals. |
| Responsive behavior | Existing Menu and journey nav preserved intentionally rather than copying the concept's static header. 320px controls wrap, long plan title does not overflow, focus stays visible; desktop half-width viewport checks layout reflow equivalent to 200% zoom. Physical browser zoom/iOS keyboard is not certified. |
| States and feedback | Live loading/status and alert errors use the same components; validation summary ref and native form submit still work. API failure is never shown as No plans yet. Closed histories and scheduling rules are not changed. |

Above-the-fold copy review found only intentional changes: shorter Login and
dashboard descriptions; No plans yet replaces the old marketing-style empty
heading; empty guidance is shortened; duplicate empty-state Create a plan is
removed. Login/Register Here, main/journey navigation, plan titles/status/date and
management destinations remain. There are no additional hero sections or claims.

## Functional and accessibility verification

- Backend **292 tests** and lint passed; this milestone changes no backend code.
- Frontend **264 tests / 15 suites** passed, including three shared native/ref/live
  region tests; existing empty/action and failure tests now assert single creation
  target and no false empty state. Strict `CI=true` production build passed.
- **56 deployment/E2E policy tests** passed. Existing workflows, authorization,
  fingerprint limits and remote cleanup code are unchanged.
- New local browser proof passed **2/2** desktop/320px cases: protected redirect,
  invalid field focus/association, wrong password recovery/clearing, Enter login,
  requested destination, single empty action, actual token/control size, keyboard
  creation, long title, authoritative status, correct inventory URL, service-error
  retry and expired-session data removal. Each relevant state passed axe A/AA and
  no-overflow checks; desktop also checks 720px layout reflow.
- Before and after running-app audits each sampled **24** settled views with
  zero axe violations, no horizontal overflow and no server errors. Automated
  checks cover sampled states, not comprehensive accessibility certification.
- Full isolated local HTTPS browser suite passed **24/24**, including all 22
  existing discovery, inventory, request, chat, rescheduling, draft, validation,
  offline and protection-bypass scenarios. Actionlint, whitespace and documentation
  link-target checks also passed.

Full local browser and final CI evidence are recorded in the PR at its immutable
head. Browser-only additions explicitly reject hosted targets; they add no remote
accounts, data budget, workflow or cleanup responsibility. All 16 legacy demo
gift records remain byte-identical. No dependency/lockfile, API, location catalog,
timezone, DST, lifecycle, session, CSRF, database/index or provider change.

No manual deployment, hosted E2E or remote database operation was performed.
Git-linked Vercel previews may be generated by PR pushes; their status is not
live staging verification. Manual screen-reader/physical Safari/iOS testing and
the earlier public-launch operational gates remain unverified. The B–E roadmap
is proposed future work, not completed full-app modernization.
