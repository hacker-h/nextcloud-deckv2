import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CardDetailModal from './CardDetailModal.svelte';

const card = { id: 10193, title: 'Detail QA' };

function open(props = {}) {
  return render(CardDetailModal, { props: { card, onClose: () => {}, ...props } });
}

describe('CardDetailModal', () => {
  it('exposes dialog semantics labelled by the card title', () => {
    open();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Detail QA');
    expect(screen.getAllByText('Detail QA')).toHaveLength(1);
  });

  it('edits the single visible header title on Enter', async () => {
    const onRename = vi.fn().mockResolvedValue(true);
    open({ onRename });

    await fireEvent.click(screen.getByRole('button', { name: 'Detail QA' }));
    const input = screen.getByLabelText('Kartentitel');
    await fireEvent.input(input, { target: { value: 'Renamed card' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).toHaveBeenCalledWith({ title: 'Renamed card' });
  });

  it('saves the header title on blur and cancels it on Escape', async () => {
    const onRename = vi.fn().mockResolvedValue(true);
    open({ onRename });

    await fireEvent.click(screen.getByRole('button', { name: 'Detail QA' }));
    let input = screen.getByLabelText('Kartentitel');
    await fireEvent.input(input, { target: { value: 'Blurred title' } });
    await fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith({ title: 'Blurred title' });

    await fireEvent.click(screen.getByRole('button', { name: 'Detail QA' }));
    input = screen.getByLabelText('Kartentitel');
    await fireEvent.input(input, { target: { value: 'Discarded' } });
    await fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Detail QA' })).toBeInTheDocument();
  });

  it('silently restores the current title instead of saving whitespace', async () => {
    const onRename = vi.fn();
    open({ onRename });

    await fireEvent.click(screen.getByRole('button', { name: 'Detail QA' }));
    const input = screen.getByLabelText('Kartentitel');
    await fireEvent.input(input, { target: { value: '   ' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Detail QA' })).toBeInTheDocument();
  });

  it('saves a title draft before a backdrop close instead of discarding it', async () => {
    let finishRename;
    const onRename = vi.fn(() => new Promise((resolve) => { finishRename = resolve; }));
    const onClose = vi.fn();
    const { container } = open({ onRename, onClose });

    await fireEvent.click(screen.getByRole('button', { name: 'Detail QA' }));
    await fireEvent.input(screen.getByLabelText('Kartentitel'), { target: { value: 'Keep this title' } });
    await fireEvent.pointerDown(container.querySelector('.backdrop'));

    expect(onRename).toHaveBeenCalledWith({ title: 'Keep this title' });
    expect(onClose).not.toHaveBeenCalled();
    finishRename({ title: 'Keep this title' });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  it('awaits a title save before the close button dismisses the modal', async () => {
    const onRename = vi.fn().mockResolvedValue({ title: 'Saved by close' });
    const onClose = vi.fn();
    open({ onRename, onClose });

    await fireEvent.click(screen.getByRole('button', { name: 'Detail QA' }));
    await fireEvent.input(screen.getByLabelText('Kartentitel'), { target: { value: 'Saved by close' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Kartendetails schließen' }));

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onRename).toHaveBeenCalledOnce();
    expect(screen.queryByText('Sie haben ungespeicherte Änderungen.')).not.toBeInTheDocument();
  });

  it('keeps the modal open and contains rename failures', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('write exploded'));
    const onClose = vi.fn();
    open({ onRename, onClose });

    await fireEvent.click(screen.getByRole('button', { name: 'Detail QA' }));
    await fireEvent.input(screen.getByLabelText('Kartentitel'), { target: { value: 'Failed title' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Kartendetails schließen' }));

    await vi.waitFor(() => expect(onRename).toHaveBeenCalledOnce());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('locks body scroll while open and restores it on close', () => {
    const { unmount } = open();
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });

  it('closes on Escape and restores focus to the originating element', async () => {
    const opener = document.createElement('button');
    opener.setAttribute('data-card-id', '10193');
    document.body.append(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const onClose = vi.fn();
    const { unmount } = open({ onClose });

    expect(document.activeElement).not.toBe(opener);

    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('keeps Tab and Shift+Tab focus inside the dialog', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);

    open();
    const dialog = screen.getByRole('dialog');
    const items = [...dialog.querySelectorAll('button')];
    expect(items.length).toBeGreaterThan(0);

    items[items.length - 1].focus();
    await fireEvent.keyDown(window, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(items[0]);

    items[0].focus();
    await fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(items[items.length - 1]);

    expect(document.activeElement).not.toBe(outside);
    outside.remove();
  });

  it('closes on a backdrop click when there is nothing to lose', async () => {
    const onClose = vi.fn();
    const { container } = open({ onClose });

    await fireEvent.pointerDown(container.querySelector('.backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('guards a dirty draft on backdrop click and honours each choice', async () => {
    const onClose = vi.fn();
    const onDiscard = vi.fn();
    const { container } = open({ dirty: true, onClose, onDiscard });

    await fireEvent.pointerDown(container.querySelector('.backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Sie haben ungespeicherte Änderungen.')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Weiter bearbeiten' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await fireEvent.keyDown(window, { key: 'Escape' });
    await fireEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves before closing when the dirty guard offers Save', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    open({ dirty: true, onSave, onClose });

    await fireEvent.keyDown(window, { key: 'Escape' });
    await fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the loading skeleton instead of content', () => {
    open({ loading: true });

    expect(screen.getByTestId('detail-skeleton')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
  });

  it('renders an error with a retry action', async () => {
    const onRetry = vi.fn();
    open({ error: 'Could not load this card', onRetry });

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load this card');
    await fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('never links into native Nextcloud Deck', () => {
    const { container } = open();

    expect(container.querySelector('a')).toBeNull();
    expect(container.innerHTML).not.toContain('apps/deck');
  });

  it('uploads a file pasted from the clipboard and displays Toast notification', async () => {
    const onUploadAttachment = vi.fn().mockResolvedValue(undefined);
    open({ onUploadAttachment });

    const file = new File(['image-data'], 'pasted-screen.png', { type: 'image/png' });
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: { items: [{ kind: 'file', getAsFile: () => file }] },
    });

    await fireEvent(window, pasteEvent);

    expect(onUploadAttachment).toHaveBeenCalledWith(expect.objectContaining({ name: 'pasted-screen.png' }));
    expect(screen.getByRole('status')).toHaveTextContent('Erfolgreich');
  });
});
