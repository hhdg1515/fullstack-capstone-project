# UX-2B3 F3 — Draft lifecycle and owner inventory

Branch: `codex/m66-ux2b3-item-first-frontend`, unchanged HEAD
`9299c2be5f2b745cd5d2c0d4b11d18be5bf2dc6f`.
All preceding uncommitted B3/F1/F2 work is retained. This is a focused F3
checkpoint, not final B3/F4 acceptance. Nothing is committed or pushed.

## Changes

- `components/Listings/Listings.js` and `Listings.css`: opt the owner feed and
  private page shells into existing design-system primitives. Keep server order,
  statuses and cursor boundaries. Retain loaded cards during next-page failure;
  retry the failed operation using its same cursor. An invalid cursor requires
  explicit **Refresh listings**, which requests the first page and replaces the
  old results only on success. No client filtering or sorting is introduced.
- Empty inventory offers prominent Create Listing; loading uses live feedback
  rather than a false empty state. A disabled API explains the unavailable tools,
  hides Create Listing and preserves the legacy plan inventory link. A 401 still
  goes through existing session invalidation. No private cache is persisted.
- Cards retain canonical detail/editor links and authoritative v1/v2 status,
  classification, location, deadline and reservation information. Edit has a short
  visible label and an item-specific accessible name. Successful Load More focuses
  the first newly appended item's link rather than dropping focus when the button
  disappears. Duplicate IDs across pages are suppressed without reordering.
- Photo-disabled/no-photo/unavailable placeholders remain explicit. Only a Ready
  preview with a valid image ID can use the existing application thumbnail route;
  broken previews fall back without disabling navigation. V2 photo uploads are
  never attempted. This does not enable any photo feature.
- `ListingForm.js`: add an accessible form name. Existing shared unsaved-change
  protection, F1 session-generation fences, F2 validation and save sequencing are
  preserved; no replacement draft store or second navigation guard is added.
- `Navbar/Navbar.js`: private item edit routes keep My Listings active; they no
  longer highlight public discovery. This corrects a defect visible in the actual
  desktop form screenshot without changing destinations or route guards. The
  corresponding `Journeys.test.js` regression and narrow/desktop browser
  assertions verify the navigation context. Error states also retain just one
  legacy inventory link rather than duplicating it.
- `ListingLifecycle.test.js`, `OwnerInventory.test.js` and
  `e2e/listing-lifecycle-f3.spec.cjs`: new focused coverage. Existing
  `ListingForm.test.js` / `ListingIsolation.test.js` retain their assertions;
  import order, an unnecessary act wrapper and form queries were corrected for
  strict lint. No security assertion was removed or relaxed.

## Draft and recovery acceptance

| Scenario | Verified behavior |
| --- | --- |
| Dirty Create/Edit → in-app link | Rejecting discard retains fields and route; approving leaves once. |
| Back / Forward | Dirty forms block traversal until explicit approval; returning after approved discard shows a fresh form, not a resurrected private draft. |
| Cancel | Reject retains input; explicit approval unregisters that form's guard and navigates without a second prompt. |
| Reload / tab close | Real Chromium beforeunload dialogs are exercised with both dismissal and approval. Dismissal keeps input; approval discards it. |
| Successful create | One authorized POST; navigate to its authoritative private detail ID; no hidden plan. No discard prompt on the save transition. |
| Successful edit | Versioned PATCH, latest detail content, reload retains saved data and produces no dirty warning. |
| Definite save failure | Input, field errors and leave protection remain; deliberate retry remains available. |
| Stale version | F2's actual concurrent update produces 409, preserves edits and locks replay; canonical new-tab review and explicit discard/reopen remain available. |
| Committed create, lost response | Real local POST commits, response replaced with 503. Input and native leave protection remain, submit is locked, new-tab inspection finds exactly one item. Forced form submission does not replay the POST. |
| Unresolved A create/edit → logout → B | Logout requires explicit discard approval. Actual A write is committed but its response is held until B's inventory is visible. Late 201/200 and simulated old 401 are discarded; a DOM observer sees no old content and no navigation to A. B stays authenticated. One mutation only. |
| Inventory pagination | 21 real drafts yield 20 then 1; injected next-page 503 retains the first 20, retry uses the same cursor, no duplicate cards. Invalid cursor requires explicit first-page refresh. |
| Legacy v1 | F1's actual authorized legacy edit still uses the plan-scoped PATCH; v2 uses the independent PATCH. Foreign detail/editor access is denied. |

An already committed A mutation cannot be undone by logout; the guarantee is
discarding its result in the new account's UI, not cancelling committed work.
An uncertain create has no server idempotency token in the approved B2 contract,
so automatic retry is deliberately prohibited. Inspect canonical inventory before
explicitly abandoning that form. No claim is made that in-memory input survives
an approved reload, tab close, explicit logout/discard or session invalidation.
Private fields are not restored into another authenticated identity.

## Verification evidence

The focused checks use Node.js 22.23.4 and actual HTTPS Chromium with disposable,
receipt-verified local MongoDB replica sets. Existing guarded index preparation is
used only for those new disposable databases. The owner API flag is injected only
into these fixtures. No production settings, existing databases or indexes change.

- Frontend component/integration: **119 passing, 10 suites, 0 failures**. This
  includes all prior F1/F2 focused suites, shared guard tests, seven new actual
  form/router lifecycle cases, nine owner feed cases and a private-editor
  navigation-context case. Deterministic delayed
  success/failure isolation remains covered at the API client/AuthProvider level.
- Strict production build: `CI=true REACT_APP_BACKEND_URL='' npm --prefix
  giftlink-frontend run build` passes.
- Listings lint: from `giftlink-frontend`,
  `./node_modules/.bin/eslint src/components/Listings src/components/Navbar/Navbar.js
  --max-warnings=0` passes.
- Focused browser: **19 passing, 0 failures**: combined desktop project **16/16**
  (F3 ten + F2 three + F1 three), then F1 mobile/320 **3/3**. Playwright retries
  remain zero. After the two screenshot-review corrections, affected F3 desktop,
  320px, 375px and inventory pagination/disabled cases were rerun: **4/4 pass**.
  They assert the correct active navigation and a single legacy recovery link;
  seven affected screenshots were refreshed. This is 19 distinct browser cases,
  plus four repeated affected-case executions, not 23 distinct cases.
- **17 successful axe scans, zero WCAG A/AA violations** in that combined run:
  14 F3 empty/form/feed/recovery/zoom scans plus the three F2 validation scans.
  The affected-case recheck adds **11 successful scans**, also zero violations.
  Native browser dialog accessibility is not assessed by DOM axe.
- `git diff --check` passes. Original demo gifts and backend runtime/schema are
  unchanged. All owned test containers were removed by receipt-based fixture
  cleanup; the original stopped MongoDB container and its two volumes remain.

Reproduction from repository root, using the installed Node 22 toolchain:

```sh
CI=true npm --prefix giftlink-frontend test -- --watchAll=false --runInBand \
  --testPathPattern='OwnerInventory.test.js|ListingLifecycle.test.js|ListingForm.test.js|ListingIsolation.test.js|UnsavedChanges.test.js|AuthContext.test.js|client.test.js|ownerListings.test.js|OwnerItemEditor.test.js|Journeys.test.js'
CI=true REACT_APP_BACKEND_URL='' npm --prefix giftlink-frontend run build
```

From `e2e`, with the local Docker daemon and no hosted E2E origin configured:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test \
  listing-lifecycle-f3.spec.cjs listing-form-f2.spec.cjs listing-session-f1.spec.cjs \
  --project=desktop --reporter=line
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test \
  listing-session-f1.spec.cjs --project=mobile --reporter=line
```

Optional `F3_SCREENSHOT_DIR` saves only synthetic UI screenshots; it does not
enable traces, cookies or request-body logs. F3 refuses hosted E2E configuration.

### Responsive and visual review

The real 1440px, 320px and 375px browser journeys exercise keyboard Tab/Enter,
native dialogs, long names, blank optional fields, pointer save and document
overflow assertions. A separate case uses Chromium's normal **Page zoom = 200%**
in a disposable browser profile: measured CSS width 720 at viewport width 1440,
devicePixelRatio 2 and visualViewport scale 1. It selects a type, keyboard-saves,
reloads and navigates to inventory. This is browser zoom, separate from the
additional 200% root-text/narrow-layout stress check. No extension/admin policy
change is required. Zoom screenshots use viewport capture because full-page
capture in this browser/driver clips the zoomed output.

Ten synthetic screenshots are retained under `docs/evidence/ux2b3-f3/` and were
visually inspected. Visual inspection caught the duplicated long name inside
Edit buttons; visible labels were shortened while accessible item context was
preserved. It also caught the incorrect private-editor navigation highlight and
duplicate unavailable-state link; the final affected browser recheck exercises
those corrections.

| Evidence | Actual capture |
| --- | --- |
| [Desktop form](evidence/ux2b3-f3/f3-form-1440.png) / [inventory](evidence/ux2b3-f3/f3-inventory-1440.png) | 1440px, long item name and blank optional fields |
| [320px form](evidence/ux2b3-f3/f3-form-320.png) / [inventory](evidence/ux2b3-f3/f3-inventory-320.png) | narrow controls, reachable Save and short Edit label |
| [375px form](evidence/ux2b3-f3/f3-form-375.png) / [inventory](evidence/ux2b3-f3/f3-inventory-375.png) | mobile layout and saved content |
| [Uncertain create](evidence/ux2b3-f3/f3-uncertain-create-375.png) | retained fields and blocked replay at 375px |
| [Disabled tools](evidence/ux2b3-f3/f3-disabled-320.png) | explicit service state and legacy recovery at 320px |
| [200% form](evidence/ux2b3-f3/f3-native-zoom-200-form.png) / [inventory](evidence/ux2b3-f3/f3-native-zoom-200-inventory.png) | native browser zoom; viewport screenshots, not full-page captures |

### Test-development failures

Early browser fixtures incorrectly waited for a dismissed reload to finish a
navigation and matched textarea content before a save had reached its detail
route. They now exercise actual native reload with explicit dialog handling and
wait for the authoritative detail URL. Account setup initially passed registration
fields to the strict login contract; it now sends only email/password. An attempted
test-only unpacked zoom extension was rejected by browser administrator policy;
it was removed rather than bypassing that policy. Normal Page zoom works instead.
No application safety check, timeout/retry policy, quota or assertion was weakened.

## Limitations, rollback and remaining F4

- Native beforeunload is browser-controlled, requires user interaction and can be
  suppressed during mobile OS termination, crashes or forced close. It is a loss
  warning, not persistence. Dialog wording/assistive technology are browser-owned.
- Physical Safari/iOS keyboards, Windows/Edge and manual screen-reader behavior
  are unverified. Chromium viewport/keyboard/axe results do not certify them.
  F1's focus/pageshow revalidation is retained; no real-time cross-tab session
  notification or native BFCache guarantee is added.
- Existing React test act warnings from prior asynchronous test fixtures remain
  visible; they are not suppressed. No failing focused assertion is accepted.
- Full backend/frontend/storage/recovery/dependency/policy/browser regression and
  GitHub CI are **not** run for this checkpoint. Those remain F4, together with
  original-spec final acceptance/rollback review and separately authorized PR
  delivery. The pre-existing intermittent C1 browser timeout is not declared fixed.
- There is no remote verification, deployment, Atlas/R2 access or provider change.
  V2 public publishing, photo uploads, pickup requests and messaging stay disabled.

Rollback is frontend-only and requires no data conversion or index removal. Keep
the completed F1 session fences and F2 confirmation/validation protections when
reverting a later reviewed F3 patch. Do not reset this uncommitted worktree or
discard earlier checkpoint files. Legacy inventory remains available at
`/app/plans`; no legacy references, appointments or public rules are rewritten.
