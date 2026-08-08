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

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Aktionen' }));

describe('CardLifecycleMenu', () => {
  it('requires confirmation before archiving', async () => {
    const { onArchive } = setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Karte archivieren' }));

    expect(onArchive).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('"Detail QA" archivieren?');
  });

  it('dispatches no request when archive is cancelled', async () => {
    const { onArchive } = setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Karte archivieren' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(onArchive).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('archives once confirmed', async () => {
    const { onArchive } = setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Karte archivieren' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Archivieren' }));

    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it('offers unarchive instead of archive for an archived card', async () => {
    const { onUnarchive } = setup({ card: { ...card, archived: true } });

    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Karte archivieren' })).toBeNull();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Karte wiederherstellen' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Wiederherstellen' }));

    expect(onUnarchive).toHaveBeenCalledTimes(1);
  });

  it('never deletes on a single click', async () => {
    const { onDelete } = setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Karte löschen' }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Karte löschen' })).toBeDisabled();
  });

  it('keeps delete blocked when the typed title does not match', async () => {
    const { onDelete } = setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Karte löschen' }));
    await fireEvent.input(screen.getByLabelText('Kartentitel bestätigen'), {
      target: { value: 'Detail Q' },
    });

    expect(screen.getByRole('button', { name: 'Karte löschen' })).toBeDisabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Karte löschen' }));
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('deletes once the exact title is typed', async () => {
    const { onDelete } = setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Karte löschen' }));
    await fireEvent.input(screen.getByLabelText('Kartentitel bestätigen'), {
      target: { value: 'Detail QA' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Karte löschen' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('states that deletion cannot be undone', async () => {
    setup();

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Karte löschen' }));

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'kann nicht rückgängig gemacht werden',
    );
  });

  it('prevents double-submit while a delete is pending', async () => {
    let release;
    const onDelete = vi.fn(() => new Promise((r) => (release = r)));
    setup({ onDelete });

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Karte löschen' }));
    await fireEvent.input(screen.getByLabelText('Kartentitel bestätigen'), {
      target: { value: 'Detail QA' },
    });
    const button = screen.getByRole('button', { name: 'Karte löschen' });
    await fireEvent.click(button);
    await fireEvent.click(button);

    expect(onDelete).toHaveBeenCalledTimes(1);
    release?.();
  });

  it('keeps the confirmation open and shows the error when the request fails', async () => {
    const onArchive = vi.fn().mockResolvedValue(false);
    setup({ onArchive, error: 'Request failed with status 403' });

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Karte archivieren' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Archivieren' }));

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Request failed with status 403');
  });

  it('keeps the delete confirmation open and shows the error on a server failure', async () => {
    const onDelete = vi.fn().mockResolvedValue(false);
    setup({ onDelete, error: 'Request failed with status 500' });

    await openMenu();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Karte löschen' }));
    await fireEvent.input(screen.getByLabelText('Kartentitel bestätigen'), {
      target: { value: 'Detail QA' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Karte löschen' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Request failed with status 500');
  });
});
