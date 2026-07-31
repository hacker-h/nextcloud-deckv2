import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CardAttachments from './CardAttachments.svelte';

function attachment(id, overrides = {}) {
  return {
    id,
    cardId: 10193,
    type: 'deck_file',
    name: 'detail-test.txt',
    mimetype: 'text/plain',
    size: 2048,
    deletedAt: 0,
    ...overrides,
  };
}

function setup(props = {}) {
  const handlers = {
    onUpload: vi.fn().mockResolvedValue(undefined),
    onRename: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onRestore: vi.fn().mockResolvedValue(undefined),
    onDownload: vi.fn().mockResolvedValue(undefined),
  };
  render(CardAttachments, { props: { attachments: [], ...handlers, ...props } });
  return handlers;
}

const file = (name = 'detail-test.txt') => new File(['hello'], name, { type: 'text/plain' });

describe('CardAttachments', () => {
  it('shows an empty state', () => {
    setup();
    expect(screen.getByText('No attachments')).toBeInTheDocument();
  });

  it('uploads a file chosen through the picker', async () => {
    const { onUpload } = setup();
    const f = file();

    await fireEvent.change(screen.getByLabelText('Attach a file'), { target: { files: [f] } });

    expect(onUpload).toHaveBeenCalledWith(f);
  });

  it('uploads a dropped file without bubbling the drag to the board', async () => {
    const { onUpload } = setup();
    const boardDrop = vi.fn();
    document.body.addEventListener('drop', boardDrop);
    const f = file();

    const zone = screen.getByTestId('dropzone');
    await fireEvent.dragEnter(zone, { dataTransfer: { files: [f] } });
    await fireEvent.drop(zone, { dataTransfer: { files: [f] } });

    expect(onUpload).toHaveBeenCalledWith(f);
    expect(boardDrop).not.toHaveBeenCalled();
    document.body.removeEventListener('drop', boardDrop);
  });

  it('lists attachments with a human-readable size', () => {
    setup({ attachments: [attachment(1)] });

    expect(screen.getByText('detail-test.txt')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
  });

  it('renames an attachment', async () => {
    const { onRename } = setup({ attachments: [attachment(1)] });

    await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await fireEvent.input(screen.getByLabelText('Attachment name'), {
      target: { value: 'detail-renamed.txt' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'detail-renamed.txt');
  });

  it('does not call rename when the name is unchanged', async () => {
    const { onRename } = setup({ attachments: [attachment(1)] });

    await fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onRename).not.toHaveBeenCalled();
  });

  it('deletes an attachment', async () => {
    const { onDelete } = setup({ attachments: [attachment(1)] });

    await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('offers restore only for deleted attachments', async () => {
    const { onRestore } = setup({
      attachments: [attachment(1, { deletedAt: 1767610000 })],
    });

    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('downloads through the authenticated handler rather than a raw link', async () => {
    const { onDownload } = setup({ attachments: [attachment(1)] });

    const button = screen.getByRole('button', { name: 'Download' });
    expect(button.tagName).toBe('BUTTON');
    await fireEvent.click(button);

    expect(onDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('surfaces an upload failure with retry and re-sends the same file', async () => {
    const onUpload = vi
      .fn()
      .mockRejectedValueOnce(new Error('Request failed with status 413'))
      .mockResolvedValueOnce(undefined);
    setup({ onUpload });
    const f = file();

    await fireEvent.change(screen.getByLabelText('Attach a file'), { target: { files: [f] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Request failed with status 413');

    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onUpload).toHaveBeenCalledTimes(2);
    expect(onUpload).toHaveBeenNthCalledWith(2, f);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never starts a second upload while one is pending', async () => {
    let release;
    const onUpload = vi.fn(() => new Promise((r) => (release = r)));
    setup({ onUpload });

    const picker = screen.getByLabelText('Attach a file');
    await fireEvent.change(picker, { target: { files: [file('a.txt')] } });
    await fireEvent.change(picker, { target: { files: [file('b.txt')] } });

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Uploading…');
    release?.();
  });

  it('renders attachment names as text, never as markup', () => {
    setup({ attachments: [attachment(1, { name: '<img src=x>' })] });

    const name = screen.getByText('<img src=x>');
    expect(name.querySelector('img')).toBeNull();
    expect(name.innerHTML).not.toContain('<img');
  });
});
