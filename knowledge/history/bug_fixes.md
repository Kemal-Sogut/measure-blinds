# Bug Fixes History

## 2026-08-20 — Bulk-add width field was unreadable: the 44px "+" button ate a 30% grid track
- **Issue:** reported by the maintainer against the one-line measurement row shipped the day
  before (`grid-cols-[4fr_3fr_3fr]`, Room/Width/Height at 40/30/30 in `BulkAddSectionCard.tsx`).
  On a 375px phone the Width input's own value was unreadable — barely a digit or two visible —
  so a consultant could not confirm what they had typed without selecting the field's text.
- **Cause:** the width input is the ONLY one of the three carrying the 44px panel-separator
  "+" button, and reserves `pr-12` (48px) for it so its text never runs under the button. Its
  30% track came to ~92px on a 375px viewport; minus `px-3`'s left inset and that 48px
  reservation, ~32px of readable text remained — under four monospace digits. The 40/30/30
  split was chosen for the three fields as if they were interchangeable; one of them is not.
- **Fix:** the row is now TWO lines — room name (plus the ✕ remove control, which no longer
  competes with the measurements for width) on the first, Width and Height on the second as
  `grid-cols-[3fr_2fr]`. 60/40 rather than an even split, for the same reason the one-line
  split failed: only the width field gives up 48px to a button, and only a width can hold a
  multi-panel value like `118.5+118`. Nothing about the row's behaviour changed — same inputs,
  same `insertPanelSeparator` caret handling, same Enter-to-add-row hop, same "Panels total"
  caption.
- **Verified in a browser** (the first time any part of this sheet has been): a throwaway Vite
  entry rendering `SectionCard` directly, since the order editor sits behind `ProtectedRoute`
  and no login is available locally. At 375x812 the width field now shows `118.5+118` in full
  where the even 50/50 split still truncated it to `118.5+1…`; the "+" button still inserts at
  the live caret (caret 5 in `118.5+118` → `118.5++118`, caret 6). Harness deleted afterwards.
- **Lesson:** an `fr` split across "similar" inputs is only fair if they carry the same chrome.
  A field with a 44px in-field button has ~48px less usable width than its neighbours at every
  viewport, so it needs either a bigger track or a line of its own — sizing it as an equal
  sibling silently hands the button most of the field.

## 2026-08-19 — Live panel-width shorthand split left focus behind, corrupting keystroke-by-keystroke typing
- **Issue:** found in review of the panel-width shorthand (`da5c852`, branch
  `feat/defaults-bulk-lineitems`). Typing `118+118` into a single-item blind's panel-width
  field ONE CHARACTER AT A TIME — the only way a phone's on-screen keyboard produces it —
  corrupted into panels `['118118', '']` instead of the intended `['118', '118']`. Pasting the
  same string worked fine (a single `onChange` event), which is what let the bug through the
  first review pass.
- **Cause:** `PanelWidths` (`blindForms/fields.tsx`) renders one `<input>` per panel keyed by
  ARRAY INDEX. `setPanel()` spliced a `+`-split value straight into the `panels` array on
  every keystroke; React's reconciler then reused the SAME DOM node for the index the
  consultant was still typing into, force-correcting its `value` down from the live keystroke
  (`'118+'`) to the shorter split result (`'118'`) — but nothing told the browser to move
  keyboard focus to the newly-created panel the split had just produced. The caret stayed
  exactly where it was, so the next keystroke landed back in the original, now-shorter input.
- **Fix (`cccc973`):** extracted the pure state transition into `applyPanelEdit`
  (`panelInput.ts`) — unit-testable without the DOM/React-rendering harness this repo does not
  have (no `@testing-library/react`, no jsdom) — which reports a `focusIndex` (the first
  newly-created panel, `index + 1`) alongside the updated `panels` array. `PanelWidths` reuses
  `BulkAddSheet.tsx`'s existing pending-focus/ref-map/effect pattern to explicitly move focus
  to that index once the new panel's input has mounted.
- **Lesson:** an array of same-shaped inputs keyed by index, where one edit can both correct a
  DIFFERENT index's live value AND insert a brand-new index, needs an explicit post-mutation
  focus decision — React reconciling "same key" as "same DOM node" silently rewrites a live
  keystroke without ever telling the browser's caret to move. The failure mode only appears
  typing character by character; a paste-based manual test cannot reproduce it, which is
  exactly why it survived the first review pass.

## 2026-08-19 — Bulk-add confirm button counted raw rows while expansion filtered blank ones
- **Issue:** found in review of allowing bulk-add rows before a type is chosen (`b41fa94`,
  branch `feat/defaults-bulk-lineitems`, which made `expandBulkSections` skip entirely blank
  rows). `BulkAddSheet.tsx`'s own `itemCount` still counted RAW `rows.length`, so a completely
  untouched sheet — its default single blank row — read "Add 1 item" with the confirm button
  ENABLED. Tapping it ran `validateBulkSections` (which an all-blank row trips no check in,
  now that type/material are no longer required either), expanded to an empty array via
  `expandBulkSections`, and closed the sheet having added nothing at all, with no error shown.
- **Cause:** `expandBulkSections`'s new blank-row filter and `itemCount`'s row count were two
  independent implementations of "how many items will this sheet produce," and only the
  former was updated when the filter was added — the same class of drift this branch's
  2026-08-17 `validateBulkSections` entry above already warned about, this time between a
  count and the function it is supposed to be counting.
- **Fix (`ced893d`):** extracted the shared predicate `bulkRowHasContent(row)` (`bulkAdd.ts`) —
  true once a room name, width or height has actually been typed — and made
  `expandBulkSections`, `bulkAddHasContent` (the discard-confirmation guard) and the sheet's
  `itemCount` all read it, so the three can no longer disagree about what counts as a blank
  row. Also added a defensive second gate in `handleConfirm`: if `expandBulkSections` ever
  still returns an empty array, it sets an inline error ("Add at least one row before
  confirming.") instead of calling `onAdd([])` and closing silently.
- **Lesson:** when a filter is added to what a function PRODUCES, every other place that
  independently predicts or gates on that same count needs the identical predicate, not a
  parallel one that happens to agree today. A cheap defensive check at the one call site that
  would otherwise fail silently (an empty-array guard right before the close) is worth adding
  even after the root predicate is unified, since it turns any future re-drift into a visible
  error message instead of a sheet that quietly does nothing.

## 2026-08-18 — Final whole-branch review fix wave (defaults/bulk/line-item batch)
Branch `feat/defaults-bulk-lineitems`. Five defects found in the FINAL review of the whole
branch (money handling itself was found correct end to end); all fixed in one pass, one
commit. Full report: `.superpowers/sdd/2026-08-17-defaults-bulk-lineitems/final-fix-report.md`.

- **Bulk edit could write an out-of-scope hardware id (`lineItemBulk.ts`).** `applyBulkPatch`
  guarded each hardware field with `uses.has(<slot>)` — true whenever the item's (possibly
  just-changed) type merely USES that slot, regardless of whether the specific id offered
  came from that type's OWN option list. Repro: select three Roller blinds, pick a
  Roller-only Control, then change Blind type to Zebra in the same dialog — the dropdown
  re-scopes option-level and blanks visually, but `bulkState.control_id` still held the
  Roller id, and apply wrote it onto Zebra items (both types use 'control', so the
  slot-level guard passed). `material_id` had no scope guard at all. **Fix:** every
  material/hardware field is now guarded OPTION-level — `materialsForType(catalogs,
  next.blinds_type).some(m => m.id === patch.material_id)` for material, and
  `optionsForType(<slot's catalog>, catalogs.blindTypes, next.blinds_type).some(o => o.id
  === patch.<field>)` for each hardware slot — matching exactly what the bulk-edit form's
  own re-scoped dropdowns offered. `lineItemBulk.test.ts` covers the repro plus the material
  case.
- **The stale-price-override-clearing rule existed in only one of its two write paths.**
  `applyBulkPatch` cleared `unit_price_override` on a price-feeding patch; the single-item
  blind-type dropdown (`BlindTypeSelect` in `blindForms/fields.tsx` → `applyTypeDefaults`)
  did not, even though a type change there resets material and every hardware slot exactly
  as bulk edit does. **Fix:** the clearing logic is now ONE function,
  `clearPriceOverride(draft)` in `lineItemBulk.ts`, called by both `applyBulkPatch` (once
  its whole patch is decided to be price-feeding) and `BlindTypeSelect`'s `onChange`
  (unconditionally, right after `applyTypeDefaults` — a type change is always
  price-feeding for a single item). One implementation, so the two paths cannot silently
  re-diverge the way they already had once.
- **The Default Options page offered a material it then silently discarded
  (`BlindTypeDefaults.tsx`).** The card's Material `<select>` was built from
  `materialsForType(...)`, which does not filter on `active`; `sanitizeDraftForType`
  (which runs right before every save) DOES require `active`. Picking a retired-but-still-
  linked material therefore saved `null`, the API returned 200, and the select snapped back
  to "No default" with no error — every attempt silently did nothing. **Fix:** the card now
  filters to `materialsForType(catalogs, type.name).filter(m => m.active)`, so the offered
  list matches exactly what can be saved.
- **Bulk-add could lose an entire measuring pass on a stray backdrop tap
  (`BulkAddSheet.tsx`).** The backdrop `onClick` called `onCancel` directly — no guard —
  even though this sheet can hold thirty windows of on-site measurements, the single most
  expensive state in the app, and the OLDER, less valuable single-measurement popup already
  guards exactly this case (`OrderDetail.tsx`'s `closeBulkMeasure`, whose own comment notes
  a backdrop tap is easy to make by accident on a tablet). **Fix:** a new pure predicate
  `bulkAddHasContent(sections)` (`bulkAdd.ts`) reports whether anything has been typed or
  picked across every section/row; a new `handleCancel` in `BulkAddSheet.tsx` confirms via
  `window.confirm` when it is true, and both the backdrop and the Cancel button now route
  through it instead of calling `onCancel` directly.
- **`removeItem` never pruned `selected` (`OrderDetail.tsx`).** Deleting a line item via its
  own Delete button removed it from `items` but left its key in the `selected` Set forever —
  select three, delete one via its row, and the toolbar still read "3 selected," with a
  follow-on bulk-delete confirming "Delete 3 items?" while only two still existed.
  `LineItemList.tsx` already pruned its own `expanded` Set on the identical membership
  change. **Fix:** a new pure `pruneSelection(selected, items)` in `lineItemDrafts.ts`
  (returns the SAME Set instance when nothing changed, so no extra render), called from
  `removeItem` right after computing the post-delete item list.

**Verified:** web `pnpm check`/`pnpm test`/`pnpm lint` clean (test count grew by the new
cases above); api `pnpm check`/`pnpm test` clean (untouched by this pass — no API surface
was touched). `apps/web/src/lib/pricing.ts`/`totals.ts` and their api twins were not
touched by any of the five fixes.

## 2026-08-17 — Default Options settings page: a stale id could make a card permanently unsavable
- **Issue:** found in review of the new `/settings/defaults` page (branch
  `feat/defaults-bulk-lineitems`). A saved default can go stale WITHOUT this page ever being
  touched — another settings page deactivates or unlinks the exact option a card's default
  points at. The first cut only re-validated a card's draft against the current catalogs when
  BUILDING the on-screen draft, never again right before the save itself fired.
- **Cause:** the page's mutation is intentionally not optimistic, and `toPatch` always resends
  the FULL row (the API replaces the whole row on every PUT). With sanitization applied only at
  render time, a card that had already rendered its stale value once could go on resending that
  same now-invalid id on every subsequent save forever — a genuine dead end, since the UI gave
  the user no field holding the bad value to clear it from.
- **Fix (`5781e05`):** `sanitizeDraftForType` is now applied a SECOND time, immediately before
  every save (`BlindTypeDefaultsCard.set`), not just once when the draft is built for display.
- **A follow-up review pass (`408a02f`) found the first fix was still too coarse.**
  `sanitizeDraftForType` originally cleared a hardware field at the SLOT level (`slotsForType` —
  "does this type use a cassette at all"), not the individual-option level. A slot can keep SOME
  active option while the SPECIFIC id a card's default points at goes inactive — that id then
  survived slot-level sanitization, reached the API, and 400'd there anyway (the API validates
  each id's own `active` flag). Rewritten to check each field against `optionsForType`'s actual
  option list (the same list `OptionSelect` renders `<option>`s from), and Material — which has
  no "slot" concept and whose `materialsForType` helper does not itself filter on `active` — is
  now checked for `active` explicitly here to match what the API accepts.
- **A second, independent race surfaced in the same review pass:** editing field B on a card
  while field A's PUT was still in flight computed B's full-row patch from the PRE-edit value of
  A (since the render closure's `draft` had not yet learned A's new value), silently REVERTING
  A's own edit the instant B's request landed. **Fix:** `pendingWrites` — per-card, per-field
  state holding the just-sent-but-not-yet-confirmed value for any field with a save in flight —
  folded into every new patch via the new `nextDraftForSave(draft, pendingWrites, field, value,
  catalogs, typeName)`, so a save for one field always carries every OTHER in-flight field's
  latest picked value, not the stale render-time one. `set` unconditionally drops a field from
  `pendingWrites` once ITS OWN save settles (success or failure), which is what stops a single
  rejected pick from going on contaminating saves fired for other fields afterward.
- **Acknowledged, undocumented-nowhere-else-until-now limit:** a save already SENT for field B
  before field A's rejection becomes known can still carry A's doomed pre-rejection value in that
  outgoing request — no local state change can un-send an HTTP request already in flight. Only
  saves fired AFTER the rejection is known are guaranteed clean. Recorded as a known limit in
  `memory-bank/progress.md`, not treated as an open bug — closing it would need either serializing
  every field's saves on one card (worse latency for the common case of picking several fields in
  quick succession) or a request-generation token to let a stale in-flight response overwrite
  nothing, out of scope for this pass.
- **Lesson:** a page whose save resends the WHOLE resource on every field edit needs its
  staleness check applied twice — once for display, once for save — and at the same GRANULARITY
  the destination actually validates at. Checking a coarser property ("the slot still has some
  active option") than what the receiving system checks ("this exact id is active") reintroduces
  the same class of failure one level down.

## 2026-08-17 — Blind-type defaults PUT swallowed Supabase lookup failures as 404/400
- **Issue:** found in review. `PUT /api/settings/blind-type-defaults/:blindTypeId` runs three
  Supabase lookups (the blind type itself, then per-field `DEFAULT_LINKS` join/option checks) but
  each one originally destructured only `data`, never `error`. A transport, permission, or
  database failure on any of those lookups therefore read as `data === null` — surfacing as a 404
  "Unknown blind type." or a 400 "not offered"/"inactive," never as the 500 an infrastructure
  failure should be.
- **Cause:** fails closed either way (no id was accepted on a broken lookup), but disguises an
  infrastructure failure as a user input error — a consultant seeing "not offered for this blind
  type" would (reasonably) try a different option rather than report an outage.
- **Fix (`6a52620`):** destructure `error` from every lookup and return 500 with the Supabase
  error message before interpreting `data` at all, for all three lookups in the route.
- **Lesson:** `const { data } = await sb...` silently treats a genuine backend error the same as
  a legitimate "not found" — the two must always be told apart before `data` is read, everywhere
  a Supabase call's result feeds a 404/400 decision.

## 2026-08-17 — Bulk edit's rewrite for type/colour dropped the stale-override-clearing rule
- **Issue:** found in review while adding blind-type and colour to bulk edit. The 2026-08-15
  single-type bulk edit cleared `unit_price_override` on every item a run touched, so a bulk
  re-option always reached the total instead of being masked by a price typed against the old
  picks. The rewrite that retired `applyBulkEditToDraft` for the new `applyBulkPatch` (needed for
  the type/colour additions) dropped that clearing behaviour entirely — its own `BulkEditForm`
  copy and JSDoc still claimed the reset happened, but nothing in the new code performed it.
- **Cause:** a straight reimplementation that carried over the OLD function's field-writing logic
  without re-deriving the override-clearing side effect that used to ride along with it.
- **Fix (`ae74757`):** `applyBulkPatch` tracks a local `pricingChanged` flag, set whenever the
  patch changes anything that actually FEEDS the calculated price — the blind type, the material,
  or any hardware slot — and clears `unit_price_override` only when that flag ends up true. A
  COLOUR-only patch never clears it: colour is free text, never priced, so wiping a deliberately
  set override on a change that could not have affected the price would surprise the consultant
  for no reason. `addons` and `show_original_price` are left untouched by either path — they add
  to a price rather than replace it. Docs corrected to state the narrower (and, this time,
  actually implemented) rule.
- **Lesson:** when a function is rewritten to add capability, re-derive its side effects from the
  desired BEHAVIOUR, not by porting only the lines that assign the new fields — a side effect that
  "just rode along" with the old field-writing code has no visible trace once that code is gone,
  and the JSDoc/UI copy can keep claiming a guarantee the implementation no longer provides.

## 2026-08-17 — Bulk-add expansion aliased one `attributes` object across every generated item
- **Issue:** found in review of `expandBulkSections`. `panels` was already correctly copied per
  expanded item (`[...r.panels]`), but `attributes` was not — every `BlindDraft` produced from one
  `BulkSection` (and the section's own still-live `config`) shared the SAME `attributes` object
  reference.
- **Cause:** one section's `config` can expand into many rows, and the section stays live in the
  sheet's own state while more rows are still being typed underneath it. Editing one expanded
  item's attributes afterward — the single-item form's own attribute inputs, e.g. Curtains' pleat
  picker — would silently reach back through the shared reference and mutate every OTHER item
  expanded from that same config, plus the section's config itself. Confirmed latent rather than
  already visible in practice: every blind-type attribute input today only ever REPLACES the
  attributes object (`{ ...draft.attributes, [k]: v }`), never assigns into it in place — but
  `expandBulkSections`'s own contract cannot rely on every FUTURE input honouring that discipline.
- **Fix (`f96c085`):** `attributes: { ...s.config.attributes }` — a fresh shallow copy per
  expanded item, mirroring how `panels` was already handled. A new test pins reference identity:
  two items expanded from the same section must have `!==` (not `===`) attributes objects.
- **Lesson:** the "copy every array, never alias it across generated siblings" discipline has to
  be applied to every mutable field a generator spreads from a shared template, not just the one
  that happened to need it first — a plain object is exactly as aliasable as an array, and Object
  spread copies it just as cheaply.

## 2026-08-17 — Bulk-add validation passed sections `buildPayload` would still reject at save
- **Issue:** found in review of `validateBulkSections`. Two related gaps: (1) it never ran a
  section's `attributes` through the blind type's own `attributeSchema` at all, so a section with
  e.g. an invalid Curtains `pleat_type_id` passed bulk-add validation cleanly and only failed
  later, once, per EXPANDED ITEM, at actual save time — the sheet would let the consultant click
  Add, then the save step would report the same problem N times over, once per row the broken
  section produced. (2) the checks it did run were not ordered the same way `buildPayload`
  orders its own — so for a section with more than one problem at once, bulk-add's validation and
  the eventual save could report two DIFFERENT "first" problems for the same section.
- **Cause:** `validateBulkSections` and `buildPayload` are necessarily two independent
  implementations (one checks one config against many not-yet-expanded rows; the other checks
  already-expanded, one-config-per-item drafts) that must be kept in sync by hand — the attribute
  check was simply never added when the rest of the function was written, and check order was
  never deliberately matched to `buildPayload`'s.
- **Fix (`f96c085`):** added a `parseDraftAttributes(cfg) === null` check per section (after the
  hardware-slot checks, mirroring `buildPayload`'s own position for the equivalent per-item
  check), and reordered the existing checks so PER-ROW measurement checks (panels, height) run
  before PER-SECTION configuration checks (type, material, hardware, attributes) — the same order
  `buildPayload` checks an expanded item in. A blind-type-not-chosen check, which has no
  `buildPayload` counterpart (an untyped blind's `material_id` is always empty too and falls
  through to the material message there), was placed immediately before the material check it
  would otherwise be folded into.
- **Lesson:** when a client-side pre-check exists purely to catch what a server-side (or, here, a
  later client-side) check will reject anyway, missing even ONE of that check's constituent gates
  does not just weaken the pre-check — it lets the failure surface later, worse (once per
  expanded item, at save, instead of once, at Add), and the order two independent checks run
  their gates in matters just as much as which gates they run, whenever more than one gate can
  fail on the same input.

## 2026-08-12 — The installed home-screen app had no way to refresh at all
- **Issue:** owner reported that the app added to the home screen "doesn't reload when I
  scroll to the top as on the regular browser". Data went stale with no way to ask for more.
- **Cause:** not a defect in this codebase — it is what `display: "standalone"` costs.
  Dropping the browser chrome drops every reload affordance with it: no address bar, no
  reload button, **and no native overscroll pull-to-refresh**. iOS has never offered the
  gesture to standalone web apps, and Chrome suppresses its own spinner in `standalone` and
  `fullscreen` display modes. Nothing in `index.css` was blocking it — there is no
  `overscroll-behavior` rule anywhere in `apps/web`; the gesture simply is not offered.
  Compounding it: there is no service worker, so nothing refetches in the background, and iOS
  keeps a standalone app suspended in memory for days rather than re-launching it.
- **Fix:** implement the gesture. `hooks/usePullToRefresh.ts` tracks a damped downward drag
  from the top of the document and, past a 64px threshold, runs the caller's refresh;
  `components/PullToRefresh.tsx` renders the puck and supplies
  `queryClient.invalidateQueries()` as the work; `Layout` mounts it once so every
  authenticated page has it.
- **Refresh is a refetch, NOT `location.reload()`.** Invalidation reproduces the whole visible
  effect of a reload without re-running auth boot, re-downloading lazy chunks over a field
  connection, or discarding a half-entered measurement on `/orders/:id`. Accepted trade: a
  pull does not pick up a newly deployed build — a cold launch does, since no service worker
  caches the shell.
- **Four conditions abort the gesture**, each for a concrete failure it would otherwise cause:
  `window.scrollY > 0` (the user is reading); `document.body.style.overflow === 'hidden'`,
  which is how `ui/Modal` locks scroll and which also parks `scrollY` at 0 — exactly the
  state the gesture starts from, so without this check a drag on a modal body refreshes the
  page behind it; a touch that started inside an inner scroller with `scrollTop > 0`; and
  `useSidebar.mobileOpen`, since the phone menu is a full-screen overlay.
- **`touchmove` must be registered `{ passive: false }`.** `preventDefault` there is the only
  way to stop iOS rubber-banding the page under the indicator, and a passive listener may not
  call it. It is called only while actually pulling down at the top, so ordinary scrolling
  keeps the passive fast path.
- **Only the indicator moves; the content column is never transformed.** Pulling the page down
  with it would put a `transform` on an ancestor of every `position: fixed` element in the app
  — the nav rail, the modal shells and OrderDetail's action bar — which re-bases all of them
  onto that ancestor and breaks the three at once.
- **Gated to standalone** (`(display-mode: standalone)` OR the legacy `navigator.standalone`,
  which is still the only signal on iOS below 16.4). In a browser tab the native gesture
  already exists, and claiming the same touch would silently swap a reload the user knows for
  a refetch they did not ask for.
- **Lesson:** an installed PWA is not the browser minus chrome — it is the browser minus every
  affordance the chrome carried. Anything the user reached through browser UI (reload, back,
  share, print) has to be re-provided in-app or it is simply gone once installed.

## 2026-08-10 — A re-opened order silently dropped its per-type options on the second save
- **Issue:** found while wiring Curtains, but latent since the attributes scaffold shipped.
  Save an item with per-type options → reopen the order → save again, and the whole
  `attributes` blob came back `{}`. The first save was correct; the second quietly wiped it,
  with no error anywhere and a price that changed under the user.
- **Cause:** `toDrafts` stringifies the PERSISTED blob into the draft, and that blob carries
  the Worker's snapshot keys (`pleat_name`, `pleat_multiplier`, …) alongside the ids the
  client originally sent. `parseDraftAttributes` then re-parsed the draft through the type's
  `.strict()` schema, which does not declare those keys — deliberately, since declaring them
  would let a client set a price. The parse failed, and its failure signal is `null`, which
  the payload builder reads as "no attributes".
- **Fix:** `parseDraftAttributes` filters the draft down to `blindType.inputKeys()` (the
  schema's declared keys) before parsing. Same call also stops a resolved price being echoed
  back to the server at all.
- **Note:** this changed an existing assertion. An undeclared key is now DROPPED client-side
  rather than making the parse return `null`; the test was rewritten to say so, and a
  companion case pins that an invalid value on a *declared* key still returns `null`. The
  server-side gate is unchanged and is the one that matters.
- **Lesson:** a validation schema that is deliberately narrower than the stored shape needs
  an explicit narrowing step on the way back in. Round-tripping through it is not symmetric,
  and a parser whose failure mode is a falsy value will lose data quietly rather than loudly.
  Any type with a server-written key would have hit this — Curtains just got there first.

## 2026-08-10 — Three new tests passed before the feature existed
- **Issue:** while writing the Curtains pricing suite, three assertions went green against
  the OLD base formula, so they proved nothing about the code they were written for.
- **Cause:** arithmetic coincidence in the chosen fixture. With a 200cm height the base area
  formula is `W × 0.8` and the Curtains formula is `W × 0.4 × multiplier` — identical
  whenever the multiplier is exactly **2**. A 250cm height with a 2.5 multiplier collides the
  same way (`300 × 250 × 40 / 10000 = 3.0 × 2.5 × 40 = 300`).
- **Fix:** re-fixtured to a 200cm height with a 2.5 multiplier so the two formulas differ
  (240 vs 300), and the reasoning is written into the helper's doc comment so the next person
  does not "tidy" it back. Confirmed all seven then failed before the module was written.
- **Lesson:** run a new test against the unchanged code and watch it fail for the RIGHT
  reason — "it failed" is not enough when several tests share one fixture. Round numbers in
  a pricing fixture are exactly where formulas coincide.

## 2026-08-09 — Wrapping a `wrap-anywhere` span in `flex flex-col` destroyed its wrapping
- **Issue:** adding the per-blind-type attribute line to the order item rows, the first
  attempt put the name and the new line side by side in a `flex min-w-0 flex-1 flex-col`
  wrapper, moving `min-w-0 flex-1 wrap-anywhere` off the name span onto the wrapper. Measured
  at 375px with a 120-character unbroken name: the name span went from **238px over 5 lines
  (height 98px) to 1252px on a single line**, dragging the row from 342px to **1356px**.
- **Why it hid:** the page's `scrollWidth` stayed at 375 in BOTH cases, so the usual
  "does the page scroll horizontally" check passed. An ancestor's `overflow-x-clip` was
  swallowing the overflow — the row was not scrolling the page, it was being cut off.
  Adding `min-w-0` back onto the inner span did NOT fix it; the flex-column context itself
  was the cause.
- **Fix:** do not wrap. Keep the original span with its exact classes and nest the attribute
  line INSIDE it as `<span className="mt-0.5 block …">`, inheriting `wrap-anywhere` (an
  inherited property) and the parent's intrinsic-width behaviour. Markup is then
  byte-identical (2647 chars) while no type declares attributes, and the 120-character stress
  case reproduces the old geometry exactly.
- **Detection:** A/B in a signed-in browser — capture geometry, `git checkout HEAD -- <file>`,
  let vite reload, capture again, restore. Comparing `getBoundingClientRect` between the two
  builds is what turned "looks fine" into a number.
- **Lesson:** `scrollWidth === clientWidth` is NOT proof a layout contains itself when an
  ancestor clips overflow — measure the element, not just the page. And moving a layout class
  from a child onto a new parent is not a no-op: `wrap-anywhere`'s effect on min-content width
  depends on the box it sits on. This is the same family of trap as the 2026-08-03
  `truncate`-vs-`wrap-anywhere` finding.

## 2026-08-09 — `public.routes.test.ts` made REAL calls to Resend on every test run
- **Issue:** the api suite failed at random on a clean tree. Different tests each time —
  `customer action logs > logs the confirm as a customer action` (5013ms),
  `POST /public/appointment/:token/request > records a change request with the customer
  note` (5003ms), `customer action logs > logs a cancellation request as a customer
  action` (5014ms) — always vitest's 5000ms default timeout, and a third run would pass
  all 35.
- **Root cause:** five public routes send an internal notification (estimate confirm,
  cancel-request, cancel-withdraw, appointment confirm, appointment request), and
  `sendEmail` in `lib/email.ts` calls `fetch('https://api.resend.com/emails')` directly.
  `public.routes.test.ts` mocked `../lib/supabase` and NOTHING else, so every one of
  those tests opened a real HTTPS connection to Resend, waited for the 401 that
  `RESEND_API_KEY: 'placeholder'` earns, and only then continued. The suite's own file
  header claimed a "scripted fake Supabase client" — true, and irrelevant to the wait.
  `orders.routes.test.ts` had this right all along: it stubs `globalThis.fetch` around
  every email-sending test. That divergence is why one file was flaky and the other was
  not.
- **Detection:** noticed while verifying an unrelated refactor — a failure appeared in
  `apps/api` on a run where `git status apps/api` was empty. Re-running produced a
  DIFFERENT failing test, which is the signature of latency, not logic.
- **Fix:** stub `globalThis.fetch` for the whole suite (restored in `afterAll`), record
  each attempted send in a `sentEmails` array reset per test, and THROW on a fetch to
  any host other than `api.resend.com` so the next unmocked outbound call fails loudly
  instead of silently reaching the internet. All three call sites already wrapped the
  send in try/catch and logged, so returning 200 instead of 401 exercises identical
  route behaviour — no existing assertion changed meaning.
- **Result:** the file's tests went 6295ms → ~32ms; the whole api suite 8.0s → ~2.0s.
  Eight consecutive full runs at 207/207, where before roughly one run in three failed.
- **Bonus:** `409 when a request is already open (no duplicate notifications)` asserted
  only the 409 — its stated point, that staff are not re-notified, was untested. It now
  asserts `sentEmails` is empty, and the confirm and cancel-request tests assert the
  single expected send.
- **Lesson:** a test suite that takes seconds against an in-memory fake is telling you it
  is not actually isolated. Treat multi-second unit tests as a bug report, not a quirk —
  and never leave `fetch` unstubbed in a suite whose routes send mail.

## 2026-07-21 — Half-finished email-theme extraction left the api not compiling
- **Issue:** commit `ef0f441` ("email-templates") on `feat/responsive-emails` created
  `apps/api/src/lib/email-theme.ts` and added the corresponding imports + re-exports to
  `email.ts`, but never DELETED the original definitions from `email.ts`. Every moved
  name therefore collided with its own import: 19 errors — TS2440 "Import declaration
  conflicts with local declaration" for 15 names, plus TS2323/TS2484 redeclaration
  errors for `brandFromSettings` and `CompanyBrand`. `email.ts` was 835 lines, over the
  Rule 6 limit, because it now held the presentation layer twice.
- **Detection:** the working tree was CLEAN and `git status` said nothing was wrong —
  the breakage was the committed state. Found only by running `pnpm check` before
  starting new work. Same failure shape as the `pdf.test.ts` conflict-marker entry
  below: a "clean" tree is not evidence the branch compiles.
- **Fix:** commit `a3096d6` deletes the duplicated block (`email.ts` lines 105–312:
  tokens, `CompanyBrand`, `brandFromSettings`, `formatMoney`, and the shell/block
  helpers), leaving the single copy in `email-theme.ts` reached through the existing
  import and re-export. `email.ts` 835 → 627 lines.
- **Verified no behaviour change:** tsc clean and 116/116 api tests passed with the test
  files completely untouched — which is exactly what makes a "pure move" provable. If a
  test had needed editing, the move would not have been verbatim.
- **Lesson:** when splitting a module, deleting the source is not a cleanup step to do
  later — it is half of the change. Run `pnpm check` before trusting a clean tree.

## 2026-07-21 — Committed merge-conflict markers broke api type-checking (pdf.test.ts)
- **Issue:** `apps/api/src/lib/pdf.test.ts` was committed WITH unresolved git conflict
  markers (`<<<<<<< HEAD` … `>>>>>>> 70a85e7`, the feat/blind-color-code merge), so
  `tsc --noEmit` failed with TS1185. The tree was "clean" — the broken file was the
  committed state, discovered by the receipt-feature verification pass.
- **Fix:** resolved to the HEAD side, which matches shipped `pdf.ts` (`material_name`,
  `color` field). The branch side was NOT keepable as-is: it imported `itemContent`
  (not exported from pdf.ts) and asserted Color renders after Control, but shipped
  order is Panels → Material → Color → Cassette → Control → Note. Its dropped
  color-line tests are flagged as a follow-up task (export `itemContent` or assert via
  rendered output, using the REAL ordering).
- **Lesson:** a clean `git status` does not mean the committed state compiles.

## 2026-07-21 — Date time-bomb in the /send route test fixture
- **Issue:** the `POST /:id/send → 502 on email failure` test hardcoded
  `expiry_date: '2026-07-17'`. The send route 400s on a lapsed expiry
  (`orders.ts` ~701) BEFORE reaching the email path, so once the calendar passed
  July 17 the test failed with 400-vs-502 — on clean main, unrelated to any change.
- **Fix:** fixture now computes `order_date` = today and `expiry_date` = today + 14d.
- **Lesson:** route tests that must get PAST a date guard need relative dates;
  hardcoded ISO dates in fixtures are only safe for routes that don't compare to now.

## 2026-07-21 — Order page scrolled sideways on phones; sections looked unequally wide
- **Issue (user report):** on a phone the order detail page's sections (Progress, Items,
  Payments) did not line up and "some of them extend off my screen". Every section is a
  child of one `flex flex-col` column, so the BOXES were always equal — what differed was
  (a) the chrome gutters around them and (b) content overflowing past the page width,
  which makes the document scroll horizontally while the sticky header and action bar stay
  pinned to the viewport, so nothing lines up any more.
- **Root causes, in order of impact:**
  1. `headerActions` put the full `StatusBadge` in the `PageHeader` right slot next to four
     icon buttons. "AWAITING PAYMENT" is ~130px on its own; badge + 4 buttons + gaps
     ≈ 300px, which does not fit beside the 44px back chevron on a ≤390px phone.
  2. The Progress timeline was `<ol className="flex …">` with six `flex-1` items. A flex
     item's automatic minimum size is its longest word, so the labels ("Awaiting",
     "Progress", "Installed" at 10px) put a hard ~285px floor on the row — it could not
     shrink and pushed the card, and therefore the page, wider than a narrow screen.
  3. Three different gutters (header 8px, cards 16px, sticky bar 14px) — see the
     `engine_features.md` 2026-07-21 entry.
- **Fix (`apps/web/src/pages/orders/OrderDetail.tsx`, `components/PageHeader.tsx`):**
  1. StatusBadge in the top bar is `hidden sm:inline-flex` — on phones the status already
     shows on the Progress card and the Payments panel, so nothing is lost.
  2. The timeline is now a GRID with `repeat(STAGES.length, minmax(0, 1fr))` tracks
     (inline style, derived from `STAGES.length` so adding a stage cannot silently break
     it) — `minmax(0, …)` tracks may shrink below their content, so the row can never
     exceed the card. Labels got `w-full break-words`; the `<li>` lost `flex-1`.
  3. Shared `mx-auto w-full max-w-lg` + 16px gutter across header, body and sticky bar.
  4. Belt and braces: `overflow-x-clip` on the page root (`clip`, NOT `hidden` — `hidden`
     creates a scroll container and would break the sticky header), plus `min-w-0` /
     `truncate` / `break-words` on the rows that can hold unbounded strings (line-item
     rows, payment note rows, activity-log messages).
- **Verified:** web `tsc --noEmit` clean, vitest 40/40, oxlint clean on both touched files.
  ⚠️ NOT yet confirmed on a physical phone — the layout math above is the reasoning, so
  re-check on a real device (and at 320px) before considering this closed.

## 2026-07-03 — @react-pdf/renderer cannot run on Cloudflare Workers (found by live E2E)
- **Issue:** PDF endpoint + send flow failed at runtime in workerd (fine in vitest/Node).
  Root causes, verified in-sandbox: (1) wrangler bundles @react-pdf's WEB build, whose
  `renderToBuffer` is a Node-only stub; (2) the web build's `pdf().toBlob()` then hits
  yoga-layout WASM: "Wasm code generation disallowed by embedder" — workerd forbids
  runtime WASM compilation. Both v4 and v3.4 are affected; v3 additionally breaks on
  React 19 (react-reconciler crash).
- **Fix:** rewrote `apps/api/src/lib/pdf.ts` on `pdf-lib` (pure JS, zero WASM, no React):
  same `PdfEstimateData` interface, same §10 layout via a cursor with word-wrap and page
  breaks. Removed react/@react-pdf deps from the api workspace; Worker bundle dropped from
  ~825 to ~427 KiB gzip. Verified: 29 api tests pass AND a workerd smoke render returns
  a real `%PDF-` stream.

## 2026-07-03 — Bulk line-item insert NULL-filled missing columns (found by live E2E)
- **Issue:** blind and preset/custom rows were built with different key sets. PostgREST
  bulk inserts unify columns across rows and send NULL for any row missing a key →
  `null value in column "description" violates not-null constraint` on mixed estimates.
  The fake-DB route tests missed it because the fake didn't enforce column uniformity.
- **Fix:** `resolveLineItems` now emits the FULL column set for every row ('' / [] / null
  explicitly). New regression test captures the actual insert payload and asserts identical
  key sets across rows (estimates.routes.test.ts).

## 2026-07-03 — Blind line-item schema silently stripped client prices
- **Issue:** `blindItemSchema` was a plain `z.object`, so a tampered payload carrying
  `unit_price` was quietly stripped instead of rejected — caught by the route-level
  integration test expecting 400.
- **Fix:** both line-item schemas are now `.strict()`; any unknown field (esp. money) → 400.

## 2026-07-03 — PDF response body type + Hono
- **Issue:** `c.body(Uint8Array)` fails Hono's typing (`Uint8Array<ArrayBufferLike>`).
- **Fix:** re-slice into a plain `ArrayBuffer` before returning the PDF stream.

## 2026-07-03 — base64 attachment stack overflow risk
- **Issue:** `btoa(String.fromCharCode(...bytes))` overflows the call stack for PDFs
  larger than ~100 kB.
- **Fix:** chunked 8 kB conversion in `toBase64()` in the estimates routes.

## 2026-07-03 — Root scripts broken on Windows (single-quoted pnpm filters)
- **Issue:** `pnpm dev` failed with "No projects matched the filters" — cmd.exe does not
  treat single quotes as quoting, so `--filter './apps/*'` was passed literally.
- **Fix:** Root `package.json` scripts now use escaped double quotes (`\"./apps/*\"`),
  which work in both cmd.exe and bash. Also added root `test` script and pinned
  `"packageManager": "pnpm@9.15.9"` (pnpm 11 via Corepack crashes on Node 20).

## 2026-07-03 — api.ts token source (latent bug, fixed before release)
- **Issue:** `apiFetch` read the access token from `localStorage.getItem('sb-access-token')`,
  a key supabase-js does not use (it stores under `sb-<project-ref>-auth-token` as JSON).
  Every authenticated API call would have gone out without a Bearer token → permanent 401s.
- **Fix:** `apiFetch` now calls `supabase.auth.getSession()` per request, which also gets
  transparent token refresh. No token is manually persisted anywhere.

## 2026-07-03 — package.json truncation during tooling edits
- **Issue:** During plan-improvement edits, `apps/web/package.json` and `apps/api/package.json`
  were observed truncated mid-file in one environment view (stale filesystem cache between the
  editing tool and the sandbox mount).
- **Fix:** Both files rewritten in full and re-validated with `JSON.parse`. Lesson recorded:
  after editing JSON config files, validate them with a parser, not by eye.

## 2026-07-07 — CORS allowed hostile "localhost" look-alike origins (security review)
- **Issue:** the Worker's CORS origin callback used `origin.includes('localhost')`, which
  also matches attacker-controlled origins such as `https://evil-localhost.example.com`,
  reflecting them as allowed.
- **Fix:** `apps/api/src/index.ts` now uses exact/prefix checks
  (`http://localhost[:port]`, `http://127.0.0.1[:port]`) plus the exact production origin
  `https://measure-blinds.blindsnisa.workers.dev`.

## 2026-07-07 — PUT /api/orders/:id silently moved order_date to "today"
- **Issue:** the update route defaulted a missing `order_date` to the current date, so any
  edit payload omitting it re-dated the order — desyncing it from the order number, which
  encodes the original date.
- **Fix:** the route now selects the stored `order_date` and falls back to it
  (`input.order_date ?? existing.order_date`). Only POST defaults to today.

## 2026-07-07 — Order edits could strand an order with zero line items
- **Issue:** PUT ran update → delete line_items → insert line_items as three separate
  PostgREST calls; an insert failure after the delete left updated totals and NO items.
- **Fix:** migration 18 adds `public.update_order_with_items(uuid, jsonb, jsonb)` — order
  field update + wholesale item replacement in ONE transaction (service_role-only
  execute). PUT now calls it via `sb.rpc(...)`; rollback restores the previous items on
  any failure. Applied live to `lgbxxlwsdeuhdgzrjjen`.

## 2026-07-07 — "Today" was computed in UTC, not the business timezone
- **Issue:** every "today" (defensive expiry checks, cron expiry, default order_date /
  paid_on) used `new Date().toISOString().slice(0,10)` — UTC is 4–5 h ahead of Toronto,
  so evening reads expired estimates hours early and late-evening e-Transfers were dated
  "tomorrow".
- **Fix:** new `apps/api/src/lib/dates.ts` (`BUSINESS_TZ = America/Toronto`,
  `todayBusiness()`, `businessDateOf()`) via cached `Intl.DateTimeFormat('en-CA')`.
  Adopted in `routes/orders.ts`, `routes/public.ts`, `routes/webhook.ts`, and the cron
  handler in `index.ts`. Timestamps (sent_at etc.) intentionally stay UTC.

## 2026-07-07 — Payments could double-record and silently exceed the order total
- **Issue:** POST /:id/payments had no idempotency (a double-click or network retry
  inserted two ledger rows) and accepted any amount regardless of the outstanding balance.
- **Fix:** migration 18 adds `payments.client_key uuid UNIQUE`; the payment sheet mints
  one UUID per open and `recordOrderPayment` maps a 23505 on it to an idempotent
  `{ duplicate }` result (route returns the current order, no second insert). The route
  also refuses a payment pushing the ledger past `orders.total` with
  409 `{ code: 'OVERPAY', error: 'This amount will exceed total balance.' }` unless
  `allow_overpay: true`; the UI shows a confirmation pop-up ("This amount will exceed
  total balance. Record it anyway?") and sends the flag only on consent. New route tests
  cover 409/consent/within-balance paths.

## 2026-07-21 — pdf.test.ts was committed with unresolved merge-conflict markers
- **Issue:** the merge of `feat/blind-color-code` (70a85e7) into HEAD landed
  `apps/api/src/lib/pdf.test.ts` with literal `<<<<<<<`/`=======`/`>>>>>>>` markers, so the
  file was not valid TypeScript and vitest could not collect it — the whole PDF suite was
  silently absent from `pnpm --filter api test`. The feature side of the conflict also
  referred to a `fabric_name` field that HEAD had renamed to `material_name`, and its
  `describe('itemContent color')` block imported a symbol `pdf.ts` did not export.
- **Fix:** resolved the file to the HEAD side and restored the dropped color coverage
  against the SHIPPED behaviour. `itemContent` in `apps/api/src/lib/pdf.ts` is now exported
  (with JSDoc documenting the print order) and the tests assert the real attribute order —
  Panels, Material, Color, Cassette, Control, Note — not the feature branch's assumed
  "Color after Control". Added cases for trimming, and for omitting the Color line when it
  is empty, whitespace, null or absent. `pnpm --filter api run check` is clean and the PDF
  suite passes 8/8. (Unrelated pre-existing failure in `orders.routes.test.ts` — the
  "502 on email failure" case returns 400 — is untouched by this fix.)

## 2026-07-21 — Advancing an order to "Sent" emailed the customer
- **Issue:** the Progress-timeline advance arrow under the *Sent* stage called
  `sendMut` → `POST /api/orders/:id/send`, the endpoint that emails the "Estimate Ready"
  mail with the PDF attached and only then flips the status. So a consultant using the
  timeline purely as bookkeeping — for an estimate already handed over in person or
  printed — silently sent the customer a duplicate email. Advancing also inherited
  `/send`'s "customer must have an email address" requirement, blocking the status move
  for walk-in customers with no email on file.
- **Root cause:** `sent` was the only lifecycle stage with no status-only route. Every
  other transition (`/confirm`, `/in-progress`, `/ready`, `/installed`) had one, so
  `handleAdvance` had nothing to call for `sent` and reused the emailing route.
- **Fix:** new `POST /:id/mark-sent` in `apps/api/src/routes/orders.ts` — status-only
  `draft → sent`, mirroring the `/confirm` pattern: stamps `sent_at`, logs
  "Marked as sent (no email).", needs NO customer email address, and deliberately writes
  neither `public_token` nor `terms_snapshot` (nothing was delivered, so there is no
  customer link to keep alive and no terms to freeze; a later real `/send` still mints
  both lazily). It keeps `/send`'s lapsed-expiry 400 because `applyDefensiveExpiry` would
  otherwise flip the order straight back to `expired` on the next read.
  `useMarkSent()` added to `apps/web/src/hooks/useOrders.ts`; `handleAdvance` in
  `OrderDetail.tsx` now calls it for the `sent` target.
- **Invariant pinned:** the top-bar Send button is the ONLY control that emails the
  estimate — documented in the OrderDetail module header and in `handleAdvance`'s JSDoc.
  `useSendOrder` now has exactly one call site (`handleSendEstimate`).
- **Tests:** 4 new cases in `orders.routes.test.ts` intercept Resend and assert zero
  email calls on the happy path plus the 409 (already confirmed), 400 (lapsed expiry) and
  404 guards. Verified: `pnpm --filter api test` 90/90, `pnpm --filter web test` 40/40,
  both `tsc --noEmit` clean, `pnpm --filter web lint` clean for the touched files.

## 2026-07-28 (later) - Trailing blank page in the label print preview
Bug fix in `apps/web/src/pages/orders/OrderLabels.tsx`.
- **Cause:** `print:break-after-page` sat unconditionally on every label box, including the
  last one. A break AFTER the final label opens a page that nothing then fills, so the preview
  showed one empty page and the printer would feed one blank die-cut label per batch.
- **Fix:** breaks now go BETWEEN labels. `Label` takes a `pageBreak: boolean` prop and only
  then applies the class. The page computes `lastPrinted` from the SELECTED list
  (`selected[selected.length - 1].index`), not from a CSS `:last-child` - a deselected label is
  `print:hidden`, so the last DOM child is often not the last printed one, and `:last-child`
  would have left the blank page in place whenever the trailing labels were unchecked. Also
  guarded with `isOn` so a hidden label never carries a break.
- Class strings stay literal (`'print:break-after-page'` in the source) so the Tailwind v4
  scanner still emits the utility despite the conditional.
- Verified: web `tsc -b --noEmit` clean, vitest 56/56, oxlint = the same 4 pre-existing
  `LineItemEditor.tsx` warnings. Preview/physical print still to be confirmed on the shop PC.

## 2026-07-31 - Label material separator disagreed with its own test and doc
Bug fix in `apps/web/src/lib/labels.test.ts` and `apps/web/src/lib/labels.ts` (doc only).
- **Cause:** a recent label commit changed `buildLabels`' material/colour join from `' · '`
  to `' — '` in `labels.ts` but updated neither the assertion in `labels.test.ts` nor the
  `LabelFields.material` JSDoc. Three sources then disagreed, and `pnpm --filter web test`
  had been failing 1/61 on `main` ever since - a red baseline that masks new regressions.
- **Fix:** the em dash is the intended printed output, so the TEST and the DOC were
  corrected to match the code, not the other way round. `hardwareOf` deliberately KEEPS
  `' · '`: the material line is two prose names that need the wider separator, while the
  hardware line is three captioned codes that an em dash would push past the 3in stock's
  usable width. That reasoning is now pinned in the `material` field's JSDoc so the two
  separators are not "unified" by a future pass.
- Found while establishing a green baseline before the UI redesign; unrelated to it.
- Verified: web `tsc -b --noEmit` clean, vitest 61/61. oxlint = the same 4 pre-existing
  `LineItemEditor.tsx` `only-export-components` warnings.

## 2026-08-01 - Address autocomplete returned wrong or missing streets; switched off
Change in `apps/web/src/components/AddressAutocomplete.tsx` only.
- **Cause:** the Photon (`photon.komoot.io`) results were unreliable in the field — wrong or
  missing streets for real service-area addresses — so the dropdown cost the consultant more
  time than typing the address did. The lookup was NOT diagnosed further; it was turned off.
- **Fix:** a module constant `ADDRESS_SEARCH_ENABLED = false`. When false the component
  renders a plain labelled controlled input and `onSelect` never fires. Flipping it to `true`
  restores the full autocomplete with **no other edit anywhere in the tree**.
- **Two guards, not one, and the ordering matters.** The switch is checked FIRST inside the
  search `useEffect` (so no debounce reaction, no `AbortController`, no Photon request), and
  the plain-input early return sits AFTER every hook. An early return placed above the
  `useState` calls would break the rules of hooks and oxlint flags it — being a module
  constant does not exempt it.
- **`lib/addressSearch.ts` is deliberately untouched** and still correct. So are all three
  call sites (`CustomerForm.tsx` ×2, `CustomerCreateModal.tsx`): the component's props are
  unchanged, and callers keep passing `onSelect` precisely so re-enabling costs one line.
- Verified: web `tsc -b --noEmit` clean; vitest 69/69; oxlint = the same 4 pre-existing
  `LineItemEditor.tsx` warnings. NOT verified: the in-app typing behaviour and the absence of
  the `photon.komoot.io` request in the Network tab — `/customers/new` is behind
  `ProtectedRoute` and no Supabase session was available.

## 2026-08-02 - Mobile (iPhone Safari) layout defects on the order screen
Changes in `apps/web/src/index.css`, `components/ui/Modal.tsx`, `hooks/useKeyboardOpen.ts`
(new), `hooks/index.ts`, `pages/orders/OrderDetail.tsx`, `pages/orders/LineItemEditor.tsx`,
`pages/orders/InstallationSection.tsx`.

Four reported symptoms: line-item rows running off the right edge with the edit/delete
buttons unreachable; the item popup "too big" with its edges off-screen; tapping any text
box zooming the page; and the bottom action bar moving with the screen and burying things.

- **Focus zoom (confirmed, and probably the root of "goes out of screen" too).** iOS Safari
  zooms the viewport whenever a focused control renders below 16px. `inputClass` was 15px and
  `LineItemEditor`'s `INPUT` was 14px. A zoomed page's right edge — which is exactly where the
  row's edit/duplicate/delete buttons live — is off-screen, and the page root is
  `overflow-x-clip`, so panning back is awkward. Fixed with a `max-width: 1023px` rule setting
  `font-size: 16px` on `input, select, textarea`.
  **The rule is deliberately UNLAYERED, not inside `@layer base`.** Tailwind's utilities layer
  beats base, so a base rule loses to every `text-sm` on an input; unlayered declarations
  outrank all layered ones. Do not "tidy" it into `@layer base` — that silently reverts it.
  `maximum-scale=1` in the viewport meta was rejected: it kills pinch-zoom app-wide.
- **Sheet height was `vh`, and `vh` is the wrong unit on iOS.** Safari resolves `vh` against
  the LARGE viewport (URL toolbar hidden), so a `max-h-[90vh]` sheet is taller than the
  visible area and its footer buttons sit behind the toolbar — the "too big, edges off-screen"
  report. All eight hand-rolled sheets in `OrderDetail` now share a `SHEET_PANEL` constant
  (`max-h-[92dvh]`, `overscroll-contain`, home-indicator inset, 20px radius); the sheet in
  `InstallationSection` and the shared `ui/Modal` got the same treatment. The sheets were NOT
  migrated onto `ui/Modal` — that is a refactor, not this fix.
- **Action bar vs. the keyboard.** `position: fixed` is resolved against the LAYOUT viewport,
  which iOS does not shrink when the keyboard opens — so the bar stayed where the bottom of
  the screen used to be, on top of the field being typed into. New `useKeyboardOpen()` watches
  `window.visualViewport` and the bar translates away while the keyboard is up. Threshold is
  150px of shrink: Safari's collapsing URL toolbar moves the visual viewport 60–90px during a
  normal scroll, and a lower threshold would make the bar flicker away mid-scroll. Returns
  `false` where `visualViewport` is absent, so unsupported browsers keep the old bar.
- **Bar height is now measured, not guessed.** The page reserved a constant `pb-40` while the
  bar is one to three button rows depending on lifecycle stage. The bar publishes its
  `offsetHeight` as `--action-bar-h` via `ResizeObserver`; the root reads
  `pb-[var(--action-bar-h,10rem)]`.
- **Item rows now break onto two lines below `sm`** (identity above; price + actions below),
  with 44px action targets on that layout and the old 32px inline ones at `sm+`.
- **Two hypotheses were tested and DISPROVED — do not re-derive them.** Measured in Chrome at
  375px and 320px with a throwaway harness that mounted the real components:
  1. *"A `<select>`'s min-content width (its longest option) blows the popup past the screen."*
     Forcing `min-width:auto` back on every element in the popup changed `scrollWidth` by
     zero — Chrome clamps a `select` at its `width:100%`. The `min-w-0` classes added to
     `LineItemEditor` are harmless hardening, NOT the fix. (Untested on real Safari.)
  2. *"The single-line item row is geometrically wider than a phone."* It is not. At 320px the
     old row's `scrollWidth` equalled its `clientWidth`; flex crushed the NAME to 0px wide
     instead of overflowing, and all three buttons stayed inside the card. The two-line layout
     is still worth it (name gets 182px at 320px instead of 0), but the unreachable buttons
     were not caused by row geometry.
- **Verified:** web `tsc -b --noEmit` clean, vitest **74 passed / 7 files** (5 new
  `useKeyboardOpen` cases covering the threshold, the toolbar-collapse false positive, and the
  inverted-viewport guard); oxlint = the same 4 pre-existing `LineItemEditor.tsx`
  `only-export-components` warnings. In-browser at 375px: form controls compute to 16px and
  the page has no horizontal overflow.
- **NOT verified:** anything on real iOS Safari. `/orders/:id` is behind `ProtectedRoute` and
  no Supabase session was available, so the item rows, the sheets, the `dvh` cap and the
  keyboard-hide behaviour were never seen in the running app. `dvh` and `visualViewport`
  cannot be exercised in desktop Chrome at all. The remaining question is what actually put
  the buttons out of reach on the reporter's phone; focus zoom is the leading explanation.

## 2026-08-03 - Tablet had no navigation; page bodies never tracked the window width

Reported as "mobile and tablet views are still broken, ui is not responsive". Four distinct
defects, all in `apps/web`. Fixed by the shell rewrite in `engine_features.md` 2026-08-03.

- **Issue 1 - tablets had no navigation at all.** `Sidebar` was `lg:flex` (>=1024px) and
  `BottomNav` was rendered only when `Layout` got `nav={true}`. Every order, customer,
  settings and appointment detail route passed `nav={false}`. So at 768-1023px, and on
  EVERY detail page at every width below `lg`, the only way out of the page was the back
  chevron. **Cause:** two components splitting the width axis at `lg` while a second,
  orthogonal flag (`nav`) independently switched one of them off. **Fix:** one `Sidebar`
  covering every width; `BottomNav` and the `nav` prop deleted.

- **Issue 2 - main never expanded or shrank with the window.** `OrderDetail`'s body was
  `mx-auto w-full max-w-lg lg:max-w-6xl`. At 768px that renders a 512px column between two
  128px dead gutters; the same `max-w-lg` pattern was repeated in ~15 other pages, and
  `PageHeader` used `max-w-lg` below `lg` and `max-w-none` above — so the header sat on a
  different track from the body it headed. **Fix:** one `.page-container` class, fluid with
  stepped gutters, capped at an overridable `--page-max`.

- **Issue 3 - line-item descriptions pushed the card past the viewport.** The name span was
  `truncate`. Note this is subtler than "truncate should have prevented overflow": a
  truncated box still reports the min-content width of its longest unbroken word as its
  intrinsic width, and the row/card/grid above it sized to that. A long unbroken
  description therefore widened the whole card even though its own text was clipped.
  **Fix:** `wrap-anywhere` (`overflow-wrap: anywhere`) — deliberately NOT `break-words`,
  which only breaks INSIDE an over-long word and leaves the same min-content width, i.e.
  would not have fixed this. Verified with a 99-character unbroken token at 375px:
  `scrollWidth === innerWidth`.

- **Issue 4 - header actions overflowed and were silently clipped.** `OrderDetail` put five
  document buttons in `PageHeader`'s `shrink-0` right slot. From `sm` up their labels
  appear, measuring roughly 470px inside a row capped at 512px. The excess was swallowed by
  the page root's `overflow-x-clip` guard, so the rightmost action — Delete, the least
  recoverable one — was simply invisible rather than visibly broken. **Fix:** the actions
  moved into a wrapping toolbar in the page body; `PageHeader`'s right slot is now
  `min-w-0` and may shrink. **Lesson:** `overflow-x-clip` as a "belt and braces" guard (added
  2026-08-02) also HIDES real overflow bugs. It was kept, but it is not evidence of
  correctness — assert `scrollWidth === innerWidth` instead.

- **Note on the measurement transition.** `.app-shell-rail` / `.app-shell-main` animate
  width for 200ms. Anything measuring rail geometry immediately after flipping `data-rail`
  reads the PRE-transition value. This produced two confusing probe runs before it was
  spotted. Force a settled read (`transition: none`) or wait past 200ms.

- **NOT verified:** nothing was exercised as a signed-in user. `/orders/:id` and every other
  shell route sit behind `ProtectedRoute`, and no Supabase session was available. The
  geometry above was measured against the real compiled stylesheet using markup matching the
  new DOM, which covers the layout defects; it does NOT cover the React wiring — hamburger
  opens the overlay, Esc/route-change/backdrop dismiss it, the collapse toggle persists
  across reloads, and `inert` actually blocks Tab into the page behind the overlay. Those
  are owed on a real session, and the phone overlay is owed on real iOS.

## 2026-08-03 (later) - Duplicate document-action toolbar on the order screen
- **Issue:** `/orders/:id` rendered the Save / Send / Download / Customer View / Delete row
  TWICE — once in the sticky head and once again as the first child of the form column.
- **Cause:** self-inflicted, same session. `docActions` was first placed at the top of the
  form column; the sticky-head block was introduced afterwards and rendered it there too,
  but the original placement was never removed. Both call sites referenced the same
  variable, so nothing about the JSX looked wrong in isolation and `tsc`/lint had nothing
  to say.
- **Fix:** dropped the form-column copy; `docActions` now has exactly one use site.
- **Lesson:** when a block MOVES rather than gets added, assert the count at the new
  location AND the absence at the old one. `grep -c docActions` returning 2 (one
  definition, one use) is the cheap check that would have caught this.

## 2026-08-03 (later) - Note: CSS transitions do not advance in the headless browser pane
Not a product defect; recorded because it cost a false bug report during verification.
Measuring `.app-shell-rail`'s width right after flipping `data-rail` returned the OLD value
(248px) even after a 600ms wait, while `--sidebar-w` correctly read `4.5rem`.
`el.getAnimations()` showed the `width` CSSTransition still `running`. The pane was not
displayed, so it composites no frames and time-driven CSS transitions never progress —
`setTimeout` still fires, which makes it look like a settled read. Injecting
`transition: none !important` produced the correct 72px / 248px immediately.
**When measuring anything the shell transitions, force `transition: none` first.**

## 2026-08-04 - Software keyboard closed itself in the add-customer pop-up (mobile)
- **Issue:** on `/orders/:id`, opening "+ Add customer" and tapping any field made the
  on-screen keyboard appear and then immediately hide again; the `autoFocus`ed first-name
  field never held the caret either.
- **Cause:** `components/ui/Modal.tsx` ran `panelRef.current?.focus()` inside an effect
  keyed on `[open, onClose]`. Every caller passes an inline arrow (`onClose={() =>
  setAddingCustomer(false)}`), so `onClose` changed identity on every render of the OPENING
  PAGE — the effect re-ran and re-focused the panel each time, blurring whatever child input
  held focus, and a blur closes the software keyboard. `OrderDetail` closed the loop: it
  subscribes to `useKeyboardOpen()`, so the keyboard opening re-rendered the page, which
  re-ran the effect, which hid the keyboard again.
- **Fix:** `onClose` now lives behind a ref so the Escape/scroll-lock effect depends on
  `[open]` alone; the panel focus moved into its own `[open]`-only effect that no-ops when
  focus is already inside the panel (so `autoFocus` children keep the caret).
- **Lesson:** an effect that touches focus must never depend on a prop the caller recreates
  each render. Focus-moving effects are not idempotent — re-running one is a visible,
  destructive action on mobile, not a no-op. `document.activeElement` is the guard.

## 2026-08-04 - Line-item rows sat above their vertical centre
- **Issue:** in the order screen's items list, the checkbox / BLIND badge / name group was
  visibly higher than the price and the edit-duplicate-delete icons on the same row.
- **Cause:** the `<li>` was `sm:items-start` and the left group `items-start` with `mt-0.5`
  nudges, while the right group is `items-center` around 32px buttons that set the row
  height. Top-aligned text next to a taller centred group reads as uncentred.
- **Fix:** `sm:items-center` on the row and on the left group, with the `mt-0.5` nudges
  cancelled by `sm:mt-0`. Phone layout keeps start-alignment on purpose: a wrapped
  multi-line item name would otherwise get a checkbox floating beside its middle line.
- **Lesson:** mixing `items-start` and `items-center` between siblings of a flex row is the
  usual source of "not centred" reports; align the whole row, then re-opt out per breakpoint.

## 2026-08-04 - Expiry term reverted when a saved order was re-opened
- **Issue:** picking an expiry term chip ("15 days") on `/orders/:id` and saving looked
  correct, but leaving the order and opening it again showed no term selected — the choice
  read as lost on save.
- **Cause:** the resolved `expiry_date` IS persisted and re-read correctly (verified against
  the live rows: order dated Aug 6 stored Aug 21, exactly the 15-day term). Only the chip was
  missing: `expiryPreset` is editor-only state, and the hydration effect in `OrderDetail`
  set the two dates but left the term at its `null` initial value. A stored date has no
  memory of the arithmetic that produced it.
- **Fix:** `lib/expiryTerms.ts` gained `presetFromDates(orderDate, expiryDate)` — the inverse
  of `expiryFromPreset`, matching by calendar day so a time component on the order date does
  not defeat it — and hydration now re-derives the chip from the two saved dates.
- **Lesson:** derived UI state that is not persisted has to be re-derivable, or it silently
  disappears at the next mount and users read that as a failed save. The give-away is a
  "revert" that only shows up after navigating away — local state was masking it until then.

## 2026-08-04 - A hand-picked expiry date reverted to the company default on re-open
- **Issue:** on `/orders/:id`, choosing an expiry date in the picker and saving persisted
  correctly, but re-opening the order from the orders list showed `order_date + 14` instead.
  Orders dated with a term chip were unaffected.
- **Cause:** last-write-wins between two effects in the SAME commit. The hydration effect is
  declared first and sets the saved expiry; the auto-expiry effect is declared second and
  re-runs whenever its deps change — `company` settles from `useCompanySettings` at almost
  exactly that moment, and its object identity is a dep. At that point `expiryManual` is
  still `false` (hydration's update has not been applied yet), so the default branch ran and
  overwrote the saved date. A chip masked the bug: on the next pass `expiryPreset` was set,
  so the effect recomputed the correct date. A hand-picked date has no rule to restore it.
- **Fix:** the default branch now returns early while an existing order is unhydrated
  (`if (id && !hydrated) return;`). A saved order supplies its own expiry; only `/orders/new`
  may fall through to the company default.
- **Lesson:** two effects writing the same state make declaration order load-bearing, and
  the second one sees pre-update values for everything the first one set. Guard on the
  condition ("this order has not hydrated"), not on the state the other effect is about to
  change. Symptom shape to remember: the bug only bites the case that has no recomputation
  rule to paper over it.

---

## Add-on rows: `w-24` never beat `w-full`, collapsing the description field (2026-08-10)

**Symptom (owner report):** in the add-on list, "the first box is only clickable — not sure
what it does, it does nothing", and the × button "extends the form, requires dragging to
the right".

**Cause.** One line, two symptoms:

```tsx
className={`${INPUT} w-24 shrink-0`}   // INPUT already contains w-full
```

`w-full` and `w-24` are both width utilities of equal specificity, so which one applies is
decided by their order in the GENERATED STYLESHEET, not by the order they appear in the
class attribute. `w-full` won. The price input was therefore 100% wide AND `shrink-0`, so
it could not give any of that width back:

- the × button was pushed past the right edge of the popup — the horizontal drag;
- the description input, the row's only shrinkable item (`min-w-0`, default `shrink:1`),
  absorbed the entire overflow and collapsed to a sliver. It was never broken and its
  `onChange` was never wrong — it simply had no width to render what you typed.

**Fix.** Widths now come from a grid template instead of from competing utilities. The
add-on rows use the same `grid-cols-2 gap-3.5` as the Calculated-price/Override and
Quantity/Unit-price pairs, with the remove button INSIDE the second column beside its price
— a third column would have knocked both fields out of alignment with every other field in
the form. `fields.tsx` gained `INPUT_BASE` (every input token except a width) for controls
sized by their container; `INPUT` is now `${INPUT_BASE} w-full`.

**Rule this leaves behind:** never compose `INPUT` with another width class. Use
`INPUT_BASE` plus the container's own sizing. The same trap was caught a second time in the
same edit, in `${LABEL} mb-0`.

**Verified in a browser**, not just by tsc: the real component was mounted against the real
stylesheet at the popup's 420px width and measured. No horizontal overflow
(`scrollWidth === clientWidth === 417`); description cells span 18→203, exactly matching the
Calculated-price cell; price input + remove button span 217→402, exactly matching the
Override input; typing into the description updates state (the remove button's aria-label
follows it).
