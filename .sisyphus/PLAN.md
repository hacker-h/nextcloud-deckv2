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
   card move is ~1.2–1.5s/card (measured, §3.2), so optimistic UI is the only thing that can
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
- **Card detail in Deck v2**: plain click and Enter/Space open the in-app detail;
  native Deck deep-links are forbidden.
- `user-select: none` on all tiles; the whole tile is the drag handle.
- **Agent-usable**: the same functions the UI calls are exposed to AI agents (§10).

### 2.3 Explicitly out of scope

Checklists, time tracking, board/stack administration, sharing, search, filters, and
all realtime-collaboration/presence features.

Card detail is first-class in this SPA: title, description, due date, labels,
assignees, comments, attachments, archive/unarchive, and guarded soft-delete are in
scope. Native Deck card deep-links are forbidden; if a detail feature is missing,
show an in-app incomplete state rather than escaping to Deck's own UI.

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
- Measured M0.3: `reorder()` on a 40-card stack took **6.5–7.5s**, versus **1.2–1.5s**
  for `update()`. Cost grows with stack size; your real boards are larger.

> **RESOLVED IN M0 — `reorder()` is not used at all.** It is CORS-blocked from the
> browser, ~5× slower, and orphans labels on cross-board moves. All mutations go
> through `PUT /api/v1.0/boards/{b}/stacks/{s}/cards/{c}` instead. See
> `M0-RESULTS.md`. The per-stack serialization rule below is therefore obsolete:
> `update()` writes a single row and does not reindex, so the queue can be broadly
> parallel (cap ~6–8) provided each card carries a distinct `order` (§3.6).

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
- **The Activity API is CORS-blocked** (M0.1): preflight returns 405 with no CORS
  headers. Resolved by adding CORS headers on the alias host — see
  `CORS-DECISION.md`. Needed for M5 only; M1–M4 are unaffected.

A local journal is still needed, but only as a small **in-flight overlay** covering
the window between optimistic render and server confirmation.

### 3.4 Cheap change detection exists

- `GET /api/v1.0/boards` sets an **ETag** (`BoardApiController::index`, lines 48–64).
- `GET /boards/{id}` and `GET /stacks/{id}` also set ETags.

> **CORRECTED IN M0.4:** `If-Modified-Since` returns **HTTP 500** — Nextcloud's
> `Util::parseHTTPDate` rejects the standard header format. Use **`If-None-Match`
> exclusively**. Measured: 304 in 0.14s with zero payload, versus 11820 bytes for a
> full fetch.

Polling: `If-None-Match` on `/boards` on window focus plus a slow background
interval (~30s), then refetch only stacks whose ETag changed. Negligible load.

### 3.6 Sparse ordering is mandatory (new, from M0.4)

`update()` does not reindex the target stack — it writes exactly the `order` given.
That is what makes it fast, but ordering becomes the client's responsibility.

Measured: six parallel moves all sending `order: 0` produced six cards sharing
`order=0`, rendering in arbitrary sequence. Repeating with values spaced 65536 apart
placed every card on its own slot under full parallelism.

Adopt Trello's model: space by **65536**, insert between neighbours by bisecting
(`(a+b)/2`), re-space lazily on read when a gap closes. `order` is `bigint`, so
headroom is effectively unlimited. O(1) writes, safe parallelism, no reindexing.

Deck's own UI renumbers stacks densely whenever it touches one; harmless, since we
re-space from the next read.

### 3.7 Read-after-write is stale (new, from M0)

Deck's read endpoints repeatedly returned pre-write state immediately after a
successful mutation (Redis-backed caching); Postgres was correct every time.
Optimistic UI hides this by construction, but **no code may verify a write by
immediately re-reading it**.

### 3.5 `deckv2.xhacker.de` makes the SPA cross-origin

This **reverses the original same-origin assumption**:

- Nextcloud session cookies are not sent → auth is app-password Basic Auth
  (hence `secrets.env`).
- CORS is load-bearing.
- Requires a DNS record, an nginx-proxy vhost, and a Let's Encrypt certificate.

**Verified in M0.1.** CORS works, with three constraints:

1. Only the `/index.php/apps/deck/api/v1.0` prefix is CORS-enabled. The internal
   app prefix (`/apps/deck/cards/{id}/reorder`) and the OCS activity endpoint both
   return **405 on preflight with no CORS headers**.
2. **`OCS-APIRequest` must not be sent from the browser** — it is absent from
   `access-control-allow-headers`, so sending it fails preflight. Verified it is not
   required: `GET /boards` without it returns 200 and valid JSON.
3. `Access-Control-Allow-Credentials: false` is irrelevant — we authenticate with an
   `Authorization` header, not cookies.

**Deployment (decided, see `CORS-DECISION.md`):** the SPA is served from
`deckv2.xhacker.de` but calls the API on the pre-existing, zero-traffic alias
`nextcloud-alice.xhacker.de`. CORS headers are added **only on the alias**, so the
production `nextcloud.xhacker.de` vhost is never modified.

> **Trap:** nginx-proxy includes `vhost.d/<host>` *instead of* `vhost.d/default`
> (`nginx.tmpl:738–741`), and `default` holds the only ACME challenge block. A
> host-specific file that omits that block silently breaks Let's Encrypt renewal,
> and the cert expires ~60 days later. Any `vhost.d/<host>` file must re-include it.

Auth consequence: the app password is a **long-lived credential in the browser**.
Keep it in a scoped store, never in `localStorage` beside cached board data, and
rely on it being independently revocable in Nextcloud settings.

---

## 4. Architecture

```
packages/
  core/          @deckv2/core — shared, framework-agnostic TypeScript
    api/         Deck REST client (api/v1.0 prefix only, auth, ETag handling)
    queue/       mutation queue: bounded parallelism (~6–8), sparse ordering
    store/       optimistic state, precise per-operation rollback
    history/     Activity fetch, dedupe, grouping, undo/redo model
    ops/         semantic operations — the single shared surface (§10)
  web/           the SPA (lean framework, dark, dense)
  agent/         thin CLI / MCP wrapper exposing packages/core/ops
```

`packages/core/ops` is the contract: the UI and AI agents call **the same
functions**. No duplicated logic, no drift, and improvements to queueing or
optimistic behaviour benefit both automatically.

### 4.0 The single mutation primitive

Every card mutation — move within a stack, move across stacks, move across boards,
rename — uses:

```
PUT /index.php/apps/deck/api/v1.0/boards/{targetBoardId}/stacks/{targetStackId}/cards/{cardId}
```

Three rules the core client enforces, each verified in M0:

1. **The target stack goes in the URL path, not the body.** `CardApiController::update`
   reads `stackId` from the request params, and the path parameter wins. Sending the
   target only in the body returns **HTTP 200 with the card unmoved** — a silent
   no-op that looks like success.
2. **Read-modify-write.** `update()` overwrites `title`, `type`, `owner` and
   `description`, so current values must be resent or they are destroyed. Callers
   never assemble payloads by hand.
3. **Always send an explicit sparse `order`** (§3.6), otherwise parallel moves
   collide.

Bonus: this endpoint rebinds labels correctly on cross-board moves
(`CardService.php:329–351` — match by title, clone if missing, reassign), which
`reorder()` does not do.

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
- Bulk moves dispatch in parallel with a bounded pool (~6–8), each card carrying a
  distinct sparse `order`. Partial success is normal: roll back only the cards that
  actually failed.
- Measured cost is **~1.2–1.5s/card**, and 6 parallel moves complete in **~4.3s
  wall**. So a bulk move is still landing for a few seconds after the UI shows it
  done. Per-card status (`pending` → `confirmed` → `failed`) is surfaced in the
  history panel rather than hidden.

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
| **M6** | Card create/rename; in-app card detail follow-ups | M2 |
| **M7** | Agent surface (CLI/MCP over `core/ops`) | M3 |
| **M8** | PWA, IndexedDB cache, offline queue | M4 |

After M4.5 everything missing from Deck is present. M6 and M8 are explicitly lower
priority. History (M5) is built on the optimistic bookkeeping from M2, so the
journal is designed to be **invertible from the start** — retrofitting undo later
would be far more expensive.

---

## 6. Multi-select specification

**Rewritten from measurement.** Trello was observed live; see `TRELLO-UX-SPEC.md`.
Two assumptions in the original spec were wrong.

**Shift is the only selection modifier. There is no Cmd/Ctrl+click.** Measured:
Cmd+click opens the card in a new browser tab — the browser claims the modifier
before the page sees it. It is not implementable, and Trello does not use it.

Measured semantics, to be replicated exactly:

| Action | Result |
|---|---|
| Shift+click, nothing selected | Select it; it becomes the anchor |
| Shift+click another card in the **same** stack | Select the **whole range** anchor→target |
| Shift+click *backwards* past the anchor | **Union** — keeps the existing range and adds the new one |
| Shift+click an **already-selected** card | **Toggle that single card off** |
| Shift+click a card in a **different** stack | Add **only that card** — ranges never span stacks |
| `Escape`, or click empty board space | Clear the selection |

```
shift+click idx2            -> {2}
shift+click idx5            -> {2,3,4,5}        range
shift+click idx0            -> {0,1,2,3,4,5}    union, not replacement
shift+click idx3 (selected) -> {2,4,5}          toggles idx3 off
```

Shift+click therefore serves double duty — **range-extend** on unselected cards,
**toggle-off** on selected ones. That single rule is why no second modifier exists.

- **Plain click must not reset the selection.** In Trello a plain click opens the
  card detail. For us: plain click on a card opens the in-app Deck v2 card detail;
  plain click on empty space clears.
- **Shift-click is selection only.** It range-extends/toggles selection and never
  opens detail.
- **Enter/Space activate detail.** Keyboard activation on a focused card opens the
  same in-app detail as a genuine plain click.
- **Drag never activates.** Pointer movement that crosses the drag threshold,
  pointer cancellation, and failed drops must not open detail.
- **Native Deck deep-links are forbidden.** No `apps/deck/board/.../card/...` URL is
  an activation fallback or escape hatch.
- Selected cards get a saturated outline (Trello: `2px rgb(0,95,204)`) plus a
  contrasting background.
- A counter shows the number of selected cards.
- No artificial limit on selection size.
- **No transition on selection state.** Trello measures `transition-duration: 0s`;
  instant feedback is a large part of why it feels fast.

### Bulk move — both paths required

1. **Menu/keyboard** (built first, more robust): "Move selection to → «stack»".
   Trello has **no equivalent** — no bulk-action toolbar exists for a shift
   selection — so this is our own design, not an imitation.
2. **Drag** — dragging any selected card takes the entire selection. The drag
   preview shows a stacked impression plus a count. On drop, all cards land in the
   target stack **in their original relative order**.

### Drag implementation

Trello uses Atlassian Pragmatic DnD over the **native HTML5 drag API**. Do **not**
copy that choice: native DnD cannot be driven by synthetic pointer events, so it
would make our own Playwright E2E tests impossible (verified — probes at 1–8px
produced no drag).

Use **pointer events** (`pointerdown`/`pointermove`/`pointerup`) with a ~4–5px
activation threshold. Testable, full control over the stacked multi-card preview,
identical behaviour on touch, and no browser-imposed drag image. Combined with
`user-select: none` this resolves the original hitbox complaint.

### Visual metrics (measured from Trello)

| Property | Value |
|---|---|
| Card height / pitch | **36px / 44px** (8px gap) |
| List width | **272px** |
| Card radius / list radius | 8px / 12px |
| Card font size | 14px |
| Selected outline | `2px rgb(0,95,204)` |
| `user-select` | `none` on card **and** title |
| `transition-duration` | `0s` |

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
- In-flight status is shown per card, honestly reflecting the ~1.2–1.5s/card lag.

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
just numeric IDs, and internally use the same queue, sparse ordering and
read-modify-write handling described in §4.0.

`packages/agent` is a thin CLI/MCP wrapper over exactly those functions — no
independent code path, so agents and UI cannot drift.

The existing Go `nextcloud-deck-cli` remains the reference for verified API
semantics but is not a runtime dependency.

---

## 11. Trello UX study — **DONE**

Completed. Full findings in **`TRELLO-UX-SPEC.md`**; §6 above was rewritten from it.

Headline results:
- **No Cmd/Ctrl+click multi-select exists** — it opens a browser tab. Shift is the
  only modifier, doing range-extend *and* toggle-off.
- Backwards shift+click **unions** rather than replacing.
- Ranges **never span lists**.
- **`transition-duration: 0s`** — no animation on selection or reorder.
- Measured metrics: 36px card / 44px pitch / 272px list / 8px+12px radii.
- Board switcher confirms **MRU + search**; inbox confirms top-insert + collapsible.

Could not be measured, because Trello uses native HTML5 DnD which synthetic pointer
events cannot trigger: drag threshold, drop-placeholder timing, stacked drag
preview. Mitigated by choosing pointer events ourselves (§6) and designing the
preview from the user's screenshots. Trello also has **no bulk-action toolbar**, so
the bulk-move menu has no precedent to copy.

Out of bounds (respected): scraping Trello's network traffic or proprietary code.

---

## 12. M0 — the spike — **DONE**

Executed against the live instance on throwaway boards `[deckv2-spike] A/B`, purged
afterwards; live card count verified back at exactly **4058**. Full measurements in
**`M0-RESULTS.md`**.

| Sub-spike | Outcome |
|---|---|
| M0.1 CORS + auth | Works on `/api/v1.0` only; omit `OCS-APIRequest`; app-prefix and activity endpoints are CORS-blocked |
| M0.2 Cross-board safety | `update()` rebinds labels correctly; `reorder()` orphans them |
| M0.3 Cost | `reorder()` 6.5–7.5s vs `update()` 1.2–1.5s; 6 parallel in 4.3s wall |
| M0.4 Ordering | `update()` does not reindex → sparse client-side ordering mandatory |
| M0.5 Change detection | `If-None-Match` → 304 in 0.14s; `If-Modified-Since` → **HTTP 500** |

Assumptions proven wrong, and corrected above: the reorder endpoint choice
(§3.2/§4.0), `If-Modified-Since` (§3.4), per-stack serialization (§3.2/§4.1), and
`OCS-APIRequest` in the browser (§3.5).

Still open from M0.5: whether activity can be queried **board-wide** rather than per
`object_id`. Affects only how M5 loads history, not whether it works.

---

## 13. Deployment tasks (for M-deploy)

Decided: **`deckv2.xhacker.de` for the SPA**, API on `nextcloud-alice.xhacker.de`.
None of this blocks M1–M4, which run from a local dev server.

1. **DNS** — add a dedicated resource in `~/src/gitlab.com/terraform/services/alice.tf`:
   ```hcl
   resource "cloudflare_record" "deckv2_alice_cname_de" {
     zone_id = data.cloudflare_zone.xhacker_de.id
     name    = "deckv2"
     type    = "CNAME"
     content = "alice.xhacker.de"
     proxied = false
     ttl     = 60
   }
   ```
   It must be its own resource: the existing `alice_service_records` set derives
   names as `<service>-alice`, which would yield the wrong hostname.
   Credentials are in git-crypted `services/terraform.tfvars`; `services/` uses a
   GitLab HTTP backend, and `docs/state.md` requires a state/zone backup first.
2. **SPA vhost** — a static-file container with `VIRTUAL_HOST=deckv2.xhacker.de` and
   `LETSENCRYPT_HOST`, auto-detected by nginx-proxy + acme-companion.
3. **CORS on the alias** — `/etc/nginx/vhost.d/nextcloud-alice.xhacker.de`, which
   **must re-include the ACME challenge block** (see §3.5 trap), plus CORS headers
   for `deckv2.xhacker.de` and `OPTIONS` → 204.
4. **FritzBox rebind exception** — likely unnecessary: measured from the LAN, the
   FritzBox already resolves `nextcloud-alice.xhacker.de` → `alice.xhacker.de` →
   the public IPv6 address, identical to public DNS. Re-test once the record exists.
   **Note:** the `fritzbox` CLI has **no** DNS-rebind command today (subcommands:
   `hosts, show, rename, rename-prefix, wake, wan-access, monitor, blocklist, fax,
   vpn`), despite `terraform/docs/dns.md` prescribing it. If needed, it must be
   built first, modelled on the existing `blocklist` web-API subcommand.
5. **Verify** — preflight returns the right ACAO; ACME path still resolves on the
   alias; generated config for `nextcloud.xhacker.de` is byte-identical (`diff`).

---

## 14. Open questions

1. **Framework choice** (Svelte vs Preact) — decide at M1; both satisfy the
   constraints.
2. **Board-wide activity querying** — affects M5 history loading only.
3. **Inbox stack rendering** — if the inbox board grows more than one stack, show
   only the first or all? Defaults to first.

Everything else is resolved: labels survive via `update()` (M0.2), CORS works with
the alias-host design (`CORS-DECISION.md`), shift-range semantics are measured
(`TRELLO-UX-SPEC.md`), and the DNS path is specified above.
