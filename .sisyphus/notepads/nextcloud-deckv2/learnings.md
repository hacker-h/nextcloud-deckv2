
## 2026-07-31 T1/T4
- Deck REST transport must omit OCS-APIRequest; OCS transport must include OCS-APIRequest: true.
- credentials: omit is now part of the Basic-auth transport contract to prevent cookie interference.
- Native Deck card URLs are forbidden; plain click/Enter/Space target in-app detail, Shift-click selects, drag never activates.

## T5 card API

- Card updates now use the shared `DeckClient.deck()` transport only. Tests inspect mocked fetch calls through `DeckClient` so typed `DeckError` propagation stays covered by the same path as production code.
- Replacement card payloads preserve all fresh server fields by default and normalize object owners to `owner.uid` immediately before PUT.

## T6/T7/T8 (Wave 1 completion)

- Vitest gotcha: `mockResolvedValue(new Response(...))` reuses ONE Response across calls and the body can only be read once. Use `mockImplementation(() => Promise.resolve(json(...)))` whenever a test issues more than one request.
- `.sisyphus/evidence/` is gitignored in this repo. Evidence files are written for the record but must NOT be staged; commits carry source + tests only.
- T6: labels and eligible participants both come from `GET /boards/{id}` (`labels`, `acl`), so one read backs both pickers. Assign/remove are PUT verbs on the card path (`assignLabel`/`removeLabel`/`assignUser`/`unassignUser`), body carries `labelId` or `{userId, type}` with type 0=user, 1=group.
- T6: Deck answers an already-assigned label/user with HTTP 400 "already assigned". Treated as a non-fatal `{ok:true, duplicate:true}` outcome so local state is never rolled back incorrectly; non-member errors normalize to code `not-a-member`.
- T7: OCS comments must go through `client.ocs()` only — the transport unwraps `ocs.data` exactly once. OCS error messages live at `ocs.meta.message`. Authorship is checked client-side too so the UI never renders an edit affordance it cannot honour; foreign-comment edit/delete throw before any request is dispatched.
- T8: multipart uploads must NOT set Content-Type — the browser supplies the boundary. `isRawBody()` in deck.js already handles FormData/Blob/ArrayBuffer. Attachment display names are reassembled from `extendedData.info.filename` + `.extension`; `type` (`deck_file` vs `file`) must round-trip.
- T8: downloads use `responseType: 'blob'` through the authenticated transport rather than an `<a href>`, keeping credentials in the Authorization header and out of URLs/history/proxy logs.

## Delegation availability

- Subagent delegation repeatedly failed with a hard account usage-limit error ("You're out of extra usage"). T6/T7/T8 were implemented directly in the orchestrator session after three parallel delegations died instantly with zero file changes. Retry delegation for Wave 2; fall back to direct implementation if the quota error persists.

## T9 dnd activation contract

- jsdom does not provide `document.elementsFromPoint`; dnd unit tests must install a configurable shim before spying on it.
- `src/lib/dnd.svelte.js` remains the single pointer arbiter: sub-5px primary pointerup activates/selects, reaching exactly 5px starts drag, pointercancel is cancel-only, and invalid-target drops are drag outcomes with no activation.
- Duplicate click suppression has to be registered during pointerup for both activation and drag paths because the browser synthesizes `click` after pointerup.

## T10 detail store

- Svelte rune stores in `.svelte.js` can own modal-local loading/error/dirty/saving state without touching the board store. Keep board synchronization behind one `onCard(card)` callback for T17.
- Core card edits must queue per card and call `updateCard()` for every edit; tests should prove the second edit does not even start its fresh GET until the first PUT resolves.
- Promise cleanup for mutation queues must not use an unobserved `finally()` promise, or rejected saves produce Vitest unhandled-rejection noise even when callers assert the rejection.

## T12-T18 (Wave 2/3 completion)

- Delegation quota errors persisted through T12-T18; every task was implemented directly. Nine subagent attempts failed in total (usage limit, expired AWS SSO token on `visual-engineering`, one zero-output false completion).
- `<input type="datetime-local">` carries wall-clock time with no zone. Build the value from local getters; slicing `toISOString()` shifts the displayed time by the UTC offset.
- jsdom does not apply Svelte scoped `<style>` blocks, so `getComputedStyle(node).whiteSpace` is always empty. Assert plain-text safety via `textContent`/`innerHTML` instead of computed CSS.
- Detail store methods that catch internally (core saves) resolve on failure and surface `state.error`; comment/attachment methods reject. Tests must mock each kind accordingly — `mockRejectedValue` on a catching method produces an unhandled rejection.
- Duplicate accessible names break Testing Library `getByRole`. The reply submit button is "Send reply", not "Reply", so the disclosure and the submit stay distinguishable for AT users too.
- Component-level integration tests for activation must construct `MouseEvent` for pointerdown/up: jsdom has no `PointerEvent`, and `fireEvent.pointerDown` silently produces an event the gesture layer ignores, which makes negative assertions pass vacuously.
- `board.replaceCard(card)` deliberately preserves the local `stackId`/`order`: drag-and-drop owns placement, and a detail response must never relocate a tile.
- Attachment rename is a re-PUT of the file, so the existing bytes must be downloaded first — uploading `new File([], name)` would silently truncate the attachment to zero bytes.
- Archive/delete are confirmed server-side before the tile is removed; Deck has no restore endpoint for a soft-deleted card, so deletion is gated behind retyping the exact card title.

## T19 (alias-host OCS CORS)

- **nginx-proxy does not hot-pick-up a new `vhost.d/<host>` file.** Dropping the file in
  and running `nginx -s reload` is NOT enough: the `include` line in the generated
  `conf.d/default.conf` still points at `vhost.d/default`. docker-gen must REGENERATE
  the config (`docker kill -s HUP alice-proxy`) before the host file is included.
  Symptom of missing this: preflight keeps returning the old `405`, config looks correct.
- Verified the replacement semantics empirically: after regeneration the ONLY diff in the
  whole 2680-line generated config was line 1349 flipping from `vhost.d/default` to
  `vhost.d/nextcloud-alice.xhacker.de` — production block byte-identical (sha match).
- `$cors_origin` style `map` variables cannot live in `vhost.d/<host>` (server context,
  not http). Literal origin is required anyway per CORS-DECISION (no reflection/wildcard).
- ACME 404 is the CORRECT healthy result for a nonexistent challenge token — it is
  nginx's own `try_files ... =404`, not Nextcloud's. Confirm by comparing `server:` header
  and body against the production host as a control; both must be the nginx 404 page.
- `location ^~ /ocs/` OVERRIDES `location /`, so it must repeat `proxy_pass` +
  `set $upstream_keepalive false`. Forgetting these yields 404/502 on real OCS calls;
  always verify with an authenticated GET, not just the preflight.
- Made it reproducible instead of volume-only: the config is committed in server-scripts
  and bind-mounted via docker-compose (same pattern as `uploadsize.conf`), then verified
  to survive `docker compose up -d` container recreation.

2026-07-31: Deck card detail, lifecycle, and attachment REST calls must include boardId and stackId: `/boards/{boardId}/stacks/{stackId}/cards/{cardId}`. Short `/cards/{id}` Deck REST routes return 405; OCS comments remain the separate allowed short-form comments endpoint.
