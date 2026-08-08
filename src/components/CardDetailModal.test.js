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
});
