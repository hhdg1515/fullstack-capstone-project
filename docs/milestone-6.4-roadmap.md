# Milestone 6.4B–6.4E proposal

The B proposal below is superseded by the focused [6.4B implementation](milestone-6.4b-listing-inventory.md),
including required publication details while name-only drafts remain supported.
C is implemented in the focused [6.4C discovery stack](milestone-6.4c-discovery.md).
D is implemented in the [pickup coordination stack](milestone-6.4d-pickup-experience.md).
E has a [local acceptance package and human checklist](milestone-6.4e-acceptance.md),
including known UX debt and unresolved public-launch gates. Each phase gets small
PRs and the existing CI; no remote operation follows automatically. Build on the
[audit](milestone-6.4-design-audit.md) and [shared vocabulary](design-system.md).
Do not change inventory/request state machines as a side effect of styling.

## B: listing and inventory

1. Adopt shared controls/cards on plan forms and item inventory. Keep populated
   inventory first, immediate creation for empty plans, repeated creation focus,
   optional classification and only item name required. Explain Draft vs Publish
   at the action rather than with repeated paragraphs. Test both submit paths.
2. Review past-date semantics with API tests first. Plan deadline already rejects
   new past UTC dates; item form validates date ordering/end cutoff but can select
   a past start, which can legitimately describe an already-available item.
   Do not blindly add `min=today` to all dates or reject historical edits. Decide
   whether UI wording should clarify this without a business-rule change.
3. Plan already owns timezone/location and default availability; item fields are
   optional overrides with a Use plan availability action. Group that summary
   near collapsed overrides rather than introduce duplicate controls. Explicit
   timezone survives region changes; DST and effective deadline stay server-checked.
4. Align owner status and action layout: Published does not imply unreserved;
   Unlist hides without counting as cleared; Mark cleared records dealt-with
   inventory, not an unverified pickup completion. Keep active-reservation
   cancellation confirmations. No destructive delete endpoint/UI is proposed.

Acceptance: existing inventory-first, repeated-create, date-conflict, unsaved-edit,
permission and reservation tests plus 320px keyboard/axe and status screenshots.
Ship forms and inventory/card adoption as separate PRs if needed.

## C: discovery and evidence-backed directory coverage (implemented separately)

First improve long metro headings, selected-region/change action, filter summary
and compact category navigation using existing query state. Keep one region
choice, accurate filtered counts, URL/history/cursor behavior, browser preference
independence and genuine empty/error distinctions. No global listing fetch.

The existing 12 metros are explicitly **2021** Census geography. The following
candidate IDs/names were checked in the same pinned official Census CitySDK
[2021 source](https://github.com/uscensusbureau/citysdk/blob/fc5d7880529fedcde181269fc5d518767221281e/v2/GeoJSON/20m/2021/metropolitan-statistical-area!micropolitan-statistical-area.json)
(metropolitan `LSAD=M1`), rather than invented from city-name similarity:

| ID | Exact source name | Candidate benefit |
| --- | --- | --- |
| 12060 | Atlanta-Sandy Springs-Alpharetta, GA | Adds a supported region in currently uncovered Georgia |
| 33100 | Miami-Fort Lauderdale-Pompano Beach, FL | Adds a supported region in currently uncovered Florida |
| 19820 | Detroit-Warren-Dearborn, MI | Adds a supported region in currently uncovered Michigan |
| 33460 | Minneapolis-St. Paul-Bloomington, MN-WI | Adds Minnesota coverage; cross-state membership must remain intact |
| 37980 | Philadelphia-Camden-Wilmington, PA-NJ-DE-MD | Adds another cross-state search region, including Delaware |
| 26420 | Houston-The Woodlands-Sugar Land, TX | Extends Texas beyond the current Dallas region |

The original proposal below is superseded by the [50-metro implementation](geographic-directory.md).
Its verified 2021 names are retained; none are current-boundary claims.
Choose a small initial batch based on actual intended pilot communities. Before
adding records: validate the full source feature and member-state list, source
hash/version, stable ID, catalog tests and a conservative timezone mapping
(leave suggestions null unless unambiguous). No existing plan rewrite is needed
for additive IDs. A current-vintage refresh requires a separately reviewed
crosswalk, retired/changed boundaries and display-label compatibility strategy;
do not mix vintages invisibly or infer membership from arbitrary user city text.
No GPS, geocoder, mapping service, new infrastructure or remote migration.

## D: messaging and pickup experience (implemented separately)

1. Add a clear conversation anchor from each request's existing review/detail
   entry, retaining item/applicant/appointment/status. Use an explicit formal
   Pickup time change section beside the confirmed appointment; conversation
   text must never alter scheduling state.
2. Use shared surfaces/actions; keep chronological messages, participant labels,
   device-time explanation, scroll anchors, Load earlier and obvious manual
   Refresh conversation. Preserve closed read-only histories and unsent draft
   recovery, retry-after and uncertain-send handling.
3. Improve the mobile composer without sticky controls covering history/focus;
   keep Enter for newline and explicit Send, native accessible text area and
   server quota/participant checks. Test scroll, keyboard and 2,000-character limit.
4. **Unread assessment:** no per-participant last-read watermark or authoritative
   unread count currently exists. Browser-local message counts miss other
   devices/accounts and unloaded history; they must not become an unread badge.
   Defer unread until a separately scoped server read-marker/privacy design is
   approved. No websockets, background polling or notification service proposed.

Acceptance: two independent accounts, pending/accepted/closed requests, actual
message exchange and refresh, draft/navigation cancellation, inaccessible/deleted
reference, quotas, proposal approval/decline/stale version and DST regression.

## E: final visual and functional acceptance

Use only verified disposable local replica-set data with two independent browser
contexts/accounts. Reuse the existing harness, real APIs and production build;
do not duplicate or relax the hosted owner/SHA/fingerprint/data-budget guards.

1. Anonymous opens landing, chooses supported state/metro, sees truthful empty
   state; registers A, logs out and logs back in without losing intended destination.
2. A creates a region-associated plan with explicit valid timezone; publishes
   categorized items and saves a separate draft. Verify name/status/condition,
   owner request suppression and no private location/account leakage.
3. Independent B registers/logs in, chooses region, filters/searches and requests
   two items. A accepts one and declines the other; reservation disappears from
   discoverable count without claiming a handoff.
4. A/B exchange private messages, refresh to see them, protect an unsent draft,
   propose/approve a future time, decline a separate proposal and reject stale
   mutations. Formal time remains unchanged by chat.
5. Advance only the local test clock to complete the accepted pickup; cancel a
   separate request. Both can read closed history, neither can send. Keep closed
   appointment/history and inventory state consistent.
6. Test loading, empty filters, service HTML/503 recovery, quota feedback, expired
   and unauthorized sessions, cross-user plan/request access and account-switch
   data removal. No failed request appears as an empty marketplace.
7. Repeat relevant journeys at 1440px, 390px, 320px and 200% reflow; inspect focus,
   menu, dialog cancellation, long titles, native date/time inputs, card actions,
   chat overflow and composer. Capture only synthetic credential-free screenshots.
   Combine axe with manual screen-reader/real Safari/iOS verification when available.

Run backend tests/lint, frontend tests, strict production build, policy tests,
full local HTTPS browser suite and before/after review. Record exact results and
limitations per immutable PR head. Screenshots are human review evidence, not
fragile cross-platform pixel thresholds. No public launch or hosted readiness
claim follows from local/CI success; earlier operational launch gates still apply.
