# M1 — Read-only board rendering (build spec)

Goal: render a real Deck board, fast and dense, visually on par with Trello.
Read-only. No mutations, no drag, no selection yet.

Repo: `/Users/hacker/src/github.com/hacker-h/nextcloud-deckv2`
Stack: **Svelte 5 + Vite** (already installed; `@sveltejs/vite-plugin-svelte@^5`,
`vite@6`, `svelte@5`). Framework choice resolves PLAN.md §14.1 — Svelte gives the
smallest runtime and no virtual-DOM overhead, which matters for dense boards.

---

## Verified API facts this milestone depends on

Measured against the live server; do not re-derive.

| Fact | Consequence for code |
|---|---|
| Only `/index.php/apps/deck/api/v1.0` is CORS-enabled | Never call the app prefix or OCS from the browser |
| `OCS-APIRequest` breaks preflight and is unnecessary | **Do not send it** |
| Nextcloud reflects arbitrary `Origin` | `http://localhost:5173` works in dev with no proxy |
| `If-Modified-Since` → HTTP 500 | Use **`If-None-Match`** only |
| Stacks arrive **unsorted** | Sort by `order`; board 113 returned order=5 first, then order=0 |
| Cards arrive unsorted within a stack | Sort by `order` |
| Read-after-write is stale (Redis) | Irrelevant in M1 (read-only), but never verify a write by re-reading |

**Auth:** app password via `Authorization: Basic`. Credentials come from
`secrets.env` (git-crypt). In dev, Vite exposes them through `import.meta.env`.
They must **never** be committed in plaintext or written to `localStorage`.

**Test data:** board **113 "Henning v2"** — 10 stacks, 89 cards, owned by
`vqslauIXXm1nmPEM7bEZ`. Good density test. Board 112 belongs to `antonia` and
returns 403 — do not use it.

Real shapes:
- Board: `{id, title, color, archived, deletedAt, labels[], owner{}, ETag, …}`
- Stack: `{id, title, order, boardId, cards[], deletedAt, ETag}`
- Card: `{id, title, order, stackId, description, duedate, done, archived,
  deletedAt, labels[], assignedUsers[], commentsCount, attachmentCount, overdue}`

---

## Files to create

```
index.html
vite.config.js
src/main.js
src/App.svelte
src/lib/deck.js          API client
src/lib/mru.js           board MRU order (localStorage)
src/components/Board.svelte
src/components/Stack.svelte
src/components/Card.svelte
src/components/BoardSwitcher.svelte
src/app.css              design tokens + global styles
.env.local               generated from secrets.env, gitignored
```

Add `.env.local` to `.gitignore`.

### `src/lib/deck.js`

```js
const API = '/index.php/apps/deck/api/v1.0';

export class DeckClient {
  constructor({ baseUrl, username, password })   // stores Basic auth header

  async getBoards({ etag })    // filters archived + deletedAt
  async getStacks(boardId, { etag })
    // filter deletedAt; sort stacks by order;
    // per stack: filter archived/deletedAt cards, sort by order
}
export class DeckError extends Error { status }
```

Rules:
- Send only `Authorization` and `Accept: application/json`.
- Pass `If-None-Match` when an ETag is known; return `{notModified:true}` on 304.
- Return `{data, etag}` otherwise.
- Parse Deck's `{"status":403,"message":"Permission denied"}` error body into
  `DeckError.message`.
- Comment each non-obvious rule with the M0 finding that justifies it. These
  comments are the only documentation of Deck's quirks that exists anywhere.

### `src/lib/mru.js`

`localStorage` key `deckv2.mru` → array of board ids, most recent first.
`touch(id)`, `sort(boards)`. Unknown boards sort after known ones by title.
(PLAN.md §8 — full switcher lands in M4.5; M1 only needs ordering + search.)

---

## UI requirements

Target: Trello-grade polish. Metrics measured from Trello (`TRELLO-UX-SPEC.md`).

### Design tokens (`src/app.css`)

Dark theme, since the user asked for dark mode and high density.

| Token | Value |
|---|---|
| `--card-h` | `36px` (min-height; grows with text) |
| `--card-gap` | `8px` (44px pitch) |
| `--stack-w` | `272px` |
| `--card-radius` | `8px` |
| `--stack-radius` | `12px` |
| `--font-size` | `14px` |
| `--bg` | `#1d2125` board background |
| `--stack-bg` | `#161a1d` |
| `--card-bg` | `#22272b` |
| `--card-bg-hover` | `#2c333a` |
| `--text` | `#b6c2cf` |
| `--text-dim` | `#8c9bab` |
| `--accent` | `#579dff` (selection blue, used from M3) |
| `--border` | `#2c333a` |

Font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.

### Layout

- Full-viewport app, no page scroll.
- Top bar (~48px): board title, board switcher trigger, card count.
- Board area: **horizontally** scrollable row of stacks.
- Each stack: fixed `272px`, own **vertical** scroll, header sticky within it.
- Stack header: title + card count, `600` weight.
- Card: title, min-height 36px, wraps to multiple lines when long.
- Left rail placeholder for the inbox panel (M4.5) — reserve the space, render
  collapsed, do not implement behaviour.

### Card metadata badges

Render only when the underlying value exists — no empty placeholders:
- due date → short form (`14. Mär`), red when `overdue`
- `commentsCount > 0` → count
- `attachmentCount > 0` → count
- `description` non-empty → a small description glyph
- labels → thin colour bars above the title (colours come as bare hex, prefix `#`)

Badges are `--text-dim`, 12px.

### Interaction (M1 scope only)

- `user-select: none` on cards and titles (PLAN.md §2.2).
- Hover: background → `--card-bg-hover`. **No transition** — Trello measures
  `transition-duration: 0s`, and instant feedback is a large part of why it feels
  fast (`TRELLO-UX-SPEC.md` §2).
- Click a card → open the Deck deep-link in a new tab:
  `{baseUrl}/index.php/apps/deck/board/{boardId}/card/{cardId}`
- Board switcher: dropdown, MRU-ordered, type-to-filter, `Escape` closes.
- Custom thin scrollbars (`::-webkit-scrollbar`, 8px, `--border` thumb). Default
  macOS scrollbars are the single biggest giveaway of an unpolished web app.

### States

- **Loading:** skeleton stacks/cards, not a spinner. Never block the whole board.
- **Error:** inline message with the `DeckError` text plus a retry button.
- **Empty stack:** muted "No cards" placeholder.

---

## Config

`vite.config.js`: svelte plugin, `server.port = 5173`.

`.env.local` (generated from `secrets.env`, gitignored):
```
VITE_NC_URL=https://nextcloud-alice.xhacker.de
VITE_NC_USER=vqslauIXXm1nmPEM7bEZ
VITE_NC_PASS=<from secrets.env>
```

Note the API host is the **alias** `nextcloud-alice.xhacker.de`, not
`nextcloud.xhacker.de` (see `CORS-DECISION.md`).

---

## Acceptance criteria

1. `npm run dev` starts cleanly; no console errors, no unhandled rejections.
2. Board 113 renders all **10 stacks in `order` sequence**, starting with `Inbox`
   (order=0) — **not** `Doing` (order=5, first in the raw response). This is the
   regression test for the sorting trap.
3. All **89 cards** render, correctly ordered within each stack.
4. Stacks scroll vertically and independently; the board scrolls horizontally.
5. Switching boards via the switcher works and updates MRU order.
6. Cards show due dates, comment/attachment counts and labels where present.
7. Text cannot be selected by dragging across a card.
8. Clicking a card opens the correct Deck deep-link in a new tab.
9. Second load of the same board issues a **304** via `If-None-Match`
   (verify in the network panel).
10. Layout holds at 1280px and 1920px widths; a 31-card stack (`Done`) scrolls
    without breaking layout.

## Out of scope for M1

No mutations, drag, multi-select, inbox behaviour, history, PWA, or offline. The
inbox rail is a visual placeholder only.

## Verification before reporting done

Run `npm run build` (must succeed), then confirm criteria 1–10 in a real browser
via Playwright — screenshot at 1280px and 1920px. Report the actual stack order
observed, so the sorting trap is provably handled.
