# UX-2B3 F1 — Navigation and account/session isolation

Working branch: `codex/m66-ux2b3-item-first-frontend`. Existing uncommitted B3
implementation is preserved. This checkpoint covers F1 only; it does not certify
completion of the forms, visual refinement or full B3 acceptance milestone.

## Changes

- My Listings becomes the primary owner navigation and Start Giving destination.
  Create Listing, private detail and item editor routes remain authenticated;
  legacy plan inventory is explicitly accessible. Existing route tests retain
  protected plan/inventory intent, pickup navigation and discovery history.
- Listing route instances are keyed by authenticated account/status and pathname.
  Old form/list/detail responses cannot repopulate newly mounted account/route
  instances. Unmounted saves cannot navigate the next account to the old item.
- The shared API client captures an authentication generation and rejects stale
  successful or unsuccessful responses, including after asynchronous JSON parsing,
  with `SESSION_CHANGED`. Old 401s never broadcast an unauthorized event to B.
  No response cache, persistent private draft store or POST replay is added.
  Identity-free GET region/taxonomy catalogs remain usable across session checks;
  private and owner-aware responses retain the generation fence.
- Authentication starts clear private identity while checking the new session.
  Superseded login/logout results cannot replace newer authenticated state.
  Logout hides private state while the request is pending; failure revalidates
  `/api/me` rather than assuming either logout or continued authentication.
  Restored browser documents (`pageshow.persisted`) revalidate the session with
  private identity cleared. Ordinary focus retains the existing session check.
- Private detail chooses v1's existing authorized Inventory editor versus v2's
  versioned draft editor from server capabilities. Disabled owner APIs preserve
  the legacy edit-context path; no v2 row is converted or attached to a plan.
- The local HTTPS fixture has an explicit, local-only owner-listings option.
  It prepares the existing index registry only on its verified disposable MongoDB
  replica set. Production/default configuration and backend authorization/schema
  are untouched.

## Executed verification

Final focused React/Jest run: **74 passed, 6 suites, zero failures**:
`ListingIsolation`, `AuthContext`, API `client`, `ownerListings`,
`OwnerItemEditor`, and `Journeys`.

The actual AuthProvider and App router component tests hold A's list response,
wait until it has really started, authenticate B, then release A's 200, 401 or 503.
They verify B identity/content remains and A content is absent. Client tests
separately cover stale 401 event suppression and an A POST whose response headers
arrive before switching but JSON resolves afterward; no second POST occurs.
Existing auth tests retain server-confirmed cookie checks; failed logout now
requires a successful fresh `/api/me` before restoring authenticated state.

Real HTTPS Chromium: **6 passed, zero failures** (three scenarios at desktop
1440px and mobile 320px) in `e2e/listing-session-f1.spec.cjs`:

1. A views and edits a private item, logs out with unsaved text, B logs in and
   sees B's own editor without A's text. A later GET is captured from the actual
   Mongo-backed API, delayed across SPA logout/login, then released as HTTP 200
   after B's own list is visible. A DOM MutationObserver checks for even transient
   A content. B stays authenticated. Foreign A detail is denied; B detail works
   through reload and Back/Forward. Only the one explicit synthetic legacy plan
   exists; independent drafts insert no hidden plans.
2. The same held-request race releases an injected stale HTTP 401 instead. This
   is a transport fault injection using real accounts/backend, not a claim that
   the captured original success was naturally a server 401. B remains signed in,
   owns its visible content and can navigate its private detail/history.
3. A legacy save emits only the authorized plan-scoped PATCH; an independent save
   emits only `/api/items/:id`. B's editor is denied to A with no editable private
   data. After expiring the synthetic local sessions, direct My Listings access
   returns to Login and private data is absent. This last expiry extension was
   rerun at both viewports: **2 passed** (the same two scenarios, not additional
   unique tests).

The tests switch authentication through SPA controls, not a document reload that
would cancel the delayed request. Private URLs and reload are tested separately.
All accounts, photos-disabled records and sessions are synthetic and disposable.
No screenshots/traces or credentials are required for this F1 checkpoint.

Strict production frontend build (`CI=true`) and `git diff --check`: passed.
Initial fixture failures (parsing logout's 204 as JSON; switching before A's mock
request started; hidden mobile navigation) were corrected without loosening
ownership/data assertions. Navigation expectations now reflect My Listings;
existing legacy navigation cases remain. No runner retries or timeout increases.

## Limits and next scope

Session fencing discards results and navigation; it cannot undo a server write
already committed before logout or recall previously delivered data. Other tabs'
cookie changes are detected through server session validation/focus/restoration,
not real-time cross-tab notifications. No physical Safari/iOS, screen reader,
remote Atlas/R2 or hosted deployment is verified here.

The earlier C1 full-browser intermittent timeout remains tracked in the B2 report;
this focused F1 run does not claim it is solved or that the entire application
suite was rerun. F2–F4 form validation, timezone UX, responsive polish, full B3
screenshots and milestone-wide regression remain outside this checkpoint.
All production feature gates stay disabled. No PR, deployment, remote database
operation or merge was performed; changes remain uncommitted for continuation.
