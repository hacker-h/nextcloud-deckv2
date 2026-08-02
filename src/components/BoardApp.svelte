<script>
  import { DeckClient } from '../lib/deck.js';
  import { createBoardStore } from '../lib/store.svelte.js';
  import { createCardDetailStore } from '../lib/detail.svelte.js';
  import { getBoardAssignmentOptions } from '../lib/assignments.js';
  import { downloadAttachment } from '../lib/attachments.js';
  import { touch, sortByMru } from '../lib/mru.js';
  import Board from './Board.svelte';
  import BoardSwitcher from './BoardSwitcher.svelte';
  import CardDetailModal from './CardDetailModal.svelte';
  import CardCoreEditor from './CardCoreEditor.svelte';
  import CardMetadataEditor from './CardMetadataEditor.svelte';
  import CardComments from './CardComments.svelte';
  import CardAttachments from './CardAttachments.svelte';
  import CardLifecycleMenu from './CardLifecycleMenu.svelte';

  let { currentUser, onSignOut = () => {}, onUnauthorized = () => {} } = $props();

  const client = new DeckClient({ onUnauthorized: () => onUnauthorized() });

  const board = createBoardStore(client);

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

  async function loadBoards() {
    const { data } = await client.getBoards();
    boards = sortByMru(data);
    return boards;
  }

  // Development points at a dedicated throwaway board so a bad drag can never
  // scramble real data. Set VITE_BOARD_ID to override.
  const preferredBoardId = Number(import.meta.env.VITE_BOARD_ID) || null;

  async function openBoard(b) {
    if (!b) return;
    current = b;
    touch(b.id);
    await board.load(b.id);
    loadAssignmentOptions(b.id);
  }

  function handleDrop({ cardIds, toStackId, index }) {
    board.moveCards({ cardIds, toStackId, index, boardId: current.id });
  }

  function handleOpenCard({ card }) {
    detail.open({ boardId: current.id, stackId: card.stackId, cardId: card.id });
  }

  async function loadAssignmentOptions(boardId) {
    try {
      const { data } = await getBoardAssignmentOptions(client, boardId);
      assignmentOptions = data;
    } catch {
      // Pickers degrade to empty lists; the rest of the detail view still works.
      assignmentOptions = { labels: [], participants: [] };
    }
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
    try {
      const list = await loadBoards();
      const preferred = list.find((b) => b.id === preferredBoardId);
      await openBoard(preferred ?? list[0]);
    } catch (e) {
      board.state.error = e.message;
      board.state.loading = false;
    }
  }

  init();
</script>

<div class="app">
  <!-- Inbox rail: visual placeholder only, behaviour lands in M4.5. -->
  <aside class="rail" title="Inbox (coming in M4.5)">
    <span class="rail-icon">▤</span>
  </aside>

  <div class="main">
    <header class="topbar">
      <BoardSwitcher {boards} {current} onselect={openBoard} />
      {#if !loading && !error}
        <span class="stat">{stacks.length} lists · {cardCount} cards</span>
      {/if}
      {#if board.state.pending > 0}
        <span class="pending" title="Saving to Deck">
          {board.state.pending} saving…
        </span>
      {/if}
      <!-- Plain text beats an avatar menu here: the topbar is dense, and one action
        does not justify hiding the signed-in username behind another interaction. -->
      <div class="account" title={`Signed in as ${currentUser}`} aria-label={`Signed in as ${currentUser}`}>
        <span class="account-user">{currentUser}</span>
        <span class="account-sep" aria-hidden="true">•</span>
        <button class="signout" type="button" onclick={() => onSignOut()}>Sign out</button>
      </div>
    </header>

    {#if error}
      <div class="state">
        <p class="err">{error}</p>
        <button class="retry" onclick={() => (current ? openBoard(current) : init())}>
          Retry
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
    {:else}
      <Board {stacks} boardId={current?.id} {client} onDrop={handleDrop} onOpenCard={handleOpenCard} />
    {/if}
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
      onDiscard={detail.discardDraft}
    >
      {#snippet main()}
        <CardCoreEditor
          card={detail.state.card}
          error={detail.state.actionScope === 'core' ? detail.state.actionError : null}
          onDraftChange={detail.setDraftPending}
          onSave={(changes) => {
            detail.editDraft(changes);
            return detail.saveCore();
          }}
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

  {#if board.state.toast}
    <div class="toast">{board.state.toast.text}</div>
  {/if}
</div>

<style>
  .app { display: flex; height: 100%; }

  .rail {
    flex: 0 0 var(--rail-w);
    display: flex;
    justify-content: center;
    padding-top: 14px;
    background: rgba(0, 0, 0, .26);
    backdrop-filter: blur(6px);
    border-right: 1px solid rgba(255, 255, 255, .09);
  }
  .rail-icon { color: var(--text-dim); font-size: 18px; }

  .main { display: flex; flex-direction: column; flex: 1; min-width: 0; }

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
  }
  .stat { font-size: 12px; color: var(--text-dim); }
  .pending { font-size: 12px; color: var(--accent); }

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

  /* Failures surface here rather than blocking the board (PLAN.md §4.1). */
  .toast {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2000;
    max-width: 520px;
    padding: 10px 16px;
    background: #5D1F1A;
    border: 1px solid #A5342B;
    border-radius: 8px;
    color: #FFD5D2;
    font-size: 13px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, .5);
  }

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
