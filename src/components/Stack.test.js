import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import Stack from './Stack.svelte';

const stack = { id: 9, title: 'Doing', cards: [] };

describe('Stack add-card composer', () => {
  it('opens from an enabled add-card button and submits a trimmed title', async () => {
    const onAddCard = vi.fn().mockResolvedValue({ id: 88 });
    const user = userEvent.setup();
    render(Stack, { props: { stack, boardId: 116, onAddCard } });

    const add = screen.getByRole('button', { name: 'Eine Karte hinzufügen' });
    expect(add).toBeEnabled();
    await user.click(add);
    const input = screen.getByRole('textbox', { name: 'Neue Karte in Doing' });
    await user.type(input, '  New card  {Enter}');

    expect(onAddCard).toHaveBeenCalledWith({ boardId: 116, stackId: 9, title: 'New card' });
    expect(await screen.findByRole('button', { name: 'Eine Karte hinzufügen' })).toHaveFocus();
  });

  it('keeps the composer open and reports a failed create', async () => {
    const onAddCard = vi.fn().mockRejectedValue(new Error('Server unavailable'));
    const user = userEvent.setup();
    render(Stack, { props: { stack, boardId: 116, onAddCard } });

    await user.click(screen.getByRole('button', { name: 'Eine Karte hinzufügen' }));
    await user.type(screen.getByRole('textbox'), 'New card{Enter}');

    expect(await screen.findByRole('alert')).toHaveTextContent('Server unavailable');
    expect(screen.getByRole('textbox')).toHaveValue('New card');
  });

  it('cancels with Escape without creating a card', async () => {
    const onAddCard = vi.fn();
    render(Stack, { props: { stack, boardId: 116, onAddCard } });

    await fireEvent.click(screen.getByRole('button', { name: 'Eine Karte hinzufügen' }));
    await fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

    expect(onAddCard).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('rejects whitespace and prevents duplicate submissions while saving', async () => {
    let resolveCreate;
    const onAddCard = vi.fn(() => new Promise((resolve) => { resolveCreate = resolve; }));
    const user = userEvent.setup();
    render(Stack, { props: { stack, boardId: 116, onAddCard } });

    await user.click(screen.getByRole('button', { name: 'Eine Karte hinzufügen' }));
    const input = screen.getByRole('textbox');
    await user.type(input, '   ');
    expect(screen.getByRole('button', { name: 'Karte hinzufügen' })).toBeDisabled();

    await user.clear(input);
    await user.type(input, 'Only once{Enter}');
    await fireEvent.keyDown(input, { key: 'Enter' });
    expect(onAddCard).toHaveBeenCalledOnce();

    resolveCreate({ id: 88 });
    expect(await screen.findByRole('button', { name: 'Eine Karte hinzufügen' })).toBeVisible();
  });
});
