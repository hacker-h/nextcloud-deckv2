# nextcloud-deckv2 — Implementation Plan

A fast, Trello-like frontend for Nextcloud Deck. Deck remains the single source of
truth; this project is a faster lens on it plus the operations Deck's own UI cannot do.

---

## 1. Verified environment

All facts below were verified directly on the `alice` server, not assumed.

| Item | Value |
|---|---|
| Nextcloud | 32.0.12 (`nextcloud:32-apache`) |
| Deck app | 1.16.7 |
| Activity app | 5.0.0 |
| Database | PostgreSQL 13 (`nextcloud-postgres-1`) |
| Cache | Redis (`nextcloud-redis-1`) |
| Reverse proxy | `nginxproxy/nginx-proxy:1.5.1-alpine` + `acme-companion:2.2.10` |
| Canonical URL | `https://nextcloud.xhacker.de` |
| Trusted domains | `nextcloud.xhacker.de`, `bob-nextcloud.xhacker.de`, `nextcloud-alice.xhacker.de`, `nextcloud.henninghacker.eu` |
| Primary user | `vqslauIXXm1nmPEM7bEZ` (17 boards) |
| Secondary user | `antonia` (20 boards, shares several boards) |
| Live cards | 4058 (`deleted_at=0 AND archived=false`) |
| Storage | ZFS volumes with snapshots (rollback net for destructive tests) |
| SPA origin | `https://deckv2.xhacker.de` (**cross-origin** — see §3) |
| Compose stack | `~/server-scripts/alice/nextcloud/docker-compose.yml` |

Secrets live in `secrets.env`, git-crypt encrypted (GPG key
`C9E8626779F0B7B6EA42A997A2A7D55AF9519FDD`). Verified: ciphertext at rest in
every commit, in local history and on the GitHub remote.

---

## 2. Requirements

### 2.1 Core problems being solved

1. **Speed.** Deck's UI blocks on every round-trip. Measured server-side cost of a
   card move is ~2.9 s/card (see §3.2), so optimistic UI is the only thing that can
   make this usable — it is the reason the project exists, not a nice-to-have.
2. **No multi-select.** Deck cannot select several cards and move them together.
   This is the headline feature.
3. **Broken hitboxes.** Card text lacks `user-select: none`, so dragging selects text
   instead of grabbing the card.
4. **Tedious cross-board moves.** Deck requires: three-dot menu → "move card" →
   choose board → choose lane, per card.
5. **No usable history.** Move history exists in the database but is not surfaced
   in any reviewable form.

### 2.2 Must-have scope

- Board view: stacks as columns, cards as compact tiles, dark mode, high density.
- Drag & drop of single cards within and between stacks.
- **Multi-select** with Trello-identical semantics (§6).
- **Bulk move**, via menu/keyboard first, then drag of the whole selection.
- **Inbox panel** — persistent cross-board staging area, collapsible (§7).
- **MRU board switcher** — dropdown sorted by last used, with search (§8).
- **Move history** with grouping, plus undo/redo (§9).
- Create cards (title-only, inline) and rename cards (inline).
- Deep-link to Deck for anything out of scope.
- `user-select: none` on all tiles; the whole tile is the drag handle.
- **Agent-usable**: the same functions the UI calls are exposed to AI agents (§10).

### 2.3 Explicitly out of scope

Card detail view, descriptions, comments, attachments, checklists, labels,
assignees, due dates, time tracking, board/stack administration, sharing, search,
filters, archive, and all realtime-collaboration/presence features.

For all of these: deep-link into Deck. If in doubt, ask rather than build.

### 2.4 Architectural constraints (fixed, not up for debate)

- Static SPA. No own backend, no PHP, no Nextcloud app framework, no Deck fork.
- Lean framework (Svelte / Preact / vanilla + small state container). No SSR,
  no Next.js.
- Optimistic UI is mandatory for every mutation.

---

## 3. Findings that shape the design

### 3.1 Deck's API spans three URL prefixes

Verified in `appinfo/routes.php` and the `nextcloud-deck-cli` client:

| Prefix | Use |
|---|---|
| `/index.php/apps/deck/api/v1.0` | REST API (boards, stacks, cards CRUD) |
| `/ocs/v2.php/apps/deck/api/v1.0` | OCS endpoints (e.g. stack done) |
| `/index.php/apps/deck` | Internal app routes — **reorder**, archive, assign |

The original prompt guessed reorder at
`/api/v1.0/boards/{b}/stacks/{s}/cards/{c}/reorder`. Both that route and
`PUT /index.php/apps/deck/cards/{cardId}/reorder` exist; the CLI uses the latter.
M0 confirms which behaves correctly for cross-board moves.

### 3.2 `CardService::reorder()` is O(n) — the root cause of slowness

From `lib/Service/CardService.php:444`:

- Sets `stackId` **without validating that the target stack belongs to the same
  board** — permission is checked on card and stack *separately*. This is why
  cross-board move works via the reorder endpoint.
- Then loads **every card in the target stack** and issues an `update()` for each,
  with an activity/event dispatch per card.

Consequences that drive the architecture:

- Moving into a 200-card stack ≈ 200 UPDATEs. Bulk-moving N cards into a stack of M
  is **O(N×M)** — 20 cards into a 200-card stack ≈ 4000 UPDATEs.
- **Parallel reorders targeting the same stack will race**, because each recomputes
  ordering from its own snapshot. Concurrency must be *serialized per target stack*
  and *parallel across stacks*.
- Measured baseline (`BENCHMARKS.md`, dedicated test instance): 2.90 s/card
  sequential move; reads ~600 ms for a 200-card stack; card creation parallelizes
  at 4.95× with 8 workers.

### 3.3 Move history already exists server-side, and is complete

`oc_activity` contains **1763 `card_update_stackId` rows**. Each carries full JSON
in `subjectparams`:

```json
{"card":{"id":9709,"title":"tür reparatur ..."},
 "stack":{"id":36,"title":"Done","boardId":4},
 "stackBefore":{"id":86,"title":"Diese Woche","boardId":4},
 "board":{"id":4,"title":"KA TODO"},
 "author":"vqslauIXXm1nmPEM7bEZ"}
```

Both `stack` and `stackBefore` include `boardId`, so exact from→to is recorded for
every move including cross-board ones, with author and timestamp.

**Therefore the Activity API is the primary history source**, not a local journal.
This gives full retention for free, works across devices, and covers moves made in
Deck's own UI or on mobile — retroactively, over all 1763 existing events.

Caveats:
- Events are **duplicated per affected user** (shared boards produce one row per
  user). Dedupe on `object_id` + `timestamp`.
- `user` column is `nextcloud`; the real actor is in `subjectparams.author`.
- The REST filter is per `object_id`. Board-wide feeds may need a different filter;
  M0 determines whether `object_type=deck` board-scoped querying is viable.

A local journal is still needed, but only as a small **in-flight overlay** covering
the window between optimistic render and server confirmation.

### 3.4 Cheap change detection exists

- `GET /api/v1.0/boards` honours **`If-Modified-Since`** and sets an **ETag**
  (`BoardApiController::index`, lines 48–64).
- `GET /boards/{id}` and `GET /stacks/{id}` also set ETags.

So polling can be: `If-Modified-Since` on `/boards` (cheap 304), then refetch only
changed stacks. Combined with refresh-on-window-focus and a slow background
interval, this satisfies "as fast as possible without unreasonable load".

### 3.5 `deckv2.xhacker.de` makes the SPA cross-origin

This **reverses the original same-origin assumption** and has real consequences:

- Nextcloud session cookies will not be sent → auth must use app-password Basic Auth
  (hence `secrets.env`) or a Nextcloud login-flow token.
- CORS becomes load-bearing. Deck's API controllers carry `@CORS` annotations, but
  credentialed requests require `Access-Control-Allow-Credentials: true` and an
  explicit origin (no wildcard).
- Requires DNS record, nginx-proxy vhost, and a Let's Encrypt certificate.

**This is the highest-risk unknown and is tested first in M0.** If Deck does not
emit usable CORS headers, fallbacks are (a) inject headers at nginx-proxy, or
(b) serve under `nextcloud.xhacker.de/board/` and regain same-origin.

---

## 4. Architecture

```
packages/
  core/          @deckv2/core — shared, framework-agnostic TypeScript
    api/         Deck REST client (three prefixes, auth, ETag handling)
    queue/       mutation queue: per-stack serialization, cross-stack parallelism
    store/       optimistic state, precise per-operation rollback
    history/     Activity fetch, dedupe, grouping, undo/redo model
    ops/         semantic operations — the single shared surface (§10)
  web/           the SPA (lean framework, dark, dense)
  agent/         thin CLI / MCP wrapper exposing packages/core/ops
```

`packages/core/ops` is the contract: the UI and AI agents call **the same
functions**. No duplicated logic, no drift, and improvements to queueing or
optimistic behaviour benefit both automatically.

### 4.1 Optimistic mutation model

1. Mutate local state and render immediately — no spinner, no disabled state, never
   a global loading state.
2. Fire the request in the background.
3. On success: nothing to do.
4. On failure: roll back precisely, show a dismissible toast naming the card, offer
   retry.

Requirements:
- Snapshot the pre-state **per operation** so rollback is exact.
- Many operations may be in flight simultaneously; rolling back a failed one must
  **not** clobber later successful changes.
- Bulk moves dispatch in parallel (respecting §3.2's per-stack serialization).
  Partial success is normal: roll back only the cards that actually failed.
- Because moves cost ~2.9 s/card server-side, a 6-card bulk move is still landing
  ~18 s after the UI shows it done. Per-card status (`pending` → `confirmed` →
  `failed`) is surfaced in the history panel rather than hidden.

---

## 5. Milestones

Stop after each milestone and demo.

| # | Content | Depends on |
|---|---|---|
| **M0** | API spike: CORS, cross-board move safety, reorder timings, concurrency, polling | — |
| **M1** | Read-only board rendering from real data | M0 |
| **M2** | Single-card move, optimistic + rollback; in-flight journal | M1 |
| **M2.5** | Trello UX study via Playwright (§11) | — |
| **M3** | Multi-select + bulk move via menu/keyboard | M2, M2.5 |
| **M4** | Drag of a multi-card selection | M3 |
| **M4.5** | Inbox panel + MRU board switcher | M4 |
| **M5** | History panel with grouping + undo/redo | M2 |
| **M6** | Card create/rename, deep-links | M2 |
| **M7** | Agent surface (CLI/MCP over `core/ops`) | M3 |
| **M8** | PWA, IndexedDB cache, offline queue | M4 |

After M4.5 everything missing from Deck is present. M6 and M8 are explicitly lower
priority. History (M5) is built on the optimistic bookkeeping from M2, so the
journal is designed to be **invertible from the start** — retrofitting undo later
would be far more expensive.

---

## 6. Multi-select specification

Trello-identical:

- **Click** — replace selection with the clicked card.
- **Cmd/Ctrl + click** — toggle a single card in/out of the selection.
- **Shift + click** — the first shift+click sets the anchor and enters selection
  mode; each subsequent shift+click selects the whole range between anchor and
  target. Deselecting everything exits the mode until the next shift+click.
  (Cmd must work — the user is on macOS.)
- **Escape**, or click on empty board space — clear the selection.
- Selected cards are strongly highlighted: border **and** contrasting background,
  not a faint shadow.
- A counter shows the number of selected cards.
- No artificial limit on selection size.

Open detail, to be resolved in M2.5: whether a shift-range spans stacks or is
confined to one stack.

### Bulk move — both paths required

1. **Menu/keyboard** (built first, more robust): "Move selection to → «stack»".
2. **Drag** — dragging any selected card takes the entire selection. The drag
   preview shows a stacked impression plus a count. On drop, all cards land in the
   target stack **in their original relative order**.

---

## 7. Inbox panel

- Backing board title: **`[deckv2] Inbox — managed, do not edit`**, autocreated,
  containing a single stack named `Inbox`.
- The prefix marks ownership; the suffix warns anyone encountering it in Deck's UI.
  It is a real Deck board so it *will* appear in Deck's board list — unavoidable —
  but the SPA filters it out of the MRU switcher so it is never a switch target.
- Rendered in a left panel, collapsible/hideable, with the state persisted locally.
- Acts as a drop target from any board and a drag source onto any board, which is
  what removes Deck's four-step move dialog.
- Also solves vertical scrolling on wide boards: a fixed drop target that does not
  move.

**Risk — cross-board data loss.** Every card passing through the inbox crosses a
board boundary *twice*. Deck's labels are **board-scoped**. If `reorder()` neither
remaps nor drops label references, a round trip may leave dangling references to
the source board's label IDs, or silently strip them. The same question applies to
assignees and card-level ACL. Labels are out of scope for *display*, but silently
destroying them on 4058 live cards is unacceptable — hence the M0 gate below.

---

## 8. Board switcher

- Dropdown/overlay listing boards **ordered by last used** (MRU), persisted locally.
- Type-to-filter over board names.
- Reachable from the bottom bar; opens with a shortcut (e.g. `Cmd+K`), then
  arrows/Tab to move and Enter to commit.
- **No global key interception.** `Cmd+Tab` was only an analogy for MRU ordering;
  it is not to be captured (and cannot be, from a web page).
- The inbox board is hidden from this list.

---

## 9. History, grouping and undo/redo

**Source:** Activity API primary (§3.3); local journal only for in-flight ops.
Entries note their origin, distinguishing app actions from those made "via Deck".

**Event model** — every mutation carries a `batchId`, so one bulk move is one entry:

```
{ batchId, ts, kind: "move", boardId,
  from: {boardId, stackId}, to: {boardId, stackId},
  cards: [{id, title, prevOrder, newOrder}],
  origin: "app" | "deck",
  status: "pending" | "confirmed" | "failed" }
```

**Grouping** — consecutive events sharing (from-stack, to-stack, author) within a
short window collapse into one row with a **time span**:

```
Today
  14:32–14:33  ▸ 6 cards   Backlog → Doing
  14:28          "Fix login bug"   Doing → Done
  14:12        ▸ 3 cards   Inbox → Umzug / Backlog     ⟶ cross-board
Yesterday
  18:04        ▸ 12 cards  Backlog → Done
```

Readability rules:
- Collapsed by default; expand to reveal card titles.
- Date buckets (Today / Yesterday / date), plus **session clustering** — bursts
  within ~2 min group into one block.
- **Path coalescing** — A→B→C in a short window renders as `A → C` with a subtle
  "via B".
- **Round-trip detection** — A→B→A renders as *"returned to A"* rather than two
  noisy rows. This is what makes the log reviewable instead of exhausting.
- Cross-board moves are visually distinct.
- In-flight status is shown per card, honestly reflecting the ~2.9 s/card lag.

**Undo/redo** — dedicated buttons in the history panel/bar, caption swapping
between Undo and Redo. Undo operates on a whole batch, so a 6-card bulk move is
reverted as a single action — something Deck cannot do. Because `stackBefore` is
recorded server-side, undo is reconstructable even for moves this app did not make.

Retention: full. The data already exists in Nextcloud indefinitely; this only
groups it for visibility.

---

## 10. Agent surface

**Requirement:** an AI agent must be able to use the same service the UI does —
calling the same functions.

`packages/core/ops` exposes semantic, batch-oriented, idempotent operations, e.g.
`moveCards(cardIds, target)`, `listBoard(boardRef)`, `createCard(...)`,
`undoBatch(batchId)`. These accept human-friendly refs (board/stack titles), not
just numeric IDs, and internally use the same queue that protects against the
O(n) reorder and same-stack races.

`packages/agent` is a thin CLI/MCP wrapper over exactly those functions — no
independent code path, so agents and UI cannot drift.

The existing Go `nextcloud-deck-cli` remains the reference for verified API
semantics but is not a runtime dependency.

---

## 11. Trello UX study (M2.5)

Playwright session on Trello test boards; the user logs in manually, then hands
over the browser. Captured as a written spec with **measured numbers**, which
becomes the acceptance criteria for M3/M4:

- Shift+click range semantics, especially across stack boundaries, and where the
  anchor resets.
- Drag threshold in px before a click becomes a drag (directly relevant to the
  broken-hitbox complaint).
- Drop-placeholder behaviour and the commit point for a new slot.
- The multi-card stacked drag preview.
- Inbox drop targeting and behaviour during a board switch mid-drag.
- Board switcher MRU ordering and keyboard navigation.
- Animation durations/easing.

Out of bounds: scraping Trello's network traffic, DOM or CSS. Different data model,
no benefit, proprietary.

---

## 12. M0 — the spike

**Rule: no application code until M0 is reported and reviewed.** All destructive
tests run on throwaway boards; the 4058 live cards are never touched. ZFS snapshots
provide the safety net.

Ordered by risk:

### M0.1 CORS + auth (highest risk — a wall here changes the deployment)
- Can `https://deckv2.xhacker.de` call the Deck API cross-origin with app-password
  Basic Auth?
- Are preflight `OPTIONS` handled, and is `Access-Control-Allow-Credentials: true`
  returned with an explicit origin?
- Does `OCS-APIRequest: true` remain sufficient?
- If it fails: nginx-proxy header injection, or fall back to same-origin
  `nextcloud.xhacker.de/board/`.

### M0.2 Cross-board move safety (gates the inbox design)
- Move a card with labels, an assignee and a due date to a board and back.
- **Diff the Postgres row and all related rows before/after.** Do labels survive,
  dangle, or vanish? What about assignees and ACL?
- Compare both candidate endpoints (`/cards/{id}/reorder` vs the API-prefixed one).
- If labels do not survive, the inbox needs explicit preserve-and-restore.

### M0.3 Reorder cost and concurrency (drives the queue design)
- Time a single move into stacks of ~10 / ~50 / ~200 cards to confirm O(n).
- Time a 10-card bulk move, sequential vs parallel.
- **Deliberately race** parallel reorders into the same stack and check whether
  ordering corrupts — this validates the per-stack serialization rule.
- Determine a safe concurrency limit across distinct stacks.

### M0.4 Change detection
- Verify `If-Modified-Since` + ETag on `/boards` really returns 304.
- Measure the cost of a no-change poll, and settle the polling interval.

### M0.5 Activity API for history
- Can activity be queried board-wide, or only per `object_id`?
- Confirm dedupe strategy for the per-user duplicate rows.
- Confirm `subjectparams.author` is the reliable actor field.
- Measure the cost of backfilling history for a busy board.

**Deliverable:** measured results, real response bodies, and a written
recommendation — plus explicit callouts wherever a stated assumption turns out to
be wrong.

---

## 13. Open questions

1. **Labels on cross-board moves** — behaviour unknown until M0.2. Gates the inbox.
2. **CORS viability** from `deckv2.xhacker.de` — M0.1. May change the deployment.
3. **Shift-range across stacks** — resolve in M2.5 by observing Trello.
4. **Board-wide activity querying** — M0.5; may affect how history is loaded.
5. **nginx-proxy vhost + DNS + TLS for `deckv2.xhacker.de`** — needs the user's
   approval to modify proxy configuration.
6. **Framework choice** (Svelte vs Preact) — decide at M1; both satisfy the
   constraints.
