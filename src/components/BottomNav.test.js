import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import BottomNav from './BottomNav.svelte';

const tab = (name) => screen.getByRole('button', { name });

describe('BottomNav', () => {
  it('offers the inbox, planner, board and switcher views', () => {
    render(BottomNav, { props: {} });

    for (const name of ['Posteingang', 'Planer', 'Board', 'Boards wechseln']) {
      expect(tab(name)).toBeInTheDocument();
    }
  });

  it('marks the board as the live view', () => {
    render(BottomNav, { props: {} });

    expect(tab('Board')).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the board tab inert because the board is always mounted behind it', async () => {
    const { container } = render(BottomNav, { props: {} });
    const board = tab('Board');

    await userEvent.click(board);

    expect(board).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.tab.active')).toHaveLength(1);
  });

  it('reflects whether the inbox is open', () => {
    const { rerender } = render(BottomNav, { props: { inboxOpen: true } });
    expect(tab('Posteingang')).toHaveAttribute('aria-pressed', 'true');

    rerender({ inboxOpen: false });
    expect(tab('Posteingang')).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles the inbox', async () => {
    const onInbox = vi.fn();
    render(BottomNav, { props: { onInbox } });

    await userEvent.click(tab('Posteingang'));

    expect(onInbox).toHaveBeenCalledTimes(1);
  });

  it('asks for the board switcher and announces the menu state', async () => {
    const onSwitchBoards = vi.fn();
    const { rerender } = render(BottomNav, { props: { onSwitchBoards } });

    const button = tab('Boards wechseln');
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(button);
    expect(onSwitchBoards).toHaveBeenCalledTimes(1);

    rerender({ onSwitchBoards, switcherOpen: true });
    expect(tab('Boards wechseln')).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps the planner inert until calendar sync exists', async () => {
    render(BottomNav, { props: {} });

    expect(tab('Planer')).toBeDisabled();
  });
});
