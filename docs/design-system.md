# Move-Out Marketplace interface foundation

Friendly, content-first Functional Minimalism: one obvious task, familiar words,
truthful status and a short path to the next action. No new UI framework, font
download, decorative icon library or animation. [Audit and concept](milestone-6.4-design-audit.md)
explain the small initial adoption scope.

## Tokens

Source of truth: `giftlink-frontend/src/design-system/tokens.css`. Definitions are
global custom properties only; no existing screen changes until it adopts the
`ui-` vocabulary. Never apply these through a new bare `.btn`, `.container`,
`.row`, `body`, `input` or Bootstrap utility override.

| Family | Values / purpose |
| --- | --- |
| Canvas/surface | `#f4f4f4` existing backdrop / white content surfaces |
| Text | `#1c3029` primary; `#50645b` secondary, readable on canvas and white |
| Primary | `#245746` existing forest-green family; `#183e32` hover; white text |
| Borders | `#ced9d3` surface boundaries; `#6c7e74` for recognizable controls |
| Subtle/status | `#edf3ef` background with dark text; always include a textual status |
| Error | `#a51d2d` text/border, `#fff5f5` background; field errors also have associated text |
| Focus | `#8b4100`, 3px outline, 3px offset; never suppress keyboard focus |
| Typography | System sans; body 16px / 1.5; small 14px; section 20px; title 28–32px / 1.2 |
| Spacing | 4, 8, 12, 16, 24, 32, 48px; avoid page-specific near-duplicates |
| Width | Page 64rem; form page 30rem including gutters; no minimum viewport width |
| Geometry | Controls 6px radius; surfaces 8px; 1px borders; optional minimal shadow token |
| Controls | At least 44px tall; explicit 16px font prevents iOS input zoom; no fixed heights for wrapping text |

These are purpose-based tokens, not a theme engine. Custom properties use rem
units for font/spacing/control dimensions. No CSS `order` rearranges reading order.
At ≤420px page/surface gutters reduce, heading actions wrap to full width and
empty-state actions span available width. Wider viewports retain content bounds.

## Reusable primitives

`design-system/primitives.js` imports the definitions and scoped styles:

- `PageHeader({ title, description, action })`: one native h1, optional concise
  description and native action, wrapping without clipping.
- `Surface`: a restrained boundary for meaningful content. Defaults to `section`;
  `as="form"` or `as="li"` preserves native semantics, attributes, events and refs.
  Give sections an accessible name when they need a named region. Do not nest
  decorative surfaces around every paragraph.
- `Feedback`: live status by default, `error` uses alert semantics. For validation
  summaries pass `tabIndex={-1}` and the existing error-summary ref; the existing
  hook still decides focus. No auto-dismiss or invented success state.

Small explicit CSS vocabulary avoids a new button or form abstraction:

- `.ui-page`, optional `.ui-page--form`: content and typography scope.
- `.ui-button`: native button **or** real navigation link. Primary is for the
  screen's next task; `--secondary` is a neutral outline, `--block` fills a form.
  Keep `type="button"` for non-submit actions. `disabled` stays a native attribute;
  never simulate it on an anchor.
- `.ui-field`, `.ui-field-error`: labels and native inputs/selects/textareas;
  preserve `required`, autocomplete, name, value, ARIA descriptions and error IDs.
- `.ui-status`: a compact text label, **not** a derivation of availability or a
  generic success indicator. A plan's Active status is not a pickup confirmation.
- `.ui-empty`: short explanation and one next action; only render after a
  successful empty response, never instead of a failed/loading request.

Example (use actual route/server state, not fixture data):

```jsx
<main className="ui-page">
  <PageHeader title="My move-out plans" description="Choose a plan to manage items and pickups." />
  <Feedback error><p>Could not load plans.</p><button className="ui-button ui-button--secondary" onClick={retry}>Retry</button></Feedback>
</main>
```

## Navigation, cards and state vocabulary

Keep existing primary Find Free Items / Give Away / Account routing. JourneyNav
keeps browser and owner tasks separate with `aria-current` and its existing
44px links. Shell/nav token adoption is deferred; no new global navigation styles
or text changes are bundled into A. A future adoption should use the same widths,
spacing, focus and color tokens, and preserve Menu/Escape/current-route behavior.

Plan cards group title and server status, then location and deadline, then the
inventory destination. No inferred inventory total is displayed. State treatments
must include words: Published, Pickup arranged, Cleared and Completed describe
different resources/events. Availability remains authoritative backend data.
Dangerous actions retain existing confirmations; color alone is never sufficient.
Private chat sender text accompanies bubble alignment/color; formal scheduling
remains separate. No unread, realtime or response-time claims without evidence.

## Accessibility and validation contract

Keyboard navigation, native semantics, visible focus, labels, field errors and
screen-reader status/alert distinctions are acceptance requirements. Minimum
text contrast is 4.5:1, large text 3:1; active control outlines at least 3:1.
Disabled controls are visibly disabled and cannot submit. Verify actual computed
styles, including hover/focus/error states; token values alone do not prove the
browser cascade. Keep password and private drafts out of localStorage, screenshots
and browser traces. Browser-local region preference remains separate.

Check desktop, 390px and 320px; include 200% zoom/reflow, long titles/locations,
multiple plan statuses, empty/loading/errors, expired sessions and authorization.
Run axe plus keyboard and real-flow checks; automated success does not certify
manual screen-reader or physical iOS/Safari behavior. Do not add brittle
pixel-perfect snapshot tests with dates, IDs or dynamic font rendering.

## Adoption and rollback

Milestone 6.4B extends this vocabulary to plan create/edit, item forms and owner
inventory; see its [scope, status meanings and evidence](milestone-6.4b-listing-inventory.md).
Posted/Reserved/Picked Up/Hidden/Cleared are presentation labels derived from
backend publication/reservation/completion data, never CSS-only business states.

First foundation PR adds definitions/primitives/docs only. Second dependent PR
adopts Login and My Plans, with before/after evidence and regression coverage.
Other pages keep their existing local/Bootstrap CSS until a focused phase adopts
the same vocabulary. Temporary mixed styling is intentional scope control, not
completion of a full-app modernization. Removing the two screens' new classes/
primitive composition restores the old rendering; no database or deployment
migration is required. Revert the screen-adoption PR before the foundation if
both must be rolled back. Do not delete legacy CSS until its final consumer is
audited and migrated in a separate change.
