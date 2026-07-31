
## 2026-07-31 T1/T4
- package.json/test infrastructure appears concurrently updated by another agent; this task did not touch package/vite config.

## CRITICAL (found during T20): short-form /cards/{id} routes DO NOT EXIST

Discovered because T20's Playwright run opened the modal against the LIVE API and
got "Failed to fetch". Every unit test passed because they all mock the transport,
so the wrong URL was never exercised.

Verified live with curl (both alias AND production host, with/without Origin, so
this is NOT caused by the T19 nginx change):

| Request                                              | Status |
|------------------------------------------------------|--------|
| `GET  /cards/10193`                                   | **405** |
| `GET  /cards/10193/attachments`                       | **405** |
| `PUT  /cards/10196/archive`                           | **405** |
| `DELETE /cards/10206`                                 | **405** |
| `GET  /boards/116/stacks/366/cards/10193`             | 200 |
| `GET  /boards/116/stacks/366/cards/10193/attachments` | 200 |
| `PUT  /boards/116/stacks/366/cards/10196/archive`     | 200 |
| `DELETE /boards/116/stacks/366/cards/10206`           | 200 |

This Deck version requires the FULL `/boards/{b}/stacks/{s}/cards/{c}` path for
card reads, attachments, archive/unarchive and delete. Only the OCS comments
route (`/ocs/.../cards/{id}/comments`) uses the short form and returns 200.

Consequence: card detail open, attachments, archive/unarchive and delete were all
broken end-to-end despite green unit tests. Callers must now thread boardId+stackId.

LESSON: mock-only unit tests cannot validate URL shape. Any endpoint must be hit
live once (read-only where possible) before its task is considered done.

## FOLLOW-UP (found during T20 verification, NOT fixed — out of T20 scope)

`detail.svelte.js` `open()` loads card + comments + attachments with `Promise.all`.
Any single rejection blanks the WHOLE modal: the user sees "Failed to fetch / Retry"
with no title, description or attachments, even though the card itself loaded fine.

Observed live: from `http://localhost:5173` the OCS comments preflight is refused
(T19 allows only the deployed SPA origin), and that one failure destroys the entire
card view. `Promise.allSettled` with per-section error state would degrade far more
gracefully — comments could show "couldn't load comments / retry" while the card
body still renders.

Not changed here because T20 is a test task; flagged for the user to decide.
