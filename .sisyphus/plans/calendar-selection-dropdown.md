# Plan — version badge, dropdown transparency, selection mode, calendar integration

Status: awaiting approval
Author: Prometheus (planning)
Baseline: `434d0fa` on `main`

---

## 0. Why this plan exists

Four requests, in the order the user raised them:

1. Show the app version top-right, so a stale deployment is obvious.
2. Fix the board switcher dropdown showing board content through it.
3. Selection mode with checkboxes (no Ctrl modifier).
4. Proton Calendar integration, Approach A now and B later, implemented and
   tested in the Proton CLI repo as well.

Plus a standing instruction that arrived mid-investigation: **seed a proper mock
board and extend the test stack**, because the existing mock board is too small
to reproduce anything realistic.

---

## 1. Corrections to the record

These matter because earlier claims in this session were wrong, and the plan is
built on the corrected version.

### 1.1 The dropdown was never verified

The original fix (`position: relative; z-index: 30` on `.topbar`, commit
`7ffb0ba`) was "verified" with `document.elementsFromPoint`. That API reports
**stacking order only**. A fully transparent element still returns itself as
topmost. So the test could not have detected the reported bug, and the pass was
meaningless. The commit may still be a correct change; it is simply unproven.

### 1.2 The first pixel "proof" was also wrong

A follow-up probe read `[29,33,37]` inside the menu and concluded bleed-through.
That pixel was inside `.search`, which sets `background: var(--bg)` — the same
colour — by design. Not a defect.

### 1.3 Chromium does not reproduce it

A full pixel scan of the menu rectangle (300x442, excluding the search box)
found **0 foreign pixels** in Chromium, even with the menu forced tall.

### 1.4 The user is on Firefox, against a stale deployment

The screenshot shows Firefox on `deckv2.xhacker.de`, and that build predates
this session: the inbox still reads "Drag cards here from any board" and there
is no bottom dock. Two consequences:

- The engine under test was wrong (Chromium vs Firefox). Firefox 153 is now
  installed for Playwright.
- The code under test was wrong. Hence task 1 (version badge) comes first.

### 1.5 ROOT CAUSE — PROVEN 2026-08-08 (hypothesis was wrong)

**The bug is already fixed in `main` by `7ffb0ba`. The deployment is stale.**

Minimal repro of the real ancestor chain, pixel-scanned inside `.menu`:

| variant | firefox 153 | chromium 151 |
|---|---|---|
| with `z-index:30` (current main) | FOREIGN = **0** | FOREIGN = **0** |
| without it (deployed build) | FOREIGN = **1296** | FOREIGN = **1336** |

Dominant foreign colour `rgb(26,27,22)` = the disabled "Add a card"
(`#242528` at `opacity:.5`) compositing through the menu. Exactly the symptom.

Deployed-build proof: `assets/index-BWFsNuwj.js` still contains the removed
string "Drag cards here from any board"; the deployed CSS contains **0**
occurrences of `z-index:30`, the local build contains 1.

Disproven:
- `background-attachment: fixed` — present in both variants; the fixed variant
  is clean. **Not the cause.**
- "Firefox-only" — **false**, it reproduces in Chromium too. The earlier
  Chromium scan read 0 only because it ran against already-fixed code.

Mechanism: `backdrop-filter` makes `.topbar` a stacking context. Without an
explicit `z-index` it paints as a z-index:0 unit, so any board descendant that
forms its own stacking context (`opacity:.5` is enough) paints above the menu.
The comment at `BoardApp.svelte:410` was right all along.

---

## 2. Task 1 — version badge (do first)

Gates everything else: without it we cannot tell whether a bug report describes
current code.

### Changes
- `vite.config.js`: `define` `__BUILD_SHA__` (from `BUILD_SHA` env, else
  `git rev-parse --short HEAD`, else `'unknown'`) and `__BUILD_TIME__`.
- `src/components/BoardApp.svelte`: render the SHA in the topbar next to the
  account block. `title` carries the full build time.
- `Dockerfile`: pass `BUILD_SHA` as a build arg, since a container build has no
  git history.

### Acceptance
- Badge visible top-right; text equals `git rev-parse --short HEAD`.
- Unit test asserts the badge renders the injected constant.
- Test must define the globals; an undefined `__BUILD_SHA__` should fail loudly
  rather than render blank.

---

## 3. Task 2 — seed a proper mock board + extend the test stack

Prerequisite for tasks 3 and 4. Current mocks are 4 stacks / 5 cards, which
reproduces nothing.

### 3.1 Shared mock fixture
New `e2e/mock-board.js`, usable from Playwright and reusable in unit tests:

- **15+ boards**, matching the switcher screenshot (long titles, truncation,
  a scrolling menu). Includes the real-world names seen in the screenshots.
- **8 stacks**, mirroring `Essensplanung` (Essen, Samstag…Mittwoch) so
  horizontal overflow is exercised.
- **Cards of varied height**: single-line, a very long wrapped title
  (the `aaa…` card), and multi-line — required by the per-card drag placeholder
  behaviour.
- An empty stack, and a stack whose cards overflow vertically.

### 3.2 Cross-browser projects
`playwright.config.js` gains `firefox` and `webkit` projects alongside
`chromium`. The user's bug is Firefox-only so far, so single-engine testing is
what let it through.

### 3.3 Pixel-assertion helper
New `e2e/pixels.js`, wrapping the technique proven to work in this session:

```
screenshot(clip) -> data URL -> <img> -> canvas -> getImageData
```

Exposes:
- `scanRegion(page, selector, { exclude: [selectors] })` — returns a histogram
  of colours inside an element's box, with named sub-regions excluded (so
  `.search` never again masquerades as a defect).
- `assertOpaque(page, selector, { expected, exclude })` — fails when any pixel
  in the region is a colour that belongs to content behind the element.

Rules this encodes, learned the hard way:
- Never assert occlusion with `elementsFromPoint`.
- Always exclude child elements that legitimately use the background colour.
- Assert against a **known set of behind-colours**, not "not equal to expected",
  so antialiasing and shadows do not produce false failures.

### Acceptance
- Mock board renders identically in all three engines.
- `assertOpaque` demonstrably **fails** on an intentionally transparent element
  (mutation check) and passes on an opaque one.

---

## 4. Task 3 — dropdown transparency

Strict order: **reproduce red, then fix, then green.** No fix is written before
a test fails on unfixed code.

### 4.1 Status: root cause proven, no CSS fix required

See §1.5. `main` is already correct; the deployment is stale. What is missing is
a **regression test that actually fails when `z-index:30` is removed**, and a
redeploy. The fix ladder below is cancelled — do not remove
`background-attachment` or `backdrop-filter`; both were exonerated.

### 4.2 Regression test (the real deliverable)
1. Seeded mock board, switcher open, menu overlapping a disabled "Add a card".
2. `assertOpaque('.menu', { exclude: ['.search'] })` — passes on current `main`.
3. **Mutation check (mandatory):** delete `z-index: 30` from `.topbar`, confirm
   the test goes red with `rgb(26,27,22)`, restore. A test that cannot fail here
   is worthless — that is precisely how this bug shipped.
4. Run in chromium + firefox + webkit.

### 4.3 Audit siblings
Same assertion for `CardLifecycleMenu`, `CardDetailModal`, `.selbar`, and
`BottomNav` (which has its own `backdrop-filter: blur(8px)` and
`#1F2023F2` — 95% alpha, so a real candidate).

### 4.4 Replace the bogus test
`e2e/smoke.spec.js`'s "board switcher covers the board beneath it" uses
`elementsFromPoint`. Rewrite it on `assertOpaque`, or delete it — as written it
cannot fail for the reported defect.

### Acceptance
- A test fails on `434d0fa` and passes after the fix, in Firefox.
- All three engines green.
- No popup in the app has a translucent or backdrop-filtered ancestor.

---

## 5. Task 4 — selection mode

Per the user: **no Ctrl.** Once anything is selected, plain click toggles.

### 5.1 Behaviour

| Selection | Input | Result |
|---|---|---|
| empty | click card | opens detail (unchanged) |
| empty | shift+click | selects, becomes anchor (unchanged) |
| non-empty | **click card** | **toggles that card** |
| non-empty | shift+click | range-extend / toggle-off (unchanged) |
| non-empty | click empty board space | clears |
| non-empty | `Escape` | clears |
| non-empty | last card deselected | leaves selection mode |
| non-empty | bulk move completes | leaves selection mode |

Ctrl/Cmd stays unbound: the browser claims it for "open in new tab", and Trello
removed it for that reason. Selection mode makes it unnecessary.

### 5.2 Checkboxes
Matching the user's Trello screenshot:
- Top-**right** of the card, only in selection mode.
- Unselected: transparent fill, light border. Selected: blue fill + white check.
- Selected card keeps its blue outline.
- `transition-duration: 0s` and `user-select: none`, per the measured spec.
- The checkbox is decorative; the whole card stays the click target. Cards are
  `role="button"`, so selection state is exposed via `aria-pressed` in selection
  mode rather than by adding a nested control.

### 5.3 Spec reconciliation
`.sisyphus/TRELLO-UX-SPEC.md:11` records that Trello has no Ctrl+click and no
checkboxes on click-selected cards. We are deliberately diverging. Amend that
section to say so, with the user's rationale, so the file stops contradicting
the code. Do not silently leave it stale.

### 5.4 Tests
- Unit: the state machine in `src/lib/selection.js` — enter, toggle, exit by
  each of the four routes.
- Unit: checkbox renders only in selection mode; reflects selected state.
- E2E on the seeded board: click-to-toggle across stacks, escape, exit after
  bulk move.
- Mutation check: break the toggle rule, confirm tests go red.

### Acceptance
- Plain click never opens detail while in selection mode.
- Plain click still opens detail when nothing is selected.
- Selection mode ends by all four routes.

---

## 6. Task 5 — calendar, Approach A

Two repos. **Proton CLI first**, since deckv2 depends on it.

### 6.1 Verified constraints

| Fact | Source |
|---|---|
| Deck's CalDAV export is read-only | `deck/lib/DAV/Calendar.php` — `createFile()` and `delete()` both `throw new Forbidden`; ACL is `read` + `write-properties` only |
| Deck exposes cards as `VTODO`, not `VEVENT` | same file, `supported-calendar-component-set` |
| Proton API rejects unknown fields | `calendar-service.js:3` `ALLOWED_FIELDS` |
| No custom `X-` properties survive | `proton-client.js` ICS writer emits a fixed property set |
| `description` is writable, returned in lists, 4000 chars | `calendar-service.js:292` |
| iCal UID is internal, not exposed | `proton-client.js:327` |
| A default calendar can be configured | `calendar-service.js:22` |

Conclusion: nothing can be stored on the Nextcloud side, and no custom field
exists on the Proton side. `description` is the only writable free-text channel.
That is what makes Approach A the only DB-free option today, and Approach B
impossible until the CLI exposes UIDs.

### 6.2 Approach A — link in the event description

Event descriptions carry a machine-readable trailer:

```
Design review

--- deckv2 ---
card: 42
board: 7
```

- Link direction is event → card, so many events per card is free.
- Card → events is derived by listing events in a window and grouping by the
  parsed trailer. No local storage of any kind.
- Deck's `duedate` is left alone, so native VTODO export keeps working.

### 6.3 Work in `proton-calendar-api`
1. `deckv2` trailer parse/format helpers, with round-trip and malformed-input
   tests.
2. Verify `description` survives create → list → patch → list unchanged
   (**must be proven against the live API**, not assumed).
3. Confirm list responses include `description`; if a projection drops it, fix
   there.
4. Confirm the window query and pagination behaviour the integration will rely
   on.
5. Only then, any new surface the integration needs.

Its README self-describes as POC: no MFA in CI bootstrap, cookie/refresh auth
rather than a long-lived token. Treat reliability as a risk, not a given.

### 6.4 Work in `nextcloud-deckv2`
1. `/api/calendar/*` added to the proxy allowlist in `server/app.js`
   (`targetPath`), which is a strict allowlist today.
2. Proton bearer token stays server-side, matching the existing app-password
   model. It must never reach the browser — assert this in
   `scripts/check-bundle.js`, which already exists for exactly this purpose.
3. Read-only first: show scheduled events on cards.
4. Then create/attach, then series, then Planner drag-to-day.

### 6.5 Approach B — later
When the CLI exposes UIDs, move the link into a deterministic UID and drop the
description trailer. Cleaner, invisible to users, immune to hand-editing.
Explicitly out of scope now.

### Acceptance
- Trailer round-trips through the live Proton API unchanged.
- Cards show their events with no local persistence anywhere.
- Proton unreachable ⇒ board renders exactly as today, minus schedule chips.
- Bundle check proves no Proton token in client output.

---

## 6.6 Task checklist

- [ ] T1 version badge: `vite.config.js` define `__BUILD_SHA__`/`__BUILD_TIME__`
- [ ] T1 version badge: render in `BoardApp.svelte` topbar + unit test
- [ ] T1 version badge: `Dockerfile` BUILD_SHA build arg
- [ ] T2 `e2e/mock-board.js` seeded fixture (15+ boards, 8 stacks, varied cards)
- [ ] T2 `playwright.config.js` firefox + webkit projects
- [ ] T2 `e2e/pixels.js` scanRegion/assertOpaque helpers
- [ ] T3 dropdown regression test + mutation check (z-index removal goes red)
- [ ] T3 replace `elementsFromPoint` test in `e2e/smoke.spec.js`
- [ ] T3 audit CardLifecycleMenu / CardDetailModal / .selbar / BottomNav
- [ ] T3 redeploy `deckv2.xhacker.de` and confirm badge shows current SHA
- [ ] T4 selection: click-toggles-when-nonempty state machine
- [ ] T4 selection: top-right checkbox UI + aria-pressed
- [ ] T4 selection: amend `.sisyphus/TRELLO-UX-SPEC.md:11`
- [ ] T4 selection: unit + e2e + mutation check
- [ ] T5 calendar: proton-calendar-api trailer helpers + live description proof
- [ ] T5 calendar: deckv2 proxy allowlist + server-side token + bundle check
- [ ] T5 calendar: read-only event display on cards

## 7. Order and risk

1. Version badge — unblocks all future bug reports.
2. Mock board + Firefox/WebKit + pixel helpers — required to see task 3 at all.
3. Dropdown — red first, then fix.
4. Selection mode — self-contained.
5. Calendar — largest, spans two repos, own milestone.

Risks:
- The dropdown may not reproduce locally even in Firefox; it may need the real
  deployment. Do not ship a speculative fix. If it will not reproduce, say so.
- The Proton CLI is POC-grade; its auth can expire in ways a token would not.
- Approach A shows nothing until a Proton fetch returns, and Deck-side search
  cannot see schedules. Accepted cost of zero persistence.

## 8. Standing rules for implementation

- No completion claim without a test that failed first.
- `elementsFromPoint` is banned for visual assertions.
- Every new comment must justify itself or be deleted.
- Commits stay atomic and conventional, each passing on its own.
