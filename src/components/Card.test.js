import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/svelte';
import Card from './Card.svelte';

const base = {
  id: 10193,
  title: 'Smoke test card',
  description: '',
  duedate: null,
  labels: [],
  commentsCount: 0,
  attachmentCount: 0,
};

describe('Card', () => {
  it('renders the card title and exposes its id for drag targeting', () => {
    const { container } = render(Card, { props: { card: base, onDrop: () => {} } });

    expect(screen.getByText('Smoke test card')).toBeInTheDocument();
    expect(container.querySelector('[data-card-id="10193"]')).not.toBeNull();
  });

  it('never renders a link into native Nextcloud Deck', () => {
    const { container } = render(Card, { props: { card: base, onDrop: () => {} } });

    expect(container.querySelector('a')).toBeNull();
    expect(container.innerHTML).not.toContain('apps/deck');
  });

  it('shows badges only for metadata the card actually has', () => {
    const { container } = render(Card, {
      props: {
        card: { ...base, description: 'has one', commentsCount: 2, attachmentCount: 3 },
        onDrop: () => {},
      },
    });

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(container.querySelector('.meta')).not.toBeNull();
  });

  it('renders an image thumbnail preview when the card has an image attachment', () => {
    render(Card, {
      props: {
        card: {
          ...base,
          attachments: [{ id: 1, name: 'screenshot.png', mimetype: 'image/png', url: 'https://example.com/thumb.png' }],
        },
        onDrop: () => {},
      },
    });

    const img = screen.getByRole('img', { name: 'screenshot.png' });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/thumb.png');
  });

  it('opens the ImageLightbox when the thumbnail button is clicked', async () => {
    const { fireEvent } = await import('@testing-library/svelte');
    render(Card, {
      props: {
        card: {
          ...base,
          attachments: [{ id: 1, name: 'screenshot.png', mimetype: 'image/png', url: 'https://example.com/thumb.png' }],
        },
        onDrop: () => {},
      },
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Vorschau vergrößern' }));

    const dialog = screen.getByRole('dialog', { name: 'screenshot.png' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('img', { name: 'screenshot.png' })).toHaveAttribute('src', 'https://example.com/thumb.png');
  });
});
