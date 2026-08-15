# Agent API

A token-authenticated HTTP surface that gives AI agents the same capabilities the web UI has:
bulk card moves, inbox capture, board/card reads and writes, and calendar planning.

The API is **disabled by default**. It never accepts session cookies, so it cannot be driven by CSRF.

## Enabling

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENT_API_ENABLED` | `false` | Master switch. When off, every `/agent/*` request returns `503`. |
| `AGENT_TOKEN_FILE` | `.data/agent-tokens.json` | Token store. Written atomically with mode `0600`. |
| `AGENT_API_RATE_MAX` | `120` | Requests per token per 60 s window (1–10000). |

Only SHA-256 hashes of token secrets are stored. A leaked store file cannot be replayed.

## Issuing a token

Tokens are minted from a logged-in browser session, so an agent can never mint its own.

```sh
curl -sS -X POST https://deck.example.com/auth/agent-tokens \
  -H 'Content-Type: application/json' \
  -b "sid=$SESSION_COOKIE" \
  -d '{"label":"laptop-agent","scopes":["boards:read","cards:read","cards:write","inbox:write"],"expiresInDays":90}'
```

```json
{
  "token": "deckv2_3f2a....<secret>",
  "record": { "id": "3f2a...", "label": "laptop-agent", "scopes": ["boards:read"], "expiresAt": "..." }
}
```

The `token` value is shown **once**. Store it in a secret manager, not in a repo.

- `GET /auth/agent-tokens` lists your tokens (no secrets, no hashes).
- `DELETE /auth/agent-tokens/:id` revokes one.
- Logging out revokes every token issued from that session.

### Scopes

| Scope | Grants |
| --- | --- |
| `boards:read` | List boards, read a board with its stacks and cards. |
| `cards:read` | Search cards. |
| `cards:write` | Move and update cards. |
| `inbox:write` | Capture into the managed inbox board. |
| `calendar:read` | Calendar status and planner. |
| `calendar:write` | Schedule, sync and unlink calendar events. |

Grant the narrowest set that works. Pass `boardIds` at issue time to additionally lock a token to
specific boards — out-of-scope boards are then invisible to reads and rejected on writes.

## Calling

```sh
curl -sS https://deck.example.com/agent/boards -H "Authorization: Bearer $DECKV2_AGENT_TOKEN"
```

Start with `GET /agent/capabilities`: it returns the granted scopes, the board scope, the limits and
the full route table, so an agent can discover the surface at runtime instead of hardcoding it.

### Routes

| Method | Path | Scope |
| --- | --- | --- |
| GET | `/agent/whoami` | — |
| GET | `/agent/capabilities` | — |
| GET | `/agent/boards` | `boards:read` |
| GET | `/agent/board?boardId=` | `boards:read` |
| GET | `/agent/cards/search?q=&limit=` | `cards:read` |
| POST | `/agent/cards/move` | `cards:write` |
| POST | `/agent/cards/update` | `cards:write` |
| POST | `/agent/inbox/capture` | `inbox:write` |
| GET | `/agent/calendar/status` | `calendar:read` |
| GET | `/agent/calendar/planner?start=&end=` | `calendar:read` |
| POST | `/agent/calendar/schedule` | `calendar:write` |
| POST | `/agent/calendar/sync` | `calendar:write` |
| POST | `/agent/calendar/unlink` | `calendar:write` |

### Bulk move

Moves up to 200 cards in one call, appending them to the destination lane while preserving their
relative order. Ordering uses the same `planOrders` algorithm as the UI's drag and drop, so an agent
move and a human move produce identical results.

```sh
curl -sS -X POST https://deck.example.com/agent/cards/move \
  -H "Authorization: Bearer $DECKV2_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"cardIds":["101","102"],"toBoardId":"3","toStackId":"12"}'
```

Every card is validated before anything moves: an unknown card id fails the whole request. The
response reports `moved` and `failed` so a partial upstream failure is visible rather than silent.

### Card update

```sh
curl -sS -X POST https://deck.example.com/agent/cards/update \
  -H "Authorization: Bearer $DECKV2_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"updates":[{"boardId":"3","stackId":"12","cardId":"101","title":"Renamed","duedate":"2026-09-01T09:00:00Z"}]}'
```

Send `"duedate": null` to clear a due date. Omit a field to leave it untouched.

### Inbox capture

```sh
curl -sS -X POST https://deck.example.com/agent/inbox/capture \
  -H "Authorization: Bearer $DECKV2_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Follow up with Sam","description":"re: Q3 numbers"}'
```

Targets the managed board `[deckv2] Inbox — managed, do not edit`, creating it on first use.

## Errors

Errors are always `{ "error": { "code": "...", "message": "..." } }`.

| Status | Codes |
| --- | --- |
| 400 | `INVALID_ID`, `INVALID_IDS`, `DUPLICATE_IDS`, `INVALID_TEXT`, `INVALID_DATE`, `INVALID_NUMBER`, `EMPTY_UPDATE`, `INVALID_UPDATES`, `INVALID_QUERY`, `INVALID_JSON` |
| 401 | `MISSING_TOKEN`, `INVALID_TOKEN`, `SESSION_EXPIRED` |
| 403 | `MISSING_SCOPE`, `BOARD_OUT_OF_SCOPE` |
| 404 | `NOT_FOUND`, `CARD_NOT_FOUND`, `STACK_NOT_FOUND` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 429 | `RATE_LIMITED` (honour the `Retry-After` header) |
| 503 | `AGENT_API_DISABLED`, `CALENDAR_INTEGRATION_DISABLED` |

`DECK_UPSTREAM_ERROR` is returned with whatever status Nextcloud Deck itself replied, so an agent
should treat any unexpected status as retryable-with-backoff rather than assuming a fixed code.

`SESSION_EXPIRED` means the Nextcloud session behind the token is gone; a human must log in and
issue a new token. Upstream error messages are redacted before they reach the client, so
credentials never leak into agent logs.

## Operational notes

- A token inherits the Nextcloud permissions of the user who issued it. It cannot exceed them.
- Every write is audit-logged with the action, token id and user — never the secret.
- Rate limiting is per token, so one noisy agent cannot starve another.
