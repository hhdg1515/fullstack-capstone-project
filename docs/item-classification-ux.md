# Item classification UX

This change starts from merged PR #65 (`eab61222923df42fe61f995cead025d3b798af46`).
It changes owner classification entry, not the inventory/publication state machine,
photo pipeline, authentication or discovery filter contract.

## Model and compatibility audit

The catalog previously contained 28 types grouped into six room-oriented categories.
Owners had to select a category before seeing types. The only fallback was
`other-household` / `other`. Inventory validation checks the complete resulting
category/type pair inside the existing transaction; publication still requires a
valid pair and description. Discovery uses canonical IDs, explicit synonyms and
server-side filters before its exact-count/pagination facet. Legacy `category`
strings are separate, bounded text. Drafts can omit classification.

The additive `household-v1.1` catalog keeps all six category IDs, every previous
type ID, labels, memberships and conditions. No items or plans are migrated.
Nine types are added: Television, Monitor, Rug, Curtains, Bicycle, Fan, Heater,
Vacuum Cleaner and Bedding. Explicit synonyms include TV, bike, drapes, vacuum
and sheets. Five category-specific Other types complement the existing global
Other. These groups remain stable browse filters, rather than a claim that an
item can only be used in one room. More fundamental regrouping is deferred.

The owner form searches types, synonyms and category labels across all groups.
Only an explicit choice assigns IDs; typing never invents a type or guesses from
the item name. Category appears as secondary information and is derived from the
chosen entry. Arrow keys, Home/End, Enter, Escape, Tab and pointer selection are
supported. Enter with the list open chooses the highlighted result, never submits
accidentally; Tab does not silently select. An unmatched query offers Other.
Unselected search text is protected as an unsaved edit and must be cleared or
resolved before saving. Name-only drafts remain supported.

## Other and custom types

Category-specific Other entries let owners keep meaningful existing category
filters. Global Other stays `other-household` / `other`, and is always offered
in search results. All Other entries optionally accept `customItemType`, a short
public type description. It is optional so existing Other records/clients remain
valid. It does not create a new canonical ID or browse filter.

The server accepts null/blank or up to 60 Unicode code points, trims/collapses
whitespace, rejects non-string values, markup delimiters, controls, bidi direction
controls and email addresses, and permits nonempty values only for catalog Other
entries. Listing policy also checks this text before publication/public edits.
Public/private DTOs include `classification.customItemType` only when valid and
nonempty; React renders it as plain text on existing item/card components. This
text is public: it must not contain contact or private location information.
Existing general listing safety guidance remains in place. This is bounded plain
text validation, not a claim of automated moderation or complete PII detection.

Changing types explicitly clears an obsolete custom value. Name/condition-only
API updates preserve it, as does an untouched owner form. Existing legacy category
text is never rewritten. Untouched old drafts and classifications keep their
meaning; unavailable catalog requests retain the existing retry/name-only-draft
behavior. No browser-local item draft persistence is introduced.

Discovery's literal escaped text search additionally covers this bounded custom
field. Canonical category/type filters, regional scope, eligibility/reservation
exclusions, stable ID sorts/cursor fingerprints and exact-count aggregation stay
unchanged. Existing Other searches still match the same canonical fallback ID.
No new collection, index, remote preparation or migration is required.

Deploy the compatible backend before or with the new frontend: the new form sends
the additive `customItemType` field, which older backends reject as unknown.
Old frontend/API clients continue to work against the updated backend. A rollback
to the old backend ignores stored custom labels on reads without rewriting them;
the old canonical IDs remain valid. Do not roll back only the API while serving
the new form. Production photo activation remains disabled independently.

## Evidence and verification

Actual HTTPS screenshots use disposable local MongoDB and synthetic accounts.
Before captures use the merged-main production frontend build; after captures
use this branch's strict production build. No generated mockups or real personal
data are used. Both desktop and 320px mobile are captured; 375px also verifies
search and reflow. Screenshots are visually reviewed, alongside automated axe
checks, not treated as a substitute for interaction testing.

| State | Desktop | 320px |
| --- | --- | --- |
| Before | [Before](verification/item-classification/desktop-before.png) | [Before](verification/item-classification/mobile-before.png) |
| Search | [Search](verification/item-classification/desktop-search.png) | [Search](verification/item-classification/mobile-search.png) |
| Invalid custom type | [Error](verification/item-classification/desktop-invalid.png) | [Error](verification/item-classification/mobile-invalid.png) |
| Other/custom type | [Custom](verification/item-classification/desktop-custom.png) | [Custom](verification/item-classification/mobile-custom.png) |
| Inventory | [Inventory](verification/item-classification/desktop-inventory.png) | [Inventory](verification/item-classification/mobile-inventory.png) |
| Discovery | [Discovery](verification/item-classification/desktop-discovery.png) | [Discovery](verification/item-classification/mobile-discovery.png) |

[375px search](verification/item-classification/mobile-375-search.png).

Final test counts and CI evidence are recorded in the PR. Coverage includes old ID
membership, optional/custom/invalid inputs, publication and owner authorization,
editing existing items, legacy text/drafts, synonym/category combination counts,
reservation exclusions, pagination, keyboard selection/error focus and narrow
screen accessibility, plus the unchanged full application regression suite.
Physical iOS/Safari and manual screen-reader verification are not claimed.
