# Milestone 6.4C — Geographic coverage and discovery

## Base and review order

Verified before implementation: PR #51 is open at
`841151aed2c9a67eb5a0dee13e50998977c6f1be`, containing PR #50
`7b6adb77d32e422bb414807f8238002152b27f9d` and PR #49
`902bfcd79804d90f58c6ce3ae7bd1a9c399e8616`. No prerequisite was merged
or changed. Start here, not on main.

Dependency/merge order: **#49 → #50 → #51 → geographic coverage → discovery
layout → cards/states/browser evidence**. Each new branch targets its direct
predecessor. Retarget dependents to main only after prerequisites merge; never
merge or deploy automatically.

## Audit and proposal (before implementation)

Read the design system, 6.4 audit/roadmap and 6.3 discovery contract. Ran the
actual existing production build through the isolated local HTTPS/replica-set
harness. Twelve desktop/320px views cover region choice, populated listings,
category filters, empty results, simulated local API failure and owner cards.
All sampled views had zero axe WCAG A/AA findings and no horizontal overflow;
this does not establish visual quality or manual assistive-technology support.

Visual inspection: the full Census metro name and count compete in an oversized
mobile heading; repeated coverage/explanatory text delays the search. Every
filter is hidden together, so even a simple category selection expands a long
form. Cards repeat description/location/window text with no compact comparison
hierarchy and use old blue/gray styles beside the newer green design system.
Errors already differ from emptiness, but cursor recovery and count freshness
need clearer presentation.

The directory has 51 states/DC and 12 metros; one backend catalog drives plan
selection and discovery. Cross-state state selection is an entry point into one
metro, not separate inventory. Plans store IDs, labels remain separate, and old
plans are never inferred from city strings. Existing explicit IANA zones survive
region changes. Canonical categories/types, small literal synonyms, server sort,
filter-bound cursors, and one snapshot facet for exact count/page already work.
No global listing fallback exists. Public DTOs contain a session-derived owner
boolean, no owner ID; account changes refetch/clear stale results. Region-only
localStorage is independent of private plans; valid URL values take precedence.

Implement additively: keep 2021 geography and all 12 existing records, expand to
50 verified metros, retain official names/memberships and add separate compact
presentation labels. Suggest zones only for the existing reviewed subset and
additional California metros; other new metros require explicit zone selection.
Use PageHeader/Surface/Feedback and scoped design tokens for discovery. Keep
common category/type/pickup/sort controls visible, collapse optional condition and
city/neighborhood controls, preserve explicit Apply/Search behavior and the
existing filter URL/count/cursor contract. Cards use real metadata, textual
availability and a detail link; no invented photographs or image infrastructure.

## Safety and verification boundary

Only disposable local databases, synthetic accounts/listings and local HTTPS are
authorized here. No remote DB/index work, hosted E2E, deployment, provider, DNS,
secret, authentication or lifecycle rewrite. All 16 demo gifts remain unchanged.
Physical Safari/iOS and manual screen readers are not verified. Earlier public
launch/network/backup/dependency gates remain separate.

## Coverage implementation

The catalog now contains 50 verified metros (38 additions), spanning 41 states
plus DC. [Source, full selection, compatibility and future verification](geographic-directory.md)
are documented separately. All 12 previous records retain their canonical data;
only an optional compact display label is added. Cross-state integration tests
exercise Philadelphia, Kansas City and Cincinnati through every member state,
with combined classification/search filters, exact totals and private-field
exclusion. Existing plan documents remain byte-for-byte unchanged by reads.

Coverage-stage local verification: full backend suite plus the final 19-test
geographic rerun, 279 frontend tests, strict build, backend lint, 56 policy tests,
actionlint and whitespace checks passed. Baseline evidence includes 12 local
browser/axe samples. Immutable PR heads and full CI/browser counts belong in the
PRs; later stages add the final full-suite results here.

## Discovery layout

The page now uses PageHeader, Surface and existing tokens, with a stable Find free
items heading and a compact area summary. The canonical full metro name stays in
the selector. Category/type are visible; desktop also shows pickup/sort directly.
At ≤600px pickup/sort join optional filters; item type appears after choosing
a category or opening Filters. Reset/help are shown only when useful, and the
selected-area summary avoids an extra padded surface.
Condition and city/neighborhood remain collapsed, with keyboard Escape and safe
focus return. Date errors reopen controls and focus the date; unsubmitted filters
survive disclosure toggles. No modal, GPS or additional form submission is needed
for region selection. Valid URL regions override browser preferences; invalid
explicit URLs offer correction without silently browsing a saved/global region.
Region changes drop city/neighborhood/cursor and retain compatible filters/sort.
Clear filters retains region. Exact counts are separate from the page heading and
are omitted during loading/failure rather than invented.

Layout-stage verification: 283 frontend tests (final focused discovery rerun:
46), strict build, four local discovery/accessibility browser scenarios, and
12 final local screenshot/axe samples passed. All samples had no A/AA findings,
overflow or server errors. Visual review prompted narrower-screen progressive
filters rather than showing all controls at once. The six retained layout images
show region, populated and expanded-filter states at desktop/320px; final card
and error-state images follow in the next dependent change.

CI initially caught the first card falling below the mobile viewport. The layout
was corrected; the original viewport assertion and all workflow safeguards remain.
This was a product reflow problem, not an excuse to scroll in the assertion.
