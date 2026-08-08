# Dropdown transparency — root cause PROVEN (2026-08-08)

## Verdict
The bug is **already fixed in `main`** by commit `7ffb0ba`
(`position: relative; z-index: 30` on `.topbar`).
The user sees it because **`deckv2.xhacker.de` serves a build that predates the fix**.

## Evidence
Minimal repro of the real ancestor chain (`/tmp/ffrepro/repro.html`), pixel-scanned
inside `.menu` (50px-wide column, past the text labels):

| variant | firefox 153 | chromium 151 |
|---|---|---|
| with `z-index:30` (= current main) | FOREIGN = **0** | FOREIGN = **0** |
| without it (= deployed build) | FOREIGN = **1296** | FOREIGN = **1336** |

Dominant foreign colour `rgb(26,27,22)` = `.addcard` (`#242528` at `opacity:.5`)
composited over `--stack-bg`. That is the disabled "Add a card" button showing
through the menu — exactly the reported symptom.

Deployed build check:
- `assets/index-BWFsNuwj.js` still contains `"Drag cards here from any board"` (removed in current code).
- Deployed CSS contains **0** occurrences of `z-index:30`; locally built CSS contains 1.

## Hypotheses DISPROVEN
- `background-attachment: fixed` (`src/app.css:50`) — **not the cause**. Present in
  both variants; the fixed variant is clean.
- `.topbar` `backdrop-filter: blur(6px)` — not sufficient on its own either.
- "Firefox-only" — **false**. Reproduces in Chromium too. The earlier Chromium
  scan found 0 foreign pixels only because it ran against already-fixed code.

## Why the original z-index fix was right
`backdrop-filter` on `.topbar` makes it a stacking context. Without an explicit
`z-index`, the bar paints as a z-index:0 unit, and any board descendant forming
its own stacking context (the `opacity:.5` disabled Add-a-card is enough) paints
above the menu. The in-code comment at `BoardApp.svelte:410` states this correctly.

## Consequences for the plan
- Task 3 needs **no new CSS fix**. It needs a regression test that genuinely fails
  when `z-index:30` is removed, plus a redeploy.
- The "cheapest first" fix ladder (remove background-attachment, then
  backdrop-filter, then portal the menu) is unnecessary — do not do it.
- `e2e/smoke.spec.js`'s `elementsFromPoint` test still must be replaced: it passes
  on the broken variant.
