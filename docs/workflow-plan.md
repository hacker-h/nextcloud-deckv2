---
read_when: Changing workflow options, search, undo, permissions or calendar planning
---
# Workflow expansion

Requested 2026-09-26. Implementation and regression plan for v0.12.0.

1. **Options and Done.** Automatically mark cards moved into a column named exactly
   `Done` (case-insensitive, whitespace trimmed) complete; default on, optional off.
   Preserve due dates and existing completion timestamps. No retroactive bulk edits.
   Reordering elsewhere must never reopen cards. Failed moves restore completion.
2. **Honest loading and saving.** Cached navigation renders immediately and silently
   revalidates. Cached preloads produce no progress. Show outstanding writes and
   failures separately from connectivity; never infer saved from an online dot.
3. **Search and My Tasks.** Search title, description, labels; switch between
   This Board and All Boards. Cmd/Ctrl+K opens search; assignment filter uses the
   logged-in user, completion filter excludes finished tasks. Partial loading and
   failures must be visible, never present an incomplete index as complete.
4. **Undo.** Offer undo for successful reversible mutations, including card moves;
   Cmd/Ctrl+Z outside editors. Tooltip on every shortcut-backed action. Keep native
   editor undo. Preserve newer edits; failed undo remains retryable. Never silently
   overwrite remotely changed cards.
5. **Read-only and ordering.** Display shared read-only boards with a leading lock,
   allow inspection/search, prohibit all mutations and drag gestures. Sort boards
   by recent use or alphabetically.
6. **Planning sidebar.** Month grid beside the board, distinct drop targets for
   days, week headers and whole month. Highlight the full selected range. Store
   planning independently from deadline. Default: date-only, no deadline prompt.
   Optional timed planning proposes a free slot and allows accepting/changing it
   or keeping only the day. Settings live in the options overlay. Persist planning
   per user on the backend, with authorization and validation; do not hide it in
   descriptions or replace Deck due dates. Include keyboard alternatives to drag.

## Verification

Unit: option defaults/persistence, Done matching/payload/rollback, cache progress,
search scope/filter/partial errors, undo conflicts, permission guards, date periods
and timezone boundaries. Component: keyboard/editor focus, labels and tooltip
hints, accessible dialogs, disabled mutations. Browser: real pointer drag,
Done/off preference/reload, cached switching with delayed network and mutation
observer (zero progress flashes), local/global search and deep-link results,
undo click/shortcut and failure, read-only inspection, calendar day/week/month
highlighting and persistence. Test Chromium, Firefox and WebKit. Full check/unit/
audit/bundle gates before release; CI image and deployed production smoke afterward.

## Deferred, explicitly not in current implementation

- [#4 Full offline startup, all boards and durable mutation queue](https://github.com/hacker-h/nextcloud-deckv2/issues/4): low priority after this work; includes a separate architecture and fault-injection test plan.
- [#5 Multiple Nextcloud instances](https://github.com/hacker-h/nextcloud-deckv2/issues/5): no current need, do not implement now.

## Shipped scope and operational details

- Undo covers completed moves/reorders within a board (up to 20 in the current
  session), including completion changes. Text fields keep native undo. Inbox
  transfers, deletion and arbitrary detail edits do not enter this history.
- Planning is personal, stored in `planning.json` alongside `SESSION_FILE`,
  included in the existing persistent data volume. Back up this file with sessions
  and calendar mappings. Optimistic revision checks reject competing writes.
- Planned time slots are Deck v2 records, independent of Proton events. External
  calendar events and current-board plans inform suggestions; suggestions do not
  reserve a slot or guarantee availability. Explicit Proton scheduling remains
  in the existing Planner. Day/week/month records never change due dates unless
  the user explicitly supplies the optional deadline.
- Preferences are scoped by user in browser storage. Browser/device changes do
  not transfer preferences. Planning itself persists on the server.
- Real integration verification used a newly created disposable card on the
  designated test board (116), verified completion/undo and planning HTTP
  readback against live Nextcloud authorization, and deleted the QA card.
