# Nextcloud Deck v2 — First-Class Card Detail

## TL;DR

> **Quick Summary**: Replace the current dead card click with a Trello-quality, in-app card detail modal. A genuine click or keyboard activation opens detail; a drag, Shift-click, pointer cancellation, or failed drop never does. The modal reads and edits all meaningful Deck card data without linking back to native Nextcloud Deck.
>
> **Deliverables**:
> - Reliable click-versus-drag activation contract with regression coverage
> - Accessible Trello-like card detail modal
> - Title, description, due date, labels, assignees, comments, attachments, archive, and soft-delete support
> - Vitest component/unit tests and Playwright browser tests
> - Safe `/ocs/` write-method CORS on the zero-traffic alias only
> - All mutation QA isolated to test board **116**
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 3 implementation waves plus final review
> **Critical Path**: T4 → T5 → T10 → T16 → T19 → T21 → F1–F4

---

## Context

### Original Request
The user asked whether card click has a meaningful implementation, then clarified that card detail must open only on a real click and **must not trigger after dragging**. Existing links to native Nextcloud Deck were already rejected because Deck v2 is intended to replace direct Deck usage.

### Confirmed Requirements
- Plain genuine click opens an in-app modal.
- Enter/Space on a focused card opens the same modal.
- Movement reaching the 5 px drag threshold is a drag-only gesture.
- Shift-click is reserved for Trello-style selection and never opens detail.
- Pointer cancellation and drops outside a valid target never open detail.
- No card link, escape hatch, or fallback may open native Nextcloud Deck.
- Detail scope: title, description, due date, labels, assignees, comments, attachments, archive/unarchive, and guarded soft delete.
- All development and browser mutation tests use `[deckv2] TEST BOARD - safe to break` (**board 116**) only.
- Automated tests: **Vitest + Playwright**.

### Research Findings
- `src/components/Card.svelte` renders a plain card `div` with no activation handler.
- `src/lib/dnd.svelte.js` already owns pointer gesture arbitration and a 5 px threshold; it must become the single source of truth for pointer activation versus drag.
- `.sisyphus/PLAN.md:61-71` and `.sisyphus/PLAN.md:349-351` contain obsolete deep-link/out-of-scope decisions that conflict with the user’s current requirement.
- Deck 1.16.7 exposes card GET/full PUT, label and assignee operations, OCS comment CRUD, attachment CRUD, archive/unarchive, and soft delete.
- Card PUT is replace-style; omitting fields can destroy data. Card GET has ETag, but writes have no `If-Match`, so edits are last-write-wins and require a fresh read plus full payload.
- Current `/ocs/` alias CORS is documented as GET-only; comment writes require a deliberately expanded method allowlist while preserving the ACME block and never touching production `nextcloud.xhacker.de`.
- The repository currently has no unit, component, E2E, coverage, or CI test infrastructure.

### Metis Review
Metis consultation was attempted as required but the delegated service returned an account usage-limit error before analysis. The plan therefore explicitly self-resolves the main foreseeable gaps: stale writes, destructive-action confirmation, unsaved drafts, focus restoration, keyboard semantics, Shift-click reservation, OCS write CORS, attachment failures, and test-data cleanup.

---

## Work Objectives

### Core Objective
Make card detail a first-class Deck v2 workflow so users can inspect and modify card data without opening native Nextcloud Deck, while preserving the exact click/drag boundary that makes Trello feel dependable.

### Concrete Deliverables
- Card activation contract integrated through Card → Stack → Board → App.
- Accessible modal shell with focus trap, focus restoration, Escape handling, loading/error states, and responsive layout.
- Detail state/store with fresh-load, full-payload updates, local board synchronization, rollback, and toasts.
- Editors for title, description, due date, labels, assignees, comments, and attachments.
- Guarded archive/unarchive and soft-delete actions.
- Safe OCS CORS configuration for comment writes on `nextcloud-alice.xhacker.de` only.
- Automated regression tests and evidence from test board 116.

### Definition of Done
- [ ] Plain click opens exactly one modal for the clicked card.
- [ ] A drag exceeding 5 px opens zero modals before, during, or after drop.
- [ ] Shift-click opens zero modals.
- [ ] Enter/Space opens the focused card modal and closing restores focus to that card.
- [ ] All supported fields round-trip through Deck APIs and update the board tile immediately.
- [ ] Failed writes preserve prior data and show a specific error.
- [ ] Comments and attachments work through the SPA origin with exactly one ACAO header.
- [ ] No `apps/deck/board/.../card/...` links remain in source or rendered DOM.
- [ ] All Vitest and Playwright tests pass; live mutation evidence references only board 116.

### Must Have
- Gesture arbitration owned by one state machine, not independent click and drag handlers racing each other.
- Fresh card read before replace-style writes; preserve all fields not being edited.
- Explicit save/cancel for description; title saves on Enter/blur; metadata actions save immediately.
- Unsaved description draft blocks accidental close until save/discard is chosen.
- Destructive actions require confirmation and expose clear failure recovery.
- Modal remains usable at 320 px width and with keyboard only.

### Must NOT Have
- No links or fallbacks to native Nextcloud Deck.
- No mutations against board 113 or any non-test board during implementation/QA.
- No write to `nextcloud.xhacker.de` proxy configuration.
- No duplicate CORS headers on `/index.php/` Deck API routes.
- No blind partial PUT to the replace-style card endpoint.
- No click triggered from `pointerup` after drag, pointer cancel, auto-scroll, or failed drop.
- No generic “it works” QA; every scenario must assert exact modal, request, and persisted-data outcomes.

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — all verification is agent-executed. Mutation tests are hard-gated to board 116.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: YES — tests-after for existing code, TDD for the new gesture activation contract
- **Frameworks**: Vitest + jsdom + Testing Library; Playwright for browser interaction
- **Agent QA**: mandatory after every task

### Test Layers
- **Unit**: request payload builders, OCS response parsing, gesture state transitions, detail-store rollback.
- **Component**: modal accessibility, editors, loading/error/dirty states, guarded actions.
- **E2E**: true click vs Shift-click vs sub-threshold jitter vs drag; keyboard focus; API round-trips; comment/attachment flows.
- **Infrastructure**: curl preflight and response-header checks for `/ocs/`; production-host regression probe.

### Evidence Policy
Evidence goes under `.sisyphus/evidence/card-detail/` using `task-{N}-{scenario}.{txt|json|png}`. Playwright traces are retained on first retry and failures. No evidence may contain credentials or app passwords.

---

## Execution Strategy

### Parallel Execution Waves

```text
Wave 1 — contracts and infrastructure (8 parallel tasks)
├── T1  Correct stale product/spec decisions
├── T2  Add Vitest/component-test infrastructure
├── T3  Add Playwright E2E infrastructure and board-116 guard
├── T4  Normalize Deck/OCS request transport
├── T5  Add card read/update/archive/delete client
├── T6  Add label and assignee client operations
├── T7  Add comments client operations
└── T8  Add attachment client operations

Wave 2 — interaction and UI modules (7 parallel tasks after relevant Wave 1 contracts)
├── T9  Implement click-versus-drag activation contract
├── T10 Build card-detail state/store
├── T11 Build accessible modal shell
├── T12 Build title/description/due-date editor
├── T13 Build labels/assignees editor
├── T14 Build comments section
└── T15 Build attachments section

Wave 3 — integration and live-safe verification (6 parallel-capable tasks)
├── T16 Wire activation Card → Stack → Board → App
├── T17 Synchronize saves with board state and errors
├── T18 Add guarded archive/unarchive/delete actions
├── T19 Expand alias-only OCS CORS safely
├── T20 Add click/drag/keyboard Playwright regression suite
└── T21 Add board-116 detail CRUD E2E suite

FINAL — four parallel audits, then explicit user approval
├── F1 Plan compliance audit
├── F2 Code quality and automated-test audit
├── F3 Real browser QA replay
└── F4 Scope and production-safety audit
```

### Dependency Matrix

| Task | Blocked by | Blocks |
|---|---|---|
| T1 | — | F1, F4 |
| T2 | — | T5–T10, T20–T21 |
| T3 | — | T20, T21 |
| T4 | — | T5–T8, T10 |
| T5 | T2, T4 | T10, T12, T18 |
| T6 | T2, T4 | T10, T13 |
| T7 | T2, T4 | T10, T14, T19 |
| T8 | T2, T4 | T10, T15 |
| T9 | T2 | T16, T20 |
| T10 | T4–T8 | T12–T18 |
| T11 | T2 | T12–T18 |
| T12 | T5, T10, T11 | T17, T21 |
| T13 | T6, T10, T11 | T17, T21 |
| T14 | T7, T10, T11 | T19, T21 |
| T15 | T8, T10, T11 | T21 |
| T16 | T9–T11 | T20, T21 |
| T17 | T10, T12, T13 | T21 |
| T18 | T5, T10, T11 | T21 |
| T19 | T7, T14 | T21 |
| T20 | T3, T9, T16 | F1–F4 |
| T21 | T3, T12–T19 | F1–F4 |

### Agent Dispatch Summary
- Wave 1: T1 `writing`; T2–T8 `quick`/`unspecified-high` by API complexity.
- Wave 2: T9–T10 `deep`; T11–T15 `visual-engineering` with `frontend-ui-ux`.
- Wave 3: T16–T18 `unspecified-high`; T19 `deep`; T20–T21 `unspecified-high` with `playwright`.
- Final: F1 `oracle`, F2/F3 `unspecified-high`, F4 `deep`.

---

## TODOs

- [x] 1. Correct obsolete card-detail and deep-link decisions

  **What to do**:
  - Update `.sisyphus/PLAN.md` and `.sisyphus/TRELLO-UX-SPEC.md` so card detail is in scope, plain click opens Deck v2 detail, and native Deck deep-links are forbidden.
  - Remove the stale `DeckClient.cardUrl()` helper and its native-Deck comment from `src/lib/deck.js`.

  **Must NOT do**: Do not rewrite unrelated milestones or remove historical API findings.

  **Recommended Agent Profile**:
  - **Category**: `writing` — precise source-of-truth correction.
  - **Skills**: none; implementation skills omitted because this is documentation plus dead-helper removal.

  **Parallelization**: Wave 1; runs immediately; blocks final scope audits only.

  **References**:
  - `.sisyphus/PLAN.md:51-71` — obsolete deep-link/out-of-scope text.
  - `.sisyphus/PLAN.md:349-351` — plain-click behaviour to replace.
  - `.sisyphus/TRELLO-UX-SPEC.md:15-25,41-49` — measured Trello click semantics.
  - `src/lib/deck.js:132-135` — unused native Deck card URL helper.

  **Acceptance Criteria**:
  - [ ] Search for `cardUrl`, `Deep-link to Deck`, and `opens the Deck deep-link` returns zero active implementation requirements.
  - [ ] Updated docs explicitly distinguish plain click, Shift-click, keyboard activation, and drag.

  **QA Scenarios**:
  ```text
  Scenario: source-of-truth reflects in-app detail
    Tool: Bash
    Steps: search the two specs and src/ for native Deck card-link requirements.
    Expected: only historical/rejection context remains; no executable deep-link helper.
    Evidence: .sisyphus/evidence/card-detail/task-1-scope-search.txt

  Scenario: unrelated scope preserved
    Tool: Bash
    Steps: diff the two docs; inspect multi-select, inbox, history, and agent sections.
    Expected: those sections remain semantically unchanged.
    Evidence: .sisyphus/evidence/card-detail/task-1-scope-diff.txt
  ```

  **Commit**: YES — `docs(plan): make card detail first class`

- [x] 2. Add Vitest and Svelte component-test infrastructure

  **What to do**:
  - Add Vitest, jsdom, Testing Library Svelte, and jest-dom using versions compatible with Svelte 5/Vite 6.
  - Add `test`, `test:watch`, and focused component-test configuration plus a smoke test.

  **Must NOT do**: Do not replace Vite, add a second package manager, or introduce coverage thresholds before baseline tests exist.

  **Recommended Agent Profile**:
  - **Category**: `quick` — bounded tooling setup.
  - **Skills**: none; `playwright` omitted because browser setup is T3.

  **Parallelization**: Wave 1; runs immediately; blocks T5–T10 and T20–T21.

  **References**:
  - `package.json:6-15` — current scripts/dependencies.
  - `vite.config.js` — existing Svelte plugin configuration to preserve.
  - Svelte Testing Library docs — Svelte 5 render/event conventions.

  **Acceptance Criteria**:
  - [ ] `npm run test -- --run` exits 0 with at least one real smoke assertion.
  - [ ] Existing `npm run build` still exits 0.

  **QA Scenarios**:
  ```text
  Scenario: clean test invocation
    Tool: Bash
    Steps: install from lockfile; run npm run test -- --run; run npm run build.
    Expected: both exit 0; no unhandled Svelte warnings.
    Evidence: .sisyphus/evidence/card-detail/task-2-tests.txt

  Scenario: failing assertion is detected
    Tool: Bash
    Steps: run Vitest against a temporary deliberately failing fixture without committing it.
    Expected: non-zero exit and exact failed assertion reported.
    Evidence: .sisyphus/evidence/card-detail/task-2-negative.txt
  ```

  **Commit**: YES — groups with T3 as `test(card-detail): add unit and browser test infrastructure`

- [x] 3. Add Playwright E2E infrastructure with a board-116 mutation guard

  **What to do**:
  - Add Playwright config, local-server startup, trace/screenshot retention, and reusable authenticated fixtures.
  - Add a hard guard that refuses any mutating request unless the URL targets board 116; redact Authorization from logs/evidence.

  **Must NOT do**: Never use board 113 or derive a mutation board from current UI selection.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — browser harness plus safety gate.
  - **Skills**: `playwright` — required for browser automation patterns.

  **Parallelization**: Wave 1; runs immediately; blocks T20–T21.

  **References**:
  - `.env.local` / `VITE_BOARD_ID=116` — existing development target; never print secret values.
  - `src/App.svelte:30-49` — preferred-board selection.
  - `.sisyphus/TRELLO-UX-SPEC.md:83-109` — pointer-event E2E rationale.

  **Acceptance Criteria**:
  - [ ] `npm run test:e2e -- --grep smoke` opens board 116 and passes.
  - [ ] A simulated PUT to board 113 is blocked before network dispatch with a clear guard error.
  - [ ] Trace artifacts contain no Basic auth value.

  **QA Scenarios**:
  ```text
  Scenario: safe smoke on test board
    Tool: Playwright
    Steps: start app; open `/`; assert header `[deckv2] TEST BOARD - safe to break`; assert stack ids 366-370.
    Expected: smoke passes without mutations.
    Evidence: .sisyphus/evidence/card-detail/task-3-smoke.png

  Scenario: real-board mutation rejected
    Tool: Playwright
    Steps: invoke guarded request helper with `/boards/113/...` PUT.
    Expected: helper throws `Mutation target must be board 116`; zero matching network requests.
    Evidence: .sisyphus/evidence/card-detail/task-3-guard.txt
  ```

  **Commit**: YES — groups with T2.

- [x] 4. Normalize Deck and OCS request transport

  **What to do**:
  - Extract shared request/error parsing inside `DeckClient` while preserving Deck API and OCS header differences.
  - Support JSON, multipart/binary responses, ETag reads, `ocs.data` unwrapping, abort signals, and redacted errors.
  - Keep credentials in memory; use `credentials: 'omit'` so cookies cannot interfere with Basic auth.

  **Must NOT do**: Never send `OCS-APIRequest` to `/index.php/apps/deck/api/...`; never log Authorization.

  **Recommended Agent Profile**:
  - **Category**: `deep` — security-sensitive transport refactor.
  - **Skills**: none; UI skills omitted because this is API transport.

  **Parallelization**: Wave 1; runs immediately; blocks T5–T8 and T10.

  **References**:
  - `src/lib/deck.js:31-57` — existing auth/GET implementation.
  - `.sisyphus/M0-RESULTS.md` — verified CORS/header/ETag traps.
  - `.sisyphus/CORS-DECISION.md:197-205` — Basic auth and credential-storage constraints.

  **Acceptance Criteria**:
  - [ ] Unit tests prove Deck requests omit `OCS-APIRequest`; OCS requests include it.
  - [ ] 304, JSON error, text error, aborted request, and `ocs.data` parsing are covered.
  - [ ] Existing board load and move behaviour remains green.

  **QA Scenarios**:
  ```text
  Scenario: Deck and OCS transport headers
    Tool: Vitest
    Steps: mock fetch; issue one Deck GET and one OCS GET.
    Expected: both carry Authorization; only OCS carries OCS-APIRequest; credentials mode is omit.
    Evidence: .sisyphus/evidence/card-detail/task-4-headers.txt

  Scenario: malformed error and abort
    Tool: Vitest
    Steps: return HTTP 500 text, then AbortError.
    Expected: typed safe errors; no credential/body leakage.
    Evidence: .sisyphus/evidence/card-detail/task-4-errors.txt
  ```

  **Commit**: YES — groups with T5–T8 as `feat(api): add card detail operations`

- [x] 5. Add safe card read, update, archive, and delete operations

  **What to do**:
  - Add card GET with ETag, fresh-read-before-save, complete replacement payload builder, update, archive/unarchive, and soft delete.
  - Preserve title, type, owner, description, order, due date, archived, and done values unless intentionally changed.

  **Must NOT do**: No partial PUT; no assumption that ETag prevents concurrent writes.

  **Recommended Agent Profile**:
  - **Category**: `deep` — data-loss-sensitive API contract.
  - **Skills**: none; browser skill omitted because unit tests cover payload correctness.

  **Parallelization**: Wave 1 after T2/T4; blocks T10, T12, T18.

  **References**:
  - `src/lib/deck.js:92-130` — existing move full-PUT behaviour.
  - Deck `CardApiController.php:49-93,163-177` — GET/PUT/archive/delete routes.
  - Deck `CardService.php:254-365` — replace-style update semantics.

  **Acceptance Criteria**:
  - [ ] Unit tests prove unchanged fields survive each single-field edit.
  - [ ] GET returns `{data, etag}`; update refetches before building the PUT.
  - [ ] Archive/unarchive and delete surface typed failures.

  **QA Scenarios**:
  ```text
  Scenario: description edit preserves every other field
    Tool: Vitest
    Steps: mock fresh GET with labels, due date, done, owner, order; edit description; inspect PUT.
    Expected: only description differs; required fields remain present.
    Evidence: .sisyphus/evidence/card-detail/task-5-full-put.txt

  Scenario: stale/read failure blocks write
    Tool: Vitest
    Steps: make fresh GET return 500 before save.
    Expected: zero PUT calls; typed error returned.
    Evidence: .sisyphus/evidence/card-detail/task-5-read-failure.txt
  ```

  **Commit**: YES — groups with T4/T6–T8.

- [x] 6. Add label and assignee operations

  **What to do**:
  - Add board-label listing plus card label assign/remove.
  - Add eligible participant listing plus card user assign/unassign with user/group type retained.
  - Normalize duplicate and non-member errors for UI consumption.

  **Must NOT do**: Do not create/edit board labels in this scope; do not silently drop board-scoped labels.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — several related API contracts.
  - **Skills**: none; UI skills omitted until T13.

  **Parallelization**: Wave 1 after T2/T4; blocks T10/T13.

  **References**:
  - `src/components/Card.svelte:13-29` — existing label display shape.
  - Deck `appinfo/routes.php:105-121` — assignment/label routes.
  - Deck `AssignmentService.php:103-182` — membership and duplicate validation.

  **Acceptance Criteria**:
  - [ ] Unit tests cover assign/remove for labels and users, including user type.
  - [ ] Repeated assignment reports an idempotent UI-safe outcome or a specific error; it never corrupts local state.

  **QA Scenarios**:
  ```text
  Scenario: assign then remove metadata
    Tool: Vitest
    Steps: mock Deck endpoints; assign label 42 and user `antonia`; remove both.
    Expected: exact endpoint/body sequence and normalized returned card data.
    Evidence: .sisyphus/evidence/card-detail/task-6-assignments.txt

  Scenario: non-member assignee rejected
    Tool: Vitest
    Steps: return Deck validation error for `not-a-member`.
    Expected: no optimistic residue; readable error code/message.
    Evidence: .sisyphus/evidence/card-detail/task-6-nonmember.txt
  ```

  **Commit**: YES — groups with T4/T5/T7/T8.

- [x] 7. Add OCS comment CRUD operations

  **What to do**:
  - Implement list/create/edit/delete for `/ocs/v2.php/apps/deck/api/v1.0/cards/{cardId}/comments`.
  - Unwrap `ocs.data`, retain author/timestamps/parentId, and expose author-only edit/delete capability.

  **Must NOT do**: Never apply Deck API response parsing to OCS responses; never expose edit/delete for another author.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — distinct OCS protocol and permissions.
  - **Skills**: none; CORS deployment handled in T19.

  **Parallelization**: Wave 1 after T2/T4; blocks T10/T14/T19.

  **References**:
  - `.sisyphus/CORS-DECISION.md:98-128` — existing OCS CORS model.
  - Deck `CommentsApiController.php:17-27` — routes/CORS allowlist.
  - Deck `CommentService.php:39-210` — CRUD permissions and response format.

  **Acceptance Criteria**:
  - [ ] Tests cover empty list, create, reply, own edit/delete, forbidden foreign edit/delete.
  - [ ] All responses are normalized from `ocs.data` once at the transport boundary.

  **QA Scenarios**:
  ```text
  Scenario: create and edit own comment
    Tool: Vitest
    Steps: mock OCS create then update responses wrapped in ocs.data.
    Expected: normalized comment returned with author and timestamps.
    Evidence: .sisyphus/evidence/card-detail/task-7-comment-crud.txt

  Scenario: foreign comment cannot be edited
    Tool: Vitest
    Steps: pass comment authored by `antonia` while current user differs.
    Expected: client/store exposes canEdit=false and dispatches no PUT/DELETE.
    Evidence: .sisyphus/evidence/card-detail/task-7-comment-permission.txt
  ```

  **Commit**: YES — groups with T4–T6/T8.

- [x] 8. Add attachment list/upload/rename/delete/restore operations

  **What to do**:
  - Add attachment listing, multipart upload, rename/update, delete, restore, and safe download/display URL handling.
  - Preserve attachment type metadata and expose upload progress/cancellation if fetch/XHR support permits without a new heavy dependency.

  **Must NOT do**: Do not inline untrusted files; do not log filenames with credentials or raw binary content.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — multipart/binary edge cases.
  - **Skills**: none; frontend rendering is T15.

  **Parallelization**: Wave 1 after T2/T4; blocks T10/T15.

  **References**:
  - `src/components/Card.svelte:62-69` — existing attachment count display.
  - Deck `AttachmentApiController.php:30-91` — endpoints.
  - Deck `AttachmentService.php:76-139` — attachment types and lifecycle.

  **Acceptance Criteria**:
  - [ ] Tests cover zero-byte file, normal upload, duplicate name, cancellation, 413/500 failure, delete and restore.
  - [ ] Download/display URLs stay on the configured alias and carry no embedded credentials.

  **QA Scenarios**:
  ```text
  Scenario: upload and list a text file
    Tool: Vitest
    Steps: submit `detail-test.txt` with `text/plain`; inspect multipart request and normalized result.
    Expected: filename/type/size retained; no Authorization in URL.
    Evidence: .sisyphus/evidence/card-detail/task-8-upload.txt

  Scenario: oversized upload fails safely
    Tool: Vitest
    Steps: return HTTP 413 from upload.
    Expected: typed size error; list state unchanged; retry remains possible.
    Evidence: .sisyphus/evidence/card-detail/task-8-upload-error.txt
  ```

  **Commit**: YES — groups with T4–T7.

- [x] 9. Implement one authoritative click-versus-drag activation contract

  **What to do**:
  - Extend `draggable()` to accept `onActivate`/modifier context and resolve each pointer gesture to exactly one outcome: activate, select-reserved, drag/drop, cancel, or no-op.
  - Call activation only from sub-threshold primary-pointer release; swallow native follow-up click after both activate and drag to avoid duplicate modal opens.
  - Add keyboard activation separately in Card; ignore Enter/Space while composing or from future nested controls.

  **Must NOT do**: Do not add an independent `onclick` that races the pointer state machine; do not lower the measured 5 px threshold without evidence.

  **Recommended Agent Profile**:
  - **Category**: `deep` — subtle event-state correctness.
  - **Skills**: none; `playwright` omitted here because unit state tests precede E2E T20.

  **Parallelization**: Wave 2 after T2; blocks T16/T20.

  **References**:
  - `src/lib/dnd.svelte.js:10,96-165,169-207` — current threshold and gesture lifecycle.
  - `.sisyphus/TRELLO-UX-SPEC.md:15-49,83-109` — click/selection/pointer rules.

  **Acceptance Criteria**:
  - [ ] RED tests first cover 0 px click, 4.9 px jitter, 5 px drag, Shift-click, pointercancel, invalid drop, and duplicate native click.
  - [ ] Each gesture yields exactly one recorded outcome; drag paths yield zero activations.

  **QA Scenarios**:
  ```text
  Scenario: genuine pointer click activates once
    Tool: Vitest/jsdom
    Steps: pointerdown/up at (100,100), then dispatch browser click.
    Expected: onActivate=1; onDrop=0; duplicate click suppressed.
    Evidence: .sisyphus/evidence/card-detail/task-9-click.txt

  Scenario: drag and cancellation never activate
    Tool: Vitest/jsdom
    Steps: test 5 px move+up, pointercancel, and invalid-target drop.
    Expected: onActivate=0 for all; drag state and cursor reset.
    Evidence: .sisyphus/evidence/card-detail/task-9-drag-negative.txt
  ```

  **Commit**: YES — `fix(dnd): separate card activation from drag gestures`

- [x] 10. Build card-detail state and mutation store

  **What to do**:
  - Add a focused detail store owning open card identity, loading/error/dirty/saving states, fresh fetch, mutation queues, cancellation, and close policy.
  - Serialize replace-style core edits per card; allow independent comment/attachment operations; synchronize returned data through one callback.
  - Provide exact rollback snapshots and stale-response guards when users switch cards quickly.

  **Must NOT do**: No global board spinner; no last response may overwrite a newer opened card.

  **Recommended Agent Profile**:
  - **Category**: `deep` — concurrent async state and rollback.
  - **Skills**: none; pure state concern.

  **Parallelization**: Wave 2 after T4–T8; blocks T12–T18.

  **References**:
  - `src/lib/store.svelte.js:10-49,72-150` — project optimistic/rollback conventions.
  - `src/App.svelte:14-22,71-75,102-104` — board store and pending/toast surfaces.
  - Deck card ETag/last-write-wins findings in Context section.

  **Acceptance Criteria**:
  - [ ] Tests cover open/load, rapid card switch, save queue, rollback, dirty close, and abort-on-close.
  - [ ] Core save always performs fresh read and only newest response updates current detail.

  **QA Scenarios**:
  ```text
  Scenario: rapid card switch ignores stale response
    Tool: Vitest
    Steps: open A, then B; resolve B before A.
    Expected: store displays B only; A response discarded/aborted.
    Evidence: .sisyphus/evidence/card-detail/task-10-race.txt

  Scenario: failed save rolls back
    Tool: Vitest
    Steps: edit title, fail PUT 500.
    Expected: prior title restored; specific toast/error; dirty draft retained where recoverable.
    Evidence: .sisyphus/evidence/card-detail/task-10-rollback.txt
  ```

  **Commit**: YES — groups with T11–T15 as `feat(card-detail): add accessible detail modal and editors`

- [x] 11. Build the accessible Trello-like modal shell

  **What to do**:
  - Add a responsive modal/dialog with backdrop, loading skeleton, error/retry state, desktop two-column layout, and mobile single-column layout.
  - Implement `role=dialog`, `aria-modal`, labelled title, focus trap, initial focus, Escape close, backdrop close, scroll locking, and focus restoration.
  - Dirty drafts intercept Escape/backdrop and present Save/Discard/Continue editing.

  **Must NOT do**: No generic centered white box, no native Deck iframe, no close that silently discards edits.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering` — high-fidelity interaction and responsive styling.
  - **Skills**: `frontend-ui-ux` — Trello-quality modal and accessibility.

  **Parallelization**: Wave 2 after T2; blocks T12–T18.

  **References**:
  - `src/app.css` — project visual tokens/gradient.
  - `src/App.svelte:59-105` — app overlay/toast integration point.
  - `.sisyphus/TRELLO-UX-SPEC.md:53-79` — measured density and dark tokens.

  **Acceptance Criteria**:
  - [ ] Component tests cover focus trap, Escape, backdrop, dirty confirmation, loading, retry, and focus restoration.
  - [ ] 320×700 and 1200×814 screenshots show no clipped controls or background interaction.

  **QA Scenarios**:
  ```text
  Scenario: keyboard-only modal lifecycle
    Tool: Testing Library Svelte
    Steps: open from card; Tab through controls; Shift+Tab wrap; Escape close.
    Expected: focus never leaves dialog; close restores originating card focus.
    Evidence: .sisyphus/evidence/card-detail/task-11-keyboard.txt

  Scenario: dirty close is guarded
    Tool: Testing Library Svelte
    Steps: edit description; click backdrop; choose Continue editing, then Discard.
    Expected: first remains open with draft; second closes without save.
    Evidence: .sisyphus/evidence/card-detail/task-11-dirty.txt
  ```

  **Commit**: YES — groups with T10/T12–T15.

- [x] 12. Build title, description, and due-date editing

  **What to do**:
  - Title: in-place edit, Enter/blur save, Escape cancel, non-empty validation.
  - Description: rendered text plus explicit Edit → Save/Cancel editor; preserve line breaks and plain-text safety.
  - Due date: local date/time input, clear action, overdue state, ISO-8601 conversion without timezone drift.

  **Must NOT do**: Do not render description as unsanitized HTML; do not save on every keystroke.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering` — form UX inside Trello-like detail.
  - **Skills**: `frontend-ui-ux` — compact, polished editor behaviour.

  **Parallelization**: Wave 2 after T5/T10/T11; blocks T17/T21.

  **References**:
  - `src/components/Card.svelte:6-15,32-53` — current due/description tile display.
  - Deck API docs `API.md:678-687` — due-date format.
  - T5 full-PUT contract — save safety.

  **Acceptance Criteria**:
  - [ ] Component tests cover title validation/cancel, multiline description, due set/clear, timezone conversion, and save failure.
  - [ ] Successful saves update both modal and card tile without board reload.

  **QA Scenarios**:
  ```text
  Scenario: edit all core fields
    Tool: Testing Library Svelte
    Steps: set title `Detail QA`; description `Line 1\nLine 2`; due `2030-04-05 14:30`; save.
    Expected: exact normalized mutation calls and updated rendered values.
    Evidence: .sisyphus/evidence/card-detail/task-12-core-edit.txt

  Scenario: invalid title and failed save
    Tool: Testing Library Svelte
    Steps: enter whitespace title; then simulate 500 on valid save.
    Expected: whitespace blocked locally; 500 restores prior title and retains recoverable input.
    Evidence: .sisyphus/evidence/card-detail/task-12-core-error.txt
  ```

  **Commit**: YES — groups with T10/T11/T13–T15.

- [x] 13. Build labels and assignees editor

  **What to do**:
  - Add searchable label and assignee popovers, selected-state chips/avatars, keyboard navigation, and immediate assign/remove mutations.
  - Disable individual options while their mutation is pending and reconcile from returned card data.

  **Must NOT do**: No board-label administration; no optimistic duplicate assignment.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering` — dense searchable metadata controls.
  - **Skills**: `frontend-ui-ux` — accessible popover/listbox interaction.

  **Parallelization**: Wave 2 after T6/T10/T11; blocks T17/T21.

  **References**:
  - `src/components/Card.svelte:13,24-29` — label visual shape.
  - T6 API contract — labels/participant operations and errors.
  - `.sisyphus/TRELLO-UX-SPEC.md:53-79` — dense styling constraints.

  **Acceptance Criteria**:
  - [ ] Component tests cover search, keyboard selection, pending state, removal, empty options, and API rejection.
  - [ ] Labels/assignees update modal and tile/store without full board reload.

  **QA Scenarios**:
  ```text
  Scenario: keyboard assign/remove
    Tool: Testing Library Svelte
    Steps: open Labels; type `urgent`; ArrowDown+Enter; reopen and remove.
    Expected: one assign then one remove request; chip state follows responses.
    Evidence: .sisyphus/evidence/card-detail/task-13-metadata.txt

  Scenario: forbidden assignee
    Tool: Testing Library Svelte
    Steps: choose mocked non-member and return 403/validation error.
    Expected: no chip remains; exact inline error; popover remains usable.
    Evidence: .sisyphus/evidence/card-detail/task-13-metadata-error.txt
  ```

  **Commit**: YES — groups with T10–T12/T14/T15.

- [x] 14. Build the comments section

  **What to do**:
  - Render chronological comments with author/time, replies, composer, own-comment edit/delete, pending state, retry, and empty state.
  - Preserve draft text after network failure; sanitize/render plain text safely.

  **Must NOT do**: Do not show edit/delete controls for comments by other users; no HTML injection.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering` — threaded activity UI.
  - **Skills**: `frontend-ui-ux` — readable compact comment interaction.

  **Parallelization**: Wave 2 after T7/T10/T11; blocks T19/T21.

  **References**:
  - `src/components/Card.svelte:54-60` — comment-count tile affordance.
  - T7 normalized OCS comment model.
  - Deck `CommentService.php:175-210` — response fields.

  **Acceptance Criteria**:
  - [ ] Tests cover empty, create, reply, own edit/delete, foreign author, retry, and escaped markup.
  - [ ] Composer cannot submit blank content or double-submit while pending.

  **QA Scenarios**:
  ```text
  Scenario: create reply and edit own comment
    Tool: Testing Library Svelte
    Steps: submit `Card detail QA`; reply `Acknowledged`; edit first to `Card detail QA updated`.
    Expected: exact sequence; chronological rendering; comment count updates.
    Evidence: .sisyphus/evidence/card-detail/task-14-comments.txt

  Scenario: failure preserves draft
    Tool: Testing Library Svelte
    Steps: type `Do not lose me`; return 500.
    Expected: draft remains; error and Retry visible; no duplicate comment.
    Evidence: .sisyphus/evidence/card-detail/task-14-comment-error.txt
  ```

  **Commit**: YES — groups with T10–T13/T15 or C5 if integrated later.

- [x] 15. Build the attachments section

  **What to do**:
  - Render attachment list with name/type/size, upload dropzone/file picker, cancel/retry, rename, download/open, delete, and restore where API permits.
  - Make drag-and-drop upload local to the modal and prevent it from starting board-card drag.

  **Must NOT do**: Do not navigate away from Deck v2; do not treat an attachment drag as card drag.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering` — file interaction and progress states.
  - **Skills**: `frontend-ui-ux` — clear upload/error affordances.

  **Parallelization**: Wave 2 after T8/T10/T11; blocks T21.

  **References**:
  - `src/components/Card.svelte:62-69` — attachment-count tile affordance.
  - T8 attachment API contract.
  - T9 gesture contract — nested/modal drag isolation.

  **Acceptance Criteria**:
  - [ ] Tests cover picker/drop upload, cancellation, rename, download URL, delete/restore, and 413/500 errors.
  - [ ] File drag inside modal triggers zero card drag events.

  **QA Scenarios**:
  ```text
  Scenario: upload rename delete restore
    Tool: Testing Library Svelte
    Steps: upload `detail-test.txt`; rename `detail-renamed.txt`; delete; restore.
    Expected: each state appears only after successful response; count stays synchronized.
    Evidence: .sisyphus/evidence/card-detail/task-15-attachments.txt

  Scenario: modal file drag cannot move card
    Tool: Testing Library Svelte
    Steps: dispatch file dragenter/drop over attachment zone.
    Expected: upload handler receives file; board onDrop and detail activation stay at zero.
    Evidence: .sisyphus/evidence/card-detail/task-15-drag-isolation.txt
  ```

  **Commit**: YES — groups with T10–T14 or C5 if integrated later.

- [x] 16. Wire card activation from Card through Stack and Board into App

  **What to do**:
  - Thread an `onOpenCard` callback Card → Stack → Board → App and pass it into T9’s gesture action.
  - Give cards keyboard focus/role/accessible names; plain pointer activation opens detail, Shift-click is consumed/reserved for selection, Enter/Space opens detail.
  - App mounts one modal instance and restores focus to the exact originating card after close.

  **Must NOT do**: No native `onclick` pointer race; no modal open on Shift-click or drag.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — cross-component event integration.
  - **Skills**: `frontend-ui-ux` — keyboard/ARIA review.

  **Parallelization**: Wave 3 after T9–T11; blocks T20/T21.

  **References**:
  - `src/components/Card.svelte:18-22,75-101` — activation surface.
  - `src/components/Stack.svelte:1-32` — card prop threading.
  - `src/components/Board.svelte:1-18` — stack prop threading.
  - `src/App.svelte:14-22,97-105` — modal/store mount point.

  **Acceptance Criteria**:
  - [ ] Component integration test asserts one open for pointer click and keyboard, zero for Shift-click/drag.
  - [ ] Closing restores focus to the same `[data-card-id]`, even after tile metadata updates.

  **QA Scenarios**:
  ```text
  Scenario: card opens and restores focus
    Tool: Testing Library Svelte
    Steps: focus card 10193; press Enter; close with Escape.
    Expected: one dialog opens for 10193; focus returns to `[data-card-id="10193"]`.
    Evidence: .sisyphus/evidence/card-detail/task-16-open-focus.txt

  Scenario: Shift-click and drag stay closed
    Tool: Testing Library Svelte
    Steps: Shift-click card; then pointer move 20px and release.
    Expected: zero dialogs; Shift-click routed to selection hook; drag routed to drop hook.
    Evidence: .sisyphus/evidence/card-detail/task-16-no-open.txt
  ```

  **Commit**: YES — `feat(card-detail): wire in-app card activation`

- [x] 17. Synchronize detail saves with board tiles and failure surfaces

  **What to do**:
  - Add a board-store card patch/reconcile operation keyed by card id and use it for successful detail mutations.
  - Keep tile title, due badge, labels, comment count, attachment count, and archive/delete removal synchronized without reloading all stacks.
  - Route failures into existing toast plus field-level recovery where appropriate.

  **Must NOT do**: Do not replace the full board from a stale detail response; do not mutate card order/stack during detail edits.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — state reconciliation across stores.
  - **Skills**: none; state concern.

  **Parallelization**: Wave 3 after T10/T12/T13; blocks T21.

  **References**:
  - `src/lib/store.svelte.js:19-25,72-89,148-154` — card lookup/rollback/public API patterns.
  - `src/components/Card.svelte:6-15,24-70` — tile fields to keep synchronized.
  - `src/App.svelte:71-75,102-104` — pending/toast surfaces.

  **Acceptance Criteria**:
  - [x] Store tests cover patch, unknown card, rapid saves, archive removal, delete removal, and rollback.
  - [x] Core detail updates never change stack or order unless explicitly moved elsewhere.

  **QA Scenarios**:
  ```text
  Scenario: saved detail updates tile immediately
    Tool: Vitest/component integration
    Steps: save title, due date, label, comment, attachment; inspect board Card.
    Expected: all visible badges/counts change without getStacks reload.
    Evidence: .sisyphus/evidence/card-detail/task-17-tile-sync.txt

  Scenario: late response cannot resurrect archived card
    Tool: Vitest
    Steps: archive card, then resolve an older title save response.
    Expected: card stays removed; stale response ignored.
    Evidence: .sisyphus/evidence/card-detail/task-17-stale.txt
  ```

  **Commit**: YES — groups with C4/C5 as appropriate.

- [x] 18. Add guarded archive, unarchive, and soft-delete actions

  **What to do**:
  - Add lifecycle actions in a compact overflow menu.
  - Archive/unarchive requires an explicit confirmation summary; delete requires typed card-title confirmation because the API has no card restore endpoint.
  - Close modal and reconcile board only after success; failures keep modal open.

  **Must NOT do**: No one-click delete; no claim that soft-deleted cards can be restored through the available API.

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering` — high-risk confirmation UX.
  - **Skills**: `frontend-ui-ux` — destructive-action hierarchy and clarity.

  **Parallelization**: Wave 3 after T5/T10/T11; blocks T21.

  **References**:
  - Deck `CardApiController.php:163-177` — archive/delete routes.
  - Deck `CardService.php:501-547` — archive/unarchive/soft-delete semantics.
  - T17 board reconciliation contract.

  **Acceptance Criteria**:
  - [x] Component tests cover cancel, wrong confirmation title, success, 403/500, and double-submit prevention.
  - [x] Delete copy accurately says removal cannot be restored in Deck v2 via current API.

  **QA Scenarios**:
  ```text
  Scenario: archive only after confirmation
    Tool: Testing Library Svelte
    Steps: choose Archive; cancel; repeat and confirm.
    Expected: first dispatches no request; second dispatches one and removes tile after 200.
    Evidence: .sisyphus/evidence/card-detail/task-18-archive.txt

  Scenario: delete confirmation mismatch
    Tool: Testing Library Svelte
    Steps: choose Delete for `Detail QA`; type `Detail Q`; submit.
    Expected: delete disabled/no request; modal/card remain.
    Evidence: .sisyphus/evidence/card-detail/task-18-delete-guard.txt
  ```

  **Commit**: YES — groups with C5.

- [x] 19. Expand `/ocs/` CORS for comment writes on the alias only

  **What to do**:
  - Update the alias-host `location ^~ /ocs/` preflight and response config to allow the exact comment methods used: GET, POST, PUT, DELETE, OPTIONS.
  - Preserve literal origin, exact allowed headers, `always`, ACME challenge block, and alias-only blast radius.
  - Run `nginx -t`, diff generated config, reload (not restart), and verify rollback path.

  **Must NOT do**: Never modify `nextcloud.xhacker.de`; never add headers to `/index.php/`; never remove/circumvent ACME.

  **Recommended Agent Profile**:
  - **Category**: `deep` — production-adjacent proxy safety.
  - **Skills**: none; this follows existing server-scripts conventions, not app UI.

  **Parallelization**: Wave 3 after T7/T14; blocks live comment E2E T21.

  **References**:
  - `.sisyphus/CORS-DECISION.md:10-43` — production and ACME guardrails.
  - `.sisyphus/CORS-DECISION.md:98-177` — current alias config and verification.
  - Deck `CommentsApiController.php:17-27` — comment endpoint methods/headers.

  **Acceptance Criteria**:
  - [x] OPTIONS for each comment write request returns 204 and exactly one ACAO.
  - [x] `/index.php/apps/deck/api/v1.0/boards` still returns exactly one ACAO.
  - [x] Generated production-host server block is unchanged; ACME probe still reaches challenge root.

  **QA Scenarios**:
  ```text
  Scenario: alias comment preflight
    Tool: Bash/curl
    Steps: OPTIONS comment URL with Origin deckv2.xhacker.de and method POST, then PUT and DELETE.
    Expected: 204; one literal ACAO; requested method allowed; exact headers only.
    Evidence: .sisyphus/evidence/card-detail/task-19-preflight.txt

  Scenario: production and Deck API regression
    Tool: Bash
    Steps: diff production server block; curl production health, Deck boards ACAO count, and ACME probe.
    Expected: production diff empty/200; Deck ACAO count 1; ACME route intact.
    Evidence: .sisyphus/evidence/card-detail/task-19-production-safety.txt
  ```

  **Commit**: YES — in owning infrastructure repo as `infra(cors): allow Deck comment writes on alias host`; do not mix repos.

- [x] 20. Add Playwright click, drag, Shift-click, and keyboard regression suite

  **What to do**:
  - Cover exact interaction arbitration in a real browser using a seeded card on board 116.
  - Assert modal count, network PUT count, drag placeholder, persisted destination, and focus restoration.
  - Include sub-threshold jitter at 4 px, drag threshold at 5 px, pointer cancellation, invalid target, and drag auto-scroll.

  **Must NOT do**: No mutations outside board 116; no timing-only assertions without observable state.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — browser-level pointer regression.
  - **Skills**: `playwright` — exact pointer/keyboard/network assertions.

  **Parallelization**: Wave 3 after T3/T9/T16; blocks final audits.

  **References**:
  - `.sisyphus/TRELLO-UX-SPEC.md:15-49,83-109` — expected interaction semantics.
  - `src/lib/dnd.svelte.js:104-165` — gesture path under test.
  - T3 board-116 safety fixture.

  **Acceptance Criteria**:
  - [x] Tests deterministically pass 5 consecutive local runs.
  - [x] Real click/Enter/Space each open one modal; Shift-click, 5+ px drag, pointercancel, and invalid drop open zero.
  - [x] Drag produces exactly the expected move PUT(s), never a detail GET caused by activation.

  **QA Scenarios**:
  ```text
  Scenario: true click and keyboard activation
    Tool: Playwright
    Steps: click `[data-card-id="10193"]`; close; focus and press Enter; close; press Space.
    Expected: one dialog per activation; correct card id/title; focus restored each close.
    Evidence: .sisyphus/evidence/card-detail/task-20-activation.zip

  Scenario: drag never opens detail
    Tool: Playwright
    Steps: move card 10193 from stack 366 to 368 with 20px+ pointer movement; wait through drop and native click window.
    Expected: placeholder appears; move persists; dialog count remains 0; no detail activation request.
    Evidence: .sisyphus/evidence/card-detail/task-20-drag-no-open.zip
  ```

  **Commit**: YES — groups with T21 as `test(card-detail): cover interaction and live-safe CRUD flows`.

- [x] 21. Add board-116 end-to-end card detail CRUD suite and cleanup

  **What to do**:
  - Create a uniquely named fixture card on board 116 and exercise all supported detail operations through the UI.
  - Verify persisted API state after each core save; exercise labels/assignees/comments/attachment and archive/unarchive.
  - Delete or restore all test artifacts in `finally`; emit API cleanup proof even after test failure.

  **Must NOT do**: Do not soft-delete pre-existing seeded cards; never touch board 113.

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high` — multi-system live E2E with cleanup.
  - **Skills**: `playwright` — UI, network, download/upload, screenshots.

  **Parallelization**: Wave 3 after T3/T12–T19; blocks final audits.

  **References**:
  - Board 116 and stacks 366–370 — dedicated safe test data.
  - T3 mutation guard and cleanup fixture.
  - T5–T8 API contracts and T12–T18 UI contracts.

  **Acceptance Criteria**:
  - [x] Suite proves exact persisted values for title, multiline description, due date, label, assignee, comment, and attachment.
  - [x] Archive/unarchive works; destructive-delete test uses only the suite-created card.
  - [x] Final API query shows zero uniquely prefixed fixture cards/comments/attachments left behind.

  **QA Scenarios**:
  ```text
  Scenario: full meaningful card-detail workflow
    Tool: Playwright
    Preconditions: board 116; create `E2E card detail <uuid>` in stack 366.
    Steps: open by click; edit title/description/due; assign available label/user; add comment; upload `detail-test.txt`; close/reopen.
    Expected: all exact values persist in modal/API; tile badges/counts match; no native Deck navigation.
    Evidence: .sisyphus/evidence/card-detail/task-21-full-workflow.zip

  Scenario: failures and guaranteed cleanup
    Tool: Playwright + Bash API probe
    Steps: intercept one save as 500; assert rollback/retry; complete cleanup in finally; query board 116 by UUID prefix.
    Expected: failure is recoverable; final query returns zero fixtures; board 113 receives zero requests.
    Evidence: .sisyphus/evidence/card-detail/task-21-failure-cleanup.txt
  ```

  **Commit**: YES — groups with T20.

---

## Final Verification Wave

> Run F1–F4 in parallel after all implementation tasks. Every reviewer must approve. Present consolidated results and wait for explicit user approval before completion.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  - Verify every Must Have and Must NOT Have against source, rendered DOM, network traces, and evidence.
  - Confirm no native Deck card links and no mutation evidence outside board 116.
  - Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT`.

- [ ] F2. **Code Quality and Automated-Test Audit** — `unspecified-high`
  - Run build, Vitest, Playwright, lint/type diagnostics if configured.
  - Inspect changed files for unsafe full-PUT omissions, duplicated request code, leaked credentials, stale handlers, broad catches, and inaccessible controls.
  - Output: `Build | Unit | Component | E2E | Files reviewed | VERDICT`.

- [ ] F3. **Real Browser QA Replay** — `unspecified-high` + `playwright`
  - Execute every QA scenario on board 116 from a clean state; retain screenshots, traces, request bodies with secrets redacted, and cleanup proof.
  - Output: `Scenarios [N/N] | Cleanup | Evidence | VERDICT`.

- [ ] F4. **Scope and Production-Safety Audit** — `deep`
  - Compare implementation diff 1:1 with tasks. Verify production Nextcloud vhost unchanged, alias CORS has one ACAO, ACME route remains, and no non-test board was mutated.
  - Output: `Scope | Production safety | Test-board isolation | VERDICT`.

---

## Commit Strategy

- C1: `test(card-detail): add unit and browser test infrastructure`
- C2: `feat(api): add card detail operations`
- C3: `fix(dnd): separate card activation from drag gestures`
- C4: `feat(card-detail): add accessible detail modal and editors`
- C5: `feat(card-detail): add comments attachments and lifecycle actions`
- C6: `infra(cors): allow Deck comment writes on alias host`
- C7: `test(card-detail): cover interaction and live-safe CRUD flows`

Each commit must stage only its listed task files and pass the relevant focused tests before creation. Do not push unless explicitly requested.

---

## Success Criteria

### Verification Commands
```bash
npm run build                 # expected: exit 0
npm run test                  # expected: all Vitest tests pass
npm run test:e2e              # expected: all Playwright tests pass against board 116
```

### Final Checklist
- [ ] True click opens one modal; drag opens none.
- [ ] Shift-click remains detail-free and reserved for selection.
- [ ] Keyboard activation and focus restoration work.
- [ ] All detail fields round-trip safely.
- [ ] Failed writes roll back without data loss.
- [ ] Comments and attachments work cross-origin through the alias.
- [ ] Archive/delete are guarded and recover cleanly on failure.
- [ ] Native Deck card links are absent.
- [ ] Production host/config remains unchanged.
- [ ] Board 116 is the only live mutation target in evidence.
