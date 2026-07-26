# Trello UX spec — measured

Observed live on `trello.com` (board "mein 2. board", 3 lists, 9 cards in "Fertig")
via Playwright. Everything below is measured behaviour, not recollection.
These are the acceptance criteria for M3/M4.

---

## 1. Selection model — the big correction

**Trello has no Cmd/Ctrl+click multi-select.** Measured: Cmd+click opens the card in
a **new browser tab** (4 tabs opened during the probe). The browser claims the
modifier before the page sees it.

**Shift is the only selection modifier.** Measured semantics:

| Action | Result |
|---|---|
| Plain click on card | **Opens the card detail** (URL → `/c/<id>/...`). Does *not* select. |
| Shift+click on unselected card, nothing selected | Selects it, becomes anchor |
| Shift+click on another card in the **same** list | Selects the **whole range** anchor→target |
| Shift+click *backwards* past the anchor | **Unions** — keeps the old range and adds the new one. Does *not* replace. |
| Shift+click on an **already-selected** card | **Toggles that single card off** |
| Shift+click a card in a **different** list | Adds **only that card** — no cross-list range |
| `Escape` | Clears the entire selection |

Worked example (list of 9, indices 0–8):
```
shift+click idx2            -> {2}
shift+click idx5            -> {2,3,4,5}        range
shift+click idx0            -> {0,1,2,3,4,5}    union, not replacement
shift+click idx3 (selected) -> {2,4,5} …        toggles idx3 off
```

So shift+click serves double duty: **range-extend** on unselected cards,
**toggle-off** on selected ones. That single rule is why Trello needs no Cmd+click,
and it is what the user meant by "make it the same as on Trello".

**Ranges never span lists.** Cross-list selection is possible, but only card by card.

### Implication for our design

The plan's §6 was wrong on two counts and must be updated:
- Drop the "Cmd/Ctrl+click toggles" requirement — Trello does not have it, and in a
  browser it cannot work reliably. Shift+click on a selected card is the toggle.
- Plain click must **not** replace the selection with that one card. In Trello plain
  click opens the card. For us the equivalent is: plain click on empty space clears;
  plain click on a card should open the Deck deep-link (or do nothing), never
  silently reset a selection the user just built.

---

## 2. Visual treatment (measured)

| Property | Value |
|---|---|
| Card height | **36 px**, pitch **44 px** (8 px gap) |
| Card radius | 8 px |
| Card font size | 14 px |
| List width | **272 px** |
| List radius | 12 px |
| Unselected outline | `3px rgb(41,42,46)` (dark theme) |
| **Selected outline** | **`2px rgb(0,95,204)`** — saturated blue |
| Selected marker | extra class on `[data-testid="trello-card"]` |
| Card shadow | `0 1px 1px rgba(30,31,33,.25), 0 0 1px rgba(30,31,33,.31)` |
| `transition-duration` | **0s** on cards and list items |
| `user-select` | **`none`** on both the card and its title |

Two things worth copying:

1. **`transition-duration: 0s`.** Selection state and card position change with **no
   animation at all**. That is a large part of why Trello feels instant — there is no
   easing curve to wait out. Our plan should not add transitions to selection or
   reorder; only drag-follow needs to be smooth.
2. **`user-select: none` on card *and* title.** Exactly the fix the user asked for.
   Confirmed at 36 px row height, the whole tile is the drag surface.

Dense layout (36 px rows, 272 px columns) matches the "many cards visible, not airy"
requirement — use these numbers directly rather than inventing spacing.

---

## 3. Drag & drop implementation

Cards carry:
```html
<li data-testid="list-card" draggable="true"
    data-planner-draggable="true" data-drop-target-for-element="true">
  <div data-testid="trello-card" data-card-id="6a654d802d9d6070e216e988"
       data-drop-target-for-external="true" data-drop-target-for-element="true">
```

`data-drop-target-for-element` / `data-drop-target-for-external` are markers of
**Atlassian's Pragmatic drag-and-drop** (`@atlaskit/pragmatic-drag-and-drop`), built
on the **native HTML5 DnD API** — not mouse-event emulation, not react-beautiful-dnd.

**Consequence for testing:** synthetic CDP mouse events (`mouse.down` → `move`) do
**not** initiate a drag. Measured: probes at 1/2/3/5/8 px produced no drag state.
Native DnD requires real OS-level drag events or explicit `DataTransfer`
dispatch. So the drag threshold could not be measured this way, and **any future
E2E test of our own drag implementation must account for this** — if we use native
HTML5 DnD, Playwright cannot drive it with mouse events either.

**Recommendation:** implement drag with **pointer events** (`pointerdown` → `pointermove`
→ `pointerup`) rather than native HTML5 DnD. Reasons: it is testable with Playwright,
gives full control over the multi-card stacked preview, avoids browser-imposed drag
image behaviour, and works identically on touch. We lose nothing, since we do not
need cross-application drops. Use a ~4–5 px activation threshold (standard, and it
resolves the user's text-selection complaint together with `user-select: none`).

---

## 4. Board switcher

Bottom bar: `Posteingang | Planer | Board | Boards wechseln`.

Opening "Boards wechseln" shows, in order:
1. a **search field** ("Ihre Boards durchsuchen")
2. filter chips: `Alle`, `Trello-Arbeitsbereich`
3. **`Zuletzt angesehen`** ("recently viewed") — MRU list, most recent first
4. then workspace groupings

Confirms the user's requirement: **MRU ordering plus type-to-filter**, exactly as
planned in §8. Closes with `Escape`.

---

## 5. Inbox panel

Left panel, header `Posteingang`, with:
- an **"Eine Karte hinzufügen"** input at the very top (add lands at top)
- explanatory empty state ("Aufgaben konsolidieren")
- privacy note: **"Der Posteingang ist nur für Sie sichtbar"** — private to the user
- toggled from the bottom bar; collapsible

Matches the planned inbox (§7). Note Trello's inbox is *private*; our Deck-backed
inbox board is private to the account by default, which is equivalent in practice.

---

## 6. What could not be measured, and why

- **Drag threshold in px** — blocked by native HTML5 DnD (see §3). Mitigation: adopt
  the standard 4–5 px pointer-event threshold; it is not a UX-critical unknown.
- **Multi-card stacked drag preview** — same blocker; could not trigger a real drag.
  Design from the screenshots the user supplied instead.
- **Bulk-move API contract** — no mutating requests were captured, because no drag
  or move could be completed. Not a loss: our backend is Deck, so Trello's API shape
  is irrelevant; only the *interaction* mattered.
- **Multi-card selection action bar** — Trello shows no dedicated bulk-action toolbar
  for a shift-selection in this version. So the "move selection to → «stack»" menu is
  **our own addition**, with no Trello precedent to copy. Worth designing
  deliberately rather than guessing at an imitation.

---

## 7. Changes this forces in PLAN.md

1. **§6 multi-select**: remove Cmd/Ctrl+click. Shift+click is range-extend on
   unselected cards and toggle-off on selected ones. Backwards shift+click unions.
2. **§6**: plain click must not reset the selection (Trello opens the card instead).
3. **New**: no transitions on selection/reorder (`transition-duration: 0s`).
4. **New**: use pointer events, not native HTML5 DnD — testability and preview control.
5. **New**: adopt measured metrics — 36 px card, 44 px pitch, 272 px list, 8/12 px radii.
6. **§6**: the bulk-move menu has no Trello equivalent; design it ourselves.
