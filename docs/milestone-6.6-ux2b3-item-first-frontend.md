# UX-2B3 — Private Item-first frontend

Branch: `codex/m66-ux2b3-item-first-frontend`.
Approved baseline: merged PR #79 / main
`9299c2be5f2b745cd5d2c0d4b11d18be5bf2dc6f` (same tree as PR head `4a883c0`).
Verification date: 2026-10-31, America/Los_Angeles.

This implements private draft management. It does not activate public v2 listings,
photos, pickups or messaging. Backend authorization, schemas/index definitions,
feature defaults, dependencies, taxonomy, provider configuration and the 16 demo
gifts are unchanged. No automatic migration, hidden plan or remote operation occurs.

Supporting focused evidence is preserved without replacing its historical results:
[F1 navigation/session isolation](milestone-6.6-ux2b3-f1.md),
[F2 timezone/validation](milestone-6.6-ux2b3-f2.md),
[F3 drafts/inventory](milestone-6.6-ux2b3-f3.md).
This report records the consolidated final integration verification, not a sum of
their overlapping focused test totals.

## User experience and API integration

| Frontend route | Behavior / approved API |
| --- | --- |
| `/app/listings` | Authenticated mixed v1/v2 owner inventory, `GET /api/me/items`. Primary navigation and Start Giving destination. |
| `/app/listings/new` | Name-only or more complete private draft, `POST /api/items`. No plan creation. |
| `/app/listings/:itemId` | Owner-only detail, `GET /api/me/items/:itemId`; classification, location, deadline and explicit timezone confirmation state. No public-share URL. |
| `/app/items/:itemId/edit` | Server capabilities choose v2 `PATCH /api/items/:itemId` with current version, or the original authorized v1 editor and plan-scoped PATCH. |
| `/app/plans` and existing plan/inventory routes | Explicit legacy compatibility; existing records, public URLs, photos, pickups, conversations and appointment semantics retained. |

`Listings.js` provides MyListings, ListingDetail and ListingEditor. ListingForm
uses the existing design-system PageHeader/Surface/Feedback, form error hook,
RegionFields, searchable ItemTypeSelector and public catalogs. `api/ownerListings`
uses the existing cookie/CSRF/JSON client and validates response envelopes.

My Listings shows backend statuses/reservations, general location, classification,
deadline and permitted legacy thumbnail previews. No-photo/disabled/unavailable
states keep navigation usable. There are explicit loading, empty, retry and
feature-disabled states, plus Incoming requests and legacy inventory entries.
Pagination uses the returned bounded cursor; retries retain loaded cards and use
the failed cursor. Invalid cursor refresh is explicit. There is no client-side
filter/sort, fake total or global query fallback. The first newly appended item
receives focus after Load More. Unknown statuses are not invented as Draft.

Private v2 forms expose no working Publish, Withdraw, Upload or pickup/chat action.
Saving is never described as publication. Legacy editor/photo behavior remains
unchanged; no plan-scoped photo endpoint is used to upload a v2 image.

## Dates, validation and save recovery

- Only name is required for a private draft; all supplied optional fields still
  satisfy the approved backend validators. Classification determines its canonical
  category; directory/type data are reused, not duplicated.
- Suggested IANA zones come from existing metro data and require a separate
  explicit confirmation. Context changes clear confirmation. Unchanged confirmation
  is omitted from PATCH rather than issuing fresh owner intent; checkbox changes
  send the exact selected zone and version. No browser/account zone is inferred.
- V2 dates use the giver's confirmed local calendar and the backend Temporal
  boundary tuple. Real LA/NY examples produce different exclusive UTC expiry
  instants. Legacy v1 UTC dates and historical appointment snapshots are untouched.
- Errors map to actual controls, with aria associations, summary links and focus
  after busy state ends. Save is reachable after name and at the form end, using
  one in-flight fence. No sticky overlay or disappearing save control is added.
- Successful creation/editing navigates to canonical saved detail. Definite
  failures retain input. Stale versions retain edits, block replay and offer
  canonical new-tab review before explicit discard/reconciliation.
- Ambiguous create locks resubmission and retains the form and leave protection.
  Inspect My Listings in a new tab; the approved POST has no idempotency token,
  so the client must not automatically repeat it. Versioned edits never silently
  overwrite a concurrent saved version.
- Existing account-scoped unsaved-change protection handles links, Cancel and
  Back/Forward. Real Chromium reload/tab-close warnings are tested. Successful
  save releases the guard before navigation, avoiding duplicate confirmations.
  Private draft contents are not persisted in browser storage.

## Session isolation and security review

The final source diff was reviewed through changed runtime paths and supporting
authorization/guard contracts, with deterministic component and real HTTPS races.
This is a scoped source/test review, not a claim of an exhaustive platform scan.

The API client captures session generation before requesting private or owner-aware
data and checks after headers and JSON parsing. Stale success/failure is discarded;
an old 401 cannot invalidate B. Only identity-free region/taxonomy catalogs are
exempt. Reconfirming an already anonymous visitor does not change generation;
known session loss, authentication, logout and restored-document boundaries retain
their fences. Public list/detail scopes also distinguish checking-session from
confirmed anonymous state, and region options refresh with their viewer.
Authentication transitions hide old identity while checking server session
state. Failed logout restores identity only after fresh `/api/me` confirmation.
Superseded authentication results cannot replace newer client identity.

Listing instances are keyed by authenticated account/status and route, with active
response guards. Late A lists, details or saves cannot repopulate B or navigate B
to A's saved item. Native cookies and backend ownership remain authoritative.
Other-tab cookie changes are detected on session validation/focus/restoration;
there is no realtime cross-tab notification guarantee. Generation fencing cannot
undo an already committed A write or recall previously delivered bytes.

Private owner APIs and Origin + CSRF writes remain unchanged. Foreign detail/edit
receives the existing denial without private content. DTOs do not expose parent,
owner, coordination/image counters, storage keys, signed tickets or messages as
visible listing information. Thumbnail URLs stay application-controlled, with
validated IDs and failure fallbacks; no provider URL is manufactured. React renders
plain text. Public discovery/detail still refuse unpublished v2 drafts; backend
publication and pickup attempts remain rejected. No backend gate is bypassed.

### Integration corrections found by full regression

1. The first full frontend run had **501 pass / 2 fail (503 total)**. One old logout
   fixture supplied only the initial session and failed POST, not the now-required
   server session revalidation. It now supplies and asserts that third request;
   sign-in/error assertions are retained rather than trusting failed logout.
2. The second failure exposed a real discovery integration gap: owner-aware lists
   refreshed after session change but location options did not. The generation
   fence correctly rejected the old options request, leaving no usable options.
   The existing locations effect now also depends on viewer. A deterministic old
   response race verifies fresh options survive and old options are ignored.
3. Primary navigation changed to My Listings, so the full legacy/hosted two-user
   workflow now enters stable `/app/plans` explicitly, independently of the private
   v2 gate. It retains the legacy Incoming requests navigation. All original
   auth, privacy, CSRF, publication, pickup, chat, scheduling and cleanup assertions
   are retained. Incoming requests is directly accessible from the new inventory.
4. Private detail now shows classification, availability and truthful timezone
   confirmation labels, with capability-based editing and readable statuses.
   Two component cases verify confirmed/unconfirmed behavior and no public action.
5. The initial browser execution exposed an anonymous lifecycle regression:
   initial/routine anonymous `/api/me` 401 checks invalidated concurrent public
   requests while list/detail scope stayed `anonymous`, preventing a fresh read.
   Observed D1/MVP pages showed `Session changed` instead of counts; discovery and
   the legacy workflow also failed at public result assertions. The superseded run
   was stopped at **38 pass / 5 fail / 1 interrupted**, with **47 not executed**;
   it is not a complete run or evidence for the queued C1 cases. The fix above
   preserves real identity-change fencing, with three AuthContext boundary tests
   and two deterministic initial public-response races. All **511** frontend tests
   pass afterward; the exact D1 anonymous gallery case passes in real HTTPS.
   A new fresh complete 91-case run follows; no broad runner retry or security
   assertion change substitutes for it.
6. The next complete run was **88 pass / 3 fail**, with all **10 C1 cases passing**.
   The two legacy workflow failures were its strict error monitor counting the
   four expected `OWNER_LISTINGS_DISABLED` 503 responses from visiting new owner
   navigation with its gate off. The compatibility URL above avoids coupling that
   existing hosted/legacy scenario to optional v2 APIs. The error monitor and
   zero-unexpected-server-error assertions are unchanged; no 503 whitelist is added.
7. The remaining E1 failure occurred while the actual run crossed UTC midnight:
   its final daily-success assertion expected 3 but observed 0. Existing quota
   normalization intentionally rotates daily counters; lifetime operation count
   remained 3. The test now verifies the exact three immutable operation identities,
   their original creation-day charge bindings, all three retained lifetime success
   charges and daily counters for the actual quota window. It retains physical
   cleanup, byte reduction, two Ready records and tombstone/privacy assertions,
   and additionally requires zero active/reserved/held quota. No quota behavior or
   limit changes. Existing deterministic backend rollover tests also pass.
   The affected desktop E1, legacy workflow and full-Chromium native zoom case
   pass together (**3/3**); these repeat existing cases and do not increase totals.

No application security/resource limit, automatic retry or backend policy changed.

## Verification and baseline comparison

The [approved PR #79](https://github.com/hhdg1515/fullstack-capstone-project/pull/79)
records baseline counts; its tree matches current merged main. All three merged-main
CI jobs passed on `9299c2b` in
[run 41225677255](https://github.com/hhdg1515/fullstack-capstone-project/actions/runs/41225677255).

| Check | UX-2B2 baseline | Current local result |
| --- | --- | --- |
| Complete native backend | 782 | **782 pass**, zero failures; includes actual SeaweedFS/Sharp, conditional writes, quotas, recovery, control/restore and independent crash/race processes |
| Complete frontend | 457 / 25 suites | **511 pass / 30 suites**, zero failures; **54** additional cases |
| Dependency compatibility | 6 | **6 pass**, lockfiles unchanged |
| Deployment/security policy | 56 | **56 pass**; separate 24-case deployment recheck is an overlapping subset, not 24 extra unique cases |
| Complete isolated HTTPS Chromium | 70 | **91 pass / 0 fail / 0 skip**, all 70 baseline + 21 new B3 cases; retries zero |
| Backend lint / targeted changed frontend lint | Pass | Pass |
| Strict production build | Pass | Pass with `CI=true`, same-origin empty `REACT_APP_BACKEND_URL` |
| actionlint / whitespace | Pass | Pass; actionlint 1.7.12 |

All existing backend files are tested recursively; no photo/recovery subset was
substituted for the full suite. All existing **70** browser cases remain scheduled,
including all **10** C1 cases across desktop/mobile. New B3 cases are F1 **6**, F2
**3**, F3 **10**, F4 **2**: **91** scheduled runner cases. F2/F3 create their own
explicit desktop-engine reflow matrices, so mobile project configuration avoids
a second project pass over those reflow cases. Separate F1/F4 and every baseline
spec retain mobile device emulation; no baseline mobile test is excluded. F4's two project cases
each execute two actual widths (1440/768 and 375/320). Focused reruns do not add
unique cases to this table. Playwright retries remain zero.

Native tests use only receipt-verified disposable local MongoDB replica sets and
private SeaweedFS. The local owner option prepares the existing guarded registry
only in its new disposable database. Default/production settings stay unchanged.
No Atlas/R2, hosted E2E or real user data is used. CI runs the same isolated suites;
it is not production or hosted-provider verification.

### Real browser acceptance and images

The new integrated test registers through the real UI and reaches empty My Listings,
saves a name-only draft, configures LA then creates an independent NY draft, and
checks different deadlines/confirmed zones. Editing one leaves the other's entire
DTO unchanged. Zero plans are asserted before explicit legacy setup; a later owned
legacy item uses only its original plan-scoped writer. Public/foreign access and
publication/pickup attempts are denied. F1/F3 retain actual delayed 200/401/save
races, navigation, uncertain commit/no-replay and session-expiry checks.

F4 screenshots are captured from the real HTTPS app under
`docs/evidence/ux2b3-f4/`, with synthetic identities. The matrix covers these states
at **1440, 768, 375 and 320px**:

| State | Desktop example | Mobile example |
| --- | --- | --- |
| Empty inventory | [1440](evidence/ux2b3-f4/1440-listings-empty.png) | [320](evidence/ux2b3-f4/320-listings-empty.png) |
| Populated independent inventory | [1440](evidence/ux2b3-f4/1440-listings-populated.png) | [375](evidence/ux2b3-f4/375-listings-populated.png) |
| Empty create | [1440](evidence/ux2b3-f4/1440-create-empty.png) | [320](evidence/ux2b3-f4/320-create-empty.png) |
| Partial create | [1440](evidence/ux2b3-f4/1440-create-partial.png) | [375](evidence/ux2b3-f4/375-create-partial.png) |
| Edit | [1440](evidence/ux2b3-f4/1440-edit.png) | [320](evidence/ux2b3-f4/320-edit.png) |
| Private detail | [1440](evidence/ux2b3-f4/1440-private-detail.png) | [375](evidence/ux2b3-f4/375-private-detail.png) |
| Validation/focus | [1440](evidence/ux2b3-f4/1440-validation.png) | [320](evidence/ux2b3-f4/320-validation.png) |
| Stale-version recovery | [1440](evidence/ux2b3-f4/1440-stale-conflict.png) | [375](evidence/ux2b3-f4/375-stale-conflict.png) |
| Feature disabled | [1440](evidence/ux2b3-f4/1440-feature-disabled.png) | [320](evidence/ux2b3-f4/320-feature-disabled.png) |

F3 also tests native **200% Chromium Page zoom**, measured separately from text
zoom or pinch scaling: [form](evidence/ux2b3-f4/native-zoom-200-form.png) and
[inventory](evidence/ux2b3-f4/native-zoom-200-inventory.png). These use viewport
capture and full Chromium (including in CI), not the Settings-less headless shell.
The current evidence set has **38 screenshots**. Complete-run accessibility: **283 passed labeled axe/WCAG checkpoints, zero violations**. No focused rerun is added to that count. Screenshots are inspected for overflow, focus,
reachable saves, card spacing, concise status and absence of private debug values.
Disabled-state screenshot injection is explicitly a transport fixture; real default
gate behavior is also covered by backend and unchanged legacy browser fixtures.

## Gate/index prerequisites and rollback

`OWNER_LISTINGS_ENABLED=false` remains the backend default and both environment
samples are unchanged. B3 introduces no frontend activation toggle. A later
owner-approved private API rollout requires the compatible B2-or-later backend
and reviewed `items_owner_created` index on the exact intended target. Use the
[existing guarded dry-run/apply procedure](milestone-6.6-ux2b2-independent-listing-api.md#activation-and-index-preparation)
only with separate authorization. Startup verifies readiness and never applies DDL.
All photo flags remain independently off; enabling this owner API cannot activate
v2 publishing, photos, pickups or messaging.

Frontend rollback can restore the prior owner navigation/editor while retaining
the dual-model backend and stored drafts. Once v2 rows exist, retain B1-or-later
model discrimination (B2-or-later to retain these private APIs); never roll back to
a binary that assumes all items have a plan. Disable new owner admission if needed
through a separately approved operational change, without deleting/converting
records or dropping the index. Preserve immutable IDs, local deadline tuples,
historical appointments, photos, tombstones, ledgers and unresolved holds. A code
rollback is not authorization for cleanup, quota refunds or data migration.

## Limits and remaining UX-2C

- Native unload warnings are browser-controlled loss protection, not persistence;
  force termination/crashes may suppress them. Private input is not retained
  across explicit logout/discard or account change. Already committed writes can
  finish, while their old responses are fenced from the new account.
- Cross-device/tab realtime session synchronization, physical Safari/iOS, Windows
  Docker Desktop/Edge and manual screen-reader verification are not established
  by these Chromium/Jest/axe runs. No production-readiness guarantee is made.
- The pre-existing intermittent C1 picker/readiness timeout remains a tracked
  reliability limitation. Its actual outcome in this full run is reported below;
  a passing run alone would not prove its cause repaired. No C1 case is removed,
  no broad retry is introduced and no quota/read budget is increased.
- Existing dependency advisories and provider/launch-readiness decisions remain
  their separately documented work. This change adds no dependencies or paid service.
- UX-2C still requires reviewed versioned media/admission/recovery contracts,
  dual-model transactional pickup/communication/lifecycle fences, publication and
  withdrawal validation, request cancellation/media revocation, mixed regional
  filtering/counts and race/restore acceptance before any public v2 activation.
  Legacy conversion requires separate approval; it is not part of B3 or rollback.

Delivery is one PR into main after complete local acceptance. Final immutable-head
CI job results and run URL are recorded in that PR's description/checks to avoid
claiming an older revision's success for a new commit. No merge, deployment,
production configuration, provider operation or UX-2C work is authorized here.

## Final local acceptance snapshot

The final complete process passed all **91** browser cases, including all **10 C1**
cases, with zero failures, skips or runner retries. Desktop **52/52**, mobile
**39/39**. The earlier C1 reliability limitation remains tracked, not declared
repaired. The full run followed the diagnosed fixes; it is not an aggregation of
selected passing reruns. See [machine-readable local evidence](verification/ux2b3-local-acceptance.json)
for source hashes, baseline comparison, exact totals and screenshot inventory.
CI remains a separate immutable-head verification reported in the PR.
