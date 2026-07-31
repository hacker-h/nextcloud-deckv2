import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CardComments from './CardComments.svelte';

function comment(id, overrides = {}) {
  return {
    id,
    message: `Comment ${id}`,
    actorId: 'alice',
    actorDisplayName: 'Alice',
    creationDateTime: '2026-01-05T10:00:00Z',
    parentId: null,
    mentions: [],
    canEdit: true,
    ...overrides,
  };
}

function setup(props = {}) {
  const handlers = {
    onAdd: vi.fn().mockResolvedValue(undefined),
    onEdit: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
  };
  render(CardComments, { props: { comments: [], ...handlers, ...props } });
  return handlers;
}

const type = (label, value) =>
  fireEvent.input(screen.getByLabelText(label), { target: { value } });

describe('CardComments', () => {
  it('shows an empty state with no comments', () => {
    setup();
    expect(screen.getByText('No comments yet')).toBeInTheDocument();
  });

  it('creates a comment and clears the composer', async () => {
    const { onAdd } = setup();

    await type('Write a comment', 'Card detail QA');
    await fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    expect(onAdd).toHaveBeenCalledWith('Card detail QA', {});
    expect(screen.getByLabelText('Write a comment')).toHaveValue('');
  });

  it('cannot submit blank or whitespace-only content', async () => {
    const { onAdd } = setup();

    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
    await type('Write a comment', '   ');
    expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('cannot double-submit while a create is pending', async () => {
    let release;
    const onAdd = vi.fn(() => new Promise((r) => (release = r)));
    setup({ onAdd });

    await type('Write a comment', 'Only once');
    const button = screen.getByRole('button', { name: 'Comment' });
    await fireEvent.click(button);
    await fireEvent.click(button);
    await fireEvent.click(button);

    expect(onAdd).toHaveBeenCalledTimes(1);
    release?.();
  });

  it('replies to a comment with the parent id', async () => {
    const { onAdd } = setup({ comments: [comment(1)] });

    await fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await type('Write a reply', 'Acknowledged');
    await fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    expect(onAdd).toHaveBeenCalledWith('Acknowledged', { parentId: 1 });
  });

  it('renders replies nested under their parent in order', () => {
    setup({
      comments: [
        comment(1, { message: 'Parent' }),
        comment(2, { message: 'Child', parentId: 1 }),
      ],
    });

    const messages = screen.getAllByText(/Parent|Child/).map((n) => n.textContent);
    expect(messages).toEqual(['Parent', 'Child']);
  });

  it('edits an own comment', async () => {
    const { onEdit } = setup({ comments: [comment(1)] });

    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await type('Edit comment', 'Card detail QA updated');
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'Card detail QA updated');
  });

  it('deletes an own comment', async () => {
    const { onDelete } = setup({ comments: [comment(1)] });

    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('hides edit and delete for comments by other users', () => {
    setup({
      comments: [comment(1, { actorId: 'bob', actorDisplayName: 'Bob', canEdit: false })],
    });

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument();
  });

  it('preserves the draft and offers retry when a create fails', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('Request failed with status 500'));
    setup({ onAdd });

    await type('Write a comment', 'Do not lose me');
    await fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

    expect(screen.getByLabelText('Write a comment')).toHaveValue('Do not lose me');
    expect(screen.getByRole('alert')).toHaveTextContent('Request failed with status 500');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('keeps the edit open with the typed text when an edit fails', async () => {
    const onEdit = vi.fn().mockRejectedValue(new Error('edit rejected by server'));
    setup({ comments: [comment(1, { message: 'Original' })], onEdit });

    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await type('Edit comment', 'Rewritten');
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByLabelText('Edit comment')).toHaveValue('Rewritten');
    expect(screen.getByRole('alert')).toHaveTextContent('edit rejected by server');
  });

  it('keeps the comment listed and reports the error when a delete fails', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('delete rejected by server'));
    setup({ comments: [comment(1, { message: 'Still here' })], onDelete });

    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.getByText('Still here')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('delete rejected by server');
  });

  it('retries the exact failed payload without duplicating it', async () => {
    const onAdd = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    setup({ onAdd });

    await type('Write a comment', 'Do not lose me');
    await fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onAdd).toHaveBeenCalledTimes(2);
    expect(onAdd).toHaveBeenNthCalledWith(2, 'Do not lose me', { parentId: undefined });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders comment markup as text, never as HTML', () => {
    setup({ comments: [comment(1, { message: '<img src=x onerror=alert(1)>' })] });

    const message = screen.getByText('<img src=x onerror=alert(1)>');
    expect(message.querySelector('img')).toBeNull();
    expect(message.innerHTML).not.toContain('<img');
  });
});
