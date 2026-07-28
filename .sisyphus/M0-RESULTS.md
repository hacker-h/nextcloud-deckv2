# M0 — API Spike Results

Executed against the live instance (`https://nextcloud.xhacker.de`, NC 32.0.12,
Deck 1.16.7) using throwaway boards `[deckv2-spike] A/B` (ids 114/115).
All scratch data purged afterwards; live card count verified back at **4058**.

Every claim below is measured, not assumed.

---

## Summary of decisions this spike forces

| Question | Answer |
|---|---|
| CORS from `deckv2.xhacker.de` | **Works** — but only on the `/api/v1.0` prefix |
| Which endpoint for moves | **`update()` (API prefix), never `reorder()`** |
| Cross-board move | **Works, and rebinds labels correctly** |
| Ordering scheme | **Sparse (65536 spacing), assigned client-side** |
| Parallel moves | **Safe**, provided each carries a distinct `order` |
| Change polling | **ETag + `If-None-Match`** (not `If-Modified-Since`) |

Net effect: the app is ~5× faster than Deck per move *and* loses no data.

---

## M0.1 — CORS and auth

App-password Basic Auth over cross-origin works. Preflight `OPTIONS` from
`Origin: https://deckv2.xhacker.de` returns:

```
access-control-allow-origin: https://deckv2.xhacker.de
access-control-allow-methods: PUT, POST, GET, DELETE, PATCH
access-control-allow-headers: Authorization, Content-Type, Accept
access-control-allow-credentials: false
```

Findings:

1. **`Access-Control-Allow-Credentials: false`** — irrelevant for us. We authenticate
   with an `Authorization` header, not cookies, so `credentials` is not needed.
   (It would matter for a session-cookie design; that path is closed cross-origin.)
2. **`OCS-APIRequest` is *not* in the allowed headers.** Verified it is also not
   required: `GET /api/v1.0/boards` without that header returns 200 and valid JSON.
   The SPA must therefore **omit** `OCS-APIRequest` — sending it would fail preflight.
   (The Go CLI sends it because it is same-origin-agnostic; the browser is stricter.)
3. **Only the `/index.php/apps/deck/api/v1.0` prefix is CORS-enabled.** Both other
   prefixes return **405 on preflight with no CORS headers at all**:
   - `/index.php/apps/deck/cards/{id}/reorder` → 405, unusable from the browser
   - `/ocs/v2.php/apps/activity/api/v2/activity/filter` → 405, unusable from the browser

**Consequences.** The internal app prefix is off-limits to the SPA. This
independently rules out `reorder()` — which the performance results below also
condemn — so there is no conflict.

The **Activity API being CORS-blocked is a genuine problem for the history feature**,
since §3.3 of the plan designated it the primary source. Options, in order of
preference:
- (a) inject CORS headers for that path at nginx-proxy (small, contained change);
- (b) serve the SPA same-origin under `nextcloud.xhacker.de/board/`, which removes
  every CORS question at once;
- (c) derive history solely from the local journal, losing the retroactive 1763
  events and cross-device coverage.

Recommendation: **(b)** if the user has no attachment to the `deckv2` subdomain,
otherwise **(a)**. Deferred to the M5 history milestone; it does not block M1–M4.

---

## M0.2 — Cross-board move and label safety

### The endpoint contract (a real trap)

`CardApiController::update()` (line 92) reads `stackId` from
`$this->request->getParam('stackId')`. Because the route is
`/boards/{boardId}/stacks/{stackId}/cards/{cardId}`, **the path parameter wins over
the request body**.

Measured consequence: sending `{"stackId": <target>}` in the body while addressing
the *source* stack in the URL returns **HTTP 200 with the card unchanged** — a
silent no-op. Verified in Postgres: card stayed on stack 363.

> **The target stack must be encoded in the URL path**, not the body:
> `PUT /api/v1.0/boards/{targetBoardId}/stacks/{targetStackId}/cards/{cardId}`

This would have been an ugly bug to find later; it looks like success.

### Label behaviour — measured

Test card carried label `Abgeschlossen` (id 511, board 114), a due date and a
description.

| Method | Result |
|---|---|
| `reorder()` (app prefix) | Card moved to board 115; **label still id 511, `board_id=114`** → orphaned cross-board reference |
| `update()` (API prefix) | Card moved to board 115; **label rebound to id 515, `board_id=115`**, same title |

`update()` implements exactly Trello's strategy (`CardService.php:329–351`): on
board change it matches labels by title on the target board, clones any that are
missing, and reassigns. `reorder()` has none of this logic.

Due date and description survived both paths intact.

**So the safe path and the fast path are the same path.** No preserve-and-restore
workaround is needed.

---

## M0.3 — Performance

Stack seeded with 40 cards.

| Operation | Time |
|---|---|
| `reorder()` — same stack, 40-card stack | **6.47s / 7.14s / 7.54s** |
| `update()` — cross-board move | **1.23s / 1.21s / 1.56s** |
| 6× `update()` in parallel, same target stack | **4.34s wall** (~0.72s/card effective) |

Interpretation:

- `reorder()` is ~5× slower and **degrades with stack size**, confirming the O(n)
  rewrite in `CardService::reorder()` (it re-`update()`s every card in the stack).
  The 2.90s/card in `BENCHMARKS.md` was measured on smaller stacks; on a 40-card
  stack it is already ~7s, and your real boards are larger.
- `update()` writes a single row: cost is flat in stack size.
- Parallelism works. A 6-card bulk move takes ~4.3s wall instead of ~7.4s
  sequential, and would take ~45s via `reorder()`.

**A 20-card bulk move: ~10s with this design, vs ~2.5 minutes using the obvious
endpoint.** This is the difference between the app being pleasant and unusable.

---

## M0.4 — Ordering and concurrency

`update()` does **not** reindex the target stack — it writes only `order` as given.
That is what makes it fast, but it means **ordering is the client's responsibility**.

Measured: 6 parallel moves all sent `order: 0` → all six landed at `order=0`
(10 cards total sharing that value). Ties render in arbitrary order.

Repeated with **sparse ordering** — distinct values spaced 65536 apart:

```
 order  | count
--------+-------
      0 |     4      <- the earlier colliding batch
  65536 |     1
 131072 |     1
 196608 |     1
 262144 |     1
 327680 |     1
 393216 |     1
```

Every card landed on its own slot under full parallelism. No races, no corruption.

**Adopt Trello's sparse-position model:** space cards by 65536, insert between
neighbours by bisecting (`(a+b)/2`), and re-space lazily on read if a gap closes.
`order` is `bigint`, so headroom is effectively unlimited. This yields O(1) writes,
safe parallelism, and no neighbour reindexing.

Note: Deck's own UI will renumber a stack densely whenever it touches one. That is
harmless — we simply re-space from the next read.

---

## M0.5 — Change detection

| Request | Result |
|---|---|
| `If-None-Match: <etag>` | **304, 0 bytes, 0.14s** |
| `If-Modified-Since: <now>` | **HTTP 500** |
| No cache headers | 200, 11820 bytes, 0.16s |

- **ETag works and is cheap** — a no-change poll costs 0.14s and zero payload.
- **Correction (found in M1): only `GET /boards` sends an ETag.**
  `GET /boards/{id}/stacks` sends **none** — verified against the live server and
  confirmed in `StackApiController::index()`, which never calls `setETag()` (only
  the single-stack `get()` does). So conditional requests work at the *board list*
  level only; refetching a board's stacks always transfers the full payload.
  Options for M2+: poll `/boards` for change detection, or fetch stacks
  individually via `/stacks/{id}` where ETags do exist (one request per stack,
  worth measuring before adopting).
- **`If-Modified-Since` returns 500.** `BoardApiController::index` parses it via
  `Util::parseHTTPDate` and evidently chokes on the standard format. The plan's
  §3.4 assumption was wrong: **use `If-None-Match` exclusively.**

Polling design: `If-None-Match` on `/boards` on window focus plus a slow background
interval (~30s), then refetch only stacks whose ETag changed. Negligible load.

---

## Impact on the plan

1. **All mutations go through `PUT /api/v1.0/boards/{b}/stacks/{s}/cards/{c}`**,
   with the *target* board/stack in the URL. `reorder()` is not used at all —
   it is CORS-blocked, ~5× slower, and orphans labels.
2. `update()` requires a **read-modify-write**: `title`, `type`, `owner`,
   `description` must be resent or they are clobbered. The core client owns this;
   callers never assemble payloads by hand.
3. **Client-side sparse ordering** (65536 spacing, bisect on insert) is mandatory,
   not an optimisation — without it, parallel moves collide on `order`.
4. **Never send `OCS-APIRequest`** from the browser; it breaks CORS preflight.
5. Use **`If-None-Match`**, never `If-Modified-Since`.
6. The mutation queue can be **broadly parallel** (a modest cap, ~6–8) rather than
   serialized per stack, since `update()` does not reindex. This supersedes the
   per-stack-serialization rule in the plan.
7. **History needs a CORS decision** (M0.1) before M5.

## Residual risks

- **Deck's read endpoints serve stale data** immediately after a write (observed
  repeatedly; likely Redis). Postgres was correct every time. Optimistic UI hides
  this by construction, but any read-back verification must not trust an immediate
  GET.
- Boards deleted via the API are **soft-deleted** (`deleted_at` set) and remain
  visible in `GET /boards`. Spike leftovers were purged directly in Postgres.
  If board deletion ever enters scope, this needs handling — currently out of scope.
