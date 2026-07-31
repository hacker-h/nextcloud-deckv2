
## 2026-07-31 T4
- Exposed DeckClient.deck() and DeckClient.ocs() as the reusable transport surface for upcoming card detail clients.
- Error bodies are parsed at transport boundary and redact the Basic Authorization value before entering DeckError.

## T5 card API

- `updateCard` intentionally performs an unconditional fresh `GET /cards/{id}` before each replacement PUT. Deck writes do not support `If-Match`; the fresh read reduces data loss from stale UI state but remains last-write-wins.

## T9 dnd activation contract

- `draggable()` exposes optional `onActivate` and `onSelect`/`onSelectReserved` callbacks instead of adding a separate click handler; this keeps pointer gesture resolution authoritative and prevents click/drag races.
- Shift-click is treated as selection-reserved on sub-threshold release, while activation is plain primary-pointer release only. Keyboard activation remains out of `dnd.svelte.js` for T16/Card wiring.

## T10 detail store

- `createCardDetailStore()` owns open card identity and all detail-local async state; it deliberately does not route loading through the board store or global pending spinner.
- Open uses a token plus AbortController. Abort is best-effort for transports that accept signals; the token guard is the authoritative protection against stale card responses overwriting a newer open.
- Failed core saves roll back the exact pre-save card snapshot but retain the draft changes and specific error so the UI can offer retry/discard instead of silently losing user input.

2026-07-31: Threaded the detail store's existing `{ boardId, stackId, cardId }` target into card and attachment helpers instead of re-deriving route context or adding short-route fallbacks.
