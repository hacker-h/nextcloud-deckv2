import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import CardLifecycleMenu from './CardLifecycleMenu.svelte';

const card = { id: 10193, title: 'Detail QA', archived: false };

function setup(props = {}) {
  const handlers = {
    onArchive: vi.fn().mockResolvedValue(true),
    onUnarchive: vi.fn().mockResolvedValue(true),
    onDelete: vi.fn().mockResolvedValue(true),
  };
  render(CardLifecycleMenu, { props: { card, ...handlers, ...props } });
  return handlers;
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Actions' }));

describe('CardLifecycleMenu', () => {
  it('requires confirmation before archiving', async () => {
    const { onArchive } = setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Archive card' }));

    expect(onArchive).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Archive "Detail QA"?');
  });

  it('dispatches no request when archive is cancelled', async () => {
    const { onArchive } = setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Archive card' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onArchive).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('archives once confirmed', async () => {
    const { onArchive } = setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Archive card' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it('offers unarchive instead of archive for an archived card', async () => {
    const { onUnarchive } = setup({ card: { ...card, archived: true } });

    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Archive card' })).toBeNull();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Unarchive card' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));

    expect(onUnarchive).toHaveBeenCalledTimes(1);
  });

  it('never deletes on a single click', async () => {
    const { onDelete } = setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete card' }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete card' })).toBeDisabled();
  });

  it('keeps delete blocked when the typed title does not match', async () => {
    const { onDelete } = setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete card' }));
    await fireEvent.input(screen.getByLabelText('Confirm card title'), {
      target: { value: 'Detail Q' },
    });

    expect(screen.getByRole('button', { name: 'Delete card' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Delete card' }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('deletes once the exact title is typed', async () => {
    const { onDelete } = setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete card' }));
    await fireEvent.input(screen.getByLabelText('Confirm card title'), {
      target: { value: 'Detail QA' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete card' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('states that deletion cannot be undone', async () => {
    setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete card' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'cannot be undone in Deck v2 — the API provides no way to restore a deleted card',
    );
  });

  it('prevents double-submit while a delete is pending', async () => {
    let release;
    const onDelete = vi.fn(() => new Promise((r) => (release = r)));
    setup({ onDelete });

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete card' }));
    await fireEvent.input(screen.getByLabelText('Confirm card title'), {
      target: { value: 'Detail QA' },
    });
    const button = screen.getByRole('button', { name: 'Delete card' });
    await fireEvent.click(button);
    await fireEvent.click(button);

    expect(onDelete).toHaveBeenCalledTimes(1);
    release?.();
  });

  it('keeps the confirmation open and shows the error when the request fails', async () => {
    const onArchive = vi.fn().mockResolvedValue(false);
    setup({ onArchive, error: 'Request failed with status 403' });

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Archive card' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Request failed with status 403');
  });

  it('keeps the delete confirmation open and shows the error on a server failure', async () => {
    const onDelete = vi.fn().mockResolvedValue(false);
    setup({ onDelete, error: 'Request failed with status 500' });

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Delete card' }));
    await fireEvent.input(screen.getByLabelText('Confirm card title'), {
      target: { value: 'Detail QA' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Delete card' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Request failed with status 500');
  });
});
