# Nextcloud Deck v2 — Real Login & Permission Visibility

## TL;DR

> **Quick Summary**: Replace the hardcoded single-account app token with a real
> "Sign in with Nextcloud" flow (Login Flow v2), so every user of the instance
> sees their own boards with their own permissions. Add a backend proxy that
> holds tokens server-side, so no credential ever reaches the browser bundle.
> Surface each board's access level (Edit / Manage) in the UI. Read-only boards
> stay filtered out as today; showing them is deferred to the roadmap.
>
> **Deliverables**:
> - `server/` — Node backend: login flow, session store, authenticated proxy
> - Per-user sessions; no `VITE_NC_*` credentials in the client bundle
> - Login screen + sign-out, "stay signed in" across server restarts
> - Board access badges (Edit / Manage) on the boards the user can already see
> - `ROADMAP.md` documenting deferred multi-server and read-only board support
> - Vitest unit/component tests + Playwright E2E against the live instance
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: T0 → T1 → T2 → T4 → T6 → T9 → T13 → T15 → F1–F3

---

## Context

### Original Request

The user asked how the app is authenticated and whether a dedicated app token
is required. Investigation showed the app ships one hardcoded app password to
every visitor. The user then asked for real Nextcloud sign-in — "I want to be
able to sign into the page the same way I do in Nextcloud" — scoped per user,
plus a visualization of whether they have read or manage access to a board.

### Confirmed Requirements

- Sign in through the user's real Nextcloud login page (password / 2FA / SSO).
- Access is **per user**: each user sees only their own boards, with their own
  Deck permissions enforced by the server.
- One default instance URL, configured by the operator (not baked into the
  bundle). Multiple simultaneous servers are **explicitly deferred** to roadmap.
- "Keep me signed in" per server — deferred as a multi-server feature, but
  basic session persistence across restarts is in scope now.
- The board list must visualize the access level. Since read-only boards stay
  hidden (D6), that means **Edit vs. Manage** among the boards actually shown.
- Read-only board support is **deferred to roadmap** at the user's request.
- Polish level: this replaces the user's daily Deck usage.

### Research Findings (verified live against the instance)

| Fact | Evidence |
| --- | --- |
| Nextcloud 32.0.12 | `GET /ocs/v2.php/cloud/capabilities` |
| Login Flow v2 works | `POST /index.php/login/v2` → 200, returns `login` URL + poll token |
| Poll semantics | `POST /login/v2/poll` → **404 while pending**, 200 + `appPassword` after approval |
| Login page is a normal browser page | flow `login` URL → 303 redirect chain |
| **Login Flow v2 has no CORS** | `OPTIONS /login/v2/poll` → **405, zero `Access-Control-*`** |
| **Deck API forbids credentialed CORS** | `access-control-allow-credentials: false` |
| Deck API allows header auth cross-origin | `access-control-allow-headers: Authorization, Content-Type, Accept` |
| Current token is a real app password | matches `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX` |
| Current token is inlined into `dist/` | `password:"<redacted>"` found verbatim in `dist/assets/index-*.js` |
| App password is full-account scope | authenticates against `/ocs/v2.php/cloud/user` → 200 |
| Read-only boards exist live (deferred, see D6) | board **109** "Antonia Aufgaben": `PERMISSION_EDIT:false`, `shared:1` |
| Read-only boards are hidden today, and stay hidden | `src/lib/deck.js:128` filters with `canEdit` |
| Every board the user can see is Manage-level today | all **16** live editable boards return `PERMISSION_MANAGE:true` |

### Why a backend is mandatory (not a style choice)

Two measured facts force it:

1. `access-control-allow-credentials: false` — the browser will never send a
   Nextcloud session cookie to the Deck API cross-origin. "Just reuse my
   existing Nextcloud cookie" is impossible from a separate origin.
2. Login Flow v2 returns **no CORS headers at all** — the browser cannot run
   the flow itself. Something server-side must initiate and poll.

Therefore: the browser talks **same-origin** to our server; our server holds the
token and talks to Nextcloud.

### Deferred (documented, not built)

- Multiple simultaneous server connections / mixing boards across instances.
- User-supplied instance URL at login (requires an SSRF guard — see ROADMAP).
- Per-server "keep me signed in" toggles.

---

## Architecture

```
Browser (same-origin, cookie only)          Server (holds tokens)        Nextcloud
  |                                            |                            |
  |-- POST /auth/login ----------------------->|-- POST /index.php/login/v2 ->|
  |<-- { loginUrl }  (open in new tab) --------|<-- { login, poll.token } ----|
  |                                            |                            |
  |   [user authenticates on real NC page: password / 2FA / SSO]            |
  |                                            |                            |
  |-- GET /auth/poll (repeat) ---------------->|-- POST /login/v2/poll ----->|
  |<-- Set-Cookie: sid (httpOnly) -------------|<-- 200 { appPassword } -----|
  |                                            |                            |
  |-- GET /api/deck/boards  (cookie) --------->|-- Authorization: Basic ---->|
  |<-- boards JSON ----------------------------|<-- boards ------------------|
```

The app password Nextcloud mints is **per user, per device**, revocable
individually in Settings → Security. The user never types credentials into our
app. This is the same mechanism the official desktop/mobile clients use.

---

## Design Decisions

### D1 — Node backend, minimal dependencies

The project currently has **zero runtime dependencies**. Keep it that way:
use `node:http` + a tiny router rather than Express. The surface is ~6 routes.

### D2 — Session cookie, not a token in JS

`Set-Cookie: sid=<random>; HttpOnly; SameSite=Strict; Path=/` (plus `Secure`
when served over HTTPS). `HttpOnly` means XSS cannot exfiltrate the session,
and the Nextcloud token itself never leaves the server.

### D3 — CSRF defence

Cookie auth makes the proxy CSRF-eligible. Two layers:
- `SameSite=Strict` on the session cookie.
- Require `Origin` (when present) to match the app's own origin on every
  mutating proxied request; reject otherwise.

`SameSite` alone is a browser-version-dependent defence; the Origin check is
the one that actually holds. Both are cheap.

### D4 — Session persistence with encrypted tokens at rest

Sessions live in a JSON file so a server restart does not sign everyone out
(the user asked for "keep signed in"). Tokens are encrypted with
`aes-256-gcm` using a key derived from `SESSION_SECRET`. If `SESSION_SECRET` is
absent the server generates an ephemeral one and **logs a clear warning** that
sessions will not survive restart — no silent insecure default.

### D5 — Proxy allowlist, not an open pass-through

The proxy forwards only Deck API and the specific OCS paths the app already
uses. An authenticated user must not be able to drive arbitrary Nextcloud
endpoints (e.g. user provisioning) through our server just because our token
is full-account scope. Path is matched against an explicit allowlist.

### D6 — Keep hiding read-only boards for now

`deck.js:128` drops non-editable boards, and that behaviour is **unchanged** by
this plan. Showing them requires a read-only mode through the whole UI (drag
suppression, read-only editors, read-only card detail) — a large surface for a
case the user does not currently hit. Deferred to ROADMAP.

Consequence: badges here distinguish **Edit** from **Manage** among boards the
user can already act on. The permission model (T13) still computes `view` so
the deferred work is a UI addition, not a model change.

**Caveat worth confirming before building Wave 3**: on the live instance all 16
visible boards return `PERMISSION_MANAGE:true` (measured). The only non-manage board is
109, which D6 hides. So today the badge would read "Manage" on every board —
correct, but carrying no information. It becomes useful as soon as someone
shares an edit-but-not-manage board, or once read-only boards are shown. If the
user wants visible value now, read-only support (roadmap item 4) is the part
that delivers it, and Wave 3 could shrink to just the T13 model.

### D7 — Permission derives from the server response, never from local state

Badges and disabled-state read `board.permissions` as returned by Deck. The
client never infers permission from ownership or caches a stale verdict. The
server is authoritative; the UI is only a hint that avoids pointless 403s.

### D8 — Instance URL is server-side runtime config

`NC_URL` is a server env var, not `VITE_NC_URL`. Same build artifact runs
against any instance — this is what makes "anyone can deploy their own copy"
work, and it is a prerequisite for the deferred multi-server feature.

---

## Tasks

### Wave 1 — Backend foundation (T0–T7)

- [ ] **T0 — Split the vitest environment** (blocks every server test)
  `vite.config.js` currently pins `environment: 'jsdom'` globally. The backend
  is plain Node; server code inheriting a DOM global takes wrong branches under
  test (anything checking `window`/`document` silently sees a browser). Convert
  `test` to a `workspace` with two projects: `client` (jsdom, existing
  `include`, `setupFiles`) and `server` (node, `include: ['server/**/*.test.js']`).
  *Verification*: existing 164 client tests still pass; a server test asserting
  `typeof window === 'undefined'` passes.

- [ ] **T1 — Server skeleton and config**
  `server/config.js`: read `NC_URL`, `PORT`, `SESSION_SECRET` from env.
  Validate `NC_URL` is a well-formed absolute http(s) URL at boot; exit with a
  readable error if missing. Warn loudly when `SESSION_SECRET` is absent.
  *Tests*: valid/invalid/missing URL, trailing-slash normalisation, warning path.

- [ ] **T2 — Session store with encrypted tokens**
  `server/sessions.js`: `create(token, user)`, `get(sid)`, `destroy(sid)`,
  `touch(sid)`. 256-bit random ids via `crypto.randomBytes`. `aes-256-gcm` at
  rest (D4). Idle expiry (30 days), file-backed JSON, atomic writes.
  *Tests*: round-trip, tampered ciphertext rejected, expiry, unknown sid,
  ids are unique and high-entropy, file survives reload.

- [ ] **T3 — Cookie helpers**
  Parse/serialise cookies; `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure`
  when the request is HTTPS. *Tests*: attribute correctness, no attribute
  injection from crafted values, clearing on sign-out.

- [ ] **T4 — Login Flow v2 client**
  `server/nextcloud.js`: `initLogin()` → `{ loginUrl, pollToken }`;
  `poll(token)` → `null` while 404 (pending), `{ appPassword, loginName }` on
  200. Enforce the flow's own 20-minute lifetime; surface expiry distinctly
  from failure. *Tests*: pending (404), success, expiry, network error, malformed body.

- [ ] **T5 — Auth routes**
  `POST /auth/login` → `{ loginUrl }` + a short-lived pending-flow record.
  `GET  /auth/poll` → 204 pending / 200 + `Set-Cookie` on success / 410 expired.
  `POST /auth/logout` → destroy session, clear cookie, **and revoke the app
  password upstream** (`DELETE /ocs/v2.php/core/apppassword`) so signing out
  does not leave a live credential behind.
  `GET  /auth/me` → `{ user }` or 401.
  *Tests*: full happy path, poll-before-approval, double-login, logout revokes
  upstream, `/auth/me` unauthenticated.

- [ ] **T6 — Authenticated proxy**
  `ALL /api/deck/*` and `/api/ocs/*` → inject `Authorization: Basic`, forward
  method/body/headers, stream response. Preserve `ETag` / `If-None-Match` and
  **304 pass-through** — the store's conditional-read path depends on it.
  Preserve `OCS-APIRequest` semantics per `deck.js:81-84`.
  *Tests*: header injection, 304 preserved, ETag round-trip, binary
  (attachment) pass-through, upstream 403 surfaces as 403, unauthenticated → 401.

- [ ] **T7 — Proxy allowlist + CSRF guard** (D3, D5)
  Reject non-allowlisted upstream paths with 403. Reject mutating requests
  whose `Origin` mismatches. *Tests*: allowed paths pass; `/ocs/v2.php/cloud/users`
  blocked; path-traversal (`/api/deck/../../ocs/...`) blocked after
  normalisation; cross-origin POST blocked; same-origin POST allowed; GET
  unaffected.

### Wave 2 — Client auth integration (T8–T12)

- [ ] **T8 — `DeckClient` drops credentials**
  Constructor takes no username/password; base becomes `/api/deck` and
  `/api/ocs`; `credentials: 'omit'` → `'same-origin'`. Delete the `#auth`
  field and the `Basic` construction (`deck.js:52-57`). Keep `redact()` —
  it now guards against upstream echoes.
  *Tests*: existing `deck.test.js` suite adapted; assert no `Authorization`
  header is ever set client-side; assert 401 surfaces as an auth error.

- [ ] **T9 — Auth store**
  `src/lib/auth.svelte.js`: `state.user`, `state.status`
  (`checking|anonymous|pending|authenticated`), `signIn()`, `poll()`,
  `signOut()`. Poll with backoff, stop on expiry, cancel on unmount.
  *Tests*: state transitions, backoff, expiry, cancellation, sign-out clears.

- [ ] **T10 — Login screen**
  `src/components/LoginScreen.svelte`: instance name, "Sign in with Nextcloud",
  opens the flow URL in a new tab, shows waiting state with a cancel, plus a
  clear expiry message and retry. Accessible (focus management, live region).
  *Tests*: renders, click starts flow, waiting state, expiry copy, retry.

- [ ] **T11 — App gating and session expiry**
  `App.svelte` renders `LoginScreen` when anonymous, board UI when
  authenticated, and a neutral splash while checking. A 401 from any request
  drops to the login screen without losing unsaved work where avoidable.
  *Tests*: gating per state; mid-session 401 redirects to login.

- [ ] **T12 — Sign-out control**
  Header shows the signed-in user and a sign-out action.
  *Tests*: renders current user, calls `signOut`, returns to login.

### Wave 3 — Permission visibility (T13–T15)

- [ ] **T13 — Permission model**
  `src/lib/permissions.js`: `accessLevel(board)` → `'view' | 'edit' | 'manage'`
  derived from `PERMISSION_MANAGE` / `PERMISSION_EDIT` / `PERMISSION_READ`;
  `canEditBoard(board)`. Pure, no I/O (D7). `'view'` is computed even though no
  board reaching the UI currently has it (D6) — the deferred read-only work then
  needs no model change.
  *Tests*: all four real permission shapes incl. live board 109's exact
  payload; missing/partial `permissions` degrades to `view`, never to `edit`.

- [ ] **T14 — Access badge component**
  `src/components/AccessBadge.svelte`: Edit / Manage (and `view`, unused for now
  but covered). Distinguished by **icon + text**, not colour alone (a
  colour-only cue fails for colour-blind users and in high-contrast mode).
  `title` + `aria-label` spell out the meaning.
  *Tests*: each level renders distinct text/icon/label; no colour-only encoding.

- [ ] **T15 — Badge placement**
  Badge in `BoardSwitcher` rows and in the board header, fed by `accessLevel`.
  No behavioural change: every visible board remains editable (D6).
  *Tests*: manage board shows Manage; edit-only board shows Edit; badge reflects
  the server response rather than any cached or inferred value (D7).

### Wave 4 — Dev/prod wiring, docs, migration (T16–T20)

- [ ] **T16 — Dev server integration**
  Vite `server.proxy` sends `/auth` and `/api` to the backend; `npm run dev`
  runs both. *Verification*: full sign-in works at `localhost:5173`.

- [ ] **T17 — Production serving**
  Backend serves `dist/` for non-API routes with SPA fallback; `npm start`.
  *Verification*: build + serve + sign in + load a board on the prod path.

- [ ] **T18 — Purge client credentials**
  Delete `VITE_NC_USER` / `VITE_NC_PASS` / `VITE_NC_URL` from client code and
  `.env.local`; document `NC_URL` / `SESSION_SECRET` / `PORT` in `.env.example`.
  *Verification (gate)*: **grep the built bundle for the app password and for
  `Basic ` — must be absent.** This is the check that proves the original
  vulnerability is gone; automate it as a test so it cannot regress.

- [ ] **T19 — E2E fixtures under the new auth**
  `e2e/fixtures.js` builds its own `Authorization` header from `.env.local`
  for direct Deck setup/teardown — that stays (it is test scaffolding, not the
  app). The browser-side flows must authenticate via a seeded session instead:
  add a test-only helper that mints a session from the existing app token so
  Playwright does not have to drive an interactive login. Keep
  `assertBoardScoped` intact — it must also cover the new `/api/*` URLs, whose
  paths differ from the direct Deck URLs it currently pattern-matches.
  *Tests*: guard recognises `/api/deck/boards/{id}` shapes; existing 17 E2E
  specs pass unchanged otherwise.

- [ ] **T20 — `ROADMAP.md`**
  Document the deferred features with the reasoning already established:

  1. **Multi-server connections** — connect several instances at once and mix
     their boards in one view. Requires session→instance binding so a token can
     never be replayed against a different server.
  2. **User-supplied instance URL** — and the **SSRF guard it requires**:
     HTTPS-only, reject private/link-local/loopback ranges, re-validate after
     redirects to defeat DNS rebinding, optional operator allowlist. Without
     this the backend becomes an open proxy into the deploying host's network.
  3. **Per-server "keep me signed in"** toggles.
  4. **Read-only board support** (D6) — show boards the user can only view,
     badged **View**, instead of filtering them out at `deck.js:128`. Needs
     read-only propagation through `Board` → `Stack` → `Card` → `dnd` (no drag),
     read-only card detail and editors, and no add/archive/delete affordances.
     The `accessLevel` model (T13) already returns `'view'`, so this is UI work
     only. Live example to test against: board **109** "Antonia Aufgaben"
     (`PERMISSION_EDIT:false`, `shared:1`).

### Final verification (F1–F3)

- [ ] **F1 — Security review**: no credential in the bundle (automated, T18);
  cookie flags; CSRF; proxy allowlist incl. traversal; token encryption at
  rest; logout revokes upstream; no token in logs or error bodies.
- [ ] **F2 — Multi-user proof**: sign in as the main user and as a second
  account; confirm each sees only their own boards and that sessions are
  isolated (one user's sign-out does not affect the other). Board 109 must be
  absent for the user who lacks edit rights, per D6.
- [ ] **F3 — Full suite**: Vitest + Playwright + build green; manual Firefox
  pass on sign-in, board load, permission badges, and sign-out.

---

## Risks

| Risk | Mitigation |
| --- | --- |
| Proxy becomes an open relay to full-account endpoints | Explicit allowlist (T7) + traversal tests |
| CSRF via cookie auth | `SameSite=Strict` + Origin check (T7) |
| Token stolen from disk | `aes-256-gcm` at rest; `SESSION_SECRET` required for persistence (T2) |
| Logout leaves a live app password | Revoke upstream on logout (T5) |
| 304/ETag path breaks behind the proxy | Explicit pass-through tests (T6) |
| Attachment downloads break (binary) | Binary pass-through test (T6) |
| Permission UI drifts from server truth | Derive from response only (D7); server still enforces |
| E2E mutation guard blinded by new URL shapes | Update `assertBoardScoped` for `/api/*` (T19) |
| Existing token already leaked via `dist/` | Revoke and reissue — see below |

---

## Open Item

The current app token is inlined in `dist/assets/index-*.js`. `dist/` is
gitignored and never committed, so if the build never left this machine the
token is intact. **If it was ever served, copied, or shared, revoke it** in
Nextcloud → Settings → Security → Devices & sessions and issue a fresh one.
After this plan lands the token is only used by E2E scaffolding (T19).
