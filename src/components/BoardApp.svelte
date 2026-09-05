<script>
  import { onDestroy } from 'svelte';
  import { ORDER_STEP } from '../../shared/ordering.js';
  import { DeckClient } from '../lib/deck.js';
  import { createBoardStore } from '../lib/store.svelte.js';
  import { createCardDetailStore } from '../lib/detail.svelte.js';
  import { boardAssignmentOptions } from '../lib/assignments.js';
  import { downloadAttachment, uploadAttachment, addLinkAttachment } from '../lib/attachments.js';
  import { touch, sortByMru, readMru } from '../lib/mru.js';
  import { accessLevel } from '../lib/permissions.js';
  import { applyCardClick, applyShiftClick, emptySelection, orderedSelection } from '../lib/selection.js';
  import { createInboxStore } from '../lib/inbox.svelte.js';
  import { withoutInbox, readCollapsed, writeCollapsed } from '../lib/inbox.js';
  import { CalendarClient, applyCalendarPulls, calendarEntries } from '../lib/calendar.js';
  import { createCard } from '../lib/cards.js';
  import { preloadBoards, PRELOAD_LIMIT } from '../lib/board-preload.js';
  import Board from './Board.svelte';
  import InboxPanel from './InboxPanel.svelte';
  import BoardSwitcher from './BoardSwitcher.svelte';
  import BottomNav from './BottomNav.svelte';
  import AccessBadge from './AccessBadge.svelte';
  import CardDetailModal from './CardDetailModal.svelte';
  import CardCoreEditor from './CardCoreEditor.svelte';
  import CardMetadataEditor from './CardMetadataEditor.svelte';
  import CardComments from './CardComments.svelte';
  import CardAttachments from './CardAttachments.svelte';
  import CardLifecycleMenu from './CardLifecycleMenu.svelte';
  import Toast from './Toast.svelte';
  import LoadProgress from './LoadProgress.svelte';
  import Planner from './Planner.svelte';

  let { currentUser, onSignOut = () => {}, onUnauthorized = () => {} } = $props();

  const client = new DeckClient({ onUnauthorized: () => onUnauthorized() });
  const calendar = new CalendarClient();

  const board = createBoardStore(client);

  let tileToast = $state(null);
  let activeView = $state('board');
  let calendarReady = $state(false);

  // Only the attachment call itself may decide success or failure. An earlier
  // version awaited the board refresh inside the same try, so anything that
  // threw after a successful upload - and `board.refresh` did not exist, so it
  // threw every time - replaced the success toast with an error one. The drop
  // had worked; the UI reported that it had not.
  async function runTileAttach(card, pending, failure, action) {
    tileToast = { status: 'uploading', message: pending };
    try {
      await action({ boardId: card.boardId, stackId: card.stackId, cardId: card.id });
    } catch (err) {
      tileToast = { status: 'error', message: err?.message ?? failure };
      setTimeout(() => { tileToast = null; }, 4000);
      return;
    }
    tileToast = { status: 'success', message: 'Erfolgreich' };
    setTimeout(() => { tileToast = null; }, 3000);
    await board.refresh();
  }

  function handleTileUploadAttachment(card, file) {
    return runTileAttach(card, 'Datei wird hochgeladen...', 'Upload fehlgeschlagen', (target) =>
      uploadAttachment(client, target, file)
    );
  }

  function handleTileAttachLink(card, uri) {
    return runTileAttach(card, 'Link anhängen', 'Link konnte nicht angehängt werden', (target) =>
      addLinkAttachment(client, target, uri)
    );
  }

  // Detail saves must repaint the board tile, so the store pushes every fresh
  // card straight back into the board state.
  // svelte-ignore state_referenced_locally -- current user is captured for draft ownership checks in the detail store.
  const detail = createCardDetailStore(client, {
    currentUser,
    onCard: (card) => board.replaceCard(card),
    onRemoveCard: (cardId) => board.removeCard(cardId),
  });

  let boards = $state([]);
  let current = $state(null);
  let assignmentOptions = $state({ labels: [], participants: [] });

  const stacks = $derived(board.state.stacks);
  const loading = $derived(board.state.loading);
  const error = $derived(board.state.error);
  const cardCount = $derived(stacks.reduce((n, s) => n + s.cards.length, 0));

  const inbox = createInboxStore(client);
  let inboxCollapsed = $state(readCollapsed());
  let switcherOpen = $state(false);

  function toggleInbox() {
    inboxCollapsed = !inboxCollapsed;
    writeCollapsed(inboxCollapsed);
  }

  // The inbox board is filtered out of the switcher: it is our storage, not a
  // place the user navigates to.
  async function loadBoards() {
    const { data } = await client.getBoards();
    boards = sortByMru(withoutInbox(data));
    inbox.init(data);
    return boards;
  }

  // Development points at a dedicated throwaway board so a bad drag can never
  // scramble real data. Set VITE_BOARD_ID to override.
  const preferredBoardId = Number(import.meta.env.VITE_BOARD_ID) || null;
  let preloadToken = 0;
  // Null once the queue is drained, so the indicator disappears on its own.
  let preloadProgress = $state(null);
  // 'boards' while the board list itself is in flight, 'board' while the board
  // the user is looking at loads, null when nothing is outstanding. The first
  // phase used to be entirely silent: the app rendered an empty shell with no
  // statement of what it was waiting for.
  let loadPhase = $state('boards');
  onDestroy(() => { preloadToken += 1; });

  function nowMs() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  // Two clocks, because they answer two different questions. The active one is
  // "how long have I been staring at this board" and restarts on every switch;
  // the total one is "how long has the app been loading anything at all" and
  // keeps running behind a board that has already painted. Sharing one clock
  // froze the aggregate's duration the moment the active board finished.
  let phaseStartedAt = $state(nowMs());
  let phaseElapsed = $state(0);
  let totalStartedAt = $state(nowMs());
  let totalElapsed = $state(0);

  function beginPhase(phase) {
    loadPhase = phase;
    phaseStartedAt = nowMs();
    phaseElapsed = 0;
  }

  // The cleanup runs on every phase change, so an abandoned board switch cannot
  // leave a timer running.
  $effect(() => {
    if (!loadPhase) return;
    const started = phaseStartedAt;
    const tick = () => { phaseElapsed = nowMs() - started; };
    const id = setInterval(tick, 200);
    tick();
    return () => clearInterval(id);
  });

  $effect(() => {
    if (!showAggregate) return;
    const started = totalStartedAt;
    const tick = () => { totalElapsed = nowMs() - started; };
    const id = setInterval(tick, 200);
    tick();
    return () => clearInterval(id);
  });

  const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

  // Cards are a running total, never a fraction. `/boards?details=1` returns
  // each board's stacks but zero cards, so there is no honest denominator to
  // count towards until every board has actually been fetched - a bar claiming
  // "600 of 3000" would be inventing the 3000.
  const preloaded = $derived(preloadProgress ?? { done: 0, total: 0, cards: 0, stacks: 0, loading: [] });
  // The active board plus the preload queue. Capped the same way the scheduler
  // caps itself, so the denominator matches the work that will really happen.
  const boardsTotal = $derived(Math.min(boards.length, PRELOAD_LIMIT + 1));
  const boardsDone = $derived(preloaded.done + (loadPhase ? 0 : 1));
  const totalCards = $derived(preloaded.cards + cardCount);
  const totalStacks = $derived(preloaded.stacks + stacks.length);
  const showAggregate = $derived(Boolean(loadPhase) || preloadProgress !== null);

  // Named so both bars are distinguishable to a screen reader and to the tests.
  const AGGREGATE_LABEL = 'Ladefortschritt aller Boards';
  const ACTIVE_LABEL = 'Ladefortschritt des aktuellen Boards';

  // Six workers means six titles at once, which is more than the panel can show
  // legibly - name two and count the rest.
  const loadingNames = $derived.by(() => {
    const names = preloaded.loading;
    if (!names.length) return loadPhase ? (current?.title ?? 'Boardliste') : '—';
    return names.length <= 2
      ? names.join(', ')
      : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
  });

  const activeLoad = $derived(
    loadPhase === 'boards'
      ? { text: 'Boardliste wird geladen…', board: '—' }
      : loadPhase === 'board' && loading
        ? { text: `„${current?.title ?? 'Board'}“ wird geladen…`, board: current?.title ?? '—' }
        : null
  );

  const idle = () => new Promise((resolve) => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(resolve, { timeout: 1000 });
    else window.setTimeout(resolve, 0);
  });

  async function preloadInBackground(activeId, token) {
    await preloadBoards({
      boards,
      activeId,
      mru: readMru(),
      idle,
      shouldContinue: () => !(
        token !== preloadToken ||
        document.hidden ||
        !navigator.onLine ||
        navigator.connection?.saveData
      ),
      preload: board.preload,
      onProgress: (event) => {
        // A stale run must not repaint the bar for the board we just left.
        if (token !== preloadToken) return;
        preloadProgress = event.done < event.total ? event : null;
      },
    });
    if (token === preloadToken) preloadProgress = null;
  }

  async function openBoard(b) {
    if (!b) return;
    const token = ++preloadToken;
    preloadProgress = null;
    current = b;
    touch(b.id);
    loadAssignmentOptions(b);
    beginPhase('board');
    // The background pool is started only after the active board resolves. Six
    // workers racing it for connections is exactly what made the board the user
    // is looking at finish last; the user asked for the opposite.
    try {
      await board.load(b.id);
    } finally {
      if (token === preloadToken) loadPhase = null;
    }
    if (token === preloadToken) void preloadInBackground(b.id, token);
  }

  let selection = $state(emptySelection());

  const selectedIds = $derived(selection.ids);
  const selectedCount = $derived(selection.ids.length);

  // The inbox is a selectable lane like any other, so ranges work inside it.
  const allStacks = $derived(
    inbox.state.stack
      ? [...stacks, { id: inbox.state.stack.id, cards: inbox.state.cards }]
      : stacks
  );

  function handleSelect({ card }) {
    const stack = allStacks.find((s) => s.id === card.stackId);
    selection = applyShiftClick(selection, {
      cardId: card.id,
      stackId: card.stackId,
      stackCardIds: (stack?.cards ?? []).map((c) => c.id),
    });
  }

  function clearSelection() {
    selection = emptySelection();
  }

  // Dragging a selected card takes the whole selection; dragging an unselected
  // one is a plain single-card move and leaves the selection untouched.
  const dragIds = (card) =>
    selection.ids.includes(card.id) ? orderedSelection(selection, allStacks) : [card.id];

  // A drop is routed by which side owns the source and target stacks, so the
  // four board/inbox combinations stay explicit rather than implied.
  function handleDrop({ cardIds, toStackId, index }) {
    const intoInbox = toStackId === inbox.state.stack?.id;
    const fromInbox = inbox.cardsByIds(cardIds);

    if (intoInbox && !fromInbox.length) {
      const cards = cardIds.map((id) => board.takeCard(id)).filter(Boolean);
      inbox.receive({ cards, index, restore: (failed) => board.restoreCards(failed) });
    } else if (intoInbox) {
      inbox.reorderWithin({ cards: fromInbox, index });
    } else if (fromInbox.length) {
      moveFromInbox({ cards: fromInbox, toStackId, index });
    } else {
      board.moveCards({ cardIds, toStackId, index, boardId: current.id });
    }

    if (cardIds.length > 1 || selection.ids.includes(cardIds[0])) clearSelection();
  }

  async function handleAddCard(target) {
    const stack = stacks.find((candidate) => candidate.id === target.stackId);
    const parsedOrder = Number(stack?.cards.at(-1)?.order);
    const lastOrder = Number.isFinite(parsedOrder) ? parsedOrder : -ORDER_STEP;
    const { data } = await createCard(client, { ...target, order: lastOrder + ORDER_STEP });
    board.addCard({ ...target, card: data });
    return data;
  }

  async function moveFromInbox({ cards, toStackId, index }) {
    const placed = board.insertCards({ cards, toStackId, index });
    const failed = await inbox.release({
      cards,
      toBoardId: current.id,
      toStackId,
      order: placed.order,
    });
    if (failed.length) board.removeCards(failed.map((c) => c.id));
  }

  function moveSelectionTo(toStackId) {
    const cardIds = orderedSelection(selection, stacks);
    if (!cardIds.length) return;
    board.moveCards({ cardIds, toStackId, index: null, boardId: current.id });
    clearSelection();
  }

  function handleOpenCard({ card }) {
    const stack = allStacks.find((s) => s.id === card.stackId);
    const result = applyCardClick(selection, {
      cardId: card.id,
      stackId: card.stackId,
      stackCardIds: (stack?.cards ?? []).map((c) => c.id),
    });
    if (result.openDetail) {
      detail.open({ boardId: current.id, stackId: card.stackId, cardId: card.id });
    } else {
      selection = result.selection;
    }
  }

  function handleOpenInboxCard({ card }) {
    const stack = allStacks.find((s) => s.id === card.stackId);
    const result = applyCardClick(selection, {
      cardId: card.id,
      stackId: card.stackId,
      stackCardIds: (stack?.cards ?? []).map((c) => c.id),
    });
    if (result.openDetail) {
      detail.open({ boardId: inbox.state.board.id, stackId: card.stackId, cardId: card.id });
    } else {
      selection = result.selection;
    }
  }

  function handlePlannerOpen({ card }) {
    detail.open({ boardId: current.id, stackId: card.stackId, cardId: card.id });
  }

  async function syncBoardDates() {
    if (!calendarReady || !current) return null;
    const result = await calendar.sync(calendarEntries(stacks, current.id), {
      autoCreate: true,
      scopeBoardIds: [String(current.id)],
      pruneMissing: true,
    });
    if (result.pulled?.length) await applyCalendarPulls(client, stacks, result.pulled, (card) => board.replaceCard(card));
    if (result.conflicts?.length) {
      tileToast = { status: 'error', message: `${result.conflicts.length} Kalenderkonflikt${result.conflicts.length === 1 ? '' : 'e'} im Planer` };
    }
    return result;
  }

  async function saveDetailCore(changes) {
    detail.editDraft(changes);
    const saved = await detail.saveCore();
    if (saved && ['title', 'duedate', 'description'].some((key) => Object.hasOwn(changes, key))) {
      try {
        await syncBoardDates();
      } catch (caught) {
        tileToast = { status: 'error', message: `Deck gespeichert; Kalender-Sync ausstehend: ${caught?.message ?? 'Fehler'}` };
      }
    }
    return saved;
  }

  function syncTitleCalendar() {
    void syncBoardDates().catch((caught) => {
      tileToast = { status: 'error', message: `Deck gespeichert; Kalender-Sync ausstehend: ${caught?.message ?? 'Fehler'}` };
    });
  }

  async function saveDetailTitle(changes) {
    const saved = await detail.saveCore(changes);
    if (saved) syncTitleCalendar();
    return saved;
  }

  function loadAssignmentOptions(b) {
    assignmentOptions = boardAssignmentOptions(b);
  }

  // Deck has no rename verb: the file is re-PUT under the new name, so the
  // existing bytes must be fetched first or the content would be truncated.
  async function handleRename(attachment, name) {
    const blob = await downloadAttachment(client, detailTarget(), attachment.id);
    await detail.replaceAttachment(attachment.id, new File([blob], name, { type: attachment.mimetype ?? blob.type }));
  }

  async function handleDownload(attachment) {
    const blob = await downloadAttachment(client, detailTarget(), attachment.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = attachment.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function detailTarget() {
    return { boardId: detail.state.boardId, stackId: detail.state.stackId, cardId: detail.state.cardId };
  }

  async function init() {
    beginPhase('boards');
    try {
      const list = await loadBoards();
      const preferred = list.find((b) => b.id === preferredBoardId);
      // The calendar probe is independent of the board payload, so it overlaps
      // the board load instead of adding a serial round-trip on a slow link.
      const calendarStatus = calendar.status().catch(() => null);
      await openBoard(preferred ?? list[0]);
      const status = await calendarStatus;
      calendarReady = Boolean(status?.enabled && status?.connected);
      if (calendarReady) {
        try {
          await syncBoardDates();
        } catch {
          calendarReady = false;
        }
      }
    } catch (e) {
      board.state.error = e.message;
      board.state.loading = false;
      loadPhase = null;
    }
  }

  init();
</script>

<div class="app">
  <InboxPanel
    state={inbox.state}
    collapsed={inboxCollapsed}
    onToggle={toggleInbox}
    onDrop={handleDrop}
    onOpenCard={handleOpenInboxCard}
    onSelect={handleSelect}
    {selectedIds}
    {dragIds}
  />

  <div class="main">
    <header class="topbar">
      <BoardSwitcher {boards} {current} onselect={openBoard} onpreload={(candidate) => board.preload(candidate.id)} bind:open={switcherOpen} />
      {#if current}
        <span class="current-access"><AccessBadge level={accessLevel(current)} /></span>
      {/if}
      {#if !loading && !error}
        <span class="stat">{stacks.length} Listen · {cardCount} Karten</span>
      {/if}
      {#if board.state.pending > 0}
        <span class="pending" title="Wird in Deck gespeichert">
          {board.state.pending} wird gespeichert…
        </span>
      {/if}
      {#if showAggregate}
        <LoadProgress
          label={AGGREGATE_LABEL}
          done={boardsDone}
          total={boardsTotal}
          text={boardsTotal ? `${boardsDone}/${boardsTotal}` : '…'}
          valuetext={boardsTotal
            ? `${boardsDone} von ${boardsTotal} Boards geladen`
            : 'Boardliste wird geladen…'}
          details={[
            { term: 'Boards geladen', value: boardsTotal ? `${boardsDone} von ${boardsTotal}` : '—' },
            { term: 'Listen geladen', value: String(totalStacks) },
            { term: 'Karten geladen', value: String(totalCards) },
            { term: 'Lädt gerade', value: loadingNames },
            { term: 'Dauer', value: seconds(totalElapsed) },
          ]}
        />
      {/if}
      <span class="build" title={`Erstellt am ${__BUILD_TIME__}`}>v{__APP_VERSION__} ({__BUILD_SHA__})</span>
      <!-- Plain text beats an avatar menu here: the topbar is dense, and one action
        does not justify hiding the signed-in username behind another interaction. -->
      <div class="account" title={`Angemeldet als ${currentUser}`} aria-label={`Angemeldet als ${currentUser}`}>
        <span class="account-user">{currentUser}</span>
        <span class="account-sep" aria-hidden="true">•</span>
        <button class="signout" type="button" onclick={() => onSignOut()}>Abmelden</button>
      </div>
    </header>

    {#if activeLoad}
      <!-- Under the topbar rather than inside it: this one is about the board
        the user is looking at, so it belongs with the board, and it names the
        board so a slow switch is never ambiguous about what is being fetched. -->
      <div class="active-load" role="status" aria-live="polite">
        <LoadProgress
          wide
          indeterminate
          label={ACTIVE_LABEL}
          text={activeLoad.text}
          valuetext={activeLoad.text}
          details={[
            { term: 'Board', value: activeLoad.board },
            { term: 'Dauer', value: seconds(phaseElapsed) },
            { term: 'Karten geladen', value: String(totalCards) },
          ]}
        />
        <span class="active-load-time">{seconds(phaseElapsed)}</span>
      </div>
    {/if}

    {#if error}
      <div class="state">
        <p class="err">{error}</p>
        <button class="retry" onclick={() => (current ? openBoard(current) : init())}>
          Erneut versuchen
        </button>
      </div>
    {:else if loading}
      <!-- Skeletons, not a spinner: the board must never look blocked. -->
      <div class="board-skel">
        {#each Array(5) as _, i}
          <div class="skel-stack">
            <div class="skel-head"></div>
            {#each Array(3 + ((i * 2) % 4)) as _}
              <div class="skel-card"></div>
            {/each}
          </div>
        {/each}
      </div>
    {:else if activeView === 'planner'}
      <Planner
        {calendar}
        deckClient={client}
        board={current}
        {stacks}
        onCard={(card) => board.replaceCard(card)}
        onOpenCard={handlePlannerOpen}
      />
    {:else}
      <Board
        {stacks}
        boardId={current?.id}
        {client}
        onDrop={handleDrop}
        onOpenCard={handleOpenCard}
        onSelect={handleSelect}
        {selectedIds}
        {dragIds}
        onClearSelection={clearSelection}
        onUploadAttachment={handleTileUploadAttachment}
        onAttachLink={handleTileAttachLink}
        onAddCard={handleAddCard}
      />
    {/if}

    {#if tileToast}
      <Toast
        status={tileToast.status}
        message={tileToast.message}
        onClose={() => (tileToast = null)}
      />
    {/if}

    {#if selectedCount > 0}
      <div class="selbar" role="region" aria-label="Selection actions">
        <span class="selcount">{selectedCount} ausgewählt</span>
        <label class="selmove">
          Verschieben nach
          <select
            aria-label="Selection to list"
            value=""
            onchange={(e) => { moveSelectionTo(Number(e.currentTarget.value)); e.currentTarget.value = ''; }}
          >
            <option value="" disabled>Liste auswählen…</option>
            {#each stacks as s (s.id)}
              <option value={s.id}>{s.title}</option>
            {/each}
          </select>
        </label>
        <button class="selclear" type="button" onclick={clearSelection}>Auswahl aufheben</button>
      </div>
    {/if}

    <BottomNav
      {activeView}
      inboxOpen={!inboxCollapsed}
      {switcherOpen}
      onInbox={toggleInbox}
      onPlanner={() => (activeView = 'planner')}
      onBoard={() => (activeView = 'board')}
      onSwitchBoards={() => (switcherOpen = !switcherOpen)}
    />
  </div>

  {#if detail.state.cardId != null}
    <CardDetailModal
      card={detail.state.card}
      loading={detail.state.loading}
      error={detail.state.error}
      dirty={detail.state.dirty || detail.state.draftPending}
      onClose={detail.requestClose}
      onRetry={detail.refreshCard}
      onSave={detail.saveCore}
      onRename={saveDetailTitle}
      onDiscard={detail.discardDraft}
      onUploadAttachment={detail.addAttachment}
      onAttachLink={detail.addLink}
    >
      {#snippet main()}
        <CardCoreEditor
          card={detail.state.card}
          error={detail.state.actionScope === 'core' ? detail.state.actionError : null}
          onDraftChange={detail.setDraftPending}
          onSave={saveDetailCore}
        />
        <CardComments
          comments={detail.state.comments}
          onAdd={detail.addComment}
          onEdit={detail.editComment}
          onDelete={detail.removeComment}
        />
      {/snippet}

      {#snippet sidebar()}
        <CardMetadataEditor
          card={detail.state.card}
          error={detail.state.actionScope === 'metadata' ? detail.state.actionError : null}
          labels={assignmentOptions.labels}
          participants={assignmentOptions.participants}
          onAssignLabel={detail.assignLabel}
          onRemoveLabel={detail.removeLabel}
          onAssignUser={detail.assignUser}
          onUnassignUser={detail.unassignUser}
        />
        <CardAttachments
          attachments={detail.state.attachments}
          onUpload={detail.addAttachment}
          onRename={handleRename}
          onDelete={(attachment) => detail.removeAttachment(attachment.id)}
          onRestore={(attachment) => detail.restoreDeletedAttachment(attachment.id)}
          onDownload={handleDownload}
        />
        <CardLifecycleMenu
          card={detail.state.card}
          error={detail.state.actionScope === 'lifecycle' ? detail.state.actionError : null}
          onArchive={detail.archive}
          onUnarchive={detail.unarchive}
          onDelete={detail.softDelete}
        />
      {/snippet}
    </CardDetailModal>
  {/if}

  {#if board.state.toast && !tileToast}
    <Toast
      status="error"
      message={board.state.toast.text}
      onClose={() => (board.state.toast = null)}
    />
  {/if}
</div>

<style>
  .app { display: flex; height: 100%; }

  .main { display: flex; flex-direction: column; flex: 1; min-width: 0; position: relative; }

  .selbar {
    position: absolute;
    /* Clears the view dock, which owns the bottom centre of the board. */
    bottom: 76px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--stack-bg);
    box-shadow: 0 8px 24px rgb(0 0 0 / 45%);
    font-size: 13px;
  }
  .selcount { font-weight: 600; }
  .selmove { display: flex; align-items: center; gap: 6px; color: var(--text-dim); }
  .selmove select {
    padding: 4px 6px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--card-bg);
    color: var(--text);
    font-size: 13px;
  }
  .selclear {
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
  }
  .selclear:hover { background: var(--card-bg-hover); color: var(--text); }

  .topbar {
    display: flex;
    align-items: center;
    gap: 16px;
    height: var(--topbar-h);
    flex: 0 0 var(--topbar-h);
    padding: 0 12px;
    background: rgba(0, 0, 0, .26);
    backdrop-filter: blur(6px);
    border-bottom: 1px solid rgba(255, 255, 255, .09);
    /* backdrop-filter makes this a stacking context, so the board switcher's
       menu cannot escape it. Without an explicit order the bar paints as a
       z-index:0 unit and any board element that forms its own context - a
       disabled Add-a-card button's opacity is enough - covers the open menu. */
    position: relative;
    z-index: 30;
  }
  .stat { font-size: 12px; color: var(--text-dim); }
  .build { font-size: 12px; color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .current-access { flex: 0 0 auto; }
  .pending { font-size: 12px; color: var(--accent); }

  /* Full-width strip directly beneath the topbar. It replaces nothing - the
     skeletons still render below it - so the board never looks blocked while
     still saying out loud what is being fetched and for how long. */
  .active-load {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 0 0 auto;
    padding: 6px 12px;
    background: rgba(0, 0, 0, .18);
    border-bottom: 1px solid rgba(255, 255, 255, .06);
    /* Above the board content, below the topbar's switcher menu. */
    position: relative;
    z-index: 20;
  }
  .active-load-time {
    flex: 0 0 auto;
    font-size: 12px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  .account {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: min(42vw, 320px);
    margin-left: auto;
    color: var(--text-dim);
    font-size: 12px;
    white-space: nowrap;
  }

  .account-user {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
  }

  .account-sep { flex: 0 0 auto; color: var(--border); }

  .signout {
    flex: 0 0 auto;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
  }

  .signout:hover { background: var(--card-bg-hover); color: var(--text); }
  .signout:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .state { display: flex; flex-direction: column; gap: 12px; align-items: flex-start; padding: 24px; }
  .err { margin: 0; color: var(--danger); }
  .retry {
    padding: 6px 14px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
  }
  .retry:hover { background: var(--card-bg-hover); }

  .board-skel { display: flex; gap: 12px; padding: 12px; overflow: hidden; }
  .skel-stack {
    display: flex;
    flex-direction: column;
    gap: var(--card-gap);
    flex: 0 0 var(--stack-w);
    padding: 10px 8px;
    background: var(--stack-bg);
    border-radius: var(--stack-radius);
  }
  .skel-head { height: 16px; width: 45%; margin: 2px 4px 6px; border-radius: 4px; background: var(--card-bg); }
  .skel-card { height: var(--card-h); border-radius: var(--card-radius); background: var(--card-bg); opacity: .6; }
</style>
