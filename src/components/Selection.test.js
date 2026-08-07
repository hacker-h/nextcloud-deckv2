import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Card from './Card.svelte';

const card = { id: 7, title: 'Selectable card', stackId: 1 };

describe('Card selection rendering', () => {
  it('marks a selected card for assistive tech', () => {
    render(Card, { props: { card, selected: true } });

    expect(screen.getByRole('button', { name: 'Selectable card' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('leaves an unselected card unpressed', () => {
    render(Card, { props: { card, selected: false } });

    expect(screen.getByRole('button', { name: 'Selectable card' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('opens the card on Enter without touching the selection', () => {
    const onOpenCard = vi.fn();
    const onSelect = vi.fn();
    render(Card, { props: { card, onOpenCard, onSelect } });

    const el = screen.getByRole('button', { name: 'Selectable card' });
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onOpenCard).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
