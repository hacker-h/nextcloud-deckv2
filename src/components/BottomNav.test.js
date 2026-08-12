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

  it('switches back to the board view', async () => {
    const onBoard = vi.fn();
    const { container } = render(BottomNav, { props: { activeView: 'planner', onBoard } });
    const board = tab('Board');

    await userEvent.click(board);

    expect(onBoard).toHaveBeenCalledOnce();
    expect(board).toHaveAttribute('aria-pressed', 'false');
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

  it('opens and marks the Proton-backed Planner view', async () => {
    const onPlanner = vi.fn();
    const { rerender } = render(BottomNav, { props: { onPlanner } });

    await userEvent.click(tab('Planer'));
    expect(onPlanner).toHaveBeenCalledOnce();

    rerender({ activeView: 'planner', onPlanner });
    expect(tab('Planer')).toHaveAttribute('aria-pressed', 'true');
    expect(tab('Board')).toHaveAttribute('aria-pressed', 'false');
  });
});
