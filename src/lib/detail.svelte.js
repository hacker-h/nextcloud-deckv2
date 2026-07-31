import { archiveCard, deleteCard, getCard, unarchiveCard, updateCard } from './cards.js';
import { assignLabel, assignUser, removeLabel, unassignUser } from './assignments.js';
import { createComment, deleteComment, listComments, updateComment } from './comments.js';
import {
  deleteAttachment,
  listAttachments,
  restoreAttachment,
  updateAttachment,
  uploadAttachment,
} from './attachments.js';

export function createCardDetailStore(
  client,
  { currentUser = null, onCard = () => {}, onRemoveCard = () => {} } = {},
) {
  const s = $state({
    boardId: null,
    stackId: null,
    cardId: null,
    card: null,
    comments: [],
    attachments: [],
    loading: false,
    error: null,
    dirty: false,
    saving: 0,
    closeBlocked: false,
    draft: {},
  });

  let loadToken = 0;
  let controller = null;
  const coreQueues = new Map();

  const sameOpen = (token, cardId) => token === loadToken && s.cardId === cardId;
  const target = () => ({ boardId: s.boardId, stackId: s.stackId, cardId: s.cardId });
  const messageOf = (e) => e?.message ?? 'Card detail action failed';

  function applyCard(card) {
    if (!card || s.cardId !== card.id) return;
    s.card = card;
    onCard(card);
  }

  async function open({ boardId, stackId, cardId }) {
    controller?.abort();
    controller = new AbortController();
    const token = ++loadToken;

    s.boardId = boardId;
    s.stackId = stackId;
    s.cardId = cardId;
    s.card = null;
    s.comments = [];
    s.attachments = [];
    s.error = null;
    s.dirty = false;
    s.closeBlocked = false;
    s.draft = {};
    s.loading = true;

    try {
      const [cardResult, commentsResult, attachmentsResult] = await Promise.all([
        getCard(client, { boardId, stackId, cardId, signal: controller.signal }),
        listComments(client, cardId, currentUser),
        listAttachments(client, { boardId, stackId, cardId }, { signal: controller.signal }),
      ]);
      if (!sameOpen(token, cardId)) return;
      s.card = cardResult.data;
      s.comments = commentsResult;
      s.attachments = attachmentsResult;
      onCard(cardResult.data);
    } catch (e) {
      if (!sameOpen(token, cardId) || e?.name === 'AbortError') return;
      s.error = messageOf(e);
      s.card = null;
    } finally {
      if (sameOpen(token, cardId)) s.loading = false;
    }
  }

  function editDraft(changes) {
    s.draft = { ...s.draft, ...changes };
    s.dirty = true;
    s.closeBlocked = false;
  }

  function discardDraft() {
    s.draft = {};
    s.dirty = false;
    s.closeBlocked = false;
    s.error = null;
  }

  function requestClose() {
    if (s.dirty || s.saving > 0) {
      s.closeBlocked = true;
      return false;
    }
    close();
    return true;
  }

  function close({ discard = false } = {}) {
    if (!discard && (s.dirty || s.saving > 0)) {
      s.closeBlocked = true;
      return false;
    }
    controller?.abort();
    controller = null;
    loadToken += 1;
    s.boardId = null;
    s.stackId = null;
    s.cardId = null;
    s.card = null;
    s.comments = [];
    s.attachments = [];
    s.loading = false;
    s.error = null;
    s.dirty = false;
    s.closeBlocked = false;
    s.draft = {};
    return true;
  }

  function saveCore(changes = s.draft) {
    const queuedTarget = target();
    const queuedChanges = { ...changes };
    const snapshot = s.card ? { ...s.card } : null;
    const cardId = queuedTarget.cardId;
    if (!cardId || !Object.keys(queuedChanges).length) return Promise.resolve(null);

    if (s.cardId === cardId && s.card) Object.assign(s.card, queuedChanges);

    const previous = coreQueues.get(cardId) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      s.saving += 1;
      s.error = null;
      try {
        const r = await updateCard(client, { ...queuedTarget, changes: queuedChanges });
        if (s.cardId === cardId) {
          applyCard(r.data);
          s.draft = {};
          s.dirty = false;
          s.closeBlocked = false;
        } else {
          onCard(r.data);
        }
        return r.data;
      } catch (e) {
        if (s.cardId === cardId && snapshot) s.card = snapshot;
        if (s.cardId === cardId) {
          s.error = messageOf(e);
          s.dirty = true;
          s.draft = { ...s.draft, ...queuedChanges };
        }
        throw e;
      } finally {
        s.saving -= 1;
      }
    });

    coreQueues.set(cardId, run);
    run.then(() => {
      if (coreQueues.get(cardId) === run) coreQueues.delete(cardId);
    }, () => {
      if (coreQueues.get(cardId) === run) coreQueues.delete(cardId);
    });
    return run;
  }

  async function refreshCard(cardId = s.cardId) {
    const r = await getCard(client, { ...target(), cardId });
    if (s.cardId === cardId) applyCard(r.data);
    else onCard(r.data);
    return r.data;
  }

  // Deck answers the assign/remove verbs with an empty body, so the updated
  // card has to be read back before the tile can show the change.
  async function reconcile(r) {
    if (!r.ok) {
      s.error = r.message;
      return r;
    }
    if (r.card) applyCard(r.card);
    else await refreshCard();
    return r;
  }

  async function label(action, labelId) {
    return reconcile(await action(client, target(), labelId));
  }

  async function user(action, userId, type) {
    return reconcile(await action(client, target(), userId, type));
  }

  // Lifecycle actions only touch the board once the server has confirmed them:
  // an optimistic removal here would be unrecoverable, since Deck exposes no
  // restore endpoint for a soft-deleted card.
  async function runLifecycle(action) {
    const cardId = s.cardId;
    if (!cardId) return false;

    s.saving += 1;
    s.error = null;
    try {
      await action(client, target());
      onRemoveCard(cardId);
      close({ discard: true });
      return true;
    } catch (e) {
      s.error = messageOf(e);
      return false;
    } finally {
      s.saving -= 1;
    }
  }

  const archive = () => runLifecycle(archiveCard);
  const softDelete = () => runLifecycle(deleteCard);

  async function unarchive() {
    const cardId = s.cardId;
    if (!cardId) return false;

    s.saving += 1;
    s.error = null;
    try {
      const r = await unarchiveCard(client, target());
      applyCard(r.data);
      return true;
    } catch (e) {
      s.error = messageOf(e);
      return false;
    } finally {
      s.saving -= 1;
    }
  }

  // Comment and attachment endpoints return only their own entity, so the tile
  // counters would stay stale until some unrelated core save republished the
  // card. Derive them from the lists we just updated instead.
  function publishCounts() {
    if (!s.card) return;
    s.card = {
      ...s.card,
      commentsCount: s.comments.length,
      attachmentCount: s.attachments.filter((a) => !a.deletedAt).length,
    };
    onCard(s.card);
  }

  async function reloadComments() {
    s.comments = await listComments(client, s.cardId, currentUser);
    publishCounts();
    return s.comments;
  }

  async function addComment(message, options) {
    const c = await createComment(client, s.cardId, message, { ...options, currentUser });
    s.comments = [...s.comments, c];
    publishCounts();
    return c;
  }

  async function editComment(comment, message) {
    const c = await updateComment(client, s.cardId, comment, message, currentUser);
    s.comments = s.comments.map((x) => (x.id === c.id ? c : x));
    return c;
  }

  async function removeComment(comment) {
    const id = await deleteComment(client, s.cardId, comment, currentUser);
    s.comments = s.comments.filter((x) => x.id !== id);
    publishCounts();
    return id;
  }

  async function reloadAttachments() {
    s.attachments = await listAttachments(client, target());
    publishCounts();
    return s.attachments;
  }

  async function addAttachment(file, options) {
    const a = await uploadAttachment(client, target(), file, options);
    s.attachments = [...s.attachments, a];
    publishCounts();
    return a;
  }

  async function replaceAttachment(attachmentId, file, options) {
    const a = await updateAttachment(client, target(), attachmentId, file, options);
    s.attachments = s.attachments.map((x) => (x.id === a.id ? a : x));
    return a;
  }

  async function removeAttachment(attachmentId) {
    const id = await deleteAttachment(client, target(), attachmentId);
    s.attachments = s.attachments.filter((x) => x.id !== id);
    publishCounts();
    return id;
  }

  async function restoreDeletedAttachment(attachmentId) {
    const a = await restoreAttachment(client, target(), attachmentId);
    s.attachments = s.attachments.map((x) => (x.id === a.id ? a : x));
    publishCounts();
    return a;
  }

  return {
    state: s,
    open,
    close,
    requestClose,
    editDraft,
    discardDraft,
    saveCore,
    refreshCard,
    assignLabel: (labelId) => label(assignLabel, labelId),
    removeLabel: (labelId) => label(removeLabel, labelId),
    assignUser: (userId, type) => user(assignUser, userId, type),
    unassignUser: (userId, type) => user(unassignUser, userId, type),
    archive,
    unarchive,
    softDelete,
    reloadComments,
    addComment,
    editComment,
    removeComment,
    reloadAttachments,
    addAttachment,
    replaceAttachment,
    removeAttachment,
    restoreDeletedAttachment,
  };
}
